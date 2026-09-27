import { Buffer } from "node:buffer";
import { PAYMENT_PROVIDER_OPERATIONS } from "@fan-support/payment-port";
import { createFakePaymentWebhookVerifier } from "@fan-support/payment-fake";
import { createPersistentTestPaymentProvider } from "@fan-support/payment-fake/persistent-http";
import { createDeployedPaymentAdapters } from "../dist/payment-deployed-adapters.js";
import { createEnvironmentCredentialResolver } from "../dist/payment-credential-resolver.js";
import { createPaymentWebhookVerifierDirectory } from "../dist/payment-webhook-verifiers.js";
import { localPaymentProfile } from "./local-experience-payment-profile.mjs";

/** Reuse deployed Stripe code and the canonical header gate; fake remains the unchanged default. */
export function createLocalPaymentRuntime({
  config,
  services,
  environment = process.env,
}) {
  const profile = localPaymentProfile(config);
  let factory,
    deployed,
    close = () => undefined;
  if (profile.startFakePsp) {
    factory = {
      descriptor: {
        schemaVersion: 1,
        adapterKey: "fake",
        adapterVersion: "1.0.0",
        protocol: "persistent-test-v1",
        supportedOperations: [...PAYMENT_PROVIDER_OPERATIONS],
        supportedInstrumentKinds: ["CARD"],
        idempotency: {
          retention: "DURABLE",
          minimumRetentionSeconds: 0,
          referenceLookup: true,
        },
      },
      create: (connection) => ({
        configuration: connection.binding,
        provider: createPersistentTestPaymentProvider({
          binding: connection.binding,
          endpointOrigin: services.psp.origin,
          returnOrigin: config.origins.storefront,
          authorizationToken: config.services.psp.authorizationToken,
          fetcher: services.psp.fetcher,
          timeoutMs: connection.timeoutMs,
        }),
      }),
    };
    const secret = Buffer.from(config.secrets.webhookSecret, "base64url");
    close = () => secret.fill(0);
    deployed = {
      verifier: createFakePaymentWebhookVerifier({
        endpointId: profile.webhook.endpointId,
        providerAccountId: profile.connection.binding.providerAccountId,
        verificationKeyReferenceHash:
          profile.webhook.verificationKeyReferenceHash,
        environment: "TEST",
        verificationSecret: secret,
      }),
      headerNames: ["x-fan-support-signature", "x-fan-support-timestamp"],
    };
  } else {
    if (
      !/^(?:sk|rk)_test_[A-Za-z0-9]{16,247}$/u.test(
        environment.PAYMENT_SECRET_STRIPE_API ?? "",
      ) ||
      !/^whsec_[A-Za-z0-9]{16,250}$/u.test(
        environment.PAYMENT_SECRET_STRIPE_WEBHOOK ?? "",
      )
    )
      throw new TypeError(
        "Stripe TEST credentials require PAYMENT_SECRET_STRIPE_API and PAYMENT_SECRET_STRIPE_WEBHOOK",
      );
    const adapters = createDeployedPaymentAdapters({
      credentials: createEnvironmentCredentialResolver(environment),
    });
    factory = adapters.connectorFactories.find(
      ({ descriptor }) => descriptor.adapterKey === "stripe",
    );
    deployed = adapters.webhookVerifierFor(profile.webhook, profile.connection);
  }
  const verifiers = createPaymentWebhookVerifierDirectory([
    {
      adapterKey: profile.connection.binding.providerCode,
      endpointId: profile.webhook.endpointId,
      ...deployed,
    },
  ]);
  return { ...profile, factory, verifiers, close };
}
