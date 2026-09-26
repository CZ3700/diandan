import type { GiftFulfillment } from "@fan-support/contracts";

import {
  appliedTransition,
  conflictingTransition,
  noopTransition,
  rejectedTransition,
  type TransitionDecision,
} from "./transition-decision.js";

export type FulfillmentStatus = GiftFulfillment["status"];

type VersionedCommand = Readonly<{
  expectedVersion: number;
  currentVersion: number;
  reasonCode?: string;
}>;

/**
 * OPERATOR_COMMAND is an authenticated studio action. SYSTEM_DIGITAL_DELIVERY is
 * the ADR-019 direct PENDING → DELIVERED step for a VIRTUAL gift line once its
 * order payment aggregate reached PAID; only application code constructs it.
 */
export type FulfillmentTransitionAuthority = VersionedCommand &
  Readonly<{ kind: "OPERATOR_COMMAND" | "SYSTEM_DIGITAL_DELIVERY" }>;

const TERMINAL_FULFILLMENT_STATUSES = new Set<FulfillmentStatus>([
  "DELIVERED",
  "CANCELED",
]);

const FULFILLMENT_TRANSITIONS: Readonly<
  Record<FulfillmentStatus, readonly FulfillmentStatus[]>
> = {
  PENDING: ["PREPARING", "ON_HOLD", "CANCELED"],
  PREPARING: ["DELIVERED", "ON_HOLD", "CANCELED"],
  DELIVERED: [],
  ON_HOLD: ["PENDING", "PREPARING", "CANCELED"],
  CANCELED: [],
};

const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;

function hasValidReason(authority: VersionedCommand): boolean {
  return (
    authority.reasonCode !== undefined &&
    REASON_CODE_PATTERN.test(authority.reasonCode)
  );
}

export function decideFulfillmentTransition(
  current: FulfillmentStatus,
  target: FulfillmentStatus,
  authority: FulfillmentTransitionAuthority,
): TransitionDecision<FulfillmentStatus> {
  if (current === target) {
    return noopTransition(current);
  }
  if (TERMINAL_FULFILLMENT_STATUSES.has(current)) {
    return conflictingTransition(
      current,
      target,
      "FULFILLMENT_TERMINAL_STATE_CONFLICT",
    );
  }
  if (authority.kind === "SYSTEM_DIGITAL_DELIVERY") {
    if (current !== "PENDING" || target !== "DELIVERED") {
      return rejectedTransition(
        current,
        target,
        "FULFILLMENT_TRANSITION_NOT_ALLOWED",
      );
    }
    if (authority.expectedVersion !== authority.currentVersion) {
      return rejectedTransition(current, target, "FULFILLMENT_STALE_VERSION");
    }
    return appliedTransition(current, target, "VIRTUAL_GIFT_AUTO_DELIVERED", [
      { type: "FULFILLMENT_STATUS_CHANGED" },
    ]);
  }
  if (!FULFILLMENT_TRANSITIONS[current].includes(target)) {
    return rejectedTransition(
      current,
      target,
      "FULFILLMENT_TRANSITION_NOT_ALLOWED",
    );
  }
  if (authority.expectedVersion !== authority.currentVersion) {
    return rejectedTransition(current, target, "FULFILLMENT_STALE_VERSION");
  }
  if (
    (target === "ON_HOLD" || target === "CANCELED") &&
    !hasValidReason(authority)
  ) {
    return rejectedTransition(current, target, "FULFILLMENT_REASON_REQUIRED");
  }
  return appliedTransition(current, target, "FULFILLMENT_OPERATOR_TRANSITION", [
    { type: "FULFILLMENT_STATUS_CHANGED" },
  ]);
}
