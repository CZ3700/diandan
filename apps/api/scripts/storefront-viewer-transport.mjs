import { createSecureServer } from "node:http2";
import { Agent, request } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Transform, pipeline } from "node:stream";
import { setTimeout, clearTimeout } from "node:timers";
import { URL } from "node:url";

const viewerHostname = "media.example.invalid";
const protocols = ["http/1.1", "h2"];
const hopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "http2-settings",
];
function validateProtocol(protocol) {
  if (!protocols.includes(protocol))
    throw new TypeError("Unsupported TEST viewer protocol");
}
function localUpstream(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Invalid TEST upstream origin");
  }
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new TypeError(
      "TEST upstream must be a credential-free local HTTP origin",
    );
  return url;
}
function endToEndHeaders(headers, requestHeaders = false) {
  const excluded = new Set([
    ...hopHeaders,
    ...String(headers.connection ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase()),
    ...(requestHeaders ? ["host", "content-length"] : []),
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) =>
        value !== undefined &&
        !name.startsWith(":") &&
        !excluded.has(name.toLowerCase()),
    ),
  );
}
function originForm(target) {
  if (
    typeof target !== "string" ||
    !target.startsWith("/") ||
    target.startsWith("//")
  )
    return false;
  for (const character of target) {
    const code = character.charCodeAt(0);
    if (code <= 32 || code === 127 || character === "\\" || character === "#")
      return false;
  }
  return true;
}
function boundedInteger(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new TypeError(`Invalid TEST ${label} bound`);
}

/**
 * TEST-only loopback viewer. TLS/ALPN changes; the upstream HTTP agent and byte
 * pipeline do not. Snapshot records entity bytes, never transfer framing or PII.
 */
