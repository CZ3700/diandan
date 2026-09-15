import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { requestRawOrderAccess } from "./order-access-observers.mjs";

test("raw access probe sends valid HTTP framing while preserving each duplicate authorization header", async () => {
  const observed = [];
  const server = createServer(async (request, response) => {
    for await (const chunk of request) assert.ok(chunk.length < 8192);
    observed.push({
      host: typeof request.headers.host === "string",
      cookies: request.rawHeaders.filter(
        (name) => name.toLowerCase() === "cookie",
      ).length,
    });
    response.writeHead(204).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await requestRawOrderAccess(
      `http://127.0.0.1:${server.address().port}`,
      "/api/v1/order-access/exchange",
      {
        headers: [
          "Cookie",
          "__Host-order=synthetic",
          "Cookie",
          "__Host-order=synthetic",
          "Content-Type",
          "application/json",
        ],
        body: "{}",
      },
    );
    assert.equal(response.status, 204);
    assert.deepEqual(observed, [{ host: true, cookies: 2 }]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
