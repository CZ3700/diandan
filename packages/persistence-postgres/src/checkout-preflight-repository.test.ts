import { expect, test, vi } from "vitest";
import { checkoutPreflightLoadCurrentCommandSchema } from "@fan-support/contracts";
import { createCheckoutPreflightRepository } from "./checkout-preflight-repository.js";

const id = "00000000-0000-4000-8000-000000000001";
const command = checkoutPreflightLoadCurrentCommandSchema.parse({
  schemaVersion: 1,
  accesses: [
    { schemaVersion: 1, tokenDigest: "a".repeat(64), pepperVersion: "test-v1" },
  ],
  cartId: id,
  expectedCartVersion: 2,
  presentationLocale: "en",
});
test("checkout authenticates and locks the current cart before reading any content", async () => {
  expect(createCheckoutPreflightRepository).toBeTypeOf("function");
  const query = vi.fn(async () => ({ rows: [] }));
  const repo = createCheckoutPreflightRepository(
    { query, release: vi.fn() },
    { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    "https://media.example.test",
  );
  await expect(repo.loadCurrent(command)).rejects.toMatchObject({
    code: "INVALID_ACCESS",
  });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]).toEqual([
    expect.stringMatching(/FROM public\.carts[\s\S]*FOR UPDATE/u),
    expect.any(Array),
  ]);
});
test("checkout rejects extra caller-supplied facts before touching PostgreSQL", async () => {
  expect(createCheckoutPreflightRepository).toBeTypeOf("function");
  const query = vi.fn(async () => ({ rows: [] }));
  const repo = createCheckoutPreflightRepository(
    { query, release: vi.fn() },
    { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    "https://media.example.test",
  );
  const invalid = { ...command, items: [] };
  await expect(repo.loadCurrent(invalid)).rejects.toMatchObject({
    code: "INVALID_COMMAND",
  });
  expect(query).not.toHaveBeenCalled();
});

const activeCart = {
  id,
  version: "2",
  status: "ACTIVE",
  expired: false,
  presentation_locale: "en",
  market: "TEST",
  currency: "USD",
  expires_at: "2026-09-09T00:00:00Z",
  created_at: "2026-09-08T00:00:00Z",
  updated_at: "2026-09-08T00:00:00Z",
};
test.each([
  [{ ...activeCart, expired: true }, "CART_EXPIRED"],
  [{ ...activeCart, status: "LOCKED" }, "CART_LOCKED"],
  [{ ...activeCart, version: "3" }, "VERSION_CONFLICT"],
  [
    { ...activeCart, id: "00000000-0000-4000-8000-000000000002" },
    "INVALID_ACCESS",
  ],
])(
  "invalid current cart prevents any publication or stock read",
  async (row, code) => {
    const query = vi.fn(async () => ({ rows: [row] }));
    const repo = createCheckoutPreflightRepository(
      { query, release: vi.fn() },
      { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
      "https://media.example.test",
    );
    await expect(repo.loadCurrent(command)).rejects.toMatchObject({ code });
    expect(query).toHaveBeenCalledTimes(1);
  },
);
