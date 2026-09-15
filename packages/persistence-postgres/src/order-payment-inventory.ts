import { randomUUID } from "node:crypto";
import {
  canonicalRequestIdSchema,
  contentTimestampSchema,
  inventoryLedgerEntrySchema,
  inventoryReservationSchema,
  persistencePortCommandSchema,
  persistencePortResponseSchema,
  type InventoryReservation,
  type LoadInventoryForUpdateCommand,
  type LoadInventoryForUpdateResponse,
} from "@fan-support/contracts";
import { planInventoryReservationTransition } from "@fan-support/domain";
import type { InventoryRepository } from "@fan-support/persistence-port";
import { sameInventoryTimestamp } from "./inventory-timestamp.js";

type Target = LoadInventoryForUpdateCommand["targets"][number] & {
  reservationId: InventoryReservation["id"];
};
type Snapshot = Extract<
  LoadInventoryForUpdateResponse,
  { outcome: "SUCCESS" }
>["value"]["items"][number];
type Input = Readonly<{
  repository: InventoryRepository;
  targets: readonly Target[];
  reservations: readonly InventoryReservation[];
  targetStatus: "COMMITTED" | "RELEASED";
  evaluatedAt: string;
  requestId: string;
  correlationId: string;
}>;
const sameId = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
const key = (target: Target) =>
  `${target.inventoryItemId.toLowerCase()}:${target.inventoryLocationId.toLowerCase()}`;
function reject(): never {
  throw new Error("Order payment inventory binding or transition failed");
}
function sameReservation(
  left: InventoryReservation,
  right: InventoryReservation,
  includeState = false,
) {
  return (
    [
      "id",
      "checkoutQuoteId",
      "cartItemId",
      "giftVariantId",
      "inventoryLocationId",
    ].every((field) => sameId(left[field as "id"], right[field as "id"])) &&
    left.quantity === right.quantity &&
    sameInventoryTimestamp(left.expiresAt, right.expiresAt) &&
    (!includeState ||
      (left.status === right.status && left.version === right.version))
  );
}
function sameBalance(left: Snapshot["balance"], right: Snapshot["balance"]) {
  return (
    sameId(left.inventoryItemId, right.inventoryItemId) &&
    sameId(left.inventoryLocationId, right.inventoryLocationId) &&
    left.onHand === right.onHand &&
    left.reserved === right.reserved &&
    left.version === right.version
  );
}

