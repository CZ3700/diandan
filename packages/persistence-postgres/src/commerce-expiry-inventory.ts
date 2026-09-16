import { randomUUID } from "node:crypto";
import {
  inventoryLedgerEntrySchema,
  persistencePortResponseSchema,
  type CommerceExpiryCommand,
  type LoadInventoryForUpdateCommand,
  type LoadInventoryForUpdateResponse,
} from "@fan-support/contracts";
import { planInventoryReservationTransition } from "@fan-support/domain";
import type { InventoryRepository } from "@fan-support/persistence-port";
import { sameInventoryTimestamp } from "./inventory-timestamp.js";
import { draftRows } from "./content-draft-data.js";
import { cartTimestamp } from "./cart-runtime-data.js";
import type { TransactionClient } from "./transaction-runner.js";
import { rejectExpiry } from "./commerce-expiry-data.js";

type Snapshot = Extract<
  LoadInventoryForUpdateResponse,
  { outcome: "SUCCESS" }
>["value"]["items"][number];
type Target = LoadInventoryForUpdateCommand["targets"][number];

/** Aggregate locks are held by the caller before any inventory lock is acquired. */
export async function expireInventory(
  client: TransactionClient,
  inventory: InventoryRepository,
  orderId: unknown,
  at: string,
  command: CommerceExpiryCommand,
) {
  const rows = await draftRows(
    client,
    `SELECT id,inventory_item_id,location_id,cart_item_id,checkout_quote_id,gift_variant_id,quantity,${cartTimestamp("expires_at")} expires_at FROM public.inventory_reservations WHERE locked_order_id=$1::uuid AND status='ACTIVE' AND expires_at<=$2::timestamptz AND expires_at<=clock_timestamp() ORDER BY inventory_item_id,location_id,id`,
    [orderId, at],
  );
  if (rows.length > 500) rejectExpiry("INTEGRITY_VIOLATION");
  const groups = new Map<string, Target[]>();
  for (const row of rows) {
    const key = `${row["inventory_item_id"]}:${row["location_id"]}`;
    const group = groups.get(key) ?? [];
    group.push({
      inventoryItemId: String(
        row["inventory_item_id"],
      ) as Target["inventoryItemId"],
      inventoryLocationId: String(
        row["location_id"],
      ) as Target["inventoryLocationId"],
      reservationId: String(row["id"]) as NonNullable<Target["reservationId"]>,
    });
    groups.set(key, group);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const snapshots = new Map<string, Snapshot>();
  const balances = new Map<string, Snapshot["balance"]>();
  // Lock all balances in stable order before adding a second reservation on any balance.
  for (let round = 0; ordered.some(([, values]) => values[round]); round++) {
    const targets = ordered.flatMap(([, values]) =>
      values[round] ? [values[round]!] : [],
    );
    for (let offset = 0; offset < targets.length; offset += 100) {
      const batch = targets.slice(offset, offset + 100);
      const response = persistencePortResponseSchema.parse(
        await inventory.loadManyForUpdate({
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
        rejectExpiry("INTEGRITY_VIOLATION");
      for (const item of response.value.items) {
        const r = item.reservation;
        const original = rows.find((row) => row["id"] === r?.id);
        const target = batch.find((value) => value.reservationId === r?.id);
        if (
          !r ||
          !original ||
          !target ||
          snapshots.has(r.id) ||
          r.status !== "ACTIVE" ||
          item.inventoryItem.id !== target.inventoryItemId ||
          item.inventoryItem.policy !== "TRACKED" ||
          item.balance.inventoryLocationId !== target.inventoryLocationId ||
          r.inventoryLocationId !== target.inventoryLocationId ||
          r.cartItemId !== original["cart_item_id"] ||
          r.checkoutQuoteId !== original["checkout_quote_id"] ||
          r.giftVariantId !== original["gift_variant_id"] ||
          r.quantity !== Number(original["quantity"]) ||
          !sameInventoryTimestamp(r.expiresAt, String(original["expires_at"]))
        )
          rejectExpiry("INTEGRITY_VIOLATION");
        snapshots.set(r.id, item);
        balances.set(
          `${target.inventoryItemId}:${target.inventoryLocationId}`,
          item.balance,
        );
      }
    }
  }
  for (const [key, targets] of ordered)
    for (const target of targets) {
      const snapshot = snapshots.get(target.reservationId!);
      if (!snapshot?.reservation) rejectExpiry("INTEGRITY_VIOLATION");
      const decision = planInventoryReservationTransition({
        schemaVersion: 1,
        inventoryItem: snapshot.inventoryItem,
        balance: balances.get(key),
        reservation: snapshot.reservation,
        targetStatus: "EXPIRED",
        evaluatedAt: at,
      });
      if (decision.kind !== "APPLY") rejectExpiry("INTEGRITY_VIOLATION");
      const ledgerEntry = inventoryLedgerEntrySchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        inventoryItemId: decision.inventoryItemId,
        inventoryLocationId: decision.inventoryLocationId,
        ...decision.ledgerDelta,
        reasonCode: decision.reasonCode,
        idempotencyKey: `commerce.expiry:${target.reservationId}`,
        actor: { kind: "SYSTEM", taskName: command.taskName },
        occurredAt: at,
      });
      const applied = persistencePortResponseSchema.parse(
        await inventory.applyReservationTransition({
          schemaVersion: 1,
          operation: "APPLY_INVENTORY_RESERVATION_TRANSITION",
          decision,
          ledgerEntry,
        }),
      );
      if (
        applied.outcome !== "SUCCESS" ||
        applied.operation !== "APPLY_INVENTORY_RESERVATION_TRANSITION" ||
        applied.value.reservation.id !== target.reservationId ||
        applied.value.reservation.status !== "EXPIRED" ||
        applied.value.reservation.version !==
          decision.nextReservation.version ||
        applied.value.balance.onHand !== decision.nextBalance.onHand ||
        applied.value.balance.reserved !== decision.nextBalance.reserved ||
        applied.value.balance.version !== decision.nextBalance.version ||
        applied.value.ledgerEntry.id !== ledgerEntry.id
      )
        rejectExpiry("INTEGRITY_VIOLATION");
      balances.set(key, applied.value.balance);
    }
  return rows.length;
}
