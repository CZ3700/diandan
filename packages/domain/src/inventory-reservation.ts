import {
  inventoryReservationCreationInputSchema,
  inventoryReservationTransitionInputSchema,
  type InventoryReservationCreationDecision,
  type InventoryReservationCreationInput,
  type InventoryReservationTransitionDecision,
  type InventoryReservationTransitionInput,
} from "@fan-support/contracts";

type CreationRejection = Extract<
  InventoryReservationCreationDecision,
  { kind: "REJECTED" }
>;
type TransitionRejection = Extract<
  InventoryReservationTransitionDecision,
  { kind: "REJECTED" }
>;

const RESERVATION_TRANSITION_REASON = {
  COMMITTED: "RESERVATION_COMMITTED",
  RELEASED: "RESERVATION_RELEASED",
  EXPIRED: "RESERVATION_EXPIRED",
} as const;

function creationRejected(code: CreationRejection["code"]): CreationRejection {
  return { schemaVersion: 1 as const, kind: "REJECTED" as const, code };
}

function transitionRejected(
  code: TransitionRejection["code"],
): TransitionRejection {
  return { schemaVersion: 1 as const, kind: "REJECTED" as const, code };
}

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function hasMatchingIdentity(
  inventoryItem: { id: string; giftVariantId: string },
  balance: { inventoryItemId: string; inventoryLocationId: string },
  reservation: { giftVariantId: string; inventoryLocationId: string },
): boolean {
  return (
    sameId(inventoryItem.id, balance.inventoryItemId) &&
    sameId(inventoryItem.giftVariantId, reservation.giftVariantId) &&
    sameId(balance.inventoryLocationId, reservation.inventoryLocationId)
  );
}

function isSameReservation(
  left: InventoryReservationCreationInput["reservation"],
  right: InventoryReservationCreationInput["reservation"],
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    sameId(left.id, right.id) &&
    sameId(left.checkoutQuoteId, right.checkoutQuoteId) &&
    sameId(left.cartItemId, right.cartItemId) &&
    sameId(left.giftVariantId, right.giftVariantId) &&
    sameId(left.inventoryLocationId, right.inventoryLocationId) &&
    left.quantity === right.quantity &&
    left.status === right.status &&
    left.expiresAt === right.expiresAt &&
    left.version === right.version
  );
}

export function planInventoryReservationCreation(
  input: unknown,
): InventoryReservationCreationDecision {
  const parsed = inventoryReservationCreationInputSchema.safeParse(input);
  if (!parsed.success) {
    return creationRejected("INVENTORY_IDENTITY_MISMATCH");
  }
  const value: InventoryReservationCreationInput = parsed.data;
  const {
    inventoryItem,
    inventoryLocation,
    balance,
    reservation,
    existingReservation,
    evaluatedAt,
  } = value;
  if (
    !hasMatchingIdentity(inventoryItem, balance, reservation) ||
    !sameId(inventoryLocation.id, balance.inventoryLocationId)
  ) {
    return creationRejected("INVENTORY_IDENTITY_MISMATCH");
  }
  if (inventoryItem.policy !== "TRACKED") {
    return creationRejected("INVENTORY_NOT_TRACKED");
  }
  if (
    inventoryItem.status !== "ACTIVE" ||
    inventoryLocation.status !== "ACTIVE"
  ) {
    return creationRejected("INVENTORY_NOT_USABLE");
  }
  if (reservation.status !== "ACTIVE") {
    return creationRejected("RESERVATION_NOT_ACTIVE");
  }
  if (existingReservation !== null) {
    if (isSameReservation(existingReservation, reservation)) {
      return {
        schemaVersion: 1,
        kind: "REPLAY",
        inventoryItem: { ...inventoryItem },
        inventoryItemId: inventoryItem.id,
        inventoryLocationId: inventoryLocation.id,
        reservationId: existingReservation.id,
        reservation: existingReservation,
        reasonCode: "RESERVATION_ALREADY_CREATED",
      };
    }
    return creationRejected("RESERVATION_IDEMPOTENCY_CONFLICT");
  }
  if (Date.parse(evaluatedAt) >= Date.parse(reservation.expiresAt)) {
    return creationRejected("RESERVATION_ALREADY_EXPIRED");
  }
  if (balance.onHand - balance.reserved < reservation.quantity) {
    return creationRejected("INSUFFICIENT_INVENTORY");
  }
  if (balance.version === Number.MAX_SAFE_INTEGER) {
    return creationRejected("VERSION_OVERFLOW");
  }
  return {
    schemaVersion: 1 as const,
    kind: "APPLY" as const,
    inventoryItem: { ...inventoryItem },
    inventoryItemId: inventoryItem.id,
    inventoryLocationId: inventoryLocation.id,
    reservationId: reservation.id,
    expectedBalanceVersion: balance.version,
    expectedReservationAbsent: true,
    previousBalance: { ...balance },
    nextBalance: {
      ...balance,
      reserved: balance.reserved + reservation.quantity,
      version: balance.version + 1,
    },
    nextReservation: reservation,
    ledgerDelta: {
      deltaOnHand: 0,
      deltaReserved: reservation.quantity,
    },
    reasonCode: "RESERVATION_CREATED" as const,
  };
}

