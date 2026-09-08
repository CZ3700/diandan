import { expect, test, vi } from "vitest";
import { createTestCartRuntimeComposition } from "./cart-composition.js";
const observed = vi.hoisted(() => ({
  create: vi.fn(() => ({ initialize: vi.fn(), read: vi.fn(), add: vi.fn() })),
}));
vi.mock("@fan-support/application", () => ({
  createCartRuntimeUseCases: observed.create,
}));
const database = { connectionString: "postgresql://fixture.invalid/cart" };
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
function factory() {
  return {
    cartRuntimeTransactionManager: { runInCartRuntimeTransaction: vi.fn() },
    close: vi.fn(async () => {}),
  };
}
test("composition shares authenticated cart transactions and key port, and closes its owned pool once", async () => {
  const persistence = factory();
  const createPersistence = vi.fn(() => persistence);
  const result = createTestCartRuntimeComposition(options, {
    createPersistence,
  });
  expect(createPersistence).toHaveBeenCalledWith(database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  expect(observed.create).toHaveBeenLastCalledWith({
    transactions: persistence.cartRuntimeTransactionManager,
    keyManagement,
  });
  expect(result.cartRoute.allowedOrigin).toBe(options.allowedOrigin);
  await result.cartRuntime.start();
  await Promise.all([result.cartRuntime.stop(), result.cartRuntime.stop()]);
  expect(persistence.close).toHaveBeenCalledTimes(1);
});
test("invalid TEST configuration is rejected before a pool is opened", () => {
  const createPersistence = vi.fn(factory);
  for (const override of [
    { environment: "production" },
    { allowedOrigin: "https://shop.example.invalid/path" },
    { publicMediaBaseUrl: "http://media.example.invalid" },
    { pepperVersions: [] },
  ]) {
    expect(() =>
      createTestCartRuntimeComposition(
        { ...options, ...override } as typeof options,
        { createPersistence },
      ),
    ).toThrow(TypeError);
  }
  expect(createPersistence).not.toHaveBeenCalled();
});
