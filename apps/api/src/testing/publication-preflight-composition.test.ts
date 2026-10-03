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
test("publication preflight requires explicit TEST composition", () => {
  expect(api).toHaveProperty("createTestPublicationPreflightComposition");
});
test("publication preflight rejects invalid configuration before acquiring persistence", () => {
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
      api.createTestPublicationPreflightComposition(
        { ...options, ...invalid } as never,
        { createPersistence },
      ),
    ).toThrow();
  }
  expect(createPersistence).not.toHaveBeenCalled();
});
test("publication preflight drains its persistence exactly once", async () => {
  const close = vi.fn(async () => undefined);
  const composition = api.createTestPublicationPreflightComposition(options, {
    createPersistence: () => ({
      publicationPreflightTransactionManager: {
        runInPublicationPreflightTransaction: async () => {
          throw new Error("unused");
        },
      },
      close,
    }),
  });
  expect(composition.publicationPreflightRoute.allowedOrigin).toBe(
    options.allowedOrigin,
  );
  await composition.publicationPreflightRuntime.start();
  await Promise.all([
    composition.publicationPreflightRuntime.stop(),
    composition.publicationPreflightRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledTimes(1);
});
