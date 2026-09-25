import { expect, test, vi } from "vitest";
import { createTestAdminContentComposition } from "./admin-content-composition.js";
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
};
test("test admin composition cannot silently enable production or malformed credentials", () => {
  for (const environment of [
    undefined,
    "development",
    "preview",
    "PRODUCTION",
  ]) {
    expect(() =>
      createTestAdminContentComposition({ ...options, environment } as never),
    ).toThrow();
  }
  expect(() =>
    createTestAdminContentComposition({ ...options, tokenPepper: "weak" }),
  ).toThrow();
});
test("closes only its own persistence once", async () => {
  const close = vi.fn(async () => undefined);
  const composition = createTestAdminContentComposition(options, {
    createPersistence: () => ({
      adminContentTransactionManager: {
        runInAdminContentTransaction: async () => {
          throw new Error("unused");
        },
      },
      close,
    }),
  });
  expect(composition.adminContentRoute.allowedOrigin).toBe(
    options.allowedOrigin,
  );
  await composition.adminContentRuntime.start();
  await Promise.all([
    composition.adminContentRuntime.stop(),
    composition.adminContentRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledTimes(1);
});
