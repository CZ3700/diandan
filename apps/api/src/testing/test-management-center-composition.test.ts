import { expect, test, vi } from "vitest";
import { createTestManagementCenterComposition } from "./test-management-center-composition.js";
const options = {
  environment: "TEST" as const,
  database: {
    host: "database.internal",
    port: 5432,
    database: "fixture",
    user: "fixture",
    password: "test-password",
  },
  tokenPepper: "a".repeat(64),
  allowedOrigin: "http://localhost:3100",
  publicMediaBaseUrl: "https://media.example.test",
  storage: {
    createUploadGrant: vi.fn(),
    inspectObject: vi.fn(),
    createDownloadGrant: vi.fn(),
    deleteObject: vi.fn(),
    resolvePublicUrl: vi.fn(),
  },
  inspector: { inspect: vi.fn() },
  processor: { process: vi.fn() },
};
test("TEST management rejects invalid configuration before acquiring persistence", () => {
  const createPersistence = vi.fn();
  for (const invalid of [
    { environment: "PRODUCTION" },
    { tokenPepper: "weak" },
    { allowedOrigin: "https://example.test/path" },
    { publicMediaBaseUrl: "http://example.test" },
    { processor: null },
    { pollIntervalMs: 0 },
  ])
    expect(() =>
      createTestManagementCenterComposition(
        { ...options, ...invalid } as never,
        { createPersistence },
      ),
    ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});
test("management composition owns its pool and continuously drives real use case ports", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const close = vi.fn(async () => undefined),
    managementClaim = vi.fn(async () => null),
    mediaClaim = vi.fn(async () => {
      await pending;
      return { schemaVersion: 1, outcome: "EMPTY" };
    });
  const transactions = {
    runInManagementCenterTransaction: async (
      work: (repositories: unknown) => unknown,
    ) => work({ operations: { claim: managementClaim } }),
    runInManagementMediaTransaction: vi.fn(),
    runInResourceManagementTransaction: vi.fn(),
    runInMediaProcessingTransaction: async (
      work: (repositories: unknown) => unknown,
    ) => work({ mediaProcessing: { claim: mediaClaim } }),
  };
  const composition = createTestManagementCenterComposition(options, {
    createPersistence: () =>
      ({
        managementCenterTransactionManager: transactions,
        managementMediaTransactionManager: transactions,
        resourceManagementTransactionManager: transactions,
        mediaProcessingTransactionManager: transactions,
        close,
      }) as never,
  });
  expect(composition).toHaveProperty("homeLayoutRoute.useCases.execute");
  expect(composition).toHaveProperty("storefrontThemeRoute.useCases.execute");
  expect(composition).toHaveProperty("storefrontBrandRoute.useCases.execute");
  expect(composition).toHaveProperty(
    "storefrontNavigationRoute.useCases.execute",
  );
  await composition.managementCenterRuntime.start();
  const stopped = composition.managementCenterRuntime.stop();
  expect(close).not.toHaveBeenCalled();
  release();
  await stopped;
  await composition.managementCenterRuntime.stop();
  expect(mediaClaim).toHaveBeenCalledTimes(1);
  expect(managementClaim).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(options.storage.createUploadGrant).not.toHaveBeenCalled();
});
