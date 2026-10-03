import { expect, test } from "vitest";
const subject = await import("./gift-commerce-edit").catch(() => undefined);
import {
  currencySchema,
  idolIdSchema,
  marketSchema,
  minorAmountSchema,
  slugSchema,
} from "@fan-support/contracts";
const price = {
  amountMinor: minorAmountSchema.parse(2400),
  market: marketSchema.parse("GLOBAL"),
  currency: currencySchema.parse("USD"),
};
const inventory = {
  policy: "TRACKED" as const,
  quantity: 8,
  locationId: "10000000-0000-4000-8000-000000000001",
};
test("a focal or text edit preserves price and stock even when their canonical values later change", () => {
  expect(subject?.giftCommerceEdit).toBeTypeOf("function");
  expect(
    subject!.giftCommerceEdit(
      { price, inventory },
      { price: { ...price }, inventory: { ...inventory } },
    ),
  ).toEqual({ price: { mode: "PRESERVE" }, inventory: { mode: "PRESERVE" } });
});
test("a bound wish's stock cannot be replenished by a stale edit", () => {
  const baseline = {
    price,
    inventory: { ...inventory, quantity: 0 },
    wish: {
      schemaVersion: 1 as const,
      wishId: "10000000-0000-4000-8000-000000000004",
      artistId: idolIdSchema.parse("10000000-0000-4000-8000-000000000002"),
      artistName: "Mira",
      artistHandle: slugSchema.parse("mira"),
      status: "SUPPORTED" as const,
    },
  };
  expect(
    subject!.giftCommerceEdit(baseline, {
      price,
      inventory: { ...inventory, quantity: 1 },
    }),
  ).toEqual({ price: { mode: "PRESERVE" }, inventory: { mode: "PRESERVE" } });
});
test("an intentional stock or price edit carries the exact displayed baseline independently", () => {
  expect(subject?.giftCommerceEdit).toBeTypeOf("function");
  expect(
    subject!.giftCommerceEdit(
      { price, inventory },
      {
        price: { ...price, amountMinor: minorAmountSchema.parse(3000) },
        inventory,
      },
    ),
  ).toEqual({
    price: { mode: "SET", baseline: price },
    inventory: { mode: "PRESERVE" },
  });
  expect(
    subject!.giftCommerceEdit(
      { price, inventory },
      { price, inventory: { ...inventory, quantity: 5 } },
    ),
  ).toEqual({
    price: { mode: "PRESERVE" },
    inventory: { mode: "SET", baseline: inventory },
  });
});
