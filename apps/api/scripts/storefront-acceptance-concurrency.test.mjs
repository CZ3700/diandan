import assert from "node:assert/strict";
import test from "node:test";
import { runConcurrentReadRounds } from "./storefront-acceptance-concurrency.mjs";

const check = (condition, label) => assert.ok(condition, label);

test("public read acceptance starts the three independent requests together", async () => {
  const waiting = [];
  let largestGroup = 0;
  const rounds = await runConcurrentReadRounds({
    locales: ["en"],
    check,
    read: (request) =>
      new Promise((resolve) => {
        waiting.push(() => resolve({ request, status: 200, valid: true }));
        largestGroup = Math.max(largestGroup, waiting.length);
        if (waiting.length === 3)
          waiting.splice(0).forEach((finish) => finish());
      }),
  });
  assert.equal(largestGroup, 3);
  assert.equal(rounds.length, 3);
  assert.ok(rounds.every((round) => round.results.length === 3));
});

test("a concurrent public failure is saved before failing and is never retried", async () => {
  let calls = 0;
  const saved = [];
  await assert.rejects(
    runConcurrentReadRounds({
      locales: ["en", "ja"],
      check,
      read: async (request) => {
        calls++;
        return {
          request,
          status: request.kind === "seo" ? 503 : 200,
          valid: true,
          code: request.kind === "seo" ? "CONTENT_UNAVAILABLE" : null,
        };
      },
      save: async (rounds) => saved.push(globalThis.structuredClone(rounds)),
    }),
    /concurrent public read succeeds/,
  );
  assert.equal(calls, 3);
  assert.equal(saved.length, 1);
  assert.equal(
    saved[0][0].results.find((row) => row.status === 503).code,
    "CONTENT_UNAVAILABLE",
  );
});
