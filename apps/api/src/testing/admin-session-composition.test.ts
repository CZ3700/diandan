import { expect, test, vi } from "vitest";
import { createTestAdminSessionComposition } from "./admin-session-composition.js";
const options = {
  environment: "TEST" as const,
  database: { connectionString: "postgresql://localhost/session-test" },
  allowedOrigin: "https://admin.example.invalid",
  tokenPepper: "a".repeat(64),
};
test("explicit TEST composition owns one session manager and closes once", async () => {
  const close = vi.fn(async () => undefined);
  const createPersistence = vi.fn(() => ({
    adminSessionTransactionManager: { runInAdminSessionTransaction: vi.fn() },
    close,
  }));
  const result = createTestAdminSessionComposition(options, {
    createPersistence,
  });
  expect(result.adminSessionRoute.allowedOrigin).toBe(options.allowedOrigin);
  expect(typeof result.adminSessionRoute.useCases.execute).toBe("function");
  await result.adminSessionRuntime.start();
  await Promise.all([
    result.adminSessionRuntime.stop(),
    result.adminSessionRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledOnce();
});
test("non-TEST composition and noncanonical origin cannot acquire persistence", () => {
  const createPersistence = vi.fn();
  for (const change of [
    { environment: "PRODUCTION" },
    { allowedOrigin: options.allowedOrigin + "/" },
    { tokenPepper: "invalid" },
    { tokenPepper: { toString: () => options.tokenPepper } },
  ])
    expect(() =>
      createTestAdminSessionComposition({ ...options, ...change } as never, {
        createPersistence,
      }),
    ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});

test("session composition releases an acquired pool when application construction fails", async () => {
  const close = vi.fn(async () => undefined);
  const createPersistence = vi.fn(
    () => ({ close, adminSessionTransactionManager: null }) as never,
  );
  expect(() =>
    createTestAdminSessionComposition(options, { createPersistence }),
  ).toThrow();
  await Promise.resolve();
  expect(createPersistence).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
