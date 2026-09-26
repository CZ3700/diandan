import * as application from "@fan-support/application";
import { expect, test, vi } from "vitest";
import * as api from "./index.js";
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
  allowedOrigin: "http://localhost:3002",
  storage: {
    createUploadGrant: vi.fn(),
    inspectObject: vi.fn(),
    createDownloadGrant: vi.fn(),
    deleteObject: vi.fn(),
    resolvePublicUrl: vi.fn(),
  },
  inspector: { inspect: vi.fn() },
};
test("resource management rejects invalid TEST configuration before acquiring persistence", () => {
  const createPersistence = vi.fn();
  for (const invalid of [
    { environment: "PRODUCTION" },
    { tokenPepper: "weak" },
    { tokenPepper: { toString: () => options.tokenPepper } },
    { allowedOrigin: "http://localhost:3002/path" },
    { allowedOrigin: "https://user:password@example.test" },
    { storage: null },
    { inspector: {} },
  ]) {
    expect(() =>
      api.createTestResourceManagementComposition(
        { ...options, ...invalid } as never,
        { createPersistence },
      ),
    ).toThrow();
  }
  expect(createPersistence).not.toHaveBeenCalled();
});
test("resource management drains owned persistence once and borrows media ports", async () => {
  const close = vi.fn(async () => undefined);
  const composition = api.createTestResourceManagementComposition(options, {
    createPersistence: () => ({
      resourceManagementTransactionManager: {
        runInResourceManagementTransaction: async () => {
          throw new Error("unused");
        },
      },
      close,
    }),
  });
  expect(composition.resourceManagementRoute.allowedOrigin).toBe(
    options.allowedOrigin,
  );
  await composition.resourceManagementRuntime.start();
  await Promise.all([
    composition.resourceManagementRuntime.stop(),
    composition.resourceManagementRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledTimes(1);
  expect(options.inspector.inspect).not.toHaveBeenCalled();
  expect(options.storage.createUploadGrant).not.toHaveBeenCalled();
});

test("construction failure closes owned persistence without retaining provider errors", async () => {
  const close = vi.fn(async () => undefined);
  const create = vi
    .spyOn(application, "createResourceManagementUseCases")
    .mockImplementationOnce(() => {
      throw new Error("sensitive-provider-detail");
    });
  try {
    expect(() =>
      api.createTestResourceManagementComposition(options, {
        createPersistence: () => ({
          resourceManagementTransactionManager: {
            runInResourceManagementTransaction: async () => {
              throw new Error("unused");
            },
          },
          close,
        }),
      }),
    ).toThrow("test resource management construction failed");
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    create.mockRestore();
  }
});
