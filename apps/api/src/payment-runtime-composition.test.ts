import { expect, test, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
const observed = vi.hoisted(() => ({
  create: vi.fn(() => ({
    capabilities: vi.fn(),
    current: vi.fn(),
    create: vi.fn(),
    read: vi.fn(),
    recover: vi.fn(),
    recoverNext: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      processed: false,
    })),
  })),
}));
vi.mock("@fan-support/application", () => ({
  createPaymentRuntimeUseCases: observed.create,
}));
import {
  createTestPaymentRuntimeComposition,
  createOptionalPaymentRuntimeComposition,
} from "./payment-runtime-composition.js";
const database = { connectionString: "postgresql://fixture.invalid/payment" };
const keyManagement = {
  computeBlindIndex: vi.fn(),
  encryptEnvelope: vi.fn(),
  encryptEnvelopeFields: vi.fn(),
  decryptEnvelope: vi.fn(),
};
const configuration = {
  schemaVersion: 1 as const,
  publicStorefrontOrigin: "https://shop.example.invalid",
  leaseMs: 10_000,
  recoveryDelayMs: 10_000,
  actionTtlMs: 60_000,
  returnStateTtlMs: 60_000,
  recoveryBatchSize: 5,
};
const binding = {
  schemaVersion: 1 as const,
  providerAccountId: "10000000-0000-4000-8000-000000000001",
  providerCode: "fake",
  environment: "TEST" as const,
  localeMapping: Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      { providerLocale: locale, fallbackUsed: false },
    ]),
  ),
  allowedActionOrigins: ["https://payments.example.invalid"],
};
const provider = {
  getCapabilities: vi.fn(),
  createPayment: vi.fn(),
  getPayment: vi.fn(),
  cancelPayment: vi.fn(),
  refundPayment: vi.fn(),
  reconcilePayment: vi.fn(),
  reconcileRefund: vi.fn(),
};
const options = {
  environment: "TEST" as const,
  database,
  publicMediaBaseUrl: "https://media.example.invalid",
  keyManagement,
  activePepperVersion: "test-v1",
  pepperVersions: ["test-v1"],
  configuration,
  providers: [{ configuration: binding, provider }],
};
test("TEST composition owns one payment pool, binds exact providers and a stoppable recovery lifecycle", async () => {
  const persistence = {
    paymentRuntimeTransactionManager: {
      runInPaymentRuntimeTransaction: vi.fn(),
    },
    close: vi.fn(async () => {}),
  };
  const createPersistence = vi.fn(() => persistence);
  const result = createTestPaymentRuntimeComposition(options as never, {
    createPersistence,
  });
  expect(result).toBeDefined();
  expect(createPersistence).toHaveBeenCalledWith(database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  expect(observed.create).toHaveBeenCalledWith({
    transactions: persistence.paymentRuntimeTransactionManager,
    keyManagement,
    providers: options.providers,
    configuration,
  });
  expect(result!.paymentRuntimeRoute.allowedOrigin).toBe(
    configuration.publicStorefrontOrigin,
  );
  expect(result!.paymentRuntimeRoute.actionOrigins).toEqual(
    binding.allowedActionOrigins,
  );
  await result!.paymentRuntime.start();
  await Promise.all([
    result!.paymentRuntime.stop(),
    result!.paymentRuntime.stop(),
  ]);
  expect(persistence.close).toHaveBeenCalledTimes(1);
});
test("invalid TEST/config/adapter registration fails before opening the pool", () => {
  const createPersistence = vi.fn();
  for (const change of [
    { environment: "LIVE" },
    {
      configuration: {
        ...configuration,
        publicStorefrontOrigin: "http://localhost:3000",
      },
    },
    { pepperVersions: [] },
    { providers: [...options.providers, ...options.providers] },
    {
      providers: [
        { configuration: { ...binding, environment: "LIVE" }, provider },
      ],
    },
  ])
    expect(() =>
      createTestPaymentRuntimeComposition({ ...options, ...change } as never, {
        createPersistence,
      }),
    ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});
test("absent configuration has no implicit PSP and partially configured deployment is rejected", () => {
  expect(createOptionalPaymentRuntimeComposition({})).toBeUndefined();
  expect(() =>
    createOptionalPaymentRuntimeComposition({
      FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON: JSON.stringify(configuration),
    }),
  ).toThrow();
  expect(() =>
    createOptionalPaymentRuntimeComposition({
      FAN_SUPPORT_PAYMENT_PROVIDER_BINDINGS_JSON: "[]",
    }),
  ).toThrow();
  expect(
    createOptionalPaymentRuntimeComposition({
      FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON: JSON.stringify(configuration),
      FAN_SUPPORT_PAYMENT_PROVIDER_BINDINGS_JSON: JSON.stringify([binding]),
      FAN_SUPPORT_SITE_ORIGIN: configuration.publicStorefrontOrigin,
    }),
  ).toBeUndefined();
});

test("a running composition observes validated deployed directory additions without replacing historical origins", async () => {
  let entries = options.providers;
  const providerDirectory = { getRegistrations: () => entries };
  const result = createTestPaymentRuntimeComposition(
    { ...options, providers: [], providerDirectory } as never,
    {
      createPersistence: () => ({
        paymentRuntimeTransactionManager: {
          runInPaymentRuntimeTransaction: vi.fn(),
        },
        close: vi.fn(),
      }),
    },
  );
  expect(result.paymentRuntimeRoute.actionOrigins).toEqual(
    binding.allowedActionOrigins,
  );
  entries = [
    ...entries,
    {
      configuration: {
        ...binding,
        providerAccountId: "10000000-0000-4000-8000-000000000002",
        allowedActionOrigins: ["https://second-payments.example.invalid"],
      },
      provider,
    },
  ];
  expect(result.paymentRuntimeRoute.actionOrigins).toEqual([
    ...binding.allowedActionOrigins,
    "https://second-payments.example.invalid",
  ]);
  expect(observed.create.mock.lastCall).toEqual([
    expect.objectContaining({ providerDirectory: expect.any(Object) }),
  ]);
  await result.paymentRuntime.stop();
});

test("TEST composition rejects a LIVE directory before opening a pool", () => {
  const createPersistence = vi.fn();
  expect(() =>
    createTestPaymentRuntimeComposition(
      {
        ...options,
        providers: [],
        providerDirectory: {
          getRegistrations: () => [
            { configuration: { ...binding, environment: "LIVE" }, provider },
          ],
        },
      } as never,
      { createPersistence },
    ),
  ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});
