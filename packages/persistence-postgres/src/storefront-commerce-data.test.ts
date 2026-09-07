import { expect, test, vi } from "vitest";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function moduleUnderTest() {
  return import("./storefront-commerce-data.js");
}
test("current storefront scopes contain only parsed market codes and currencies", async () => {
  const { readStorefrontMarkets } = await moduleUnderTest();
  const query = vi.fn(async () => ({
    rows: [{ market: "TEST", currencies: ["USD"] }],
  }));
  expect(await readStorefrontMarkets({ query, release: vi.fn() })).toEqual([
    { market: "TEST", currencies: ["USD"] },
  ]);
  query.mockResolvedValueOnce({
    rows: [{ market: "TEST", currencies: ["USD", "USD"] }],
  });
  await expect(
    readStorefrontMarkets({ query, release: vi.fn() }),
  ).rejects.toThrow();
});
test("bounded variant facts preserve a real location maximum, genuine price and no-item procurement", async () => {
  const { readStorefrontVariantFacts } = await moduleUnderTest();
  const query = vi.fn(async () => ({
    rows: [
      {
        id: id(2),
        prices: [{ priceId: id(5), priceRevision: 1, unitAmountMinor: 123 }],
        inventory_policy: null,
        inventory_status: null,
        available_quantity: "0",
        eligible_for_selected: false,
        witness_id: id(7),
        witness_handle: "artist-a",
      },
      {
        id: id(1),
        prices: [],
        inventory_policy: "TRACKED",
        inventory_status: "ACTIVE",
        available_quantity: "3",
        eligible_for_selected: true,
        witness_id: null,
        witness_handle: null,
      },
    ],
  }));
  const result = await readStorefrontVariantFacts(
    { query, release: vi.fn() },
    {
      giftId: id(9),
      variantIds: [id(1), id(2)],
      market: "TEST",
      currency: "USD",
      idolId: id(7),
    },
  );
  expect(result.facts.map((row) => row.giftVariantId)).toEqual([id(1), id(2)]);
  expect(result.facts[0]).toMatchObject({
    maximumLocationAvailableQuantity: 3,
    price: null,
    inventoryItem: { policy: "TRACKED", status: "ACTIVE" },
  });
  expect(result.facts[1]).toMatchObject({
    price: { unitAmountMinor: 123 },
    inventoryItem: null,
    hasEligibleRecipient: false,
  });
  expect(result.witnesses).toEqual([
    { variantId: id(2), idolId: id(7), handle: "artist-a" },
  ]);
});
test("ambiguous prices, foreign or missing variants, and imprecise quantities fail closed", async () => {
  const { readStorefrontVariantFacts } = await moduleUnderTest();
  const price = { priceId: id(4), priceRevision: 1, unitAmountMinor: 1 };
  const row = {
    id: id(1),
    prices: [],
    inventory_policy: "TRACKED",
    inventory_status: "ACTIVE",
    available_quantity: "2",
    eligible_for_selected: false,
    witness_id: null,
    witness_handle: null,
  };
  for (const rows of [
    [],
    [{ ...row, id: id(3) }],
    [row, row],
    [{ ...row, prices: [price, price] }],
    [{ ...row, available_quantity: "9007199254740992" }],
    [{ ...row, available_quantity: "2.5" }],
  ]) {
    const query = vi.fn(async () => ({ rows }));
    await expect(
      readStorefrontVariantFacts(
        { query, release: vi.fn() },
        {
          giftId: id(9),
          variantIds: [id(1)],
          market: "TEST",
          currency: "USD",
          idolId: null,
        },
      ),
    ).rejects.toThrow("STOREFRONT_COMMERCE_DATA_INVALID");
  }
});
