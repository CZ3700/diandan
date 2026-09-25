import { Buffer } from "node:buffer";
import { createServer as httpServer, request as httpRequest } from "node:http";
import { createServer as httpsServer } from "node:https";
import { readFile } from "node:fs/promises";

async function start(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let closing;
  return {
    port: server.address().port,
    close: () =>
      (closing ??= (async () => {
        server.closeAllConnections();
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      })()),
  };
}
async function forward(request, response, target, extraHeaders = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw new Error("TEST gateway request limit");
    chunks.push(chunk);
  }
  const headers = new globalThis.Headers();
  for (const key of [
    "accept",
    "content-type",
    "origin",
    "cookie",
    "x-csrf-token",
    "idempotency-key",
    "sec-fetch-site",
    "rsc",
    "next-router-state-tree",
    "next-router-prefetch",
    "next-url",
  ])
    if (typeof request.headers[key] === "string")
      headers.set(key, request.headers[key]);
  for (const [key, value] of Object.entries(extraHeaders))
    headers.set(key, value);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      target + request.url,
      {
        method: request.method,
        headers: Object.fromEntries(headers),
        signal: globalThis.AbortSignal.timeout(60_000),
      },
      (incoming) => {
        const chunks = [];
        let size = 0;
        incoming.on("data", (chunk) => {
          size += chunk.length;
          if (size > 16_777_216)
            incoming.destroy(new Error("TEST gateway response limit"));
          else chunks.push(chunk);
        });
        incoming.on("error", reject);
        incoming.on("end", () => {
          const responseHeaders = Object.fromEntries(
            Object.entries(incoming.headers).filter(
              ([key]) =>
                !["connection", "content-length", "transfer-encoding"].includes(
                  key,
                ),
            ),
          );
          resolve({
            result: { status: incoming.statusCode },
            responseHeaders,
            body: Buffer.concat(chunks),
            response,
          });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(chunks.length ? Buffer.concat(chunks) : undefined);
  });
}
/** One exact public TEST HTTPS origin, attached only to the owned local Next listener. */
export async function createPaymentStorefrontTlsGateway({
  certificatePath,
  privateKeyPath,
}) {
  let target, origin;
  const server = httpsServer(
    {
      cert: await readFile(certificatePath),
      key: await readFile(privateKeyPath),
      minVersion: "TLSv1.2",
    },
    async (request, response) => {
      try {
        if (
          !target ||
          request.headers.host !== new globalThis.URL(origin).host ||
          !request.url?.startsWith("/") ||
          request.url.startsWith("//")
        ) {
          response
            .writeHead(503, { "cache-control": "private, no-store" })
            .end();
          return;
        }
        const upstream = await forward(request, response, target, {
          host: new globalThis.URL(origin).host,
          "x-forwarded-host": new globalThis.URL(origin).host,
          "x-forwarded-proto": "https",
        });
        response
          .writeHead(upstream.result.status, upstream.responseHeaders)
          .end(upstream.body);
      } catch {
        if (!response.destroyed)
          response
            .writeHead(503, { "cache-control": "private, no-store" })
            .end();
      }
    },
  );
  const owned = await start(server);
  origin = `https://storefront.example.invalid:${owned.port}`;
  return {
    origin,
    close: owned.close,
    attach(value) {
      const url = new globalThis.URL(value);
      if (
        url.origin !== value ||
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1"
      )
        throw new TypeError("Invalid owned Next target");
      target = value;
    },
  };
}
/** Successful bodies always originate in the actual API; fault injection only discards transport. */
export async function createPaymentApiGateway({
  cartBase,
  checkoutBase,
  paymentBase,
}) {
  let fault;
  const observations = [];
  const server = httpServer(async (request, response) => {
    try {
      const pathname = new globalThis.URL(request.url, "http://owned.invalid")
        .pathname;
      const payment =
        pathname === "/api/v1/checkout/current/status" ||
        /^\/api\/v1\/checkout\/sessions\/[^/]+\/(?:capabilities|attempts)(?:\/|$)/u.test(
          pathname,
        );
      const checkout =
        pathname === "/api/v1/cart/validate" ||
        pathname === "/api/v1/checkout/sessions" ||
        /^\/api\/v1\/checkout\/sessions\/[^/]+\/status$/u.test(pathname);
      const upstream = await forward(
        request,
        response,
        payment ? paymentBase : checkout ? checkoutBase : cartBase,
      );
      const category = payment
        ? "PAYMENT"
        : checkout
          ? "CHECKOUT"
          : "CART_PUBLIC";
      const discard = fault && request.method === "POST" && pathname === fault;
      if (discard) fault = undefined;
      observations.push({
        category,
        method: request.method,
        status: upstream.result.status,
        discarded: Boolean(discard),
      });
      if (discard) {
        response.destroy();
        return;
      }
      response
        .writeHead(upstream.result.status, upstream.responseHeaders)
        .end(upstream.body);
    } catch {
      if (!response.destroyed)
        response.writeHead(503, { "cache-control": "private, no-store" }).end();
    }
  });
  const owned = await start(server);
  return {
    origin: `http://127.0.0.1:${owned.port}`,
    close: owned.close,
    observations: () => observations.map((entry) => ({ ...entry })),
    discardNextResponse(path) {
      if (
        fault ||
        !/^\/api\/v1\/checkout\/sessions(?:\/[a-f\d-]{36}\/attempts)?$/iu.test(
          path,
        )
      )
        throw new TypeError("Invalid TEST discard target");
      fault = path;
    },
  };
}
