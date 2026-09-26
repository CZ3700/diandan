import { expect, test } from "vitest";

import { createEnvironmentCredentialResolver } from "./payment-credential-resolver.js";

const request = {
  schemaVersion: 1,
  secretRef: "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_WEBHOOK",
  providerAccountId: "10000000-0000-4000-8000-000000000001",
  environment: "TEST",
  purpose: "WEBHOOK_VERIFY",
} as const;

test("injected payment secrets resolve on every call, including rotation lists", async () => {
  const environment: Record<string, string | undefined> = {
    PAYMENT_SECRET_STRIPE_WEBHOOK: "whsec_new,whsec_old",
  };
  const resolver = createEnvironmentCredentialResolver(environment);
  expect(await resolver.resolve(request)).toEqual({
    ...request,
    version: "env-v1",
    values: ["whsec_new", "whsec_old"],
  });
  environment["PAYMENT_SECRET_STRIPE_WEBHOOK"] = "whsec_newest";
  expect(await resolver.resolve(request)).toMatchObject({
    values: ["whsec_newest"],
  });
});

test("references outside the payment secret namespace are never read", async () => {
  const resolver = createEnvironmentCredentialResolver({
    FAN_SUPPORT_DATABASE_URL: "postgresql://private",
    PAYMENT_SECRET_EMPTY: "",
    PAYMENT_SECRET_MANY: "a,b,c,d",
  });
  for (const secretRef of [
    "secret-ref:v1:env:FAN_SUPPORT_DATABASE_URL",
    "secret-ref:v1:aws:PAYMENT_SECRET_STRIPE_API",
    "secret-ref:v1:env:PAYMENT_SECRET_MISSING",
    "secret-ref:v1:env:PAYMENT_SECRET_EMPTY",
    "secret-ref:v1:env:PAYMENT_SECRET_MANY",
  ])
    await expect(resolver.resolve({ ...request, secretRef })).rejects.toThrow(
      "Payment credential unavailable",
    );
});