export async function createStorefrontViewerTransport({
  upstreamOrigin,
  certificatePath,
  privateKeyPath,
  protocol = "http/1.1",
  requestTimeoutMs = 60_000,
  maxRecords = 10_000,
}) {
  const upstream = localUpstream(upstreamOrigin);
  validateProtocol(protocol);
  boundedInteger(requestTimeoutMs, 300_000, "request timeout");
  boundedInteger(maxRecords, 100_000, "record count");
  const [cert, key] = await Promise.all([
    readFile(certificatePath),
    readFile(privateKeyPath),
  ]);
  const agent = new Agent({
    keepAlive: true,
    maxSockets: 64,
    maxFreeSockets: 64,
    scheduling: "fifo",
  });
  const sockets = new Set(),
    sessions = new Set(),
    active = new Set(),
    records = [];
  let currentProtocol = protocol,
    closed = false,
    switching = false,
    overflowRequests = 0,
    origin;
  const server = createSecureServer({
    cert,
    key,
    allowHTTP1: true,
    minVersion: "TLSv1.2",
    handshakeTimeout: 10_000,
    ALPNCallback: ({ protocols: offered }) =>
      !closed && !switching && offered.includes(currentProtocol)
        ? currentProtocol
        : undefined,
  });
  function track(socket) {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  }
  server.on("connection", track);
  server.on("secureConnection", (socket) => {
    track(socket);
    if (socket.alpnProtocol !== currentProtocol || switching || closed)
      socket.destroy();
  });
  server.on("session", (session) => {
    sessions.add(session);
    session.once("close", () => sessions.delete(session));
    session.on("error", () => session.destroy());
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("tlsClientError", (_error, socket) => socket.destroy());
  server.on("unknownProtocol", (socket) => socket.destroy());
  server.setTimeout(requestTimeoutMs, (socket) => socket.destroy());
  server.on("request", (incoming, outgoing) => {
    if (closed || switching || records.length >= maxRecords) {
      if (records.length >= maxRecords) overflowRequests++;
      outgoing.writeHead(503, {
        "content-length": "0",
        "cache-control": "no-store",
      });
      outgoing.end();
      incoming.resume();
      return;
    }
    const target = incoming.url,
      validPath = originForm(target);
    const record = {
      id: records.length + 1,
      method: incoming.method,
      path: validPath ? target.split("?")[0] : null,
      httpVersion: incoming.httpVersion,
      alpnProtocol: incoming.socket.alpnProtocol || null,
      status: null,
      contentEncoding: null,
      byteLength: 0,
      sha256: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      complete: false,
      failure: null,
    };
    records.push(record);
    const digest = createHash("sha256");
    let finished = false,
      source,
      upstreamRequest;
    const context = { abort: () => fail("CLOSED", 503) };
    active.add(context);
    const timer = setTimeout(() => fail("TIMEOUT", 504), requestTimeoutMs);
    timer.unref();
    function finish(failure) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      active.delete(context);
      record.status = outgoing.statusCode;
      record.failure = failure;
      record.complete = failure === null;
      record.sha256 = digest.digest("hex");
      record.finishedAt = new Date().toISOString();
    }
    function fail(code, status = 502) {
      if (finished) return;
      if (!outgoing.headersSent && !outgoing.destroyed) {
        outgoing.statusCode = status;
        outgoing.setHeader("content-length", "0");
        outgoing.setHeader("cache-control", "no-store");
        finish(code);
        outgoing.end();
      } else {
        finish(code);
        outgoing.destroy();
      }
      upstreamRequest?.destroy();
      source?.destroy();
    }
    outgoing.on("error", () => fail("CLIENT_ABORTED"));
    outgoing.on("close", () => {
      if (!outgoing.writableFinished) fail("CLIENT_ABORTED");
    });
    incoming.on("error", () => fail("CLIENT_ABORTED"));
    incoming.on("aborted", () => fail("CLIENT_ABORTED"));
    if (!["GET", "HEAD"].includes(incoming.method)) {
      outgoing.setHeader("allow", "GET, HEAD");
      fail("METHOD_NOT_ALLOWED", 405);
      incoming.resume();
      return;
    }
    if (
      !validPath ||
      (incoming.headers[":scheme"] &&
        incoming.headers[":scheme"] !== "https") ||
      (incoming.headers[":authority"] ?? incoming.headers.host) !==
        new URL(origin).host ||
      incoming.headers["transfer-encoding"] ||
      (incoming.headers["content-length"] &&
        incoming.headers["content-length"] !== "0")
    ) {
      fail("INVALID_TARGET", 400);
      incoming.resume();
      return;
    }
    incoming.on("data", () => fail("REQUEST_BODY_NOT_ALLOWED", 400));
    incoming.resume();
    upstreamRequest = request(
      {
        hostname: upstream.hostname,
        port: upstream.port || 80,
        method: incoming.method,
        path: target,
        agent,
        headers: {
          ...endToEndHeaders(incoming.headers, true),
          host: upstream.host,
        },
      },
      (response) => {
        source = response;
        if (finished) {
          response.destroy();
          return;
        }
        response.once("aborted", () => fail("UPSTREAM_ABORTED"));
        record.contentEncoding = response.headers["content-encoding"] ?? null;
        try {
          outgoing.writeHead(
            response.statusCode,
            endToEndHeaders(response.headers),
          );
        } catch {
          fail("INVALID_UPSTREAM_HEADERS");
          return;
        }
        const meter = new Transform({
          transform(chunk, _encoding, callback) {
            record.byteLength += chunk.length;
            digest.update(chunk);
            callback(null, chunk);
          },
        });
        pipeline(response, meter, outgoing, (error) => {
          if (finished) return;
          if (error || !response.complete) fail("UPSTREAM_ABORTED");
          else finish(null);
        });
      },
    );
    upstreamRequest.on("error", () => fail("UPSTREAM_ERROR"));
    upstreamRequest.on("upgrade", (_response, socket) => {
      socket.destroy();
      fail("UPSTREAM_UPGRADE");
    });
    upstreamRequest.end();
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    agent.destroy();
    server.close();
    throw error;
  }
  origin = `https://${viewerHostname}:${server.address().port}`;
  async function destroyViewerConnections() {
    const pending = [...sockets]
      .filter((socket) => !socket.closed)
      .map((socket) => new Promise((resolve) => socket.once("close", resolve)));
    for (const session of sessions) session.destroy();
    for (const socket of sockets) socket.destroy();
    await Promise.all(pending);
  }
  let closing;
  return {
    origin,
    async setProtocol(next) {
      validateProtocol(next);
      if (closed) throw new Error("TEST viewer is closed");
      if (active.size || switching)
        throw new Error("TEST viewer has active requests or protocol switch");
      switching = true;
      await destroyViewerConnections();
      currentProtocol = next;
      switching = false;
    },
    snapshot: () => ({
      schemaVersion: 1,
      origin,
      protocol: currentProtocol,
      requests: records.map((record) => ({ ...record })),
      activeRequests: active.size,
      overflowRequests,
      closed,
    }),
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        const stopped = new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        for (const context of active) context.abort();
        await destroyViewerConnections();
        agent.destroy();
        await stopped;
      })();
      return closing;
    },
  };
}
