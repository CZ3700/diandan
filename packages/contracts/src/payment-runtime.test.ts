import { describe, expect, it } from "vitest";

const id = "10000000-0000-4000-8000-000000000001";
const load = () => import("./payment-runtime.js").catch(() => null);
const create = {
  schemaVersion: 1,
  operation: "CREATE_PAYMENT_ATTEMPT",
  checkoutSessionId: id,
  capabilityId: id,
  country: "US",
  configVersion: 1,
  ruleVersion: 1,
  supportedActionTypes: ["REDIRECT"],
};
const attempt = {
  schemaVersion: 1,
  id,
  checkoutSessionId: id,
  version: 1,
  environment: "TEST",
  status: "UNKNOWN",
  requestedLocale: "ja",
  providerLocale: "en",
  providerLocaleFallbackUsed: true,
  recovery: "RECONCILE_REQUIRED",
  canRetry: false,
  actionExpired: false,
  updatedAt: "2026-09-09T00:00:00.000Z",
};

describe("session-scoped payment runtime contracts", () => {
  it("creates from a scoped capability without accepting financial or provider authority", async () => {
    const schemas = await load();
    expect(
      schemas?.paymentRuntimeCreateCommandSchema.safeParse(create).success,
    ).toBe(true);
    for (const extra of [
      { amountMinor: 1 },
      { currency: "USD" },
      { providerAccountId: id },
      { requestedLocale: "en" },
      { returnUrl: "https://attacker.example/return" },
      { status: "SUCCEEDED" },
      { supportedActionTypes: ["REDIRECT", "REDIRECT"] },
      { supportedActionTypes: ["WAIT"] },
    ])
      expect(
        schemas?.paymentRuntimeCreateCommandSchema.safeParse({
          ...create,
          ...extra,
        }).success,
      ).toBe(false);
  });
  it("never guesses country from a language when reading capabilities", async () => {
    const schemas = await load();
    const read = {
      schemaVersion: 1,
      operation: "READ_PAYMENT_CAPABILITIES",
      checkoutSessionId: id,
      presentationLocale: "zh-CN",
      supportedActionTypes: ["REDIRECT"],
    };
    expect(
      schemas?.paymentRuntimeCapabilitiesCommandSchema.parse(read),
    ).toEqual(read);
    expect(
      schemas?.paymentRuntimeCapabilitiesCommandSchema.safeParse({
        ...read,
        country: "zh-CN",
      }).success,
    ).toBe(false);
  });
  it("keeps UNKNOWN non-retryable and cannot return a checkout action from an uncertain attempt", async () => {
    const schemas = await load();
    expect(
      schemas?.paymentRuntimeAttemptViewSchema.safeParse(attempt).success,
    ).toBe(true);
    for (const extra of [
      { canRetry: true },
      {
        action: {
          schemaVersion: 1,
          type: "REDIRECT",
          url: "https://payments.example/continue",
        },
      },
      { externalReference: "provider-private-reference" },
      { email: "test@example.test" },
      { providerIdempotencyKey: id },
    ])
      expect(
        schemas?.paymentRuntimeAttemptViewSchema.safeParse({
          ...attempt,
          ...extra,
        }).success,
      ).toBe(false);
  });
  it("only offers a fresh interactive action for REQUIRES_ACTION", async () => {
    const schemas = await load();
    const ready = {
      ...attempt,
      status: "REQUIRES_ACTION",
      recovery: "NONE",
      action: {
        schemaVersion: 1,
        type: "REDIRECT",
        url: "https://payments.example/continue",
      },
      actionExpiresAt: "2026-09-09T00:10:00.000Z",
    };
    expect(
      schemas?.paymentRuntimeAttemptViewSchema.safeParse(ready).success,
    ).toBe(true);
    expect(
      schemas?.paymentRuntimeAttemptViewSchema.safeParse({
        ...ready,
        actionExpired: true,
      }).success,
    ).toBe(false);
    expect(
      schemas?.paymentRuntimeAttemptViewSchema.safeParse({
        ...ready,
        status: "SUCCEEDED",
      }).success,
    ).toBe(false);
  });
  it("treats recovery as a command and never accepts a browser success assertion", async () => {
    const schemas = await load();
    const recover = {
      schemaVersion: 1,
      operation: "RECOVER_PAYMENT_ATTEMPT",
      checkoutSessionId: id,
      attemptId: id,
    };
    expect(
      schemas?.paymentRuntimeRecoverCommandSchema.safeParse(recover).success,
    ).toBe(true);
    expect(
      schemas?.paymentRuntimeRecoverCommandSchema.safeParse({
        ...recover,
        success: true,
      }).success,
    ).toBe(false);
    expect(
      schemas?.paymentRuntimeRecoverRequestSchema.parse({ schemaVersion: 1 }),
    ).toEqual({ schemaVersion: 1 });
  });
});
