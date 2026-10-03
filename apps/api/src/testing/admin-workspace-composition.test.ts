import { expect, test, vi } from "vitest";
import { createTestAdminWorkspaceComposition } from "./admin-workspace-composition.js";
const options = {
  environment: "TEST" as const,
  publicMediaBaseUrl: "https://media.example.invalid",
  database: {
    host: "127.0.0.1",
    port: 5432,
    database: "test",
    user: "test",
    password: "test",
  },
  tokenPepper: "a".repeat(64),
  allowedOrigin: "http://localhost:3100",
  storage: { createDownloadGrant: vi.fn() } as never,
};
test("explicit workspace composition installs fixed capabilities and owns exactly one close", async () => {
  const close = vi.fn(async () => undefined);
  const createPersistence = vi.fn(
    () =>
      ({
        close,
        adminCatalogTransactionManager: {
          runInAdminCatalogTransaction: vi.fn(),
        },
        translationWorkspaceTransactionManager: {
          runInTranslationWorkspaceTransaction: vi.fn(),
        },
        translationTransferTransactionManager: {
          runInTranslationTransferTransaction: vi.fn(),
        },
        adminPreviewMediaTransactionManager: {
          runInAdminPreviewMediaTransaction: vi.fn(),
        },
      }) as never,
  );
  const value = createTestAdminWorkspaceComposition(options, {
    createPersistence,
  });
  expect(createPersistence).toHaveBeenCalledWith(options.database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  expect(value.adminCatalogRoute.allowedOrigin).toBe(options.allowedOrigin);
  expect(typeof value.adminPreviewMediaRoute.useCases.execute).toBe("function");
  await value.adminWorkspaceRuntime.start();
  await Promise.all([
    value.adminWorkspaceRuntime.stop(),
    value.adminWorkspaceRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledTimes(1);
});
test("invalid workspace TEST configuration is rejected before persistence acquisition", () => {
  const createPersistence = vi.fn();
  for (const patch of [
    { environment: "PRODUCTION" },
    { tokenPepper: "invalid" },
    { tokenPepper: { toString: () => options.tokenPepper } },
    { allowedOrigin: "http://localhost:3100/path" },
  ])
    expect(() =>
      createTestAdminWorkspaceComposition({ ...options, ...patch } as never, {
        createPersistence,
      }),
    ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});
