import { describe, expect, test } from "vitest";
import {
  lineAmountCalculationDecisionSchema,
  orderAmountCalculationDecisionSchema,
} from "@fan-support/contracts";

import { calculateLineAmounts, calculateOrderAmounts } from "./money.js";

const CART_ITEM_ID = "c0d51f36-f139-4fd7-9205-fb6d9db1666e";
const GIFT_VARIANT_ID = "9fa44c67-1a8e-45e9-afc2-887f0422cc8e";
const PRICE_ID = "ec4caf66-6e49-4112-876a-11e405b89cc7";

function quoteLine(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    cartItemId: CART_ITEM_ID,
    giftVariantId: GIFT_VARIANT_ID,
    priceId: PRICE_ID,
    priceRevision: 2,
    quantity: 1,
    unitAmountMinor: 1_000,
    lineSubtotalMinor: 1_000,
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    lineTotalMinor: 1_000,
    currency: "USD",
    ...overrides,
  };
}

describe("minor-unit amount arithmetic", () => {
  test("calculates line amounts without floating-point arithmetic", () => {
    expect(
      calculateLineAmounts({
        schemaVersion: 1,
        unitAmountMinor: 1_250,
        quantity: 2,
        taxAmountMinor: 100,
        discountAmountMinor: 50,
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "CALCULATED",
      lineSubtotalMinor: 2_500,
      lineTotalMinor: 2_550,
    });
  });

  test("rejects multiplication beyond MAX_SAFE_INTEGER", () => {
    expect(
      calculateLineAmounts({
        schemaVersion: 1,
        unitAmountMinor: Number.MAX_SAFE_INTEGER,
        quantity: 2,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "AMOUNT_OVERFLOW",
    });
  });

  test("rejects invalid line inputs and discounts larger than gross", () => {
    expect(calculateLineAmounts(null)).toMatchObject({
      kind: "REJECTED",
      code: "INVALID_AMOUNT",
    });
    expect(
      calculateLineAmounts({
        schemaVersion: 1,
        unitAmountMinor: 100,
        quantity: 1,
        taxAmountMinor: 0,
        discountAmountMinor: 101,
      }),
    ).toMatchObject({
      kind: "REJECTED",
      code: "DISCOUNT_EXCEEDS_GROSS",
    });
  });

  test("rejects duplicate cart-item lines before aggregating", () => {
    const line = quoteLine();

    expect(
      calculateOrderAmounts({
        schemaVersion: 1,
        currency: "USD",
        lines: [line, line],
        shippingAmountMinor: 0,
        feeAmountMinor: 0,
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "DUPLICATE_CART_ITEM",
    });
  });

  test("rejects a non-canonical cart-item identity", () => {
    expect(
      calculateOrderAmounts({
        schemaVersion: 1,
        currency: "USD",
        lines: [quoteLine({ cartItemId: "not-a-cart-item-id" })],
        shippingAmountMinor: 0,
        feeAmountMinor: 0,
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "INVALID_AMOUNT",
    });
  });

  test("allows safe cancellation of a temporarily larger BigInt sum", () => {
    expect(
      calculateOrderAmounts({
        schemaVersion: 1,
        currency: "USD",
        lines: [
          quoteLine({
            unitAmountMinor: Number.MAX_SAFE_INTEGER,
            lineSubtotalMinor: Number.MAX_SAFE_INTEGER,
            taxAmountMinor: 2,
            discountAmountMinor: 2,
            lineTotalMinor: Number.MAX_SAFE_INTEGER,
          }),
        ],
        shippingAmountMinor: 0,
        feeAmountMinor: 0,
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "CALCULATED",
      subtotalMinor: Number.MAX_SAFE_INTEGER,
      taxAmountMinor: 2,
      shippingAmountMinor: 0,
      feeAmountMinor: 0,
      discountAmountMinor: 2,
      totalAmountMinor: Number.MAX_SAFE_INTEGER,
    });
  });

  test("rejects a self-consistent line total when unit price times quantity is tampered", () => {
    expect(
      calculateOrderAmounts({
        schemaVersion: 1,
        currency: "USD",
        lines: [
          quoteLine({
            quantity: 2,
            unitAmountMinor: 500,
            lineSubtotalMinor: 1_250,
            lineTotalMinor: 1_250,
          }),
        ],
        shippingAmountMinor: 0,
        feeAmountMinor: 0,
      }),
    ).toMatchObject({
      schemaVersion: 1,
      kind: "REJECTED",
    });
  });

  test("requires a complete strict canonical checkout-quote line", () => {
    const missingPrice: Record<string, unknown> = quoteLine();
    delete missingPrice["priceId"];
    expect(
      calculateOrderAmounts({
        schemaVersion: 1,
        currency: "USD",
        lines: [missingPrice],
        shippingAmountMinor: 0,
        feeAmountMinor: 0,
      }),
    ).toMatchObject({ kind: "REJECTED", code: "INVALID_AMOUNT" });

    expect(
      calculateOrderAmounts({
        schemaVersion: 1,
        currency: "USD",
        lines: [quoteLine({ untrustedAmount: 1 })],
        shippingAmountMinor: 0,
        feeAmountMinor: 0,
      }),
    ).toMatchObject({ kind: "REJECTED", code: "INVALID_AMOUNT" });
  });

  test("validates line currency independently from the canonical quote line", () => {
    expect(
      calculateOrderAmounts({
        schemaVersion: 1,
        currency: "USD",
        lines: [quoteLine({ currency: "EUR" })],
        shippingAmountMinor: 0,
        feeAmountMinor: 0,
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "CURRENCY_MISMATCH",
    });
  });

  test("rejects aggregate overflow across individually valid quote lines", () => {
    expect(
      calculateOrderAmounts({
        schemaVersion: 1,
        currency: "USD",
        lines: [
          quoteLine({
            unitAmountMinor: Number.MAX_SAFE_INTEGER,
            lineSubtotalMinor: Number.MAX_SAFE_INTEGER,
            lineTotalMinor: Number.MAX_SAFE_INTEGER,
          }),
          quoteLine({
            cartItemId: "f828042c-71a4-4df0-97e3-80a8e6aacbc0",
            unitAmountMinor: 1,
            lineSubtotalMinor: 1,
            lineTotalMinor: 1,
          }),
        ],
        shippingAmountMinor: 0,
        feeAmountMinor: 0,
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "AMOUNT_OVERFLOW",
    });
  });

  test.each([null, [], { currency: "USD", lines: [] }, { lines: [1] }])(
    "rejects malformed order amount input %#",
    (input) => {
      expect(calculateOrderAmounts(input)).toMatchObject({
        kind: "REJECTED",
        code: "INVALID_AMOUNT",
      });
    },
  );

  test("strictly validates versioned amount inputs and emits contract decisions", () => {
    const validLineInput = {
      schemaVersion: 1,
      unitAmountMinor: 500,
      quantity: 2,
      taxAmountMinor: 0,
      discountAmountMinor: 0,
    };
    const lineDecision = calculateLineAmounts(validLineInput);
    expect(
      lineAmountCalculationDecisionSchema.safeParse(lineDecision).success,
    ).toBe(true);
    for (const invalid of [
      { ...validLineInput, schemaVersion: 2 },
      { ...validLineInput, unknown: true },
      {
        unitAmountMinor: 500,
        quantity: 2,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
      },
    ]) {
      expect(calculateLineAmounts(invalid)).toMatchObject({
        kind: "REJECTED",
        code: "INVALID_AMOUNT",
      });
    }

    const validOrderInput = {
      schemaVersion: 1,
      currency: "USD",
      lines: [quoteLine()],
      shippingAmountMinor: 0,
      feeAmountMinor: 0,
    };
    const orderDecision = calculateOrderAmounts(validOrderInput);
    expect(
      orderAmountCalculationDecisionSchema.safeParse(orderDecision).success,
    ).toBe(true);
    for (const invalid of [
      { ...validOrderInput, schemaVersion: 2 },
      { ...validOrderInput, unknown: true },
      {
        currency: "USD",
        lines: [quoteLine()],
        shippingAmountMinor: 0,
        feeAmountMinor: 0,
      },
    ]) {
      expect(calculateOrderAmounts(invalid)).toMatchObject({
        kind: "REJECTED",
        code: "INVALID_AMOUNT",
      });
    }
  });
});
