import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

test("checkout fault gateway drops exactly one actual success response and preserves retry bytes", async () => {
  const modulePath = "./checkout-preflight-gateway.mjs";
  const module = await import(modulePath).catch(() => null);
  assert.equal(typeof module?.createCheckoutResponseLossGateway, "function");
  const received = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    received.push({
      body,
      key: request.headers["idempotency-key"],
      authorization: request.headers.authorization,
    });
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: received.length === 1 ? "CREATED" : "REPLAYED",
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const proxy = await module.createCheckoutResponseLossGateway(
    `http://127.0.0.1:${server.address().port}`,
  );
  try {
    const request = () =>
      globalThis.fetch(proxy.origin + "/api/v1/checkout/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "test-checkout-0001",
          authorization: "ignored",
        },
        body: '{"fixture":true}',
      });
    await assert.rejects(request());
    const replay = await request();
    assert.equal(replay.status, 200);
    await replay.arrayBuffer();
    assert.equal(received.length, 2);
    assert.deepEqual(received[0], received[1]);
    assert.equal(received[0].authorization, undefined);
    assert.deepEqual(
      proxy.events().map(({ upstreamStatus, disconnected }) => ({
        upstreamStatus,
        disconnected,
      })),
      [
        { upstreamStatus: 200, disconnected: true },
        { upstreamStatus: 200, disconnected: false },
      ],
    );
  } finally {
    await proxy.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