export function planInventoryReservationTransition(
  input: unknown,
): InventoryReservationTransitionDecision {
  const parsed = inventoryReservationTransitionInputSchema.safeParse(input);
  if (!parsed.success) {
    return transitionRejected("INVENTORY_IDENTITY_MISMATCH");
  }
  const value: InventoryReservationTransitionInput = parsed.data;
  const { inventoryItem, balance, reservation, evaluatedAt, targetStatus } =
    value;
  if (!hasMatchingIdentity(inventoryItem, balance, reservation)) {
    return transitionRejected("INVENTORY_IDENTITY_MISMATCH");
  }
  if (reservation.status !== "ACTIVE") {
    return reservation.status === targetStatus
      ? {
          schemaVersion: 1 as const,
          kind: "REPLAY" as const,
          inventoryItem: { ...inventoryItem },
          inventoryItemId: inventoryItem.id,
          inventoryLocationId: reservation.inventoryLocationId,
          reservationId: reservation.id,
          reservation,
        }
      : transitionRejected("RESERVATION_NOT_ACTIVE");
  }
  if (
    targetStatus === "EXPIRED" &&
    Date.parse(evaluatedAt) < Date.parse(reservation.expiresAt)
  ) {
    return transitionRejected("RESERVATION_NOT_EXPIRED");
  }
  if (balance.reserved < reservation.quantity) {
    return transitionRejected("BALANCE_INCONSISTENT");
  }
  if (
    balance.version === Number.MAX_SAFE_INTEGER ||
    reservation.version === Number.MAX_SAFE_INTEGER
  ) {
    return transitionRejected("VERSION_OVERFLOW");
  }
  const commits = targetStatus === "COMMITTED";
  const deltaOnHand = commits ? -reservation.quantity : 0;
  const deltaReserved = -reservation.quantity;
  return {
    schemaVersion: 1 as const,
    kind: "APPLY" as const,
    inventoryItem: { ...inventoryItem },
    inventoryItemId: inventoryItem.id,
    inventoryLocationId: reservation.inventoryLocationId,
    reservationId: reservation.id,
    expectedBalanceVersion: balance.version,
    expectedReservationVersion: reservation.version,
    previousBalance: { ...balance },
    previousReservation: { ...reservation },
    nextBalance: {
      ...balance,
      onHand: balance.onHand + deltaOnHand,
      reserved: balance.reserved + deltaReserved,
      version: balance.version + 1,
    },
    nextReservation: {
      ...reservation,
      status: targetStatus,
      version: reservation.version + 1,
    },
    ledgerDelta: { deltaOnHand, deltaReserved },
    reasonCode: RESERVATION_TRANSITION_REASON[targetStatus],
  };
}
