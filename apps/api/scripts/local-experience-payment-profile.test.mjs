import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadLocalState } from "../../../scripts/local-experience-state.mjs";

async function fixture(t, paymentProvider) {
  const root = await mkdtemp(path.join(tmpdir(), "local-payment-profile-"));
  await mkdir(path.join(root, "node_modules"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return (await loadLocalState(root, "test-profile", { paymentProvider }))
    .config;
}
const profileModule = async () => ({
  ...(await import("./local-experience-payment-profile.mjs").catch(() => ({}))),
  ...(await import("./local-experience-payment-runtime.mjs").catch(() => ({}))),
});

test("one Stripe TEST profile drives routing, actions and canonical webhook verification", async (t) => {
  const module = await profileModule();
  assert.equal(typeof module.localPaymentProfile, "function");
  const config = await fixture(t, "stripe-test");
  const profile = module.localPaymentProfile(config);
  assert.equal(profile.paymentMethod, "card");
  assert.equal(profile.startFakePsp, false);
  assert.deepEqual(profile.actionOrigins, ["https://checkout.stripe.com"]);
  assert.equal(profile.connection.protocol, "stripe-checkout-v1");
  assert.equal(profile.connection.returnOrigin, config.origins.storefront);
  assert.equal(
    profile.webhook.secretRef,
    "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_WEBHOOK",
  );
  const runtime = module.createLocalPaymentRuntime({
    config,
    environment: {
      PAYMENT_SECRET_STRIPE_API: "sk_test_" + "x".repeat(32),
      PAYMENT_SECRET_STRIPE_WEBHOOK: "whsec_" + "w".repeat(32),
    },
  });
  assert.equal(runtime.factory.descriptor.adapterKey, "stripe");
  assert.equal(
    runtime.factory.create(profile.connection).configuration.providerCode,
    "stripe",
  );
  const gated = runtime.verifiers.gate({
    receiver: {},
    endpointPreflight: async () => ({ schemaVersion: 1, outcome: "AVAILABLE" }),
  });
  assert.deepEqual(gated.verificationHeaderNames, ["stripe-signature"]);
  assert.equal(
    typeof runtime.verifiers.verifierForEndpoint(
      "stripe",
      profile.webhook.endpointId,
    )?.verifyPaymentWebhook,
    "function",
  );
  assert.equal(
    runtime.verifiers.verifierForEndpoint("fake", profile.webhook.endpointId),
    undefined,
  );
  assert.equal(
    (await gated.endpointPreflight({ endpointId: randomUUID() })).outcome,
    "UNAVAILABLE",
  );
  const now = Math.floor(Date.now() / 1000);
  const raw = Buffer.from(
    JSON.stringify({
      id: "evt_LocalProfile",
      object: "event",
      type: "checkout.session.completed",
      created: now,
      livemode: false,
      data: {
        object: {
          id: "cs_test_LocalProfile",
          object: "checkout.session",
          mode: "payment",
          status: "complete",
          payment_status: "paid",
          url: null,
          payment_intent: "pi_LocalProfile",
          amount_total: 2500,
          currency: "usd",
          client_reference_id: randomUUID(),
          locale: "en",
          metadata: {},
          livemode: false,
          created: now,
        },
      },
    }),
  );
  const signature = createHmac("sha256", "whsec_" + "w".repeat(32))
    .update(`${now}.`)
    .update(raw)
    .digest("hex");
  const verifier = runtime.verifiers.verifierForEndpoint(
    "stripe",
    profile.webhook.endpointId,
  );
  const command = {
    schemaVersion: 1,
    operation: "VERIFY_PAYMENT_WEBHOOK",
    endpointId: profile.webhook.endpointId,
    providerAccountId: profile.connection.binding.providerAccountId,
    environment: "TEST",
    verificationKeyReferenceHash: profile.webhook.verificationKeyReferenceHash,
    rawBodyBase64: raw.toString("base64url"),
    headers: { "stripe-signature": `t=${now},v1=${signature}` },
    receivedAt: new Date(now * 1000).toISOString(),
  };
  const result = await verifier.verifyPaymentWebhook(command);
  assert.equal(result.outcome, "SUCCESS");
  assert.equal(result.value.candidate.status, "SUCCEEDED");
  assert.equal(
    result.value.candidate.transaction.providerReference,
    "pi.LocalProfile",
  );
  const wrong = await verifier.verifyPaymentWebhook({
    ...command,
    headers: { "stripe-signature": `t=${now},v1=${"0".repeat(64)}` },
  });
  assert.equal(wrong.outcome, "FAILURE");
  assert.equal(wrong.error.code, "INVALID_SIGNATURE");
});

test("legacy fake profile preserves its local identities and rejects provider drift", async (t) => {
  const module = await profileModule();
  assert.equal(typeof module.localPaymentProfile, "function");
  const config = await fixture(t);
  const profile = module.localPaymentProfile(config);
  assert.equal(profile.paymentMethod, "fake_card");
  assert.equal(profile.startFakePsp, true);
  assert.equal(
    profile.connection.binding.providerAccountId,
    config.services.psp.binding.providerAccountId,
  );
  assert.deepEqual(profile.actionOrigins, [config.origins.psp]);
  assert.equal(
    profile.webhook.secretRef,
    "secret-ref:v1:test:local/webhook/" + config.services.psp.webhookEndpointId,
  );
  assert.throws(
    () =>
      module.localPaymentProfile({
        ...config,
        services: {
          ...config.services,
          psp: {
            ...config.services.psp,
            binding: { ...config.services.psp.binding, providerCode: "stripe" },
          },
        },
      }),
    /profile/u,
  );
});

test("Stripe runtime fails closed for missing or live credentials without exposing values", async (t) => {
  const module = await profileModule();
  assert.equal(typeof module.createLocalPaymentRuntime, "function");
  const config = await fixture(t, "stripe-test");
  for (const environment of [
    {},
    {
      PAYMENT_SECRET_STRIPE_API: "sk_live_private",
      PAYMENT_SECRET_STRIPE_WEBHOOK: "whsec_" + "w".repeat(32),
    },
  ]) {
    assert.throws(
      () => module.createLocalPaymentRuntime({ config, environment }),
      (error) =>
        /Stripe TEST credentials/u.test(error.message) &&
        !error.message.includes("private"),
    );
  }
});

test("browser and worker environment omit all payment credentials while keeping required variables", async () => {
  const module = await profileModule();
  assert.equal(typeof module.withoutLocalPaymentCredentials, "function");
  assert.deepEqual(
    module.withoutLocalPaymentCredentials({
      PATH: "/bin",
      NODE_EXTRA_CA_CERTS: "/test/ca.crt",
      PAYMENT_SECRET_STRIPE_API: "private",
      STRIPE_TEST_SECRET_KEY: "private",
      STRIPE_TEST_WEBHOOK_SECRET: "private",
      OTHER: "keep",
    }),
    { PATH: "/bin", NODE_EXTRA_CA_CERTS: "/test/ca.crt", OTHER: "keep" },
  );
});
