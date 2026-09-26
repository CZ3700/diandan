import { expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  paymentRuntimeConfigurationSchema,
} from "@fan-support/contracts";
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
    probeNext: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      processed: false,
    })),
  })),
}));
vi.mock("@fan-support/application", () => ({
  createPaymentRuntimeUseCases: observed.create,
}));
import { createPaymentRuntimeComposition } from "../payment-runtime-composition.js";
import { createTestPaymentRuntimeComposition } from "./payment-runtime-composition.js";
const database = { connectionString: "postgresql://fixture.invalid/payment" };
const keyManagement = {
  computeBlindIndex: vi.fn(),
  encryptEnvelope: vi.fn(),
  encryptEnvelopeFields: vi.fn(),
  decryptEnvelope: vi.fn(),
};
const configuration = paymentRuntimeConfigurationSchema.parse({
  schemaVersion: 1 as const,
  publicStorefrontOrigin: "https://shop.example.invalid",
  leaseMs: 10_000,
  recoveryDelayMs: 10_000,
  actionTtlMs: 60_000,
  returnStateTtlMs: 60_000,
  recoveryBatchSize: 5,
});
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
test("dynamic policies reach application health while legacy initial policy validation remains mandatory", () => {
  const policy = {
    schemaVersion: 1,
    providerAccountId: binding.providerAccountId,
    environment: "TEST",
    version: 1,
    failureThreshold: 3,
    failureWindowMs: 60000,
    openDurationMs: 30000,
    probeLeaseMs: 30000,
    probeRetryMs: 10000,
  };
  const readHealthPolicies = () => [policy];
  const persistence = {
    paymentRuntimeTransactionManager: {
      runInPaymentRuntimeTransaction: vi.fn(),
    },
    paymentHealthTransactionManager: { runInPaymentHealthTransaction: vi.fn() },
    close: vi.fn(async () => undefined),
  };
  createTestPaymentRuntimeComposition(
    { ...options, healthPolicies: [policy], readHealthPolicies } as never,
    { createPersistence: () => persistence },
  );
  expect(observed.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      health: expect.objectContaining({ readPolicies: readHealthPolicies }),
    }),
  );
});
test("a dynamic deployment can begin without an eligible account and activate its first PG publication later", async () => {
  const readHealthPolicies = () => [];
  const persistence = {
    paymentRuntimeTransactionManager: {
      runInPaymentRuntimeTransaction: vi.fn(),
    },
    paymentHealthTransactionManager: { runInPaymentHealthTransaction: vi.fn() },
    close: vi.fn(async () => undefined),
  };
  const result = createTestPaymentRuntimeComposition(
    { ...options, providers: [], healthPolicies: [], readHealthPolicies },
    { createPersistence: () => persistence },
  );
  expect(observed.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      health: expect.objectContaining({
        policies: [],
        readPolicies: readHealthPolicies,
      }),
    }),
  );
  await result.paymentRuntime.stop();
});
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

const healthPolicy = {
  schemaVersion: 1 as const,
  providerAccountId: binding.providerAccountId,
  environment: "TEST" as const,
  version: 1,
  failureThreshold: 3,
  failureWindowMs: 60000,
  openDurationMs: 30000,
  probeLeaseMs: 30000,
  probeRetryMs: 10000,
};
test("explicit TEST health policy connects the independent PostgreSQL health transaction manager", async () => {
  const persistence = {
    paymentRuntimeTransactionManager: {
      runInPaymentRuntimeTransaction: vi.fn(),
    },
    paymentHealthTransactionManager: { runInPaymentHealthTransaction: vi.fn() },
    close: vi.fn(async () => {}),
  };
  const runtime = createTestPaymentRuntimeComposition(
    { ...options, healthPolicies: [healthPolicy] } as never,
    {
      createPersistence: () => persistence,
    },
  );
  expect(observed.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      health: {
        policies: [healthPolicy],
        transactions: persistence.paymentHealthTransactionManager,
      },
    }),
  );
  await runtime.paymentRuntime.stop();
});

test("the direct production factory rejects a missing health policy before borrowing a pool", () => {
  const openPersistence = vi.fn();
  expect(() =>
    createPaymentRuntimeComposition({ ...options, openPersistence } as never),
  ).toThrow("Invalid payment health policies");
  expect(openPersistence).not.toHaveBeenCalled();
});
