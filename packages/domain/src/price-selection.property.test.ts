import { expect, test } from "vitest";
import fc from "fast-check";

import { selectEffectivePrice } from "./price-selection.js";
import { PROPERTY_PARAMETERS } from "./test-support/property-parameters.js";

const BASE_TIME = Date.parse("2026-01-01T00:00:00Z");
const DAY = 86_400_000;
const VARIANT_ID = "9fa44c67-1a8e-45e9-afc2-887f0422cc8e";
const BOOK_ID = "33650349-95d0-43df-9c85-9dcb486c35c7";
const PRICE_ID = "ec4caf66-6e49-4112-876a-11e405b89cc7";

test("price validity is start-inclusive and end-exclusive for every interval", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 300 }),
      fc.integer({ min: 1, max: 30 }),
      fc.integer({ min: -1, max: 31 }),
      (startDay, durationDays, evaluatedOffset) => {
        const start = BASE_TIME + startDay * DAY;
        const end = start + durationDays * DAY;
        const evaluatedAt = start + evaluatedOffset * DAY;
        const result = selectEffectivePrice({
          schemaVersion: 1,
          evaluatedAt: new Date(evaluatedAt).toISOString(),
          market: "US",
          currency: "USD",
          giftVariantId: VARIANT_ID,
          priceBooks: [
            {
              schemaVersion: 1,
              id: BOOK_ID,
              revision: 1,
              market: "US",
              currency: "USD",
              status: "PUBLISHED",
              validFrom: new Date(start - DAY).toISOString(),
              validUntil: new Date(end + DAY).toISOString(),
            },
          ],
          prices: [
            {
              schemaVersion: 1,
              id: PRICE_ID,
              revision: 7,
              priceBookId: BOOK_ID,
              priceBookRevision: 1,
              giftVariantId: VARIANT_ID,
              unitAmountMinor: 2_500,
              validFrom: new Date(start).toISOString(),
              validUntil: new Date(end).toISOString(),
            },
          ],
        });

        expect(result.kind).toBe(
          evaluatedAt >= start && evaluatedAt < end ? "SELECTED" : "REJECTED",
        );
        if (result.kind === "SELECTED") {
          expect(result).toMatchObject({ priceId: PRICE_ID, priceRevision: 7 });
        }
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("overlapping effective price revisions always fail closed", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 1_000_000 }),
      fc.integer({ min: 1, max: 1_000_000 }),
      (firstAmount, secondAmount) => {
        const price = {
          schemaVersion: 1,
          revision: 1,
          priceBookId: BOOK_ID,
          priceBookRevision: 1,
          giftVariantId: VARIANT_ID,
          validFrom: "2026-01-01T00:00:00Z",
          validUntil: "2026-02-01T00:00:00Z",
        } as const;
        expect(
          selectEffectivePrice({
            schemaVersion: 1,
            evaluatedAt: "2026-01-15T00:00:00Z",
            market: "US",
            currency: "USD",
            giftVariantId: VARIANT_ID,
            priceBooks: [
              {
                schemaVersion: 1,
                id: BOOK_ID,
                revision: 1,
                market: "US",
                currency: "USD",
                status: "PUBLISHED",
                validFrom: "2026-01-01T00:00:00Z",
                validUntil: "2026-02-01T00:00:00Z",
              },
            ],
            prices: [
              { ...price, id: PRICE_ID, unitAmountMinor: firstAmount },
              {
                ...price,
                id: "3d2847a8-8f94-4d71-9434-e7d4be6c8918",
                unitAmountMinor: secondAmount,
              },
            ],
          }),
        ).toEqual({
          schemaVersion: 1,
          kind: "REJECTED",
          code: "PRICE_AMBIGUOUS",
        });
      },
    ),
    PROPERTY_PARAMETERS,
  );
});
