import { describe, expect, it } from "vitest";
import * as contracts from "./index.js";

const account = "a1000000-0000-4000-8000-000000000001";
const uuid = "a1000000-0000-4000-8000-000000000002";
const policy = {
  schemaVersion: 1,
  providerAccountId: account,
  environment: "TEST",
  version: 1,
  failureThreshold: 3,
  failureWindowMs: 60000,
  openDurationMs: 30000,
  probeLeaseMs: 10000,
  probeRetryMs: 30000,
};
const command = {
  schemaVersion: 1,
  operation: "GET_CAPABILITIES",
  providerAccountId: account,
  environment: "TEST",
  market: "TEST_MARKET",
  country: "TH",
  currency: "USD",
  amountMinor: 1000,
  requestedLocale: "en",
  supportedActionTypes: ["REDIRECT"],
};
const observation = {
  schemaVersion: 1,
  observationId: uuid,
  providerAccountId: account,
  environment: "TEST",
  operation: "GET_CAPABILITIES",
  classification: "SUCCESS",
  code: null,
  probeContext: {
    schemaVersion: 1,
    routeId: uuid,
    configVersion: 1,
    ruleVersion: 1,
    command,
  },
};
function accepts(name: string, value: unknown) {
  const schema = (
    contracts as unknown as Record<
      string,
      { safeParse(value: unknown): { success: boolean } }
    >
  )[name];
  expect(schema, name).toBeDefined();
  return schema!.safeParse(value).success;
}
describe("bounded internal payment health contracts", () => {
  it("accepts a versioned account policy and rejects unbounded thresholds or secrets", () => {
    expect(accepts("paymentHealthPolicySchema", policy)).toBe(true);
    for (const invalid of [
      { failureThreshold: 0 },
      { failureWindowMs: 0 },
      { probeLeaseMs: 999999 },
      { version: 0 },
      { secret: "forbidden" },
    ])
      expect(
        accepts("paymentHealthPolicySchema", { ...policy, ...invalid }),
      ).toBe(false);
  });
  it("stores only a correlated read-only capability context", () => {
    expect(accepts("paymentHealthObservationSchema", observation)).toBe(true);
    for (const invalid of [
      { ...observation, providerAccountId: uuid },
      { ...observation, environment: "LIVE" },
      { ...observation, operation: "CREATE_PAYMENT" },
      {
        ...observation,
        probeContext: {
          ...observation.probeContext,
          command: { ...command, operation: "CREATE_PAYMENT" },
        },
      },
      { ...observation, payload: "private provider body" },
    ])
      expect(accepts("paymentHealthObservationSchema", invalid)).toBe(false);
  });
  it("technical failure cannot label a decline, success cannot carry an error", () => {
    expect(
      accepts("paymentHealthObservationSchema", {
        ...observation,
        classification: "TECHNICAL_FAILURE",
        code: "RATE_LIMITED",
      }),
    ).toBe(true);
    for (const invalid of [
      { classification: "TECHNICAL_FAILURE", code: "PROVIDER_DECLINED" },
      { classification: "SUCCESS", code: "TEMPORARY_UNAVAILABLE" },
      { classification: "BUSINESS_OUTCOME", code: "RATE_LIMITED" },
      { classification: "CONFIGURATION_ERROR", code: "PROVIDER_DECLINED" },
    ])
      expect(
        accepts("paymentHealthObservationSchema", {
          ...observation,
          ...invalid,
        }),
      ).toBe(false);
  });
  it("rejects duplicate or unbounded accounts and mismatched fenced probe identity", () => {
    const identity = { providerAccountId: account, environment: "TEST" };
    expect(
      accepts("paymentHealthClaimProbeCommandSchema", {
        schemaVersion: 1,
        accounts: [identity],
      }),
    ).toBe(true);
    expect(
      accepts("paymentHealthClaimProbeCommandSchema", {
        schemaVersion: 1,
        accounts: [identity, identity],
      }),
    ).toBe(false);
    expect(
      accepts("paymentHealthClaimProbeCommandSchema", {
        schemaVersion: 1,
        accounts: [],
      }),
    ).toBe(false);
    const lease = {
      schemaVersion: 1,
      probeId: uuid,
      ...identity,
      generation: 1,
      expiresAt: "2026-09-21T18:00:00.000Z",
      context: observation.probeContext,
    };
    expect(accepts("paymentHealthProbeLeaseSchema", lease)).toBe(true);
    expect(
      accepts("paymentHealthProbeLeaseSchema", {
        ...lease,
        providerAccountId: uuid,
      }),
    ).toBe(false);
  });
});
