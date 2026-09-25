import { expect, test, vi } from "vitest";
import { storefrontGiftReadCommandSchema } from "@fan-support/contracts";
import type { TransactionScopeControl } from "./transaction-runner.js";

const scope = {
  trackOperation: <T>(work: () => Promise<T>) => work(),
} as TransactionScopeControl;
test("an invalid bounded recipient witness is unknown availability, never absence of eligible artists", async () => {
  const { verifyStorefrontRecipientWitnesses } =
    await import("./storefront-commerce-repository.js");
  const load = vi.fn(async () => false);
  // SQL selected the first current candidate; another artist may exist outside this bounded proof.
  await expect(
    verifyStorefrontRecipientWitnesses(
      [{ variantId: "variant", idolId: "first", handle: "first" }],
      load,
    ),
  ).rejects.toThrow("STOREFRONT_RECIPIENT_PROOF_UNAVAILABLE");
  expect(load).toHaveBeenCalledTimes(1);
  expect(await verifyStorefrontRecipientWitnesses([], load)).toEqual(new Set());
});
test("storefront repository rejects caller-selected private fields before any SQL", async () => {
  const { createStorefrontCommerceRepository } =
    await import("./storefront-commerce-repository.js");
  const query = vi.fn();
  const reader = createStorefrontCommerceRepository(
    { query, release: vi.fn() },
    scope,
    "https://media.example.test/",
  );
  expect(
    await reader.readContext({ schemaVersion: 1, country: "TEST" } as never),
  ).toMatchObject({ code: "INVALID_QUERY" });
  expect(
    await reader.loadGift({
      schemaVersion: 1,
      handle: "gift",
      locale: "en",
      market: "TEST",
      currency: "USD",
      inventoryItemId: "secret",
    } as never),
  ).toMatchObject({ code: "INVALID_QUERY" });
  expect(query).not.toHaveBeenCalled();
});
test("empty public configuration is valid and missing gifts cannot expose prices or inventory", async () => {
  const { createStorefrontCommerceRepository } =
    await import("./storefront-commerce-repository.js");
  const query = vi.fn(async () => ({ rows: [] }));
  const reader = createStorefrontCommerceRepository(
    { query, release: vi.fn() },
    scope,
    "https://media.example.test/",
  );
  expect(await reader.readContext({ schemaVersion: 1 })).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_CONTEXT",
    markets: [],
    policies: [],
  });
  query.mockClear();
  expect(
    await reader.loadGift(
      storefrontGiftReadCommandSchema.parse({
        schemaVersion: 1,
        handle: "gift",
        locale: "en",
        market: "TEST",
        currency: "USD",
      }),
    ),
  ).toMatchObject({ code: "NOT_FOUND" });
  expect(
    query.mock.calls
      .flat()
      .some((sql) =>
        /public\.(?:prices|inventory_balances)/u.test(String(sql)),
      ),
  ).toBe(false);
});
