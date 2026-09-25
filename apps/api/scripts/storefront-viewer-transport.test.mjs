import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import tls from "node:tls";
import net from "node:net";
import { gzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { setImmediate } from "node:timers";
import { createStorefrontViewerTransport } from "./storefront-viewer-transport.mjs";

let directory, certificatePath, privateKeyPath, ca;
const hostname = "media.example.invalid";
const entity = gzipSync(
  Buffer.from("TEST multilingual storefront image response ".repeat(1000)),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function openssl(args) {
  const result = spawnSync("openssl", args, {
    cwd: directory,
    stdio: "ignore",
  });
  assert.equal(
    result.status,
    0,
    "temporary TEST certificate generation succeeds",
  );
}
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "p306-viewer-transport-"));
  certificatePath = path.join(directory, "server.crt");
  privateKeyPath = path.join(directory, "server.key");
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-days",
    "1",
    "-subj",
    "/CN=P306 TEST CA",
  ]);
  await chmod(path.join(directory, "ca.key"), 0o600);
  openssl([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    privateKeyPath,
    "-out",
    "server.csr",
    "-subj",
    `/CN=${hostname}`,
  ]);
  await chmod(privateKeyPath, 0o600);
  await writeFile(
    path.join(directory, "server.ext"),
    `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${hostname}\n`,
    { mode: 0o600 },
  );
  openssl([
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    certificatePath,
    "-days",
    "1",
    "-sha256",
    "-extfile",
    "server.ext",
  ]);
  ca = await readFile(path.join(directory, "ca.crt"));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function fixture(t, handler, options = {}) {
  const {
    listenHost = "127.0.0.1",
    upstreamHostname = "127.0.0.1",
    ...transportOptions
  } = options;
  const sockets = new Set();
  const upstream = http.createServer(handler);
  upstream.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  upstream.listen(0, listenHost);
  await once(upstream, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => upstream.close(resolve));
  });
  const upstreamOrigin = `http://${upstreamHostname}:${upstream.address().port}`;
  const viewer = await createStorefrontViewerTransport({
    upstreamOrigin,
    certificatePath,
    privateKeyPath,
    ...transportOptions,
  });
  assert.ok(
    viewer && typeof viewer.setProtocol === "function",
    "transport creates a protocol-switchable real HTTPS viewer",
  );
  t.after(() => viewer.close());
  assert.match(viewer.origin, /^https:\/\/media\.example\.invalid:\d+$/u);
  return { viewer, upstream, upstreamOrigin };
}
function h1(origin, options = {}) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: url.port,
        servername: hostname,
        ca,
        rejectUnauthorized: true,
        ALPNProtocols: ["http/1.1"],
        agent: false,
        method: "GET",
        path: "/",
        ...options,
        headers: { host: url.host, ...options.headers },
      },
      (res) => {
        const bytes = [];
        res.on("data", (b) => bytes.push(b));
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            bytes: Buffer.concat(bytes),
            httpVersion: res.httpVersion,
            alpn: req.socket.alpnProtocol,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
async function h2Session(t, origin) {
  const url = new URL(origin);
  const session = http2.connect(origin, {
    createConnection: () =>
      tls.connect({
        host: "127.0.0.1",
        port: url.port,
        servername: hostname,
        ca,
        rejectUnauthorized: true,
        ALPNProtocols: ["h2", "http/1.1"],
      }),
  });
  session.on("error", () => {});
  t.after(() => session.destroy());
  await once(session, "connect");
  assert.equal(session.alpnProtocol, "h2");
  return session;
}
function h2(session, requestPath = "/", headers = {}) {
  return new Promise((resolve, reject) => {
    const stream = session.request({
      ":method": "GET",
      ":path": requestPath,
      ...headers,
    });
    const bytes = [];
    let response;
    stream.on("response", (h) => {
      response = h;
    });
    stream.on("data", (b) => bytes.push(b));
    stream.on("error", reject);
    stream.on("end", () =>
      resolve({
        status: response?.[":status"],
        headers: response,
        bytes: Buffer.concat(bytes),
        stream,
      }),
    );
    stream.end();
  });
}
async function waitFor(predicate) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail("bounded transport observation did not finish");
}
function compressed(_req, res) {
  res.writeHead(200, {
    "content-encoding": "gzip",
    "content-length": entity.length,
    "content-type": "image/svg+xml",
    "cache-control": "public, max-age=60",
    etag: '"test-entity"',
    vary: "Accept-Encoding",
    connection: "keep-alive, x-hop",
    "x-hop": "remove",
  });
  res.end(entity);
}

