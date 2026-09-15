import assert from "node:assert/strict";
import Fastify from "../../../apps/api/node_modules/fastify/fastify.js";
import { registerOrderAccessRoute } from "../../../apps/api/src/order-access-route.ts";

const origin = "https://review.example.invalid";
const configuration = {
  schemaVersion: 1,
  publicStorefrontOrigin: origin,
  sessionTtlSeconds: 900,
  linkTtlSeconds: 3600,
  rateLimit: {
    windowSeconds: 60,
    exchangeMax: 10,
    bootstrapMax: 10,
    readMax: 10,
    revokeMax: 10,
  },
};
const routes = [
  ["POST", "/api/v1/order-access/exchange"],
  [
    "POST",
    "/api/v1/checkout/sessions/10000000-0000-4000-8000-000000000001/order-access",
  ],
  ["GET", "/api/v1/orders/10000000-0000-4000-8000-000000000001"],
  ["POST", "/api/v1/order-access/revoke"],
];
let assertions = 0;
for (const fault of [
  "throw",
  "missing-schema",
  "denial-zero-delay",
  "allow-positive-delay",
  "kms-throw",
]) {
  let dispatched = 0;
  const business = async () => {
    dispatched++;
    throw new Error("Business must not execute");
  };
  const app = Fastify({ logger: false });
  registerOrderAccessRoute(app, {
    configuration,
    credentials: {
      async rateLimitAccess() {
        if (fault === "kms-throw") throw new Error("PRIVATE_REVIEW_KMS");
        return {
          schemaVersion: 1,
          tokenDigest: "a".repeat(64),
          pepperVersion: "review-v1",
        };
      },
    },
    cartCredentials: {},
    useCases: {
      exchange: business,
      bootstrap: business,
      read: business,
      revoke: business,
      async consumeRateLimit() {
        if (fault === "throw") throw new Error("PRIVATE_REVIEW_DATABASE");
        if (fault === "missing-schema")
          return { allowed: true, retryAfterSeconds: 0 };
        if (fault === "denial-zero-delay")
          return { schemaVersion: 1, allowed: false, retryAfterSeconds: 0 };
        return { schemaVersion: 1, allowed: true, retryAfterSeconds: 1 };
      },
    },
  });
  try {
    for (const [method, url] of routes) {
      const response = await app.inject({
        method,
        url,
        remoteAddress: "127.0.0.1",
        headers: { origin, "content-type": "application/json" },
        ...(method === "POST" ? { payload: { schemaVersion: 1 } } : {}),
      });
      assert.equal(response.statusCode, 503);
      assertions++;
      assert.deepEqual(response.json(), {
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "TEMPORARY_UNAVAILABLE",
      });
      assertions++;
      assert.equal(response.headers["set-cookie"], undefined);
      assertions++;
      assert.equal(response.headers["cache-control"], "private, no-store");
      assertions++;
      assert.equal(response.headers["referrer-policy"], "no-referrer");
      assertions++;
      assert.equal(response.headers["x-robots-tag"], "noindex, nofollow");
      assertions++;
    }
    assert.equal(dispatched, 0);
    assertions++;
  } finally {
    await app.close();
  }
}
process.stdout.write(
  JSON.stringify({
    status: "PASS",
    scope:
      "independent actual Fastify rate failure injection; business persistence not invoked",
    cases: 20,
    assertions,
  }) + "\n",
);
