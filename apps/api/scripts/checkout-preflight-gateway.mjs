import { Buffer } from "node:buffer";
import { createServer } from "node:http";

/** TEST-only transport loss after the actual API has returned success; no business response is fabricated. */
export async function createCheckoutResponseLossGateway(base) {
  let pending = true;
  const events = [];
  const active = new Set();
  const server = createServer(async (request, response) => {
    if (
      request.method !== "POST" ||
      request.url !== "/api/v1/checkout/sessions"
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
        if (size > 8192) throw new Error("Bounded TEST checkout request");
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
      const upstream = await globalThis.fetch(base + request.url, {
        method: "POST",
        headers,
        body: Buffer.concat(chunks),
        redirect: "error",
        signal: globalThis.AbortSignal.any([
          controller.signal,
          globalThis.AbortSignal.timeout(30_000),
        ]),
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      const value = JSON.parse(body.toString());
      const disconnected =
        pending &&
        upstream.status === 200 &&
        value.outcome === "SUCCESS" &&
        value.action === "CREATED";
      events.push({
        upstreamStatus: upstream.status,
        disconnected,
        downstreamHeadersSent: response.headersSent,
      });
      if (disconnected) {
        pending = false;
        response.destroy();
        return;
      }
      const responseHeaders = Object.fromEntries(upstream.headers);
      delete responseHeaders["content-encoding"];
      delete responseHeaders["content-length"];
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