test("real trusted TLS selects H1 then H2 on one origin and preserves exact gzip entities", async (t) => {
  const seen = [];
  const { viewer, upstreamOrigin } = await fixture(t, (req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    compressed(req, res);
  });
  assert.equal((await stat(privateKeyPath)).mode & 0o777, 0o600);
  const origin = viewer.origin;
  const one = await h1(origin, {
    path: "/image?width=640&token=private-query",
    headers: {
      "accept-encoding": "gzip",
      cookie: "private-cookie",
      authorization: "private-auth",
      connection: "keep-alive, x-input-hop",
      "x-input-hop": "remove",
    },
  });
  assert.equal(one.alpn, "http/1.1");
  assert.equal(one.httpVersion, "1.1");
  assert.deepEqual(one.bytes, entity);
  await viewer.setProtocol("h2");
  assert.equal(viewer.origin, origin);
  const session = await h2Session(t, origin);
  const two = await h2(session, "/image?width=640", {
    "accept-encoding": "gzip",
  });
  assert.deepEqual(two.bytes, entity);
  assert.equal(two.status, one.status);
  for (const key of [
    "content-encoding",
    "content-length",
    "content-type",
    "cache-control",
    "etag",
    "vary",
  ])
    assert.equal(two.headers[key], one.headers[key], key);
  assert.equal(two.headers["x-hop"], undefined);
  assert.equal(one.headers["x-hop"], undefined);
  assert.equal(seen[0].url, "/image?width=640&token=private-query");
  assert.equal(seen[0].headers.host, new URL(upstreamOrigin).host);
  assert.equal(seen[0].headers["x-input-hop"], undefined);
  assert.equal(seen[0].headers.cookie, "private-cookie");
  assert.equal(seen[0].headers.authorization, "private-auth");
  await waitFor(() => viewer.snapshot().requests.every((r) => r.complete));
  const snapshot = viewer.snapshot();
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.requests.length, 2);
  for (const record of snapshot.requests) {
    assert.ok(Number.isFinite(Date.parse(record.startedAt)));
    assert.ok(Date.parse(record.finishedAt) >= Date.parse(record.startedAt));
    assert.ok(
      record.startedAt.endsWith("Z") && record.finishedAt.endsWith("Z"),
    );
  }
  assert.deepEqual(
    snapshot.requests.map((r) => [
      r.httpVersion,
      r.alpnProtocol,
      r.byteLength,
      r.sha256,
      r.complete,
      r.failure,
    ]),
    [
      ["1.1", "http/1.1", entity.length, hash(entity), true, null],
      ["2.0", "h2", entity.length, hash(entity), true, null],
    ],
  );
  assert.ok(!JSON.stringify(snapshot).includes("private-"));
  assert.equal(snapshot.requests[0].path, "/image");
  snapshot.requests[0].path = "mutated";
  snapshot.requests.push({});
  assert.equal(viewer.snapshot().requests.length, 2);
  assert.equal(viewer.snapshot().requests[0].path, "/image");
  const closed = once(session, "close");
  await viewer.setProtocol("http/1.1");
  await closed;
  assert.deepEqual((await h1(origin)).bytes, entity);
});

