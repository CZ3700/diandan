import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createCartStorefrontGateway } from "./cart-storefront-gateway.mjs";
test("cart gateway forwards real mutation bytes and only the allowed credential headers", async () => {
  const observed = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const bytes of request) body += bytes.toString();
    observed.push({ method: request.method, headers: request.headers, body });
    response
      .writeHead(200, {
        "content-type": "application/json",
        "cache-control": "private, no-store",
      })
      .end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const proxy = await createCartStorefrontGateway(
    `http://127.0.0.1:${server.address().port}`,
  );
  try {
    const response = await globalThis.fetch(
      `${proxy.origin}/api/v1/cart/items`,
      {
        method: "POST",
        headers: {
          origin: "https://shop.example.invalid",
          cookie: "__Host-fan-cart=" + "A".repeat(43),
          authorization: "Bearer ignored",
          "x-csrf-token": "A".repeat(43),
          "idempotency-key": "test-mutation-0001",
          "content-type": "application/json",
        },
        body: JSON.stringify({ fixture: true }),
      },
    );
    await response.arrayBuffer();
    assert.equal(observed[0].method, "POST");
    assert.equal(observed[0].body, '{"fixture":true}');
    assert.equal(observed[0].headers.authorization, undefined);
    assert.equal(observed[0].headers.origin, "https://shop.example.invalid");
    assert.equal(observed[0].headers["idempotency-key"], "test-mutation-0001");
    proxy.arm({
      method: "POST",
      path: "/api/v1/cart/items",
      mode: "AFTER_COMMIT",
    });
    await assert.rejects(
      globalThis.fetch(`${proxy.origin}/api/v1/cart/items`, {
        method: "POST",
        body: "{}",
      }),
    );
    assert.equal(observed.length, 2);
    assert.equal(proxy.events().at(-1).upstreamStatus, 200);
    assert.equal(proxy.events().at(-1).downstreamHeadersSent, false);
    proxy.arm({
      method: "DELETE",
      path: "/api/v1/cart/items/test",
      mode: "BEFORE",
    });
    const failure = await globalThis.fetch(
      `${proxy.origin}/api/v1/cart/items/test`,
      { method: "DELETE" },
    );
    assert.equal(failure.status, 503);
    await failure.arrayBuffer();
    assert.equal(observed.length, 2);
  } finally {
    await proxy.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
