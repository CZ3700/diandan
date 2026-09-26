import { expect, test, vi } from "vitest";
import * as composition from "./checkout-composition.js";

const observed = vi.hoisted(() => ({
  create: vi.fn(() => ({ validate: vi.fn(), create: vi.fn(), read: vi.fn() })),
}));
vi.mock("@fan-support/application", () => ({
  createCheckoutPreflightUseCases: observed.create,
}));
const load = async () => composition;
const database = { connectionString: "postgresql://fixture.invalid/checkout" };
const keyManagement = {
  computeBlindIndex: vi.fn(),
  encryptEnvelope: vi.fn(),
  encryptEnvelopeFields: vi.fn(),
  decryptEnvelope: vi.fn(),
  generateSupportIntentKey: vi.fn(),
};
const options = {
  environment: "TEST" as const,
  database,
  allowedOrigin: "https://shop.example.invalid",
  publicMediaBaseUrl: "https://media.example.invalid",
  keyManagement,
  activePepperVersion: "test-v1",
  pepperVersions: ["test-v1"],
};

test("checkout composition owns exactly one independent transaction pool and shares its KMS credentials", async () => {
  const module = await load();
  expect(module?.createTestCheckoutPreflightComposition).toBeTypeOf("function");
  const persistence = {
    checkoutPreflightTransactionManager: {
      runInCheckoutPreflightTransaction: vi.fn(),
    },
    close: vi.fn(async () => {}),
  };
  const createPersistence = vi.fn(() => persistence);
  const result = module!.createTestCheckoutPreflightComposition(options, {
    createPersistence,
  });
  expect(createPersistence).toHaveBeenCalledWith(database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  expect(observed.create).toHaveBeenLastCalledWith({
    transactions: persistence.checkoutPreflightTransactionManager,
    keyManagement,
  });
  expect(result.checkoutPreflightRoute.allowedOrigin).toBe(
    options.allowedOrigin,
  );
  await result.checkoutPreflightRuntime.start();
  await Promise.all([
    result.checkoutPreflightRuntime.stop(),
    result.checkoutPreflightRuntime.stop(),
  ]);
  expect(persistence.close).toHaveBeenCalledTimes(1);
});

test("invalid checkout TEST configuration fails before opening a pool", async () => {
  const module = await load();
  expect(module?.createTestCheckoutPreflightComposition).toBeTypeOf("function");
  const createPersistence = vi.fn();
  for (const override of [
    { environment: "production" },
    { allowedOrigin: options.allowedOrigin + "/path" },
    { publicMediaBaseUrl: "http://media.example.invalid" },
    { pepperVersions: [] },
  ])
    expect(() =>
      module!.createTestCheckoutPreflightComposition(
        { ...options, ...override } as typeof options,
        { createPersistence },
      ),
    ).toThrow(TypeError);
  expect(createPersistence).not.toHaveBeenCalled();
});
