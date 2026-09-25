import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { createServer as httpsServer } from "node:https";
import { request as httpRequest } from "node:http";
const execute = promisify(execFile);
export async function prepareLocalTls({ config, stateDirectory }) {
  const directory = path.dirname(config.tls.certificatePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await access(config.tls.certificatePath);
    await access(config.tls.privateKeyPath);
    await access(config.tls.caCertificatePath);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const caKey = path.join(directory, "ca.key"),
    csr = path.join(directory, "server.csr"),
    extensions = path.join(directory, "server.cnf");
  await writeFile(
    extensions,
    "subjectAltName=DNS:localhost,IP:127.0.0.1," +
      Object.values(config.origins)
        .map((v) => "DNS:" + new URL(v).hostname)
        .join(",") +
      "\nextendedKeyUsage=serverAuth\n",
    { mode: 0o600 },
  );
  const openssl = async (args) =>
    execute("openssl", args, { cwd: stateDirectory, timeout: 30000 });
  await openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "365",
    "-subj",
    "/CN=Fan Support local TEST CA",
    "-keyout",
    caKey,
    "-out",
    config.tls.caCertificatePath,
  ]);
  await openssl([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-subj",
    "/CN=localhost",
    "-keyout",
    config.tls.privateKeyPath,
    "-out",
    csr,
  ]);
  await openssl([
    "x509",
    "-req",
    "-in",
    csr,
    "-CA",
    config.tls.caCertificatePath,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-days",
    "365",
    "-sha256",
    "-extfile",
    extensions,
    "-out",
    config.tls.certificatePath,
  ]);
  await rm(csr);
  await rm(extensions);
}
export async function startLocalProxy({
  config,
  port,
  origin,
  target,
  own,
  name,
}) {
  const destination = new URL(target),
    publicHost = new URL(origin).host;
  if (
    destination.protocol !== "http:" ||
    destination.hostname !== "127.0.0.1" ||
    destination.origin !== target
  )
    throw new Error("Proxy requires an owned loopback origin");
  const sockets = new Set();
  const valid = (request) =>
    request.headers.host === publicHost &&
    request.url?.startsWith("/") &&
    !request.url.startsWith("//") &&
    new URL(request.url, target).origin === target;
  const headers = (request) => ({
    ...request.headers,
    "x-forwarded-host": publicHost,
    "x-forwarded-proto": "https",
  });
  const server = httpsServer(
    {
      cert: await readFile(config.tls.certificatePath),
      key: await readFile(config.tls.privateKeyPath),
      minVersion: "TLSv1.2",
    },
    (request, response) => {
      if (!valid(request)) {
        response.writeHead(421).end();
        return;
      }
      const upstream = httpRequest(
        new URL(request.url, target),
        {
          method: request.method,
          headers: headers(request),
        },
        (incoming) => {
          response.writeHead(incoming.statusCode, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on("error", () => {
        if (!response.headersSent)
          response.writeHead(503, { "cache-control": "no-store" });
        response.end();
      });
      request.pipe(upstream);
    },
  );
  server.on("upgrade", (request, socket, head) => {
    if (
      !valid(request) ||
      request.method !== "GET" ||
      request.headers.upgrade?.toLowerCase() !== "websocket"
    ) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    const upstream = httpRequest(new URL(request.url, target), {
      method: "GET",
      headers: headers(request),
    });
    upstream.once("upgrade", (response, remote, remoteHead) => {
      sockets.add(remote);
      remote.once("close", () => sockets.delete(remote));
      socket.write(
        `HTTP/1.1 ${response.statusCode} Switching Protocols\r\n` +
          Object.entries(response.headers)
            .map(([key, value]) => `${key}: ${value}\r\n`)
            .join("") +
          "\r\n",
      );
      if (remoteHead.length) socket.write(remoteHead);
      if (head.length) remote.write(head);
      socket.on("error", () => remote.destroy());
      remote.on("error", () => socket.destroy());
      socket.once("close", () => remote.destroy());
      remote.once("close", () => socket.destroy());
      socket.pipe(remote);
      remote.pipe(socket);
    });
    upstream.once("response", (response) => {
      response.resume();
      socket.destroy();
    });
    upstream.once("error", () => socket.destroy());
    upstream.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  own(
    name,
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return server;
}
