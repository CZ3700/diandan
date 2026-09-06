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
test("authoring requires an explicit test composition", () => {
  expect(api).toHaveProperty("createTestContentAuthoringComposition");
});
test("authoring rejects production or invalid configuration before opening persistence", () => {
  const createPersistence = vi.fn();
  const stringLikePepper = { toString: () => options.tokenPepper };
  for (const invalid of [
    { environment: "PRODUCTION" },
    { tokenPepper: "weak" },
    { tokenPepper: stringLikePepper },
    { allowedOrigin: "http://localhost:3002/path" },
  ])
    expect(() =>
      api.createTestContentAuthoringComposition(
        { ...options, ...invalid } as never,
        { createPersistence },
      ),
    ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});
test("authoring drains only its own persistence once", async () => {
  const close = vi.fn(async () => undefined);
  const composition = api.createTestContentAuthoringComposition(options, {
    createPersistence: () => ({
      contentAuthoringTransactionManager: {
        runInContentAuthoringTransaction: async () => {
          throw new Error("unused");
        },
      },
      close,
    }),
  });
  expect(composition.contentAuthoringRoute.allowedOrigin).toBe(
    options.allowedOrigin,
  );
  await composition.contentAuthoringRuntime.start();
  await Promise.all([
    composition.contentAuthoringRuntime.stop(),
    composition.contentAuthoringRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledTimes(1);
});
