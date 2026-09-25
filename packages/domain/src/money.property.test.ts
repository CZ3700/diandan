import { expect, test } from "vitest";
import fc from "fast-check";

import { calculateLineAmounts, calculateOrderAmounts } from "./money.js";
import { PROPERTY_PARAMETERS } from "./test-support/property-parameters.js";

const CART_ITEM_ID = "c0d51f36-f139-4fd7-9205-fb6d9db1666e";
const GIFT_VARIANT_ID = "9fa44c67-1a8e-45e9-afc2-887f0422cc8e";
const PRICE_ID = "ec4caf66-6e49-4112-876a-11e405b89cc7";
const SECOND_CART_ITEM_ID = "f828042c-71a4-4df0-97e3-80a8e6aacbc0";

function quoteLine(
  cartItemId: string,
  unitAmountMinor: number,
  currency = "USD",
) {
  return {
    schemaVersion: 1,
    cartItemId,
    giftVariantId: GIFT_VARIANT_ID,
    priceId: PRICE_ID,
    priceRevision: 1,
    quantity: 1,
    unitAmountMinor,
    lineSubtotalMinor: unitAmountMinor,
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    lineTotalMinor: unitAmountMinor,
    currency,
  };
}

test("line arithmetic agrees with a BigInt oracle at safe-integer boundaries", () => {
  fc.assert(
    fc.property(
      fc.maxSafeNat(),
      fc.integer({ min: 1, max: 1_000 }),
      fc.maxSafeNat(),
      fc.maxSafeNat(),
      (unitAmountMinor, quantity, taxAmountMinor, discountAmountMinor) => {
        const subtotal = BigInt(unitAmountMinor) * BigInt(quantity);
        const total =
          subtotal + BigInt(taxAmountMinor) - BigInt(discountAmountMinor);
        const result = calculateLineAmounts({
          schemaVersion: 1,
          unitAmountMinor,
          quantity,
          taxAmountMinor,
          discountAmountMinor,
        });

        if (total < 0n) {
          expect(result).toMatchObject({
            kind: "REJECTED",
            code: "DISCOUNT_EXCEEDS_GROSS",
          });
        } else if (
          subtotal > BigInt(Number.MAX_SAFE_INTEGER) ||
          total > BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          expect(result).toMatchObject({
            kind: "REJECTED",
            code: "AMOUNT_OVERFLOW",
          });
        } else {
          expect(result).toEqual({
            schemaVersion: 1,
            kind: "CALCULATED",
            lineSubtotalMinor: Number(subtotal),
            lineTotalMinor: Number(total),
          });
        }
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("currency mismatches are rejected independently of valid quote-line amounts", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 1_000_000 }), (amount) => {
      expect(
        calculateOrderAmounts({
          schemaVersion: 1,
          currency: "USD",
          lines: [quoteLine(CART_ITEM_ID, amount, "EUR")],
          shippingAmountMinor: 0,
          feeAmountMinor: 0,
        }),
      ).toMatchObject({
        kind: "REJECTED",
        code: "CURRENCY_MISMATCH",
      });
    }),
    PROPERTY_PARAMETERS,
  );
});

test("adding any positive valid line to MAX_SAFE_INTEGER overflows the order", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1_000_000 }), (amount) => {
      expect(
        calculateOrderAmounts({
          schemaVersion: 1,
          currency: "USD",
          lines: [
            quoteLine(CART_ITEM_ID, Number.MAX_SAFE_INTEGER),
            quoteLine(SECOND_CART_ITEM_ID, amount),
          ],
          shippingAmountMinor: 0,
          feeAmountMinor: 0,
        }),
      ).toMatchObject({
        kind: "REJECTED",
        code: "AMOUNT_OVERFLOW",
      });
    }),
    PROPERTY_PARAMETERS,
  );
});

test("order arithmetic agrees with a BigInt oracle and duplicate lines fail closed", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.boolean(),
      (
        lineSubtotalMinor,
        taxAmountMinor,
        shippingAmountMinor,
        duplicateLine,
      ) => {
        const lineTotalMinor = lineSubtotalMinor + taxAmountMinor;
        const line = {
          schemaVersion: 1,
          cartItemId: CART_ITEM_ID,
          giftVariantId: GIFT_VARIANT_ID,
          priceId: PRICE_ID,
          priceRevision: 1,
          quantity: 1,
          unitAmountMinor: lineSubtotalMinor,
          currency: "USD",
          lineSubtotalMinor,
          taxAmountMinor,
          discountAmountMinor: 0,
          lineTotalMinor,
        };
        const result = calculateOrderAmounts({
          schemaVersion: 1,
          currency: "USD",
          lines: duplicateLine ? [line, { ...line }] : [line],
          shippingAmountMinor,
          feeAmountMinor: 0,
        });

        if (duplicateLine) {
          expect(result).toMatchObject({
            kind: "REJECTED",
            code: "DUPLICATE_CART_ITEM",
          });
        } else {
          const total = BigInt(lineTotalMinor) + BigInt(shippingAmountMinor);
          expect(result).toMatchObject({
            kind: "CALCULATED",
            subtotalMinor: lineSubtotalMinor,
            taxAmountMinor,
            totalAmountMinor: Number(total),
          });
        }
      },
    ),
    PROPERTY_PARAMETERS,
  );
});
