import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

/** TEST-only real socket loss after the original API returned a successful committed response. */
export async function createOrderAccessResponseLossGateway({
  base,
  path,
  mode,
}) {
  if (
    !["BEFORE_HEADERS", "AFTER_HEADERS"].includes(mode) ||
    !path.startsWith("/api/v1/")
  )
    throw new TypeError("Invalid access response-loss fixture");
  let pending = true;
  const events = [],
    active = new Set();
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== path) {
      request.resume();
      response.writeHead(400, { "cache-control": "private, no-store" }).end();
      return;
    }
    const controller = new globalThis.AbortController();
    active.add(controller);
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8192) throw new Error("Bounded TEST access request");
        chunks.push(chunk);
      }
      const headers = {};
      for (const name of [
        "origin",
        "content-type",
        "cookie",
        "x-csrf-token",
        "idempotency-key",
      ])
        if (typeof request.headers[name] === "string")
          headers[name] = request.headers[name];
      const upstream = await globalThis.fetch(base + path, {
        method: "POST",
        headers,
        body: Buffer.concat(chunks),
        redirect: "error",
        signal: globalThis.AbortSignal.any([
          controller.signal,
          globalThis.AbortSignal.timeout(30000),
        ]),
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      const disconnected =
        pending &&
        upstream.status === 200 &&
        JSON.parse(body.toString()).outcome === "SUCCESS";
      const responseHeaders = Object.fromEntries(upstream.headers);
      delete responseHeaders["content-encoding"];
      delete responseHeaders["transfer-encoding"];
      responseHeaders["content-length"] = String(body.length);
      if (disconnected) {
        pending = false;
        if (mode === "AFTER_HEADERS") {
          response.writeHead(upstream.status, responseHeaders);
          response.flushHeaders();
          // The client receives the real cookie headers; the JSON body never arrives.
          await delay(25);
        }
        events.push({
          upstreamStatus: upstream.status,
          disconnected: true,
          downstreamHeadersSent: response.headersSent,
        });
        response.destroy();
        return;
      }
      events.push({
        upstreamStatus: upstream.status,
        disconnected: false,
        downstreamHeadersSent: response.headersSent,
      });
      response.writeHead(upstream.status, responseHeaders).end(body);
    } catch {
      response.destroy();
    } finally {
      active.delete(controller);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    events: () => events.map((event) => ({ ...event })),
    async close() {
      for (const controller of active) controller.abort();
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
