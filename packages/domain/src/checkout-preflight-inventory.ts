import {
  checkoutPreflightCurrentSchema,
  checkoutInventoryPlanCommandSchema,
  checkoutInventoryPlanSchema,
  checkoutInventorySelectionSchema,
  type CheckoutInventoryAssignment,
  type CheckoutInventoryPlan,
  type CheckoutInventorySelection,
  type CheckoutPreflightFailure,
  type InventoryReservationCreationDecision,
} from "@fan-support/contracts";
import { planInventoryReservationCreation } from "./inventory-reservation.js";

const normalized = (id: string) => id.toLowerCase();
const targetKey = (itemId: string, locationId: string) =>
  `${normalized(itemId)}:${normalized(locationId)}`;
function failure(
  code: CheckoutPreflightFailure["code"],
): CheckoutPreflightFailure {
  return { schemaVersion: 1, outcome: "FAILURE", code };
}

/** Deterministic best fit, largest lines first. A line is never split between locations. */
export function selectCheckoutInventory(
  input: unknown,
): CheckoutInventorySelection {
  const parsed = checkoutPreflightCurrentSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_COMMAND");
  const current = parsed.data;
  if (current.cart.expired) return failure("CART_EXPIRED");
  if (current.cart.status !== "ACTIVE") return failure("CART_LOCKED");
  const remaining = new Map<string, number>();
  const facts = new Map<string, string>();
  const byLine = new Map(
    current.inventory.map((entry) => [normalized(entry.cartItemId), entry]),
  );
  for (const entry of current.inventory) {
    for (const location of entry.locations) {
      const key = targetKey(entry.inventoryItem.id, location.location.id);
      const encoded = JSON.stringify([entry.inventoryItem, location]);
      if (facts.has(key) && facts.get(key) !== encoded)
        return failure("CONTENT_UNAVAILABLE");
      facts.set(key, encoded);
      remaining.set(key, location.balance.onHand - location.balance.reserved);
    }
  }
  const assignments: CheckoutInventoryAssignment[] = [];
  const lines = current.consent.lines
    .filter((line) => line.inventoryPolicy === "TRACKED")
    .sort(
      (a, b) =>
        b.quantity - a.quantity ||
        normalized(a.cartItemId).localeCompare(normalized(b.cartItemId)),
    );
  for (const line of lines) {
    const entry = byLine.get(normalized(line.cartItemId));
    if (!entry || entry.inventoryItem.status !== "ACTIVE")
      return failure("INSUFFICIENT_STOCK");
    const candidates = entry.locations
      .filter(({ location }) => location.status === "ACTIVE")
      .map(({ location }) => ({
        location,
        available:
          remaining.get(targetKey(entry.inventoryItem.id, location.id)) ?? 0,
      }))
      .filter(({ available }) => available >= line.quantity)
      .sort(
        (a, b) =>
          a.available - b.available ||
          normalized(a.location.id).localeCompare(normalized(b.location.id)),
      );
    const selected = candidates[0];
    if (!selected) return failure("INSUFFICIENT_STOCK");
    remaining.set(
      targetKey(entry.inventoryItem.id, selected.location.id),
      selected.available - line.quantity,
    );
    assignments.push({
      cartItemId: line.cartItemId,
      inventoryItemId: entry.inventoryItem.id,
      inventoryLocationId: selected.location.id,
    });
  }
  const targets = [
    ...new Map(
      assignments.map(({ inventoryItemId, inventoryLocationId }) => [
        targetKey(inventoryItemId, inventoryLocationId),
        { inventoryItemId, inventoryLocationId },
      ]),
    ).values(),
  ].sort((a, b) =>
    targetKey(a.inventoryItemId, a.inventoryLocationId).localeCompare(
      targetKey(b.inventoryItemId, b.inventoryLocationId),
    ),
  );
  return checkoutInventorySelectionSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    assignments,
    targets,
  });
}

