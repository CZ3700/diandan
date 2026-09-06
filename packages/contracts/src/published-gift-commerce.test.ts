import { expect, it } from "vitest";
import * as contract from "./published-gift-commerce.js";
it("keeps gift classification reads separate from locale, price and inventory commands", () => {
  const input = {
    schemaVersion: 1,
    locator: { kind: "GIFT", handle: "studio-gift" },
    locale: "th",
  };
  expect(contract.publishedGiftCommerceReadCommandSchema.parse(input)).toEqual(
    input,
  );
  for (const extra of [
    { currency: "USD" },
    { giftKind: "VIRTUAL" },
    { inventoryPolicy: "PROCURE_ON_DEMAND" },
    { locale: "en-XA" },
  ])
    expect(
      contract.publishedGiftCommerceReadCommandSchema.safeParse({
        ...input,
        ...extra,
      }).success,
    ).toBe(false);
  expect(
    contract.publishedGiftCommerceReadCommandSchema.safeParse({
      ...input,
      locator: { kind: "IDOL", handle: "studio-gift" },
    }).success,
  ).toBe(false);
});
it("exposes only reviewed classification vocabulary and hash, never internal profile authors", () => {
  expect(
    contract.publishedGiftClassificationSchema.parse({ kind: "LEGACY" }),
  ).toEqual({ kind: "LEGACY" });
  const profile = {
    kind: "CLASSIFIED",
    giftKind: "WISH",
    profileHash: "a".repeat(64),
  };
  expect(contract.publishedGiftClassificationSchema.parse(profile)).toEqual(
    profile,
  );
  expect(
    contract.publishedGiftClassificationSchema.safeParse({
      ...profile,
      createdBy: "operator",
    }).success,
  ).toBe(false);
  expect(
    contract.publishedGiftClassificationSchema.safeParse({
      ...profile,
      inventoryPolicy: "TRACKED",
    }).success,
  ).toBe(false);
});