/** Caller owns the transaction and financial authority. This bridge only settles its exact reservations. */
export async function applyOrderPaymentInventory(
  input: Input,
): Promise<{ unavailable: boolean; transitioned: number }> {
  canonicalRequestIdSchema.parse(input.requestId);
  canonicalRequestIdSchema.parse(input.correlationId);
  contentTimestampSchema.parse(input.evaluatedAt);
  if (
    !["COMMITTED", "RELEASED"].includes(input.targetStatus) ||
    input.reservations.length > 500 ||
    input.targets.length !== input.reservations.length
  )
    reject();
  const expected = new Map<string, InventoryReservation>();
  for (const value of input.reservations) {
    const reservation = inventoryReservationSchema.parse(value);
    const id = reservation.id.toLowerCase();
    if (expected.has(id)) reject();
    expected.set(id, reservation);
  }
  const seen = new Set<string>();
  const groups = new Map<string, Target[]>();
  for (const target of input.targets) {
    persistencePortCommandSchema.parse({
      schemaVersion: 1,
      operation: "LOAD_INVENTORY_FOR_UPDATE",
      targets: [target],
    });
    if (!target.reservationId) reject();
    const id = target.reservationId.toLowerCase();
    const reservation = expected.get(id);
    if (
      seen.has(id) ||
      !reservation ||
      !sameId(reservation.inventoryLocationId, target.inventoryLocationId)
    )
      reject();
    seen.add(id);
    const group = groups.get(key(target)) ?? [];
    group.push(target);
    groups.set(key(target), group);
  }
  const ordered = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) =>
      group.sort((left, right) =>
        left.reservationId
          .toLowerCase()
          .localeCompare(right.reservationId.toLowerCase()),
      ),
    );
  const snapshots = new Map<string, Snapshot>();
  const balances = new Map<string, Snapshot["balance"]>();
  const inventoryItems = new Map<string, Snapshot["inventoryItem"]>();
  // The first round locks every balance in global order. Later rounds only add reservations on already-held balances.
  for (let round = 0; ordered.some((group) => round < group.length); round++) {
    const targets = ordered.flatMap((group) =>
      group[round] ? [group[round]!] : [],
    );
    for (let start = 0; start < targets.length; start += 100) {
      const batch = targets.slice(start, start + 100);
      const response = persistencePortResponseSchema.parse(
        await input.repository.loadManyForUpdate({
          schemaVersion: 1,
          operation: "LOAD_INVENTORY_FOR_UPDATE",
          targets: batch,
        }),
      );
      if (
        response.outcome !== "SUCCESS" ||
        response.operation !== "LOAD_INVENTORY_FOR_UPDATE" ||
        response.value.items.length !== batch.length
      )
        reject();
      const batchSeen = new Set<string>();
      for (const snapshot of response.value.items) {
        const target = batch.find(
          (entry) =>
            sameId(entry.inventoryItemId, snapshot.inventoryItem.id) &&
            sameId(entry.inventoryLocationId, snapshot.inventoryLocation.id),
        );
        if (!target || batchSeen.has(key(target))) reject();
        batchSeen.add(key(target));
        const reservation = snapshot.reservation;
        if (
          !reservation ||
          !sameId(reservation.id, target.reservationId) ||
          !sameReservation(
            expected.get(target.reservationId.toLowerCase())!,
            reservation,
          ) ||
          !sameId(
            snapshot.inventoryItem.giftVariantId,
            reservation.giftVariantId,
          ) ||
          snapshot.inventoryItem.policy !== "TRACKED" ||
          !sameId(snapshot.balance.inventoryItemId, target.inventoryItemId) ||
          !sameId(
            snapshot.balance.inventoryLocationId,
            target.inventoryLocationId,
          )
        )
          reject();
        const previous = balances.get(key(target));
        const previousItem = inventoryItems.get(key(target));
        if (
          previous &&
          (!sameBalance(previous, snapshot.balance) ||
            previousItem?.sku !== snapshot.inventoryItem.sku ||
            previousItem.status !== snapshot.inventoryItem.status ||
            !sameId(
              previousItem.giftVariantId,
              snapshot.inventoryItem.giftVariantId,
            ))
        )
          reject();
        balances.set(key(target), snapshot.balance);
        inventoryItems.set(key(target), snapshot.inventoryItem);
        snapshots.set(reservation.id.toLowerCase(), snapshot);
      }
    }
  }
  let unavailable = false;
  let transitioned = 0;
  for (const target of ordered.flat()) {
    const snapshot = snapshots.get(target.reservationId.toLowerCase());
    if (!snapshot?.reservation) reject();
    const reservation = snapshot.reservation;
    if (reservation.status !== "ACTIVE") {
      if (
        input.targetStatus === "COMMITTED" &&
        ["RELEASED", "EXPIRED"].includes(reservation.status)
      )
        unavailable = true;
      continue;
    }
    const decision = planInventoryReservationTransition({
      schemaVersion: 1,
      inventoryItem: snapshot.inventoryItem,
      balance: balances.get(key(target)),
      reservation,
      targetStatus: input.targetStatus,
      evaluatedAt: input.evaluatedAt,
    });
    if (decision.kind !== "APPLY") reject();
    const ledgerEntry = inventoryLedgerEntrySchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      inventoryItemId: decision.inventoryItemId,
      inventoryLocationId: decision.inventoryLocationId,
      ...decision.ledgerDelta,
      reasonCode: decision.reasonCode,
      idempotencyKey: `order.payment:${reservation.id.toLowerCase()}:${input.targetStatus.toLowerCase()}`,
      actor: { kind: "SYSTEM", taskName: "order-payment-application" },
      occurredAt: input.evaluatedAt,
    });
    const response = persistencePortResponseSchema.parse(
      await input.repository.applyReservationTransition({
        schemaVersion: 1,
        operation: "APPLY_INVENTORY_RESERVATION_TRANSITION",
        decision,
        ledgerEntry,
      }),
    );
    if (
      response.outcome !== "SUCCESS" ||
      response.operation !== "APPLY_INVENTORY_RESERVATION_TRANSITION" ||
      !sameBalance(response.value.balance, decision.nextBalance) ||
      !sameReservation(
        response.value.reservation,
        decision.nextReservation,
        true,
      )
    )
      reject();
    const actual = response.value.ledgerEntry;
    if (
      !sameId(actual.id, ledgerEntry.id) ||
      !sameId(actual.inventoryItemId, ledgerEntry.inventoryItemId) ||
      !sameId(actual.inventoryLocationId, ledgerEntry.inventoryLocationId) ||
      actual.deltaOnHand !== ledgerEntry.deltaOnHand ||
      actual.deltaReserved !== ledgerEntry.deltaReserved ||
      actual.reasonCode !== ledgerEntry.reasonCode ||
      actual.idempotencyKey !== ledgerEntry.idempotencyKey ||
      actual.actor.kind !== "SYSTEM" ||
      actual.actor.taskName !== "order-payment-application" ||
      !sameInventoryTimestamp(actual.occurredAt, ledgerEntry.occurredAt)
    )
      reject();
    balances.set(key(target), response.value.balance);
    transitioned++;
  }
  return { unavailable, transitioned };
}
