import { expect, test } from "vitest";
import { SUPPORTED_LOCALES } from "./locale.js";
import * as storefrontCommerce from "./storefront-commerce.js";

async function contracts() {
  const module = storefrontCommerce;
  expect(module, "storefront commerce read contracts must exist").toBeDefined();
  return module!;
}

const variantId = "b74152dc-e245-44d5-97f5-ff84ef60e138";
const priceId = "3f15ce90-171b-4c76-8238-118212242295";

test("gift reads require explicit independent locale and complete commerce scope", async () => {
  const { storefrontGiftReadCommandSchema: schema } = await contracts();
  const input = {
    schemaVersion: 1,
    handle: "studio-gift",
    market: "TEST",
    currency: "USD",
  };
  for (const locale of SUPPORTED_LOCALES)
    expect(schema.safeParse({ ...input, locale }).success).toBe(true);
  for (const change of [
    { locale: "en-XA" },
    { market: undefined },
    { currency: undefined },
    { idolId: "caller-name" },
    { inventoryPolicy: "PROCURE_ON_DEMAND" },
    { price: 1 },
    { schemaVersion: 2 },
  ])
    expect(
      schema.safeParse({ ...input, locale: "en", ...change }).success,
    ).toBe(false);
});

test("public configuration is bounded unique canonical market and published policy metadata", async () => {
  const {
    storefrontContextReadCommandSchema,
    storefrontContextResponseSchema: schema,
  } = await contracts();
  expect(
    storefrontContextReadCommandSchema.safeParse({ schemaVersion: 1 }).success,
  ).toBe(true);
  expect(
    storefrontContextReadCommandSchema.safeParse({
      schemaVersion: 1,
      locale: "en",
    }).success,
  ).toBe(false);
  const input = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_CONTEXT",
    markets: [{ market: "TEST", currencies: ["JPY", "USD"] }],
    policies: [{ policyKey: "studio-refunds", kind: "REFUND" }],
  };
  expect(schema.safeParse(input).success).toBe(true);
  for (const change of [
    { inventoryLocations: [] },
    { markets: [{ ...input.markets[0], marketId: variantId }] },
    { markets: [...input.markets, ...input.markets] },
    { markets: [{ market: "TEST", currencies: ["USD", "USD"] }] },
    { policies: [...input.policies, ...input.policies] },
    { policies: [{ ...input.policies[0], body: "unreviewed text" }] },
  ])
    expect(schema.safeParse({ ...input, ...change }).success).toBe(false);
});

test("stock is distinct from gift type and unavailable offers cannot advertise selectable quantities", async () => {
  const { storefrontGiftOfferSchema: schema } = await contracts();
  const offer = {
    giftVariantId: variantId,
    price: { priceId, priceRevision: 1, unitAmountMinor: 1200 },
    availability: "AVAILABLE",
    reason: null,
    requiresRecipient: true,
    stock: { kind: "TRACKED", availableQuantity: 2 },
    maxQuantity: 2,
  };
  expect(schema.safeParse(offer).success).toBe(true);
  expect(
    schema.safeParse({
      ...offer,
      stock: { kind: "PROCURE_ON_DEMAND" },
      maxQuantity: Number.MAX_SAFE_INTEGER,
    }).success,
  ).toBe(true);
  expect(
    schema.safeParse({
      ...offer,
      stock: { kind: "PREORDER" },
      availability: "PREORDER",
    }).success,
  ).toBe(true);
  for (const change of [
    { price: null },
    { maxQuantity: 0 },
    { maxQuantity: 3 },
    { reason: "OUT_OF_STOCK" },
    { giftKind: "VIRTUAL" },
    { stock: { kind: "PROCURE_ON_DEMAND", availableQuantity: 999999 } },
    { availability: "UNAVAILABLE", reason: "OUT_OF_STOCK" },
    { availability: "LOW_STOCK" },
  ])
    expect(schema.safeParse({ ...offer, ...change }).success).toBe(false);
  expect(
    schema.safeParse({
      ...offer,
      availability: "UNAVAILABLE",
      reason: "NOT_ELIGIBLE",
      maxQuantity: 0,
    }).success,
  ).toBe(true);
});

test("new public failures remain strict and distinguish a withdrawn market from missing content", async () => {
  const { storefrontGiftResponseSchema: schema } = await contracts();
  for (const code of [
    "INVALID_QUERY",
    "NOT_FOUND",
    "MARKET_UNAVAILABLE",
    "CONTENT_UNAVAILABLE",
  ]) {
    const failure = { schemaVersion: 1, outcome: "FAILURE", code };
    expect(schema.safeParse(failure).success).toBe(true);
    expect(schema.safeParse({ ...failure, objectKey: "private" }).success).toBe(
      false,
    );
  }
});
