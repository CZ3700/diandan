import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { discardCommittedCartResponse } from "./cart-http-response-loss.mjs";

test("an actual upstream commit is followed by a downstream network failure, not a fabricated response", async () => {
  let commits = 0;
  const upstream = createServer((request, response) => {
    assert.equal(request.url, "/api/v1/cart/items");
    request.resume();
    request.on("end", () => {
      commits++;
      response
        .writeHead(200, { "content-type": "application/json" })
        .end('{"committed":true}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  try {
    const result = await discardCommittedCartResponse({
      base: `http://127.0.0.1:${upstream.address().port}`,
      body: { schemaVersion: 1 },
      headers: { "content-type": "application/json" },
    });
    assert.equal(commits, 1);
    assert.deepEqual(result, {
      upstreamStatus: 200,
      clientNetworkFailure: true,
      downstreamHeadersSent: false,
    });
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});
