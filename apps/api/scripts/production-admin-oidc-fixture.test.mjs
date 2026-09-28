import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import {
  assertOwnedOrigin,
  productionAdminEnvironment,
  reserveOwnedOrigin,
  startOwnedTlsProxy,
  ownedHttpsFetch,
} from "./production-admin-oidc-fixture.mjs";

const input = {
  adminOrigin: "https://admin.example.invalid:45101",
  apiOrigin: "https://api.example.invalid:45102",
  issuer: "https://oidc.example.invalid:45103",
  accessKey: "a".repeat(64),
  caPath: "/owned/test/ca.pem",
};
test("formal Next fixture requires production code with explicit staging OIDC and trusted CA", () => {
  const env = productionAdminEnvironment(input, {
    PATH: "/bin",
    FAN_SUPPORT_ADMIN_MODE: "TEST",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    NODE_OPTIONS: "--inspect",
    FAN_SUPPORT_ADMIN_SESSION_TOKEN: "do-not-inherit",
    PAYMENT_SECRET_STRIPE: "private-payment-canary",
    STRIPE_TEST_SECRET_KEY: "private-stripe-canary",
    STRIPE_SECRET_KEY: "private-stripe-live-canary",
  });
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.FAN_SUPPORT_DEPLOYMENT_ENV, "staging");
  assert.equal(env.FAN_SUPPORT_ADMIN_MODE, "OIDC");
  assert.equal(env.FAN_SUPPORT_INTERNAL_API_ORIGIN, input.apiOrigin);
  assert.equal(env.NODE_EXTRA_CA_CERTS, input.caPath);
  assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.FAN_SUPPORT_ADMIN_SESSION_TOKEN, undefined);
  assert.equal(env.PAYMENT_SECRET_STRIPE, undefined);
  assert.equal(env.STRIPE_TEST_SECRET_KEY, undefined);
  assert.equal(env.STRIPE_SECRET_KEY, undefined);
});
test("owned TLS proxy trusts only its certificate and exact origin", async () => {
  const upstream = createServer((_request, response) => response.end("owned"));
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  let proxy;
  try {
    const origin = await reserveOwnedOrigin("api");
    proxy = await startOwnedTlsProxy({
      origin,
      target: `http://127.0.0.1:${upstream.address().port}`,
    });
    assert.equal(
      await (await proxy.fetch(`${origin}/healthz`)).text(),
      "owned",
    );
    await assert.rejects(proxy.fetch("https://elsewhere.invalid/healthz"));
    await assert.rejects(
      ownedHttpsFetch({ origin, ca: undefined })(`${origin}/healthz`),
    );
    assert.match(proxy.pin, /^[A-Za-z0-9+/]{43}=$/u);
  } finally {
    await proxy?.stop();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
test("fixture rejects remote, HTTP, credentials, paths, and lookalike origins before starting services", () => {
  assert.equal(
    assertOwnedOrigin(input.adminOrigin, "admin"),
    input.adminOrigin,
  );
  for (const value of [
    "http://admin.example.invalid:45101",
    "https://admin.example.com:45101",
    "https://admin.example.invalid.attacker.invalid:45101",
    "https://admin.example.invalid:45101/path",
    "https://user@admin.example.invalid:45101",
    "https://admin.example.invalid:45101?x=y",
  ])
    assert.throws(() => assertOwnedOrigin(value, "admin"));
  assert.throws(() =>
    productionAdminEnvironment({
      ...input,
      apiOrigin: "http://127.0.0.1:45102",
    }),
  );
});
