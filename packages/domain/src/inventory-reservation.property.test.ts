import { expect, test } from "vitest";
import fc from "fast-check";

import {
  planInventoryReservationCreation,
  planInventoryReservationTransition,
} from "./inventory-reservation.js";
import { PROPERTY_PARAMETERS } from "./test-support/property-parameters.js";

const ITEM_ID = "0b91add0-e78b-4898-8b3d-3ab50c50a9dc";
const LOCATION_ID = "88aab92a-fd64-43f1-8f59-15a4e4cb6dce";
const VARIANT_ID = "9fa44c67-1a8e-45e9-afc2-887f0422cc8e";
const inventoryItem = {
  schemaVersion: 1,
  id: ITEM_ID,
  giftVariantId: VARIANT_ID,
  sku: "AURORA-KEEPSAKE-01",
  policy: "TRACKED",
  status: "ACTIVE",
} as const;
const inventoryLocation = {
  schemaVersion: 1,
  id: LOCATION_ID,
  code: "PRIMARY",
  status: "ACTIVE",
} as const;

const stockArbitrary = fc.integer({ min: 1, max: 100_000 }).chain((onHand) =>
  fc.integer({ min: 0, max: onHand - 1 }).chain((reserved) =>
    fc.record({
      onHand: fc.constant(onHand),
      reserved: fc.constant(reserved),
      quantity: fc.integer({ min: 1, max: onHand - reserved }),
    }),
  ),
);

function reservation(quantity: number, status = "ACTIVE") {
  return {
    schemaVersion: 1,
    id: "fc2bdc97-5cd3-4584-9215-fb13476aa83c",
    checkoutQuoteId: "dc7db228-5757-42a8-af9e-c610bc80ea55",
    cartItemId: "c0d51f36-f139-4fd7-9205-fb6d9db1666e",
    giftVariantId: VARIANT_ID,
    inventoryLocationId: LOCATION_ID,
    quantity,
    status,
    expiresAt: "2026-09-03T01:00:00Z",
    version: 4,
  };
}

test("reserving conserves on-hand and consumes exactly the available quantity", () => {
  fc.assert(
    fc.property(stockArbitrary, ({ onHand, reserved, quantity }) => {
      const result = planInventoryReservationCreation({
        schemaVersion: 1,
        inventoryItem,
        inventoryLocation,
        balance: {
          schemaVersion: 1,
          inventoryItemId: ITEM_ID,
          inventoryLocationId: LOCATION_ID,
          onHand,
          reserved,
          version: 1,
        },
        reservation: reservation(quantity),
        existingReservation: null,
        evaluatedAt: "2026-09-03T00:00:00Z",
      });
      expect(result.kind).toBe("APPLY");
      if (result.kind === "APPLY") {
        expect(result.nextBalance.onHand).toBe(onHand);
        expect(result.nextBalance.reserved).toBe(reserved + quantity);
        expect(result.nextBalance.onHand - result.nextBalance.reserved).toBe(
          onHand - reserved - quantity,
        );
      }
    }),
    PROPERTY_PARAMETERS,
  );
});

test("terminal transitions conserve inventory and release reserved quantity once", () => {
  fc.assert(
    fc.property(
      stockArbitrary,
      fc.constantFrom("COMMITTED", "RELEASED", "EXPIRED"),
      ({ onHand, reserved, quantity }, targetStatus) => {
        const reservedAfterCreation = reserved + quantity;
        const result = planInventoryReservationTransition({
          schemaVersion: 1,
          inventoryItem,
          balance: {
            schemaVersion: 1,
            inventoryItemId: ITEM_ID,
            inventoryLocationId: LOCATION_ID,
            onHand,
            reserved: reservedAfterCreation,
            version: 2,
          },
          reservation: reservation(quantity),
          targetStatus,
          evaluatedAt: "2026-09-03T01:00:00Z",
        });
        expect(result.kind).toBe("APPLY");
        if (result.kind === "APPLY") {
          expect(result.nextBalance.reserved).toBe(reserved);
          expect(result.nextBalance.onHand).toBe(
            targetStatus === "COMMITTED" ? onHand - quantity : onHand,
          );
          expect(result.nextBalance.reserved).toBeGreaterThanOrEqual(0);
          expect(result.nextBalance.reserved).toBeLessThanOrEqual(
            result.nextBalance.onHand,
          );
        }
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("replaying any identical terminal transition never emits another mutation", () => {
  fc.assert(
    fc.property(
      stockArbitrary,
      fc.constantFrom("COMMITTED", "RELEASED", "EXPIRED"),
      ({ onHand, reserved, quantity }, targetStatus) => {
        const terminalReservation = reservation(quantity, targetStatus);
        const result = planInventoryReservationTransition({
          schemaVersion: 1,
          inventoryItem,
          balance: {
            schemaVersion: 1,
            inventoryItemId: ITEM_ID,
            inventoryLocationId: LOCATION_ID,
            onHand,
            reserved,
            version: 3,
          },
          reservation: terminalReservation,
          targetStatus,
          evaluatedAt: "2026-09-03T02:00:00Z",
        });

        expect(result).toEqual({
          schemaVersion: 1,
          kind: "REPLAY",
          inventoryItem,
          inventoryItemId: ITEM_ID,
          inventoryLocationId: LOCATION_ID,
          reservationId: terminalReservation.id,
          reservation: terminalReservation,
        });
      },
    ),
    PROPERTY_PARAMETERS,
  );
});