/** Uses freshly locked balances, carrying each decision forward for shared stock. */
export function planCheckoutInventory(input: unknown): CheckoutInventoryPlan {
  const parsed = checkoutInventoryPlanCommandSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_COMMAND");
  const value = parsed.data;
  if (Date.parse(value.evaluatedAt) >= Date.parse(value.expiresAt))
    return failure("PREFLIGHT_EXPIRED");
  if (value.current.cart.expired) return failure("CART_EXPIRED");
  if (value.current.cart.status !== "ACTIVE") return failure("CART_LOCKED");
  const lines = new Map(
    value.current.consent.lines
      .filter((line) => line.inventoryPolicy === "TRACKED")
      .map((line) => [normalized(line.cartItemId), line]),
  );
  const assignments = new Map(
    value.assignments.map((assignment) => [
      normalized(assignment.cartItemId),
      assignment,
    ]),
  );
  const reservations = new Map(
    value.reservations.map((reservation) => [
      normalized(reservation.cartItemId),
      reservation.reservationId,
    ]),
  );
  const locked = new Map(
    value.lockedInventory.map((entry) => [
      targetKey(entry.inventoryItem.id, entry.inventoryLocation.id),
      entry,
    ]),
  );
  if (
    assignments.size !== lines.size ||
    assignments.size !== value.assignments.length ||
    reservations.size !== lines.size ||
    reservations.size !== value.reservations.length ||
    new Set(value.reservations.map((entry) => normalized(entry.reservationId)))
      .size !== reservations.size ||
    locked.size !== value.lockedInventory.length ||
    locked.size !==
      new Set(
        value.assignments.map((entry) =>
          targetKey(entry.inventoryItemId, entry.inventoryLocationId),
        ),
      ).size
  )
    return failure("INVALID_COMMAND");
  const decisions: Extract<
    InventoryReservationCreationDecision,
    { kind: "APPLY" }
  >[] = [];
  for (const assignment of value.assignments) {
    const line = lines.get(normalized(assignment.cartItemId));
    const reservationId = reservations.get(normalized(assignment.cartItemId));
    const key = targetKey(
      assignment.inventoryItemId,
      assignment.inventoryLocationId,
    );
    const entry = locked.get(key);
    const original = value.current.inventory.find(
      (item) =>
        normalized(item.cartItemId) === normalized(assignment.cartItemId),
    );
    if (
      !line ||
      !reservationId ||
      !entry ||
      !original ||
      entry.reservation !== null ||
      normalized(line.inventoryItemId ?? "") !==
        normalized(assignment.inventoryItemId) ||
      normalized(entry.inventoryItem.giftVariantId) !==
        normalized(line.giftVariantId) ||
      !original.locations.some(
        ({ location }) =>
          normalized(location.id) ===
          normalized(assignment.inventoryLocationId),
      )
    )
      return failure("INVALID_COMMAND");
    const decision = planInventoryReservationCreation({
      schemaVersion: 1,
      inventoryItem: entry.inventoryItem,
      inventoryLocation: entry.inventoryLocation,
      balance: entry.balance,
      existingReservation: null,
      evaluatedAt: value.evaluatedAt,
      reservation: {
        schemaVersion: 1,
        id: reservationId,
        checkoutQuoteId: value.quoteId,
        cartItemId: line.cartItemId,
        giftVariantId: line.giftVariantId,
        inventoryLocationId: assignment.inventoryLocationId,
        quantity: line.quantity,
        status: "ACTIVE",
        expiresAt: value.expiresAt,
        version: 1,
      },
    });
    if (decision.kind !== "APPLY")
      return failure(
        decision.kind === "REJECTED" &&
          decision.code === "RESERVATION_ALREADY_EXPIRED"
          ? "PREFLIGHT_EXPIRED"
          : "INSUFFICIENT_STOCK",
      );
    decisions.push(decision);
    locked.set(key, { ...entry, balance: decision.nextBalance });
  }
  return checkoutInventoryPlanSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    decisions,
  });
}
