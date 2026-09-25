import { randomUUID } from "node:crypto";
import {
  inventoryLedgerEntrySchema,
  type CheckoutPreflightCurrent,
  type CheckoutQuote,
  type InventoryReservationCreationDecision,
  type LoadInventoryForUpdateResponse,
} from "@fan-support/contracts";
import {
  planCheckoutInventory,
  selectCheckoutInventory,
} from "@fan-support/domain";
import type { CheckoutPreflightRepositories } from "@fan-support/persistence-port";
import {
  checkoutPersistenceSuccess,
  rejectCheckout,
} from "./checkout-transaction.js";

type InventoryReservationCreationApply = Extract<
  InventoryReservationCreationDecision,
  { kind: "APPLY" }
>;

/** Lock in globally stable batches, then plan all lines against the actual locked balances. */
export async function prepareCheckoutInventory(
  repos: CheckoutPreflightRepositories,
  current: CheckoutPreflightCurrent,
  quote: CheckoutQuote,
) {
  const selected = selectCheckoutInventory(current);
  if (selected.outcome === "FAILURE") return rejectCheckout(selected.code);
  const lockedInventory: Extract<
    LoadInventoryForUpdateResponse,
    { outcome: "SUCCESS" }
  >["value"]["items"] = [];
  for (let start = 0; start < selected.targets.length; start += 100) {
    const targets = selected.targets.slice(start, start + 100);
    const result = checkoutPersistenceSuccess(
      await repos.inventory.loadManyForUpdate({
        schemaVersion: 1,
        operation: "LOAD_INVENTORY_FOR_UPDATE",
        targets,
      }),
    );
    if (result.operation !== "LOAD_INVENTORY_FOR_UPDATE")
      return rejectCheckout("TEMPORARY_UNAVAILABLE");
    if (
      result.value.items.length !== targets.length ||
      targets.some(
        (target) =>
          !result.value.items.some(
            (entry) =>
              entry.inventoryItem.id === target.inventoryItemId &&
              entry.inventoryLocation.id === target.inventoryLocationId,
          ),
      )
    )
      return rejectCheckout("CONTENT_UNAVAILABLE");
    lockedInventory.push(...result.value.items);
  }
  const plan = planCheckoutInventory({
    schemaVersion: 1,
    current,
    assignments: selected.assignments,
    lockedInventory,
    reservations: selected.assignments.map((assignment) => ({
      cartItemId: assignment.cartItemId,
      reservationId: randomUUID(),
    })),
    quoteId: quote.id,
    expiresAt: quote.expiresAt,
    evaluatedAt: current.evaluatedAt,
  });
  if (plan.outcome === "FAILURE") return rejectCheckout(plan.code);
  return plan.decisions;
}
export async function applyCheckoutInventory(
  repos: CheckoutPreflightRepositories,
  decisions: InventoryReservationCreationApply[],
  occurredAt: string,
): Promise<void> {
  for (const decision of decisions) {
    const ledgerEntry = inventoryLedgerEntrySchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      inventoryItemId: decision.inventoryItemId,
      inventoryLocationId: decision.inventoryLocationId,
      ...decision.ledgerDelta,
      reasonCode: decision.reasonCode,
      idempotencyKey: `checkout.reserve:${decision.nextReservation.id}`,
      actor: { kind: "SYSTEM", taskName: "checkout.preflight.create" },
      occurredAt,
    });
    const result = checkoutPersistenceSuccess(
      await repos.inventory.applyReservationCreation({
        schemaVersion: 1,
        operation: "APPLY_INVENTORY_RESERVATION_CREATION",
        decision,
        ledgerEntry,
      }),
    );
    if (
      result.operation !== "APPLY_INVENTORY_RESERVATION_CREATION" ||
      result.value.reservation.id !== decision.nextReservation.id
    )
      return rejectCheckout("TEMPORARY_UNAVAILABLE");
  }
}
