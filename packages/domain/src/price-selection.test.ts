import { describe, expect, test } from "vitest";
import { priceSelectionDecisionSchema } from "@fan-support/contracts";

import { selectEffectivePrice } from "./price-selection.js";

const VARIANT_ID = "9fa44c67-1a8e-45e9-afc2-887f0422cc8e";
const PRICE_BOOK_ID = "33650349-95d0-43df-9c85-9dcb486c35c7";
const PRICE_ID = "ec4caf66-6e49-4112-876a-11e405b89cc7";

const priceBook = {
  schemaVersion: 1,
  id: PRICE_BOOK_ID,
  revision: 4,
  market: "US",
  currency: "USD",
  status: "PUBLISHED",
  validFrom: "2026-09-03T00:00:00Z",
  validUntil: "2026-10-03T00:00:00Z",
} as const;

const price = {
  schemaVersion: 1,
  id: PRICE_ID,
  revision: 2,
  priceBookId: PRICE_BOOK_ID,
  priceBookRevision: 4,
  giftVariantId: VARIANT_ID,
  unitAmountMinor: 2_500,
  validFrom: "2026-09-03T00:00:00Z",
  validUntil: "2026-10-03T00:00:00Z",
} as const;

function selectAt(evaluatedAt: string) {
  return selectEffectivePrice({
    schemaVersion: 1,
    evaluatedAt,
    market: "US",
    currency: "USD",
    giftVariantId: VARIANT_ID,
    priceBooks: [priceBook],
    prices: [price],
  });
}

describe("effective price selection", () => {
  test("uses half-open validity and returns the price revision", () => {
    expect(selectAt(price.validFrom)).toEqual({
      schemaVersion: 1,
      kind: "SELECTED",
      priceId: PRICE_ID,
      priceRevision: 2,
      priceBookId: PRICE_BOOK_ID,
      priceBookRevision: 4,
      unitAmountMinor: 2_500,
    });
    expect(selectAt(price.validUntil)).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "PRICE_NOT_FOUND",
    });
  });

  test("fails closed when more than one effective price matches", () => {
    expect(
      selectEffectivePrice({
        schemaVersion: 1,
        evaluatedAt: "2026-09-15T00:00:00Z",
        market: "US",
        currency: "USD",
        giftVariantId: VARIANT_ID,
        priceBooks: [priceBook],
        prices: [
          price,
          {
            ...price,
            id: "13dc5880-5ca4-4f2f-b951-acd695a77fb1",
            revision: 1,
          },
        ],
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "PRICE_AMBIGUOUS",
    });
  });

  test("does not select a non-published price-book revision", () => {
    expect(
      selectEffectivePrice({
        schemaVersion: 1,
        evaluatedAt: "2026-09-15T00:00:00Z",
        market: "US",
        currency: "USD",
        giftVariantId: VARIANT_ID,
        priceBooks: [{ ...priceBook, status: "SUPERSEDED" }],
        prices: [price],
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "PRICE_NOT_FOUND",
    });
  });

  test("rejects duplicate revisions and ignores prices for another variant", () => {
    const input = {
      schemaVersion: 1,
      evaluatedAt: "2026-09-15T00:00:00Z",
      market: "US",
      currency: "USD",
      giftVariantId: VARIANT_ID,
      priceBooks: [priceBook],
      prices: [price],
    } as const;
    expect(
      selectEffectivePrice({ ...input, priceBooks: [priceBook, priceBook] }),
    ).toMatchObject({ kind: "REJECTED", code: "PRICE_DATA_INVALID" });
    expect(
      selectEffectivePrice({ ...input, prices: [price, price] }),
    ).toMatchObject({ kind: "REJECTED", code: "PRICE_DATA_INVALID" });
    expect(
      selectEffectivePrice({
        ...input,
        prices: [
          {
            ...price,
            giftVariantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
        ],
      }),
    ).toMatchObject({ kind: "REJECTED", code: "PRICE_NOT_FOUND" });
  });

  test("strictly validates the versioned selection input and emits a contract decision", () => {
    const valid = {
      schemaVersion: 1,
      evaluatedAt: "2026-09-15T00:00:00Z",
      market: "US",
      currency: "USD",
      giftVariantId: VARIANT_ID,
      priceBooks: [priceBook],
      prices: [price],
    };
    expect(
      priceSelectionDecisionSchema.safeParse(selectEffectivePrice(valid))
        .success,
    ).toBe(true);

    for (const invalid of [
      { ...valid, schemaVersion: 2 },
      { ...valid, unknown: true },
      {
        evaluatedAt: valid.evaluatedAt,
        market: valid.market,
        currency: valid.currency,
        giftVariantId: valid.giftVariantId,
        priceBooks: valid.priceBooks,
        prices: valid.prices,
      },
      null,
    ]) {
      expect(selectEffectivePrice(invalid)).toEqual({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "PRICE_DATA_INVALID",
      });
    }
  });
});
