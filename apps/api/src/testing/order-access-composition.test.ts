import { orderAccessConfigurationSchema } from "@fan-support/contracts";
import { expect, test, vi } from "vitest";
import { createTestOrderAccessComposition } from "./order-access-composition.js";
import { resolveOrderAccessRuntimeConfig } from "../order-access-runtime-config.js";

const configuration = orderAccessConfigurationSchema.parse({
  schemaVersion: 1 as const,
  publicStorefrontOrigin: "https://shop.example.invalid",
  sessionTtlSeconds: 900,
  linkTtlSeconds: 3600,
  rateLimit: {
    windowSeconds: 60,
    exchangeMax: 10,
    bootstrapMax: 10,
    readMax: 100,
    revokeMax: 10,
  },
});

test("unconfigured access is explicitly unavailable and malformed or foreign activation is rejected", () => {
  const siteOrigin = configuration.publicStorefrontOrigin;
  expect(resolveOrderAccessRuntimeConfig({}, siteOrigin)).toBeUndefined();
  expect(
    resolveOrderAccessRuntimeConfig(
      { FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON: JSON.stringify(configuration) },
      siteOrigin,
    ),
  ).toEqual(configuration);
  for (const text of [
    "",
    "{}",
    "invalid",
    JSON.stringify({ ...configuration, sessionTtlSeconds: 0 }),
    "x".repeat(16_385),
  ])
    expect(() =>
      resolveOrderAccessRuntimeConfig(
        { FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON: text },
        siteOrigin,
      ),
    ).toThrow("Invalid order access runtime configuration");
  expect(() =>
    resolveOrderAccessRuntimeConfig(
      { FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON: JSON.stringify(configuration) },
      "https://other.example.invalid",
    ),
  ).toThrow("Order access origin does not match deployment");
});

test("TEST composition validates its boundary before creating persistence and owns close exactly once", async () => {
  const close = vi.fn(async () => {});
  const manager = { runInOrderAccessTransaction: vi.fn() };
  const createPersistence = vi.fn(() => ({
    orderAccessTransactionManager: manager,
    close,
  }));
  const keyManagement = {
    computeBlindIndex: vi.fn(),
    encryptEnvelope: vi.fn(),
    encryptEnvelopeFields: vi.fn(),
    decryptEnvelope: vi.fn(),
  };
  const options = {
    environment: "TEST" as const,
    database: {
      connectionString: [
        "postgresql://",
        "test",
        ":",
        "test",
        "@localhost/test",
      ].join(""),
    },
    publicMediaBaseUrl: "https://media.example.invalid",
    configuration,
    keyManagement,
    activePepperVersion: "test-mac",
    pepperVersions: ["test-mac"],
  };
  const composition = createTestOrderAccessComposition(options, {
    createPersistence,
  } as never);
  expect(composition.orderAccessRoute.configuration).toEqual(configuration);
  expect(composition.orderAccessRoute.useCases.read).toBeTypeOf("function");
  expect(createPersistence).toHaveBeenCalledWith(options.database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  await composition.orderAccessRuntime.start();
  await Promise.all([
    composition.orderAccessRuntime.stop(),
    composition.orderAccessRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledTimes(1);
  createPersistence.mockClear();
  expect(() =>
    createTestOrderAccessComposition(
      { ...options, environment: "PRODUCTION" as never },
      { createPersistence } as never,
    ),
  ).toThrow("Invalid TEST order access environment");
  expect(() =>
    createTestOrderAccessComposition(
      { ...options, configuration: { ...configuration, sessionTtlSeconds: 0 } },
      { createPersistence } as never,
    ),
  ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});
