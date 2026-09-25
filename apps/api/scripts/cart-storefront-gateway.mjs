import { Buffer } from "node:buffer";
import { createServer } from "node:http";

/** Actual API passthrough; one-shot faults can fail transport, never invent a successful business response. */
export async function createCartStorefrontGateway(base) {
  let armed = null;
  let held;
  const events = [];
  const active = new Set();
  const server = createServer(async (request, response) => {
    const url = new globalThis.URL(request.url, base);
    if (
      url.origin !== new globalThis.URL(base).origin ||
      !url.pathname.startsWith("/api/v1/") ||
      (request.method !== "GET" &&
        !/^\/api\/v1\/(?:carts|cart\/items(?:\/[^/]+(?:\/editor)?)?)$/u.test(
          url.pathname,
        ))
    ) {
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
        if (size > 8192) throw new Error("Request body bound");
        chunks.push(chunk);
      }
      const fault =
        armed?.method === request.method && armed?.path === url.pathname
          ? armed
          : null;
      if (fault) armed = null;
      if (fault?.mode === "BEFORE") {
        events.push({
          mode: fault.mode,
          upstreamStatus: null,
          downstreamHeadersSent: false,
        });
        response
          .writeHead(503, {
            "cache-control": "private, no-store",
            "content-type": "application/json",
          })
          .end(
            JSON.stringify({
              schemaVersion: 1,
              outcome: "FAILURE",
              code: "TEMPORARY_UNAVAILABLE",
            }),
          );
        return;
      }
      if (fault?.mode === "HOLD")
        await new Promise((resolve) => {
          held = resolve;
        });
      const headers = {};
      for (const name of [
        "accept",
        "content-type",
        "origin",
        "cookie",
        "x-csrf-token",
        "idempotency-key",
      ])
        if (typeof request.headers[name] === "string")
          headers[name] = request.headers[name];
      const upstream = await globalThis.fetch(url, {
        method: request.method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        redirect: "error",
        signal: globalThis.AbortSignal.any([
          controller.signal,
          globalThis.AbortSignal.timeout(30_000),
        ]),
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      if (fault?.mode === "AFTER_COMMIT" && upstream.status === 200) {
        events.push({
          mode: fault.mode,
          upstreamStatus: upstream.status,
          downstreamHeadersSent: response.headersSent,
        });
        response.destroy();
        return;
      }
      const responseHeaders = Object.fromEntries(upstream.headers);
      delete responseHeaders["content-encoding"];
      delete responseHeaders["content-length"];
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length) responseHeaders["set-cookie"] = cookies;
      response.writeHead(upstream.status, responseHeaders).end(body);
    } catch {
      if (!response.destroyed)
        response
          .writeHead(503, {
            "cache-control": "private, no-store",
            "content-type": "application/json",
          })
          .end(
            JSON.stringify({
              schemaVersion: 1,
              outcome: "FAILURE",
              code: "TRANSACTION_OUTCOME_UNKNOWN",
            }),
          );
    } finally {
      active.delete(controller);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    arm(fault) {
      if (
        armed ||
        !["BEFORE", "AFTER_COMMIT", "HOLD"].includes(fault.mode) ||
        !["POST", "PATCH", "DELETE"].includes(fault.method) ||
        !fault.path.startsWith("/api/v1/cart")
      )
        throw new TypeError("Invalid or already armed cart fault");
      armed = { ...fault };
    },
    release() {
      held?.();
      held = undefined;
    },
    events() {
      return events.map((event) => ({ ...event }));
    },
    async close() {
      held?.();
      for (const controller of active) controller.abort();
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
