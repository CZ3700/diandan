import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { withAcceptanceResources } from "./storefront-acceptance-lifecycle.mjs";

async function listening() {
  const server = createServer((_, response) => response.end("fixture"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

test("partial initialization closes its own listener even when another cleanup fails", async () => {
  const unrelated = await listening();
  let owned;
  const initialFailure = new Error("TEST_INITIALIZATION_FAILURE");
  const cleanupFailure = new Error("TEST_CLEANUP_FAILURE");
  try {
    await assert.rejects(
      withAcceptanceResources(async (own) => {
        owned = await listening();
        own(
          "owned HTTP",
          () =>
            new Promise((resolve, reject) =>
              owned.close((error) => (error ? reject(error) : resolve())),
            ),
        );
        own("later resource", () => {
          throw cleanupFailure;
        });
        throw initialFailure;
      }),
      (error) => {
        assert.deepEqual(error.errors, [initialFailure, cleanupFailure]);
        return true;
      },
    );
    assert.equal(owned.listening, false);
    assert.equal(unrelated.listening, true);
  } finally {
    await new Promise((resolve) => unrelated.close(resolve));
  }
});

test("successful verification awaits every owned close in reverse dependency order", async () => {
  const events = [];
  const result = await withAcceptanceResources(async (own) => {
    own("database", async () => {
      events.push("database");
    });
    own("API", async () => {
      await Promise.resolve();
      events.push("API");
    });
    return "verified";
  });
  assert.equal(result, "verified");
  assert.deepEqual(events, ["API", "database"]);
});

test("cleanup failure cannot be reported as a successful verification", async () => {
  const failure = new Error("TEST_CLOSE_FAILURE");
  await assert.rejects(
    withAcceptanceResources(async (own) => {
      own("resource", () => {
        throw failure;
      });
      return "not a pass";
    }),
    (error) => error === failure,
  );
});
