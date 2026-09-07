import { expect, it } from "vitest";
import { storefrontGiftOfferSchema } from "@fan-support/contracts";
import * as selection from "./gift-selection";

it("opens the lowest currently available variant and preserves an explicit selection", () => {
  const offer = (tail: string, amount: number) =>
    storefrontGiftOfferSchema.parse({
      giftVariantId: `11111111-1111-4111-8111-11111111111${tail}`,
      price: {
        priceId: `22222222-2222-4222-8222-22222222222${tail}`,
        priceRevision: 1,
        unitAmountMinor: amount,
      },
      availability: "AVAILABLE",
      reason: null,
      requiresRecipient: true,
      stock: { kind: "PROCURE_ON_DEMAND" },
      maxQuantity: Number.MAX_SAFE_INTEGER,
    });
  const expensive = offer("1", 2000),
    cheap = offer("2", 1000);
  const choose = (selection as unknown as Record<string, unknown>)[
    "selectGiftOffer"
  ];
  expect(typeof choose).toBe("function");
  if (typeof choose !== "function") return;
  const offers = Object.freeze([expensive, cheap]);
  expect(choose(offers)).toEqual(cheap);
  expect(choose(offers, expensive.giftVariantId)).toEqual(expensive);
  expect(
    choose(offers, "33333333-3333-4333-8333-333333333333"),
  ).toBeUndefined();
  expect(offers[0]).toBe(expensive);
});
