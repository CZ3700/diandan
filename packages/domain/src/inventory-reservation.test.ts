import { describe, expect, test } from "vitest";
import {
  inventoryReservationCreationDecisionSchema,
  inventoryReservationTransitionDecisionSchema,
} from "@fan-support/contracts";

import {
  planInventoryReservationCreation,
  planInventoryReservationTransition,
} from "./inventory-reservation.js";

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
const balance = {
  schemaVersion: 1,
  inventoryItemId: ITEM_ID,
  inventoryLocationId: LOCATION_ID,
  onHand: 10,
  reserved: 2,
  version: 7,
} as const;
const reservation = {
  schemaVersion: 1,
  id: "fc2bdc97-5cd3-4584-9215-fb13476aa83c",
  checkoutQuoteId: "dc7db228-5757-42a8-af9e-c610bc80ea55",
  cartItemId: "c0d51f36-f139-4fd7-9205-fb6d9db1666e",
  giftVariantId: VARIANT_ID,
  inventoryLocationId: LOCATION_ID,
  quantity: 3,
  status: "ACTIVE",
  expiresAt: "2026-09-03T01:00:00Z",
  version: 4,
} as const;

describe("tracked inventory reservation plans", () => {
  test("reserves available stock and carries exact item/location identity", () => {
    expect(
      planInventoryReservationCreation({
        schemaVersion: 1,
        inventoryItem,
        inventoryLocation,
        balance,
        reservation,
        existingReservation: null,
        evaluatedAt: "2026-09-03T00:00:00Z",
      }),
    ).toMatchObject({
      schemaVersion: 1,
      kind: "APPLY",
      inventoryItemId: ITEM_ID,
      inventoryLocationId: LOCATION_ID,
      reservationId: reservation.id,
      expectedBalanceVersion: 7,
      expectedReservationAbsent: true,
      nextBalance: { onHand: 10, reserved: 5, version: 8 },
      ledgerDelta: { deltaOnHand: 0, deltaReserved: 3 },
    });
  });

  test("does not create a reservation that is already expired", () => {
    expect(
      planInventoryReservationCreation({
        schemaVersion: 1,
        inventoryItem,
        inventoryLocation,
        balance,
        reservation,
        existingReservation: null,
        evaluatedAt: reservation.expiresAt,
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "RESERVATION_ALREADY_EXPIRED",
    });
  });

  test("replays an existing identical reservation without reserving inventory twice", () => {
    const result = planInventoryReservationCreation({
      schemaVersion: 1,
      inventoryItem,
      inventoryLocation,
      balance: { ...balance, reserved: 5, version: 8 },
      reservation,
      existingReservation: reservation,
      evaluatedAt: "2026-09-03T02:00:00Z",
    });

    expect(result).toEqual({
      schemaVersion: 1,
      kind: "REPLAY",
      inventoryItem,
      inventoryItemId: ITEM_ID,
      inventoryLocationId: LOCATION_ID,
      reservationId: reservation.id,
      reservation,
      reasonCode: "RESERVATION_ALREADY_CREATED",
    });
    expect(result).not.toHaveProperty("nextBalance");
    expect(result).not.toHaveProperty("ledgerDelta");
  });

  test("fails closed when the reservation identity was already used for different content", () => {
    expect(
      planInventoryReservationCreation({
        schemaVersion: 1,
        inventoryItem,
        inventoryLocation,
        balance: { ...balance, reserved: 5, version: 8 },
        reservation,
        existingReservation: { ...reservation, quantity: 2 },
        evaluatedAt: "2026-09-03T00:00:00Z",
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "RESERVATION_IDEMPOTENCY_CONFLICT",
    });
  });

  test.each([
    ["COMMITTED", 7, 2, -3, -3],
    ["RELEASED", 10, 2, 0, -3],
    ["EXPIRED", 10, 2, 0, -3],
  ] as const)(
    "plans %s with conserving balance deltas",
    (targetStatus, nextOnHand, nextReserved, deltaOnHand, deltaReserved) => {
      const alreadyReserved = { ...balance, reserved: 5 };
      const result = planInventoryReservationTransition({
        schemaVersion: 1,
        inventoryItem,
        balance: alreadyReserved,
        reservation,
        targetStatus,
        evaluatedAt: "2026-09-03T01:00:00Z",
      });

      expect(result).toMatchObject({
        schemaVersion: 1,
        kind: "APPLY",
        inventoryItemId: ITEM_ID,
        inventoryLocationId: LOCATION_ID,
        reservationId: reservation.id,
        expectedBalanceVersion: 7,
        expectedReservationVersion: 4,
        nextBalance: {
          onHand: nextOnHand,
          reserved: nextReserved,
          version: 8,
        },
        nextReservation: { status: targetStatus, version: 5 },
        ledgerDelta: { deltaOnHand, deltaReserved },
      });
    },
  );

  test("replaying an identical terminal transition emits no second mutation", () => {
    expect(
      planInventoryReservationTransition({
        schemaVersion: 1,
        inventoryItem,
        balance: { ...balance, onHand: 7, reserved: 2 },
        reservation: { ...reservation, status: "COMMITTED", version: 5 },
        targetStatus: "COMMITTED",
        evaluatedAt: "2026-09-03T02:00:00Z",
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "REPLAY",
      inventoryItem,
      inventoryItemId: ITEM_ID,
      inventoryLocationId: LOCATION_ID,
      reservationId: reservation.id,
      reservation: { ...reservation, status: "COMMITTED", version: 5 },
    });
  });

  test("does not expire before the half-open expiry boundary", () => {
    expect(
      planInventoryReservationTransition({
        schemaVersion: 1,
        inventoryItem,
        balance: { ...balance, reserved: 5 },
        reservation,
        targetStatus: "EXPIRED",
        evaluatedAt: "2026-09-03T00:59:59.999Z",
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "REJECTED",
      code: "RESERVATION_NOT_EXPIRED",
    });
  });

  test.each([
    [
      "INVENTORY_IDENTITY_MISMATCH",
      {
        balance: {
          ...balance,
          inventoryItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      },
    ],
    [
      "INVENTORY_NOT_TRACKED",
      { inventoryItem: { ...inventoryItem, policy: "PREORDER" } },
    ],
    [
      "INVENTORY_NOT_USABLE",
      { inventoryItem: { ...inventoryItem, status: "PAUSED" } },
    ],
    [
      "INVENTORY_NOT_USABLE",
      { inventoryLocation: { ...inventoryLocation, status: "PAUSED" } },
    ],
    [
      "RESERVATION_NOT_ACTIVE",
      { reservation: { ...reservation, status: "RELEASED" } },
    ],
    [
      "INSUFFICIENT_INVENTORY",
      { reservation: { ...reservation, quantity: 9 } },
    ],
    [
      "VERSION_OVERFLOW",
      { balance: { ...balance, version: Number.MAX_SAFE_INTEGER } },
    ],
  ] as const)("rejects invalid creation state with %s", (code, overrides) => {
    expect(
      planInventoryReservationCreation({
        schemaVersion: 1,
        inventoryItem,
        inventoryLocation,
        balance,
        reservation,
        existingReservation: null,
        evaluatedAt: "2026-09-03T00:00:00Z",
        ...overrides,
      }),
    ).toEqual({ schemaVersion: 1, kind: "REJECTED", code });
  });

  test.each([
    [
      "INVENTORY_IDENTITY_MISMATCH",
      {
        balance: {
          ...balance,
          reserved: 5,
          inventoryItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      },
    ],
    [
      "RESERVATION_NOT_ACTIVE",
      {
        balance: { ...balance, reserved: 5 },
        reservation: { ...reservation, status: "COMMITTED" },
        targetStatus: "RELEASED",
      },
    ],
    ["BALANCE_INCONSISTENT", {}],
    [
      "VERSION_OVERFLOW",
      {
        balance: {
          ...balance,
          reserved: 5,
          version: Number.MAX_SAFE_INTEGER,
        },
      },
    ],
    [
      "VERSION_OVERFLOW",
      {
        balance: { ...balance, reserved: 5 },
        reservation: { ...reservation, version: Number.MAX_SAFE_INTEGER },
      },
    ],
  ] as const)("rejects invalid terminal state with %s", (code, overrides) => {
    expect(
      planInventoryReservationTransition({
        schemaVersion: 1,
        inventoryItem,
        balance,
        reservation,
        targetStatus: "COMMITTED",
        evaluatedAt: "2026-09-03T01:00:00Z",
        ...overrides,
      }),
    ).toEqual({ schemaVersion: 1, kind: "REJECTED", code });
  });

  test("strictly validates versioned reservation inputs and emits contract decisions", () => {
    const creation = {
      schemaVersion: 1,
      inventoryItem,
      inventoryLocation,
      balance,
      reservation,
      existingReservation: null,
      evaluatedAt: "2026-09-03T00:00:00Z",
    };
    expect(
      inventoryReservationCreationDecisionSchema.safeParse(
        planInventoryReservationCreation(creation),
      ).success,
    ).toBe(true);
    for (const invalid of [
      null,
      { ...creation, schemaVersion: 2 },
      { ...creation, unknown: true },
      {
        inventoryItem,
        inventoryLocation,
        balance,
        reservation,
        evaluatedAt: creation.evaluatedAt,
      },
    ]) {
      expect(planInventoryReservationCreation(invalid)).toEqual({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "INVENTORY_IDENTITY_MISMATCH",
      });
    }

    const transition = {
      schemaVersion: 1,
      inventoryItem,
      balance: { ...balance, reserved: 5 },
      reservation,
      targetStatus: "COMMITTED",
      evaluatedAt: "2026-09-03T01:00:00Z",
    };
    expect(
      inventoryReservationTransitionDecisionSchema.safeParse(
        planInventoryReservationTransition(transition),
      ).success,
    ).toBe(true);
    for (const invalid of [
      null,
      { ...transition, schemaVersion: 2 },
      { ...transition, unknown: true },
      {
        inventoryItem,
        balance: transition.balance,
        reservation,
        targetStatus: transition.targetStatus,
        evaluatedAt: transition.evaluatedAt,
      },
    ]) {
      expect(planInventoryReservationTransition(invalid)).toEqual({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "INVENTORY_IDENTITY_MISMATCH",
      });
    }
  });
});
