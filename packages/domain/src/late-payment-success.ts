import {
  adminIdentityIdSchema,
  providerEvidenceAuditReferenceSchema,
  providerEventReferenceSchema,
  type LatePaymentSuccessAuditActor,
  type LatePaymentSuccessDecision,
  type LatePaymentSuccessPlan,
  type LatePaymentSuccessState,
  type LatePaymentSuccessSubjectVersions,
} from "@fan-support/contracts";

import {
  isAcceptedProviderEvidenceFor,
  type AcceptedProviderEvidence,
} from "./provider-evidence.js";

const TASK_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[-_:][a-z0-9]+)*$/u;

export type LatePaymentSuccessInput = Readonly<
  Omit<LatePaymentSuccessState, "schemaVersion"> & {
    evidence: AcceptedProviderEvidence;
    providerEventId: string;
    auditActor: LatePaymentSuccessAuditActor;
  }
>;

type RejectionReason = Extract<
  LatePaymentSuccessDecision,
  { decision: "REJECTED" }
>["reasonCode"];
type ConflictReason = Extract<
  LatePaymentSuccessDecision,
  { decision: "CONFLICT" }
>["reasonCode"];

function projectSubjects(
  input: LatePaymentSuccessInput,
): LatePaymentSuccessSubjectVersions {
  return {
    paymentAttempt: {
      id: input.paymentAttempt.id,
      expectedVersion: input.paymentAttempt.version,
    },
    order: {
      id: input.order.id,
      expectedVersion: input.order.version,
    },
    cart: {
      id: input.cart.id,
      expectedVersion: input.cart.version,
    },
    reservations: input.reservations.map((reservation) => ({
      id: reservation.id,
      expectedVersion: reservation.version,
    })),
    fulfillments: input.fulfillments.map((fulfillment) => ({
      id: fulfillment.id,
      expectedVersion: fulfillment.version,
    })),
  };
}

function reject(
  input: LatePaymentSuccessInput,
  reasonCode: RejectionReason,
): LatePaymentSuccessDecision {
  return {
    schemaVersion: 1,
    decision: "REJECTED",
    reasonCode,
    subjects: projectSubjects(input),
    effects: [],
  };
}

function conflict(
  input: LatePaymentSuccessInput,
  reasonCode: ConflictReason,
): LatePaymentSuccessDecision {
  return {
    schemaVersion: 1,
    decision: "CONFLICT",
    reasonCode,
    subjects: projectSubjects(input),
    effects: [],
  };
}

function projectOriginalState(
  input: LatePaymentSuccessInput,
): LatePaymentSuccessState {
  return {
    schemaVersion: 1,
    paymentAttempt: { ...input.paymentAttempt },
    order: { ...input.order },
    cart: { ...input.cart },
    reservations: input.reservations.map((reservation) => ({
      ...reservation,
    })),
    fulfillments: input.fulfillments.map((fulfillment) => ({
      ...fulfillment,
    })),
    competingPaymentAttemptIds: [...input.competingPaymentAttemptIds],
  };
}

function hasValidAuditActor(actor: LatePaymentSuccessAuditActor): boolean {
  return actor.kind === "ADMIN"
    ? adminIdentityIdSchema.safeParse(actor.adminIdentityId).success
    : actor.taskName.length <= 128 && TASK_NAME_PATTERN.test(actor.taskName);
}

function hasValidAggregateLinks(input: LatePaymentSuccessInput): boolean {
  const orderId = input.order.id;
  const normalizedOrderId = orderId.toLowerCase();
  const reservationIds = input.reservations.map(({ id }) => id.toLowerCase());
  const fulfillmentIds = input.fulfillments.map(({ id }) => id.toLowerCase());
  return (
    input.paymentAttempt.orderId.toLowerCase() === normalizedOrderId &&
    input.cart.orderId.toLowerCase() === normalizedOrderId &&
    input.reservations.every(
      (subject) => subject.orderId.toLowerCase() === normalizedOrderId,
    ) &&
    input.fulfillments.length > 0 &&
    input.fulfillments.every(
      (subject) => subject.orderId.toLowerCase() === normalizedOrderId,
    ) &&
    new Set(reservationIds).size === reservationIds.length &&
    new Set(fulfillmentIds).size === fulfillmentIds.length &&
    (input.order.currentPaymentAttemptId === null ||
      input.order.currentPaymentAttemptId.toLowerCase() ===
        input.paymentAttempt.id.toLowerCase())
  );
}

function hasValidOrderState(input: LatePaymentSuccessInput): boolean {
  return (
    hasValidAggregateLinks(input) &&
    ["PENDING_PAYMENT", "CANCELED", "OPEN"].includes(input.order.orderStatus) &&
    ["PENDING", "PAID"].includes(input.order.paymentStatus) &&
    ["LOCKED", "CONVERTED"].includes(input.cart.status)
  );
}

