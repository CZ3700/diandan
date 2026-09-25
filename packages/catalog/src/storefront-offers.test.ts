import { expect, test } from "vitest";

async function project(input: unknown) {
  const module = await import("./storefront-offers.js").catch(() => undefined);
  expect(
    module,
    "current storefront offer projection must exist",
  ).toBeDefined();
  return module!.projectStorefrontGiftOffers(input);
}
const id = "b74152dc-e245-44d5-97f5-ff84ef60e138";
const input = () => ({
  schemaVersion: 1,
  giftStatus: "active",
  recipient: { kind: "NONE" },
  variants: [
    {
      schemaVersion: 1,
      id,
      label: "Standard",
      status: "active",
      inventoryPolicy: "TRACKED",
    },
  ],
  facts: [
    {
      giftVariantId: id,
      price: {
        priceId: "3f15ce90-171b-4c76-8238-118212242295",
        priceRevision: 1,
        unitAmountMinor: 1200,
      },
      hasEligibleRecipient: true,
      eligibleForSelectedRecipient: false,
      inventoryItem: { policy: "TRACKED", status: "ACTIVE" },
      maximumLocationAvailableQuantity: 2,
    },
  ],
});

test("unselected recipients can browse a real offer but must choose a recipient", async () => {
  expect(await project(input())).toMatchObject([
    {
      availability: "AVAILABLE",
      reason: null,
      requiresRecipient: true,
      stock: { kind: "TRACKED", availableQuantity: 2 },
      maxQuantity: 2,
    },
  ]);
});
test("on-demand and preorder do not need a fictional inventory item or balance", async () => {
  for (const policy of ["PROCURE_ON_DEMAND", "PREORDER"]) {
    const value = input();
    Object.assign(value.variants[0]!, { inventoryPolicy: policy });
    Object.assign(value.facts[0]!, {
      inventoryItem: null,
      maximumLocationAvailableQuantity: 0,
    });
    expect(await project(value)).toMatchObject([
      {
        availability: policy === "PREORDER" ? "PREORDER" : "AVAILABLE",
        stock: { kind: policy },
        maxQuantity: Number.MAX_SAFE_INTEGER,
      },
    ]);
  }
});
test("unavailable canonical facts retain real price but never selectable quantity", async () => {
  for (const [change, reason] of [
    [{ maximumLocationAvailableQuantity: 0 }, "OUT_OF_STOCK"],
    [{ price: null }, "PRICE_UNAVAILABLE"],
    [{ hasEligibleRecipient: false }, "NO_ELIGIBLE_RECIPIENT"],
    [{ inventoryItem: null }, "INVENTORY_UNAVAILABLE"],
    [
      { inventoryItem: { policy: "PREORDER", status: "ACTIVE" } },
      "INVENTORY_UNAVAILABLE",
    ],
    [
      { inventoryItem: { policy: "TRACKED", status: "PAUSED" } },
      "INVENTORY_UNAVAILABLE",
    ],
  ] as const) {
    const value = input();
    Object.assign(value.facts[0]!, change);
    expect(await project(value)).toMatchObject([
      { availability: "UNAVAILABLE", reason, maxQuantity: 0 },
    ]);
  }
});
test("pause and a withdrawn recipient override otherwise available stock", async () => {
  const giftPaused = input();
  giftPaused.giftStatus = "paused";
  expect(await project(giftPaused)).toMatchObject([
    { reason: "GIFT_PAUSED", maxQuantity: 0 },
  ]);
  const variantPaused = input();
  variantPaused.variants[0]!.status = "paused";
  expect(await project(variantPaused)).toMatchObject([
    { reason: "VARIANT_PAUSED", maxQuantity: 0 },
  ]);
  const unavailable = input();
  Object.assign(unavailable, {
    recipient: { kind: "UNAVAILABLE", idolId: id },
  });
  expect(await project(unavailable)).toMatchObject([
    {
      reason: "RECIPIENT_UNAVAILABLE",
      requiresRecipient: false,
      maxQuantity: 0,
    },
  ]);
});
test("missing duplicate or foreign variant facts fail closed", async () => {
  for (const facts of [
    [],
    [...input().facts, ...input().facts],
    [
      {
        ...input().facts[0],
        giftVariantId: "3f15ce90-171b-4c76-8238-118212242295",
      },
    ],
  ]) {
    await expect(project({ ...input(), facts })).rejects.toThrow(
      "STOREFRONT_OFFER_DATA_INVALID",
    );
  }
});
