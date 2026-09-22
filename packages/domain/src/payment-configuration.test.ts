import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LOCALES,
  minorAmountSchema,
  sourceHashSchema,
  type PaymentConfigurationValidationInput,
} from "@fan-support/contracts";
const api = await import("./payment-configuration.js").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001",
  actor = "10000000-0000-4000-8000-000000000002",
  reviewer = "10000000-0000-4000-8000-000000000003",
  hash = "a".repeat(64);
const health = {
  failureThreshold: 3,
  failureWindowMs: 10000,
  openDurationMs: 10000,
  probeLeaseMs: 1000,
  probeRetryMs: 10000,
};
const baseline = () =>
  ({
    schemaVersion: 1,
    configuration: {
      schemaVersion: 1,
      channels: [
        {
          providerAccountId: id,
          enabled: true,
          displayOrder: 0,
          rolloutBasisPoints: 10000,
          healthPolicy: health,
          translations: SUPPORTED_LOCALES.map((locale) => ({
            locale,
            displayName: `Test ${locale}`,
            customerHint: `TEST ${locale}`,
            translatedFromSourceHash: hash,
          })),
        },
      ],
      routes: [
        {
          ruleKey: "test-route",
          providerAccountId: id,
          paymentMethod: "card",
          enabled: true,
          countries: ["US"],
          markets: ["TEST"],
          currencies: ["USD"],
          minimumAmountMinor: 0,
          maximumAmountMinor: 10000,
          requiredDeviceCapabilities: ["REDIRECT"],
          priority: 1,
          rolloutBasisPoints: 10000,
        },
      ],
    },
    accounts: [
      {
        providerAccountId: id,
        environment: "TEST",
        displayLabel: "TEST account",
        adapterKey: "test-provider",
        adapterVersion: "1.0.0",
        paymentMethods: ["card"],
        deployed: true,
        accountStatus: "INTERNAL",
        merchantStatus: "ACTIVE",
        healthStatus: "HEALTHY",
        healthPolicy: health,
      },
    ],
    reviews: SUPPORTED_LOCALES.map((locale) => ({
      providerAccountId: id,
      locale,
      status: "APPROVED",
      sourceHash: hash,
      editorId: actor,
      reviewerId: reviewer,
      canApprove: false,
    })),
    mode: "PUBLISH",
    previouslyPublished: false,
  }) as PaymentConfigurationValidationInput;
describe("payment configuration publish rules", () => {
  it("accepts reviewed deployed routes and permits a deliberate zero rollout", () => {
    expect(api?.validatePaymentConfiguration).toBeDefined();
    const input = baseline();
    expect(api!.validatePaymentConfiguration(input)).toEqual({
      schemaVersion: 1,
      valid: true,
      issues: [],
    });
    input.configuration.channels[0]!.rolloutBasisPoints = 0;
    input.configuration.routes[0]!.rolloutBasisPoints = 0;
    expect(api!.validatePaymentConfiguration(input).valid).toBe(true);
  });
  it.each(["missing", "unapproved", "stale", "self", "no-reviewer"])(
    "rejects %s critical translations",
    (kind) => {
      expect(api?.validatePaymentConfiguration).toBeDefined();
      const input = baseline();
      if (kind === "missing")
        input.configuration.channels[0]!.translations.pop();
      if (kind === "unapproved") input.reviews[0]!.status = "IN_REVIEW";
      if (kind === "stale")
        input.configuration.channels[0]!.translations[1]!.translatedFromSourceHash =
          sourceHashSchema.parse("b".repeat(64));
      if (kind === "self") input.reviews[0]!.reviewerId = actor;
      if (kind === "no-reviewer") input.reviews[0]!.reviewerId = null;
      expect(api!.validatePaymentConfiguration(input).valid).toBe(false);
    },
  );
  it.each([
    "none",
    "disabled",
    "account",
    "adapter",
    "merchant",
    "health",
    "scope",
    "amount",
    "method",
    "orphan",
  ])("rejects %s invalid routing", (kind) => {
    expect(api?.validatePaymentConfiguration).toBeDefined();
    const input = baseline();
    if (kind === "none") input.configuration.routes = [];
    if (kind === "disabled") input.configuration.routes[0]!.enabled = false;
    if (kind === "account") input.accounts[0]!.accountStatus = "SUSPENDED";
    if (kind === "adapter") input.accounts[0]!.deployed = false;
    if (kind === "merchant") input.accounts[0]!.merchantStatus = "SUSPENDED";
    if (kind === "health") input.accounts[0]!.healthStatus = "UNAVAILABLE";
    if (kind === "scope") input.configuration.routes[0]!.countries = [];
    if (kind === "amount")
      input.configuration.routes[0]!.minimumAmountMinor =
        minorAmountSchema.parse(10001);
    if (kind === "method")
      input.configuration.routes[0]!.paymentMethod = "usdt";
    if (kind === "orphan") input.configuration.channels = [];
    expect(api!.validatePaymentConfiguration(input).valid).toBe(false);
  });
  it("requires proof of a prior publication for rollback", () => {
    expect(api?.validatePaymentConfiguration).toBeDefined();
    const input = baseline();
    input.mode = "ROLLBACK";
    expect(api!.validatePaymentConfiguration(input).valid).toBe(false);
    input.previouslyPublished = true;
    expect(api!.validatePaymentConfiguration(input).valid).toBe(true);
  });
  it("reports value differences independent of list ordering", () => {
    expect(api?.diffPaymentConfiguration).toBeDefined();
    const before = baseline().configuration,
      after = baseline().configuration;
    after.channels[0]!.translations.reverse();
    expect(
      api!.diffPaymentConfiguration({ schemaVersion: 1, before, after }).diff,
    ).toEqual([]);
    after.channels[0]!.rolloutBasisPoints = 0;
    after.routes[0]!.maximumAmountMinor = minorAmountSchema.parse(5000);
    expect(
      api!.diffPaymentConfiguration({ schemaVersion: 1, before, after }).diff,
    ).toEqual([
      {
        kind: "CHANNEL",
        key: id,
        change: "CHANGED",
        fields: ["rolloutBasisPoints"],
        values: [{ field: "rolloutBasisPoints", before: 10000, after: 0 }],
      },
      {
        kind: "ROUTE",
        key: "test-route",
        change: "CHANGED",
        fields: ["maximumAmountMinor"],
        values: [{ field: "maximumAmountMinor", before: 10000, after: 5000 }],
      },
    ]);
  });
});