function buildPlan(
  input: LatePaymentSuccessInput,
  inventoryUnavailable: boolean,
): LatePaymentSuccessPlan {
  return {
    paymentAttempt: {
      id: input.paymentAttempt.id,
      expectedVersion: input.paymentAttempt.version,
      status: "SUCCEEDED",
    },
    order: {
      id: input.order.id,
      expectedVersion: input.order.version,
      paymentStatus: "PAID",
      orderStatus: "OPEN",
    },
    cart: {
      id: input.cart.id,
      expectedVersion: input.cart.version,
      status: "CONVERTED",
    },
    reservations: input.reservations.map((reservation) => ({
      id: reservation.id,
      expectedVersion: reservation.version,
      status:
        reservation.status === "ACTIVE" ? "COMMITTED" : reservation.status,
      inventoryAction:
        reservation.status === "ACTIVE" ? "COMMIT_RESERVED" : "NONE",
    })),
    fulfillments: input.fulfillments.map((fulfillment) => ({
      id: fulfillment.id,
      expectedVersion: fulfillment.version,
      status: inventoryUnavailable ? "ON_HOLD" : "PENDING",
    })),
  };
}

function isAlreadyApplied(
  input: LatePaymentSuccessInput,
  inventoryUnavailable: boolean,
): boolean {
  const expectedFulfillmentStatus = inventoryUnavailable
    ? "ON_HOLD"
    : "PENDING";
  return (
    input.paymentAttempt.status === "SUCCEEDED" &&
    input.order.paymentStatus === "PAID" &&
    input.order.orderStatus === "OPEN" &&
    input.cart.status === "CONVERTED" &&
    input.reservations.every(({ status }) => status !== "ACTIVE") &&
    input.fulfillments.every(
      ({ status }) => status === expectedFulfillmentStatus,
    )
  );
}

function hasFulfillmentConflict(
  input: LatePaymentSuccessInput,
  inventoryUnavailable: boolean,
): boolean {
  return input.fulfillments.some(({ status }) =>
    inventoryUnavailable
      ? status !== "PENDING" && status !== "ON_HOLD"
      : status !== "PENDING",
  );
}

export function planLatePaymentSuccess(
  input: LatePaymentSuccessInput,
): LatePaymentSuccessDecision {
  const providerEventId = providerEventReferenceSchema.safeParse(
    input.providerEventId,
  );
  const providerEvidence = providerEvidenceAuditReferenceSchema.safeParse(
    input.evidence.evidence,
  );
  if (
    !providerEventId.success ||
    !providerEvidence.success ||
    input.evidence.providerEventId !== input.providerEventId ||
    !isAcceptedProviderEvidenceFor(input.evidence, {
      eventType: "PAYMENT_STATUS",
      expectedPaymentAttemptId: input.paymentAttempt.id,
      expectedStatus: "SUCCEEDED",
    })
  ) {
    return reject(input, "LATE_SUCCESS_TRUSTED_EVIDENCE_REQUIRED");
  }
  if (!hasValidAuditActor(input.auditActor)) {
    return reject(input, "LATE_SUCCESS_AUDIT_ACTOR_INVALID");
  }
  if (input.competingPaymentAttemptIds.length > 0) {
    return conflict(input, "LATE_SUCCESS_SECOND_ATTEMPT_CONFLICT");
  }
  if (["FAILED", "CANCELED", "EXPIRED"].includes(input.paymentAttempt.status)) {
    return conflict(input, "LATE_SUCCESS_PAYMENT_TERMINAL_CONFLICT");
  }
  if (!hasValidOrderState(input)) {
    return reject(input, "LATE_SUCCESS_ORDER_STATE_INVALID");
  }

  const inventoryUnavailable = input.reservations.some(
    ({ status }) => status === "RELEASED" || status === "EXPIRED",
  );
  if (isAlreadyApplied(input, inventoryUnavailable)) {
    return {
      schemaVersion: 1,
      decision: "NOOP",
      reasonCode: "ALREADY_APPLIED",
      subjects: projectSubjects(input),
      effects: [],
    };
  }
  if (hasFulfillmentConflict(input, inventoryUnavailable)) {
    return conflict(input, "LATE_SUCCESS_FULFILLMENT_STATE_CONFLICT");
  }

  const hasActiveReservation = input.reservations.some(
    ({ status }) => status === "ACTIVE",
  );
  return {
    schemaVersion: 1,
    decision: "APPLIED",
    reasonCode: inventoryUnavailable
      ? "LATE_PAYMENT_INVENTORY_UNAVAILABLE"
      : "PAYMENT_SUCCESS_RECONCILED",
    subjects: projectSubjects(input),
    plan: buildPlan(input, inventoryUnavailable),
    audit: {
      original: projectOriginalState(input),
      providerEventId: providerEventId.data,
      providerEvidence: providerEvidence.data,
      actor: { ...input.auditActor },
    },
    effects: [
      { type: "PAYMENT_SUCCEEDED" },
      { type: "ORDER_OPENED" },
      ...(hasActiveReservation
        ? [{ type: "INVENTORY_RESERVATION_COMMIT_REQUIRED" as const }]
        : []),
      ...(inventoryUnavailable
        ? [{ type: "FULFILLMENT_REVIEW_REQUIRED" as const }]
        : []),
      { type: "AUDIT_REQUIRED" },
    ],
  };
}
