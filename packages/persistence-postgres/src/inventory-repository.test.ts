import { expect, test, vi } from "vitest";
import {
  inventoryLedgerEntrySchema,
  inventoryReservationSchema,
  persistencePortCommandSchema,
} from "@fan-support/contracts";
import {
  planInventoryReservationCreation,
  planInventoryReservationTransition,
} from "@fan-support/domain";
import { createInventoryRepository } from "./inventory-repository.js";
import type { PostgresQueryLayer } from "./query-layer.js";
import { inventoryBalances } from "./schema.js";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const exact = "2026-09-10T00:00:00.123456Z";
const offset = "2026-09-10T08:00:00.1234560+08:00";
const evaluatedAt = "2026-09-09T00:00:00.654321Z";
const inventoryItem = {
  schemaVersion: 1,
  id: uuid(1),
  giftVariantId: uuid(2),
  sku: "TEST-ITEM",
  policy: "TRACKED",
  status: "ACTIVE",
} as const;
const inventoryLocation = {
  schemaVersion: 1,
  id: uuid(3),
  code: "TEST",
  status: "ACTIVE",
} as const;
const balance = {
  schemaVersion: 1,
  inventoryItemId: inventoryItem.id,
  inventoryLocationId: inventoryLocation.id,
  onHand: 10,
  reserved: 2,
  version: 1,
} as const;
const reservation = inventoryReservationSchema.parse({
  schemaVersion: 1,
  id: uuid(4),
  checkoutQuoteId: uuid(5),
  cartItemId: uuid(6),
  giftVariantId: inventoryItem.giftVariantId,
  inventoryLocationId: inventoryLocation.id,
  quantity: 2,
  status: "ACTIVE",
  expiresAt: exact,
  version: 1,
});

function fixture(storedExpiry = "2026-09-10 00:00:00.123456+00") {
  const updateValues = vi.fn();
  const insertValues = vi.fn<(value: unknown) => Promise<void>>(
    async () => undefined,
  );
  const database = {
    select: () => {
      let table: unknown;
      const query = {
        from: (value: unknown) => {
          table = value;
          return query;
        },
        innerJoin: () => query,
        where: () => query,
        orderBy: () => query,
        for: async () =>
          table === inventoryBalances
            ? [{ inventoryItem, inventoryLocation, balance }]
            : [
                {
                  ...reservation,
                  inventoryItemId: inventoryItem.id,
                  locationId: inventoryLocation.id,
                  lockedOrderId: uuid(7),
                  expiresAt: storedExpiry,
                },
              ],
      };
      return query;
    },
    update: () => ({
      set: (value: unknown) => {
        updateValues(value);
        return {
          where: () => ({
            returning: async () => [{ version: 2, id: reservation.id }],
          }),
        };
      },
    }),
    insert: () => ({ values: insertValues }),
    execute: async () => ({
      rows: [
        {
          locked_order_id: uuid(7),
          checkout_session_id: uuid(8),
          cart_id: uuid(9),
          id: uuid(10),
        },
      ],
    }),
  };
  const rollback = vi.fn();
  const repository = createInventoryRepository(
    database as unknown as PostgresQueryLayer,
    {
      markRollbackOnly: rollback,
      trackOperation: async (work) => work(),
    },
  );
  return { repository, updateValues, insertValues, rollback };
}

function command(kind: "CREATION" | "TRANSITION", expiresAt = exact) {
  const input = {
    schemaVersion: 1,
    inventoryItem,
    balance,
    reservation: { ...reservation, expiresAt },
    evaluatedAt,
  };
  const decision =
    kind === "CREATION"
      ? planInventoryReservationCreation({
          ...input,
          inventoryLocation,
          existingReservation: null,
        })
      : planInventoryReservationTransition({
          ...input,
          targetStatus: "COMMITTED",
        });
  if (decision.kind !== "APPLY")
    throw new Error("Invalid TEST inventory decision");
  return persistencePortCommandSchema.parse({
    schemaVersion: 1,
    operation: `APPLY_INVENTORY_RESERVATION_${kind}`,
    decision,
    ledgerEntry: inventoryLedgerEntrySchema.parse({
      schemaVersion: 1,
      id: uuid(11),
      inventoryItemId: inventoryItem.id,
      inventoryLocationId: inventoryLocation.id,
      ...decision.ledgerDelta,
      reasonCode: decision.reasonCode,
      idempotencyKey: "test.inventory.precision",
      actor: { kind: "SYSTEM", taskName: "order-payment-application" },
      occurredAt: evaluatedAt,
    }),
  });
}

test.each([
  "2026-09-10 00:00:00.123456+00",
  "2026-09-10 08:00:00.123456+08",
  offset,
])(
  "loads exact PG reservation time without discarding microseconds: %s",
  async (storedExpiry) => {
    const f = fixture(storedExpiry);
    const request = persistencePortCommandSchema.parse({
      schemaVersion: 1,
      operation: "LOAD_INVENTORY_FOR_UPDATE",
      targets: [
        {
          inventoryItemId: inventoryItem.id,
          inventoryLocationId: inventoryLocation.id,
          reservationId: reservation.id,
        },
      ],
    });
    if (request.operation !== "LOAD_INVENTORY_FOR_UPDATE")
      throw new Error("Invalid TEST load");
    const response = await f.repository.loadManyForUpdate(request);
    expect(response).toMatchObject({
      outcome: "SUCCESS",
      value: { items: [{ reservation: { expiresAt: exact } }] },
    });
    expect(f.updateValues).not.toHaveBeenCalled();
  },
);

test.each(["2026-09-10T00:00:00.123455Z", "2026-09-10T00:00:00.123457Z"])(
  "rejects a previous reservation differing by one microsecond: %s",
  async (expiresAt) => {
    const f = fixture();
    const request = command("TRANSITION", expiresAt);
    if (request.operation !== "APPLY_INVENTORY_RESERVATION_TRANSITION")
      throw new Error("Invalid TEST transition");
    expect(
      await f.repository.applyReservationTransition(request),
    ).toMatchObject({
      outcome: "FAILURE",
      error: { code: "VERSION_CONFLICT" },
    });
    expect(f.updateValues).not.toHaveBeenCalled();
    expect(f.insertValues).not.toHaveBeenCalled();
    expect(f.rollback).toHaveBeenCalledOnce();
  },
);

test.each(["CREATION", "TRANSITION"] as const)(
  "%s preserves precise timestamps in writes and safe receipts, accepting equivalent offsets",
  async (kind) => {
    const f = fixture();
    const request = command(kind, offset);
    const response =
      request.operation === "APPLY_INVENTORY_RESERVATION_CREATION"
        ? await f.repository.applyReservationCreation(request)
        : request.operation === "APPLY_INVENTORY_RESERVATION_TRANSITION"
          ? await f.repository.applyReservationTransition(request)
          : undefined;
    expect(response).toMatchObject({
      outcome: "SUCCESS",
      value: {
        reservation: { expiresAt: exact },
        ledgerEntry: { occurredAt: evaluatedAt },
      },
    });
    expect(f.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: evaluatedAt }),
    );
    expect(f.updateValues).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: evaluatedAt }),
    );
    if (kind === "CREATION") {
      expect(f.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: offset }),
      );
    }
    expect(f.rollback).not.toHaveBeenCalled();
  },
);
