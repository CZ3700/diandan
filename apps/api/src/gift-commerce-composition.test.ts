import { expect, test, vi } from "vitest";
import { createTestGiftCommerceComposition } from "./gift-commerce-composition.js";

const options = {
  environment: "TEST" as const,
  database: { connectionString: "postgres://localhost/commerce-fixture" },
  tokenPepper: "a".repeat(64),
  allowedOrigin: "http://localhost:3100",
  publicMediaBaseUrl: "https://media.example.invalid",
};
test.each([
  { environment: "PRODUCTION" },
  { tokenPepper: { toString: () => "a".repeat(64) } },
  { tokenPepper: "invalid" },
  { allowedOrigin: "http://localhost:3100/path" },
  { allowedOrigin: "file:///private" },
])(
  "invalid TEST commerce configuration acquires no persistence",
  (override) => {
    const createPersistence = vi.fn();
    expect(() =>
      createTestGiftCommerceComposition({ ...options, ...override } as never, {
        createPersistence,
      }),
    ).toThrow();
    expect(createPersistence).not.toHaveBeenCalled();
  },
);

test("the explicit commerce composition borrows no storage and owns one close-once database resource", async () => {
  const close = vi.fn(async () => undefined);
  const result = createTestGiftCommerceComposition(options, {
    createPersistence: () =>
      ({
        close,
        giftCommerceTransactionManager: {
          runInGiftCommerceTransaction: async () => ({
            schemaVersion: 1,
            outcome: "FAILURE",
            code: "FORBIDDEN",
          }),
        },
      }) as never,
  });
  expect(result.giftCommerceRoute.allowedOrigin).toBe(options.allowedOrigin);
  expect(typeof result.giftCommerceRoute.useCases.execute).toBe("function");
  await result.giftCommerceRuntime.start();
  await Promise.all([
    result.giftCommerceRuntime.stop(),
    result.giftCommerceRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledTimes(1);
});

test("construction failure after acquisition releases its pool exactly once", async () => {
  const close = vi.fn(async () => undefined);
  expect(() =>
    createTestGiftCommerceComposition(options, {
      createPersistence: () =>
        ({ close, giftCommerceTransactionManager: {} }) as never,
    }),
  ).toThrow();
  await Promise.resolve();
  await Promise.resolve();
  expect(close).toHaveBeenCalledTimes(1);
});
