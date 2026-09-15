import { Buffer } from "node:buffer";
import { createServer, request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const isOrder = (path) =>
  /^\/api\/(?:v1|storefront)\/(?:order-access\/(?:exchange|revoke)|orders\/[^/]+|checkout\/sessions\/[^/]+\/order-access)$/u.test(
    path,
  );

/** TEST socket boundary: route genuine responses or discard transport, never fabricate business data. */
export async function createOrderStorefrontGateway({
  fallbackBase,
  accessBase,
}) {
  let fault,
    target = fallbackBase;
  const observations = [],
    requests = new Set();
  const server = createServer(async (request, response) => {
    let pending;
    try {
      const pathname = new globalThis.URL(request.url, "http://owned.invalid")
        .pathname;
      const order = isOrder(pathname);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 32768) throw new Error("TEST request bound");
        chunks.push(chunk);
      }
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter(
          ([key]) =>
            !["connection", "content-length", "transfer-encoding"].includes(
              key,
            ),
        ),
      );
      const upstream = await new Promise((resolve, reject) => {
        pending = httpRequest(
          (order && accessBase ? accessBase : target) + request.url,
          { method: request.method, headers, timeout: 60000 },
          (incoming) => {
            const body = [];
            let length = 0;
            incoming.on("data", (chunk) => {
              length += chunk.length;
              if (length > 16777216)
                incoming.destroy(new Error("TEST response bound"));
              else body.push(chunk);
            });
            incoming.on("error", reject);
            incoming.on("end", () =>
              resolve({
                status: incoming.statusCode,
                headers: Object.fromEntries(
                  Object.entries(incoming.headers).filter(
                    ([key]) =>
                      ![
                        "connection",
                        "content-length",
                        "transfer-encoding",
                      ].includes(key),
                  ),
                ),
                body: Buffer.concat(body),
              }),
            );
          },
        );
        requests.add(pending);
        pending.on("error", reject);
        pending.on("timeout", () => pending.destroy(new Error("TEST timeout")));
        pending.end(chunks.length ? Buffer.concat(chunks) : undefined);
      });
      const discard =
        fault &&
        request.method === "POST" &&
        pathname === fault.path &&
        upstream.status === 200;
      if (discard) {
        const mode = fault.mode;
        fault = undefined;
        if (mode === "EMPTY_BODY") {
          observations.push({
            category: order ? "ORDER" : "OTHER",
            method: request.method,
            status: upstream.status,
            discarded: true,
            downstreamHeadersSent: true,
          });
          response.writeHead(upstream.status, upstream.headers).end();
          return;
        }
        if (mode === "AFTER_HEADERS") {
          response.writeHead(upstream.status, {
            ...upstream.headers,
            "content-length": String(upstream.body.length),
          });
          response.flushHeaders();
          await delay(50);
        }
        observations.push({
          category: order ? "ORDER" : "OTHER",
          method: request.method,
          status: upstream.status,
          discarded: true,
          downstreamHeadersSent: response.headersSent,
        });
        response.destroy();
        return;
      }
      observations.push({
        category: order ? "ORDER" : "OTHER",
        method: request.method,
        status: upstream.status,
        discarded: false,
        downstreamHeadersSent: false,
      });
      response.writeHead(upstream.status, upstream.headers).end(upstream.body);
    } catch {
      if (!response.destroyed)
        response.writeHead(503, { "cache-control": "private, no-store" }).end();
    } finally {
      if (pending) requests.delete(pending);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    attach(value) {
      const url = new globalThis.URL(value);
      if (
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1" ||
        url.origin !== value
      )
        throw new TypeError("Invalid TEST Next origin");
      target = value;
    },
    observations: () => observations.map((entry) => ({ ...entry })),
    discardNextResponse(path, mode) {
      if (
        fault ||
        !isOrder(path) ||
        !["BEFORE_HEADERS", "AFTER_HEADERS", "EMPTY_BODY"].includes(mode)
      )
        throw new TypeError("Invalid TEST discard target");
      fault = { path, mode };
    },
    async close() {
      for (const request of requests) request.destroy();
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
