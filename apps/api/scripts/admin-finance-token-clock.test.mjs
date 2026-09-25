import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import { startTestOidcProvider } from "../../../packages/identity-oidc/src/test-support/https-idp.mjs";
import { createFinanceTokenClock } from "./admin-finance-session-clock.mjs";

test("TEST token readiness keeps malformed, unknown and non-live challenge on the original failure path", async () => {
  const digests = [];
  let assertions = 0;
  const gate = createFinanceTokenClock({
    client: {
      query: async (_sql, values) => {
        digests.push(values[0]);
        return {
          rows:
            digests.length === 1
              ? []
              : [{ eligible: false, postgres_ready: false, node_ready: false }],
        };
      },
    },
    check: () => {
      assertions++;
    },
  });
  const tokenPepper = "d".repeat(64);
  await gate({ state: "invalid", tokenPepper });
  assert.equal(digests.length, 0);
  await gate({ state: "a".repeat(64), tokenPepper });
  await gate({ state: "b".repeat(64), tokenPepper });
  assert.equal(digests.length, 2);
  assert.notEqual(
    digests[0],
    digests[1],
    "each original state binds a distinct persisted challenge",
  );
  assert.equal(
    assertions,
    0,
    "unknown or non-live claim is never declared ready",
  );
});

test("owned valid token clock hook receives exactly its one-time authorization state", async () => {
  const states = [];
  const idp = await startTestOidcProvider({
    beforeValidTokenResponse: async ({ state }) => {
      states.push(state);
    },
  });
  try {
    const verifier = randomBytes(32).toString("base64url"),
      state = randomBytes(32).toString("hex"),
      redirect = "https://admin.example.invalid/api/admin/auth/callback";
    const url = new URL(idp.issuer + "/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: "local-admin-client",
      redirect_uri: redirect,
      state,
      nonce: randomBytes(32).toString("hex"),
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    }).toString();
    const start = await idp.fetch(url.href, { redirect: "manual" }),
      callback = new URL(start.headers.get("location"));
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "local-admin-client",
      redirect_uri: redirect,
      code: callback.searchParams.get("code"),
      code_verifier: verifier,
    });
    const exchange = () =>
      idp.fetch(idp.issuer + "/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    assert.equal((await exchange()).status, 200);
    assert.equal(states.length, 1);
    assert.ok(
      states[0] === state,
      "hook is bound to the code's original state",
    );
    assert.equal((await exchange()).status, 400);
    assert.equal(
      states.length,
      1,
      "replayed code never reaches the valid-token clock hook",
    );
  } finally {
    await idp.stop();
  }
});
