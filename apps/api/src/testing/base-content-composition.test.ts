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
};
test("base content requires explicit TEST composition", () => {
  expect(api).toHaveProperty("createTestBaseContentComposition");
});
test("base content rejects invalid configuration before acquiring persistence", () => {
  const createPersistence = vi.fn();
  const credentialOrigin = new URL("https://example.test");
  credentialOrigin.username = "fixture-user";
  credentialOrigin.password = "fixture-password";
  for (const invalid of [
    { environment: "PRODUCTION" },
    { tokenPepper: "weak" },
    { tokenPepper: { toString: () => options.tokenPepper } },
    { allowedOrigin: "http://localhost:3002/path" },
    { allowedOrigin: credentialOrigin.toString() },
  ]) {
    expect(() =>
      api.createTestBaseContentComposition(
        { ...options, ...invalid } as never,
        { createPersistence },
      ),
    ).toThrow();
  }
  expect(createPersistence).not.toHaveBeenCalled();
});
test("base content drains its persistence exactly once", async () => {
  const close = vi.fn(async () => undefined);
  const composition = api.createTestBaseContentComposition(options, {
    createPersistence: () => ({
      baseContentTransactionManager: {
        runInBaseContentTransaction: async () => {
          throw new Error("unused");
        },
      },
      close,
    }),
  });
  expect(composition.baseContentRoute.allowedOrigin).toBe(
    options.allowedOrigin,
  );
  await composition.baseContentRuntime.start();
  await Promise.all([
    composition.baseContentRuntime.stop(),
    composition.baseContentRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledTimes(1);
});
