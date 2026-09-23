import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import { localControlAuthorized } from "./local-experience-control.mjs";

test("control authentication refuses equal-character unequal-byte headers over actual HTTP", async (t) => {
  const token = "a".repeat(43),
    expected = "Bearer " + token;
  const server = createServer((incoming, response) => {
    response
      .writeHead(localControlAuthorized(incoming, token) ? 200 : 404)
      .end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const get = (authorization) =>
    new Promise((resolve, reject) => {
      const outgoing = request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          headers: { authorization },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      outgoing.once("error", reject);
      outgoing.end();
    });
  assert.equal(await get("é".repeat(expected.length)), 404);
  assert.equal(await get("Bearer " + "b".repeat(43)), 404);
  assert.equal(await get(expected), 200);
});
