import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";

const module = await import("./order-access-gateway.mjs").catch(() => null);

for (const mode of ["BEFORE_HEADERS", "AFTER_HEADERS"]) {
  test(`actual successful access response loses ${mode} without fabricated business state`, async () => {
    assert.equal(
      typeof module?.createOrderAccessResponseLossGateway,
      "function",
    );
    const credential = randomBytes(32).toString("base64url");
    let committed = 0;
    const server = createServer(async (request, response) => {
      for await (const chunk of request) {
        assert.ok(chunk.length < 8192);
      }
      committed++;
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": `__Host-order=${credential}; Secure; HttpOnly; Path=/; SameSite=Lax`,
        "cache-control": "private, no-store",
      });
      response.end(JSON.stringify({ schemaVersion: 1, outcome: "SUCCESS" }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    let gateway;
    try {
      gateway = await module.createOrderAccessResponseLossGateway({
        base: `http://127.0.0.1:${server.address().port}`,
        path: "/api/v1/order-access/exchange",
        mode,
      });
      const send = () =>
        globalThis.fetch(`${gateway.origin}/api/v1/order-access/exchange`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://store.example.test",
          },
          body: JSON.stringify({ schemaVersion: 1, token: credential }),
          signal: globalThis.AbortSignal.timeout(5000),
        });
      if (mode === "BEFORE_HEADERS") await assert.rejects(send());
      else {
        const response = await send();
        assert.match(response.headers.get("set-cookie"), /HttpOnly/u);
        await assert.rejects(response.text());
      }
      assert.equal(committed, 1);
      assert.deepEqual(gateway.events(), [
        {
          upstreamStatus: 200,
          disconnected: true,
          downstreamHeadersSent: mode === "AFTER_HEADERS",
        },
      ]);
      assert.equal(
        JSON.stringify(gateway.events()).includes(credential),
        false,
      );
      const retry = await send();
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).outcome, "SUCCESS");
      assert.equal(committed, 2);
      assert.equal(gateway.events()[1].disconnected, false);
    } finally {
      await gateway?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