test("certificate trust and hostname validation are required", async (t) => {
  const { viewer } = await fixture(t, compressed);
  assert.equal((await h1(viewer.origin)).status, 200);
  await assert.rejects(h1(viewer.origin, { ca: undefined }), {
    code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  });
  await assert.rejects(
    h1(viewer.origin, { servername: "wrong.example.invalid" }),
    { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
  );
  assert.equal(viewer.snapshot().requests.length, 1);
});

test("HEAD, redirects and query headers retain upstream semantics over both protocols", async (t) => {
  const seen = [];
  const { viewer } = await fixture(t, (req, res) => {
    seen.push({ method: req.method, url: req.url, accept: req.headers.accept });
    res.writeHead(307, {
      location: "/next?sort=asc",
      "content-encoding": "gzip",
      "content-length": entity.length,
      "cache-control": "private, no-store",
      "set-cookie": ["TEST=one; Secure", "TEST_TWO=two; Secure"],
    });
    res.end(entity);
  });
  const first = await h1(viewer.origin, {
    method: "HEAD",
    path: "/from?sort=asc",
    headers: { accept: "image/*" },
  });
  await viewer.setProtocol("h2");
  const session = await h2Session(t, viewer.origin);
  const second = await h2(session, "/from?sort=asc", {
    ":method": "HEAD",
    accept: "image/*",
  });
  for (const r of [first, second]) {
    assert.equal(r.status, 307);
    assert.equal(r.bytes.length, 0);
    assert.equal(r.headers.location, "/next?sort=asc");
    assert.equal(r.headers["content-length"], String(entity.length));
    assert.equal(r.headers["content-encoding"], "gzip");
    assert.equal(r.headers["set-cookie"].length, 2);
  }
  assert.deepEqual(seen, [
    { method: "HEAD", url: "/from?sort=asc", accept: "image/*" },
    { method: "HEAD", url: "/from?sort=asc", accept: "image/*" },
  ]);
  await waitFor(() => viewer.snapshot().requests.every((r) => r.complete));
  for (const record of viewer.snapshot().requests) {
    assert.equal(record.byteLength, 0);
    assert.equal(record.sha256, hash(Buffer.alloc(0)));
  }
});

for (const upstreamOrigin of [
  "https://127.0.0.1:1",
  "http://example.com:80",
  "http://127.0.0.1.evil.invalid:1",
  "http://user:password@localhost:1",
  "http://localhost:1/path",
  "http://localhost:1/?token=value",
  "http://localhost:1/#fragment",
  "ftp://localhost:1",
]) {
  test(`rejects non-local or non-origin upstream ${upstreamOrigin.replace("user:password@", "credentials@")}`, async () => {
    await assert.rejects(
      createStorefrontViewerTransport({
        upstreamOrigin,
        certificatePath,
        privateKeyPath,
      }),
      /upstream/u,
    );
  });
}
test("read-only origin-form policy rejects mutations and absolute or authority paths without contacting upstream", async (t) => {
  let calls = 0;
  const { viewer } = await fixture(t, (_req, res) => {
    calls++;
    res.end("ok");
  });
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    assert.equal((await h1(viewer.origin, { method })).status, 405);
  for (const requestPath of [
    "http://example.invalid/private",
    "//example.invalid/private",
    "*",
    "/path#fragment",
    "/\\example.invalid/path",
  ])
    assert.equal((await h1(viewer.origin, { path: requestPath })).status, 400);
  assert.equal(calls, 0);
});

test("upstream disconnection and truncated bodies are explicit failures rather than complete entities", async (t) => {
  const { viewer } = await fixture(t, (req, res) => {
    if (req.url === "/fail") {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { "content-length": 100 });
    res.write("partial");
    setImmediate(() => res.destroy());
  });
  const failed = await h1(viewer.origin, { path: "/fail" });
  assert.equal(failed.status, 502);
  await assert.rejects(h1(viewer.origin, { path: "/cut" }));
  await waitFor(() => viewer.snapshot().activeRequests === 0);
  const records = viewer.snapshot().requests;
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal(record.complete, false);
    assert.equal(typeof record.failure, "string");
  }
  assert.ok(records[1].byteLength < 100);
});

test("absolute request deadline aborts stalled upstream and permits later requests", async (t) => {
  const { viewer } = await fixture(
    t,
    (req, res) => {
      if (req.url !== "/stall") res.end("recovered");
    },
    { requestTimeoutMs: 100 },
  );
  const result = await h1(viewer.origin, { path: "/stall" });
  assert.equal(result.status, 504);
  await waitFor(() => viewer.snapshot().activeRequests === 0);
  assert.equal(viewer.snapshot().requests[0].failure, "TIMEOUT");
  assert.equal((await h1(viewer.origin)).bytes.toString(), "recovered");
});

test("client abort stops upstream, active switching rejects, and close releases only owned listeners", async (t) => {
  let upstreamClosed = false,
    upstreamStarted = false;
  const { viewer, upstreamOrigin } = await fixture(t, (_req, res) => {
    upstreamStarted = true;
    res.on("close", () => {
      upstreamClosed = true;
    });
    res.writeHead(200);
    res.write("first");
  });
  const url = new URL(viewer.origin);
  const req = https.request(
    {
      hostname: "127.0.0.1",
      port: url.port,
      servername: hostname,
      ca,
      ALPNProtocols: ["http/1.1"],
      headers: { host: url.host },
    },
    (res) => res.on("data", () => {}),
  );
  req.on("error", () => {});
  req.end();
  await waitFor(() => upstreamStarted);
  await assert.rejects(viewer.setProtocol("h2"), /active/u);
  req.destroy();
  await waitFor(() => upstreamClosed && viewer.snapshot().activeRequests === 0);
  assert.equal(viewer.snapshot().requests[0].complete, false);
  assert.equal(viewer.snapshot().requests[0].failure, "CLIENT_ABORTED");
  await viewer.close();
  await viewer.close();
  assert.equal(viewer.snapshot().closed, true);
  await assert.rejects(
    new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port: url.port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", reject);
    }),
    { code: "ECONNREFUSED" },
  );
  const remaining = net.connect({
    host: "127.0.0.1",
    port: new URL(upstreamOrigin).port,
  });
  await once(remaining, "connect");
  remaining.destroy();
  await assert.rejects(viewer.setProtocol("http/1.1"), /closed/u);
});

