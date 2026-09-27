import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, request } from "node:https";
import { URL, URLSearchParams } from "node:url";
import { TextDecoder } from "node:util";

export const privateHeaders = Object.freeze({
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
  "content-security-policy":
    "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
});
/** Loopback origins name their port; public origins are a service label under the instance's base domain on 443. */
export function localServiceOrigin(value) {
  const url = new URL(value);
  const loopback =
    /^[a-z][a-z0-9-]*\.example\.invalid$/u.test(url.hostname) && url.port;
  const exposed =
    /^(?:storefront|admin|oidc|payments|mail|media)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){2,}$/u.test(
      url.hostname,
    ) &&
    !url.hostname.endsWith(".example.invalid") &&
    !url.port;
  if (
    url.protocol !== "https:" ||
    !(loopback || exposed) ||
    url.origin !== value
  )
    throw new TypeError("Invalid local service origin");
  return url.origin;
}
export function secretEquals(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}
export function secretBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value))
    throw new TypeError("Invalid local service secret");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value)
    throw new TypeError("Invalid local service secret");
  return bytes;
}
export async function readBody(request, limit = 16384) {
  let length = 0;
  const parts = [];
  for await (const part of request) {
    length += part.length;
    if (length > limit) throw new Error("Local service request too large");
    parts.push(part);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts));
}
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/gu,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function htmlPage(title, content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${content}</main></body></html>`;
}
export async function startLocalTlsServer({ origin, port, tls, handle }) {
  localServiceOrigin(origin);
  const listenPort = port ?? Number(new URL(origin).port);
  const server = createServer(
    {
      cert: await readFile(tls.certificatePath),
      key: await readFile(tls.privateKeyPath),
      minVersion: "TLSv1.2",
    },
    (request, response) => {
      for (const [key, value] of Object.entries(privateHeaders))
        response.setHeader(key, value);
      if (request.headers.host !== new URL(origin).host) {
        request.resume();
        response.writeHead(421).end();
        return;
      }
      Promise.resolve()
        .then(() => handle(request, response))
        .catch(() => {
          if (!response.headersSent) response.writeHead(400);
          response.end();
        });
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", resolve);
  });
  let closing;
  return {
    close: () =>
      (closing ??= (async () => {
        server.closeAllConnections();
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      })()),
  };
}
/** Exact owned origins are mapped to loopback while TLS verifies the original hostname. */
export async function createLocalExperienceFetch({
  origins,
  caCertificatePath,
  targets = {},
}) {
  const approved = new Set(origins.map(localServiceOrigin));
  // Public origins have no port: owned services are reached directly, never through the edge.
  const targetFor = (url) => {
    const target = targets[url.origin] ?? {
      address: "127.0.0.1",
      port: Number(url.port),
    };
    if (!/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(target.address))
      throw new TypeError("Owned services are reached only on loopback");
    return target;
  };
  const ca = await readFile(caCertificatePath);
  return async (input, init = {}) => {
    const url = new URL(
      input instanceof globalThis.Request ? input.url : String(input),
    );
    if (!approved.has(url.origin) || url.username || url.password || url.hash)
      throw new TypeError("Unapproved local service target");
    const target = targetFor(url);
    return new Promise((resolve, reject) => {
      const outgoing = request(
        {
          hostname: target.address,
          port: target.port,
          servername: url.hostname,
          ca,
          rejectUnauthorized: true,
          path: url.pathname + url.search,
          method: init.method ?? "GET",
          headers: {
            ...Object.fromEntries(new globalThis.Headers(init.headers)),
            host: url.host,
          },
          signal: init.signal,
        },
        (incoming) => {
          const parts = [];
          let length = 0;
          incoming.on("data", (part) => {
            length += part.length;
            if (length > 4_194_304)
              incoming.destroy(new Error("Local service response too large"));
            else parts.push(part);
          });
          incoming.on("error", reject);
          incoming.on("end", () =>
            resolve(
              new globalThis.Response(
                [204, 304].includes(incoming.statusCode)
                  ? null
                  : Buffer.concat(parts),
                { status: incoming.statusCode, headers: incoming.headers },
              ),
            ),
          );
        },
      );
      outgoing.on("error", reject);
      outgoing.end(
        init.body instanceof URLSearchParams ? init.body.toString() : init.body,
      );
    });
  };
}