it("accepts a disabled historical channel without falsely approving its incomplete copy", () => {
  expect(api?.validatePaymentConfiguration).toBeDefined();
  const input = baseline();
  const disabled = { ...input.configuration.channels[0]! };
  disabled.providerAccountId =
    "10000000-0000-4000-8000-000000000005" as typeof disabled.providerAccountId;
  disabled.enabled = false;
  disabled.translations = [];
  input.configuration.channels.push(disabled);
  input.accounts.push({
    ...input.accounts[0]!,
    providerAccountId: disabled.providerAccountId,
    accountStatus: "SUSPENDED",
    healthStatus: "UNAVAILABLE",
  });
  expect(api!.validatePaymentConfiguration(input).valid).toBe(true);
  input.configuration.routes.push({
    ...input.configuration.routes[0]!,
    ruleKey: "disabled-history",
    providerAccountId: disabled.providerAccountId,
    enabled: false,
  });
  expect(api!.validatePaymentConfiguration(input).valid).toBe(true);
  input.configuration.routes[1]!.enabled = true;
  expect(
    api!
      .validatePaymentConfiguration(input)
      .issues.some((issue) => issue.code === "INVALID_ROUTE"),
  ).toBe(true);
});
it("fails closed on untyped or duplicate external data", () => {
  expect(api?.validatePaymentConfiguration).toBeDefined();
  for (const input of [
    null,
    {},
    {
      ...baseline(),
      configuration: {
        ...baseline().configuration,
        channels: [
          ...baseline().configuration.channels,
          ...baseline().configuration.channels,
        ],
      },
    },
  ])
    expect(api!.validatePaymentConfiguration(input).valid).toBe(false);
});
it("does not allow missing source review or a non-English stale approval", () => {
  expect(api?.validatePaymentConfiguration).toBeDefined();
  const input = baseline();
  input.reviews = input.reviews.filter((r) => r.locale !== "en");
  expect(api!.validatePaymentConfiguration(input).valid).toBe(false);
  const missing = baseline();
  missing.reviews.pop();
  expect(api!.validatePaymentConfiguration(missing).valid).toBe(false);
  const stale = baseline();
  stale.reviews[1]!.status = "STALE";
  expect(api!.validatePaymentConfiguration(stale).valid).toBe(false);
});
it("rejects empty market/currency scope or an account absent from the deployed directory", () => {
  expect(api?.validatePaymentConfiguration).toBeDefined();
  for (const field of ["markets", "currencies"] as const) {
    const input = baseline();
    input.configuration.routes[0]![field] = [];
    expect(api!.validatePaymentConfiguration(input).valid).toBe(false);
  }
  const absent = baseline();
  absent.accounts = [];
  expect(api!.validatePaymentConfiguration(absent).valid).toBe(false);
});
it("shows additions, removals and legacy unknown policy without guessing previous values", () => {
  expect(api?.diffPaymentConfiguration).toBeDefined();
  const after = baseline().configuration;
  expect(
    api!
      .diffPaymentConfiguration({ schemaVersion: 1, before: null, after })
      .diff.map((d) => d.change),
  ).toEqual(["ADDED", "ADDED"]);
  expect(
    api!
      .diffPaymentConfiguration({
        schemaVersion: 1,
        before: after,
        after: { schemaVersion: 1, channels: [], routes: [] },
      })
      .diff.map((d) => d.change),
  ).toEqual(["REMOVED", "REMOVED"]);
  const before = {
    ...after,
    channels: after.channels.map((c) => ({ ...c, healthPolicy: null })),
  };
  expect(
    api!.diffPaymentConfiguration({ schemaVersion: 1, before, after }).diff,
  ).toEqual([
    {
      kind: "CHANNEL",
      key: id,
      change: "CHANGED",
      fields: ["healthPolicy"],
      values: [{ field: "healthPolicy", before: null, after: health }],
    },
  ]);
});
it("provides the exact before and after values for publication confirmation", () => {
  expect(api?.diffPaymentConfiguration).toBeDefined();
  const before = baseline().configuration,
    after = baseline().configuration;
  after.channels[0]!.rolloutBasisPoints = 2500;
  expect(
    api!.diffPaymentConfiguration({ schemaVersion: 1, before, after }).diff[0],
  ).toMatchObject({
    values: [{ field: "rolloutBasisPoints", before: 10000, after: 2500 }],
  });
});
it("does not publish an internal-only provider account in the LIVE environment", () => {
  const input = baseline();
  input.accounts[0]!.environment = "LIVE";
  expect(
    api!
      .validatePaymentConfiguration(input)
      .issues.some((issue) => issue.code === "ACCOUNT_UNAVAILABLE"),
  ).toBe(true);
  input.accounts[0]!.accountStatus = "ACTIVE";
  expect(api!.validatePaymentConfiguration(input).valid).toBe(true);
});
