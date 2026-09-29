import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createOrderStorefrontGateway } from "./order-storefront-gateway.mjs";

test("order gateway routes five exact API paths without exposing request credentials", async () => {
  const server = createServer((request, response) => {
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ path: request.url }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const gateway = await createOrderStorefrontGateway({
    fallbackBase: base,
    accessBase: base,
  });
  try {
    const paths = [
      "/api/v1/order-access/exchange",
      "/api/v1/order-access/revoke",
      "/api/v1/order-access/locate",
      "/api/v1/orders/order_test",
      "/api/v1/checkout/sessions/123/order-access",
      "/api/v1/cart",
      "/api/v1/orders/order_test/extra",
    ];
    for (const path of paths) {
      const response = await globalThis.fetch(gateway.origin + path, {
        headers: { cookie: "private-canary" },
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).path, path);
    }
    assert.deepEqual(
      gateway.observations().map((item) => item.category),
      ["ORDER", "ORDER", "ORDER", "ORDER", "ORDER", "OTHER", "OTHER"],
    );
    assert.equal(
      JSON.stringify(gateway.observations()).includes("private-canary"),
      false,
    );
  } finally {
    await gateway.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("edge fault loses JSON only after actual successful cookie headers", async () => {
  const server = createServer((_request, response) => {
    response
      .writeHead(200, {
        "content-type": "application/json",
        "set-cookie":
          "__Host-fan-order=canary; Secure; HttpOnly; SameSite=Strict; Path=/",
      })
      .end('{"outcome":"SUCCESS"}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const gateway = await createOrderStorefrontGateway({
    fallbackBase: `http://127.0.0.1:${server.address().port}`,
  });
  try {
    gateway.discardNextResponse(
      "/api/storefront/order-access/exchange",
      "AFTER_HEADERS",
    );
    const response = await globalThis.fetch(
      gateway.origin + "/api/storefront/order-access/exchange",
      { method: "POST" },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/u);
    await assert.rejects(response.text());
    assert.deepEqual(gateway.observations(), [
      {
        category: "ORDER",
        method: "POST",
        status: 200,
        discarded: true,
        downstreamHeadersSent: true,
      },
    ]);
    const retry = await globalThis.fetch(
      gateway.origin + "/api/storefront/order-access/exchange",
      { method: "POST" },
    );
    assert.equal(await retry.text(), '{"outcome":"SUCCESS"}');
    gateway.discardNextResponse(
      "/api/storefront/order-access/exchange",
      "EMPTY_BODY",
    );
    const lost = await globalThis.fetch(
      gateway.origin + "/api/storefront/order-access/exchange",
      { method: "POST" },
    );
    assert.equal(lost.status, 200);
    assert.match(lost.headers.get("set-cookie"), /HttpOnly/u);
    assert.equal(await lost.text(), "");
    assert.equal(gateway.observations().at(-1).discarded, true);
    assert.throws(() =>
      gateway.discardNextResponse("/arbitrary", "BEFORE_HEADERS"),
    );
  } finally {
    await gateway.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