test("unsupported protocol and finite record bounds fail closed", async (t) => {
  await assert.rejects(
    createStorefrontViewerTransport({
      upstreamOrigin: "http://127.0.0.1:1",
      certificatePath,
      privateKeyPath,
      protocol: "h3",
    }),
    /protocol/u,
  );
  const { viewer } = await fixture(t, (_req, res) => res.end("ok"), {
    maxRecords: 2,
  });
  await assert.rejects(viewer.setProtocol("h3"), /protocol/u);
  await h1(viewer.origin);
  await h1(viewer.origin);
  assert.equal((await h1(viewer.origin)).status, 503);
  const snapshot = viewer.snapshot();
  assert.equal(snapshot.requests.length, 2);
  assert.equal(snapshot.overflowRequests, 1);
});

test("localhost upstream preserves an IPv6-only local listener", async (t) => {
  const { viewer } = await fixture(t, compressed, {
    listenHost: "::1",
    upstreamHostname: "localhost",
  });
  assert.deepEqual((await h1(viewer.origin)).bytes, entity);
});

test("idle protocol switching selects actual ALPN and rejects an unavailable protocol", async (t) => {
  const { viewer } = await fixture(t, compressed);
  await viewer.setProtocol("h2");
  await assert.rejects(h1(viewer.origin), (error) =>
    ["EPROTO", "ECONNRESET"].includes(error.code),
  );
  assert.equal(viewer.snapshot().requests.length, 0);
  await viewer.setProtocol("http/1.1");
  const url = new URL(viewer.origin);
  const offered = tls.connect({
    host: "127.0.0.1",
    port: url.port,
    servername: hostname,
    ca,
    ALPNProtocols: ["h2", "http/1.1"],
  });
  await once(offered, "secureConnect");
  assert.equal(offered.alpnProtocol, "http/1.1");
  offered.destroy();
  await viewer.close();
  assert.equal(viewer.snapshot().closed, true);
  assert.equal(viewer.snapshot().activeRequests, 0);
});

test("HTTP2 streams arrive before upstream completion and independent requests can finish", async (t) => {
  let release,
    sentLast = false;
  const first = Buffer.alloc(64 * 1024, 97),
    last = Buffer.alloc(1024 * 1024, 98);
  const { viewer } = await fixture(
    t,
    (req, res) => {
      if (req.url !== "/slow") {
        res.end("independent");
        return;
      }
      res.writeHead(200, { "content-length": first.length + last.length });
      res.write(first);
      release = () => {
        sentLast = true;
        res.end(last);
      };
    },
    { protocol: "h2" },
  );
  const session = await h2Session(t, viewer.origin);
  const stream = session.request({ ":path": "/slow" });
  const chunks = [];
  stream.on("data", (b) => chunks.push(b));
  const finished = once(stream, "end");
  stream.end();
  await waitFor(() => chunks.length > 0);
  assert.equal(
    sentLast,
    false,
    "viewer forwards first bytes before the upstream ends",
  );
  assert.equal((await h2(session, "/fast")).bytes.toString(), "independent");
  stream.pause();
  release();
  await delay(20);
  stream.resume();
  await finished;
  assert.deepEqual(Buffer.concat(chunks), Buffer.concat([first, last]));
  await waitFor(() => viewer.snapshot().activeRequests === 0);
  const record = viewer.snapshot().requests.find((r) => r.path === "/slow");
  assert.equal(record.complete, true);
  assert.equal(record.byteLength, first.length + last.length);
  assert.equal(record.sha256, hash(Buffer.concat([first, last])));
});

test("close aborts active HTTP2 streams and freezes explicit completed or failed records", async (t) => {
  let began = false,
    upstreamClosed = false;
  const { viewer } = await fixture(
    t,
    (_req, res) => {
      began = true;
      res.on("close", () => {
        upstreamClosed = true;
      });
      res.writeHead(200);
      res.write("pending");
    },
    { protocol: "h2" },
  );
  const session = await h2Session(t, viewer.origin);
  const stream = session.request({ ":path": "/pending" });
  stream.on("error", () => {});
  stream.on("data", () => {});
  stream.end();
  await waitFor(() => began);
  await viewer.close();
  await waitFor(() => upstreamClosed);
  const snapshot = viewer.snapshot();
  assert.equal(snapshot.activeRequests, 0);
  assert.equal(snapshot.closed, true);
  assert.equal(snapshot.requests.length, 1);
  assert.equal(snapshot.requests[0].failure, "CLOSED");
  assert.equal(snapshot.requests[0].complete, false);
  assert.ok(snapshot.requests[0].finishedAt);
  assert.equal(typeof snapshot.requests[0].sha256, "string");
});
