import {
  disputeTransitionCommandSchema,
  disputeTransitionDecisionSchema,
  fulfillmentTransitionCommandSchema,
  fulfillmentTransitionDecisionSchema,
  latePaymentSuccessCommandSchema,
  latePaymentSuccessDecisionSchema,
  orderLifecycleTransitionCommandSchema,
  orderLifecycleTransitionDecisionSchema,
  orderPaymentTransitionCommandSchema,
  orderPaymentTransitionDecisionSchema,
  paymentAttemptTransitionCommandSchema,
  paymentAttemptTransitionDecisionSchema,
  refundTransitionCommandSchema,
  refundTransitionDecisionSchema,
  type DisputeTransitionDecision,
  type FulfillmentTransitionDecision,
  type LatePaymentSuccessState,
  type LatePaymentSuccessDecision,
  type OrderLifecycleTransitionDecision,
  type OrderPaymentTransitionDecision,
  type PaymentAttemptSubject,
  type PaymentAttemptTransitionDecision,
  type ProviderEvent,
  type RefundTransitionDecision,
} from "@fan-support/contracts";

import { decideDisputeTransition } from "./dispute-state-machine.js";
import { decideFulfillmentTransition } from "./fulfillment-state-machine.js";
import { planLatePaymentSuccess } from "./late-payment-success.js";
import {
  decideOrderLifecycleTransition,
  decideOrderPaymentTransition,
} from "./order-state-machine.js";
import { decidePaymentAttemptTransition } from "./payment-state-machine.js";
import {
  validateProviderEvidence,
  type ProviderEvidenceTarget,
  type ProviderEvidenceValidation,
} from "./provider-evidence.js";
import { evaluateRefundCapacity } from "./refund-capacity.js";
import { decideRefundTransition } from "./refund-state-machine.js";
import type { TransitionDecision } from "./transition-decision.js";

/**
 * Security precondition for every public wrapper in this module: Application
 * code must build subjects from persisted records and events from a verified
 * webhook inbox or an authenticated, audited reconcile path. These pure
 * functions validate serialized contracts, entity linkage and optimistic-lock
 * versions; parsing raw input alone does not prove a signature or DB record.
 * Operator, admin, and audited-business authorities must be constructed by an
 * authenticated and authorized application workflow. auditLogId must name an
 * already-persisted audit row; no authority may be copied from a request body.
 */

type EvidenceEventType = ProviderEvidenceTarget["eventType"];

function evidenceTarget(
  eventType: EvidenceEventType,
  paymentAttempt: PaymentAttemptSubject,
  amountMinor: number,
  currency: string,
  providerReference?: string,
): ProviderEvidenceTarget {
  const base = {
    paymentAttemptId: paymentAttempt.id,
    providerAccountId: paymentAttempt.providerAccountId,
    environment: paymentAttempt.environment,
    amountMinor,
    currency,
    ...(paymentAttempt.externalReference === undefined
      ? {}
      : { externalReference: paymentAttempt.externalReference }),
  };

  switch (eventType) {
    case "PAYMENT_STATUS":
      return { ...base, eventType };
    case "REFUND_STATUS":
    case "DISPUTE_STATUS":
      if (providerReference === undefined) {
        throw new Error(`${eventType} requires a provider reference`);
      }
      return { ...base, eventType, providerReference };
  }
}

function validateCommandEvidence(
  target: ProviderEvidenceTarget,
  event: ProviderEvent,
): ProviderEvidenceValidation {
  return validateProviderEvidence(target, event);
}

function validatePaymentEvidence(
  paymentAttempt: PaymentAttemptSubject,
  event: ProviderEvent,
): ProviderEvidenceValidation {
  return validateCommandEvidence(
    evidenceTarget(
      "PAYMENT_STATUS",
      paymentAttempt,
      paymentAttempt.amountMinor,
      paymentAttempt.currency,
    ),
    event,
  );
}

function attachIdentity<State extends string, Identity extends object>(
  decision: TransitionDecision<State>,
  identity: Identity,
) {
  return { ...decision, ...identity };
}

function rejectedDecision<State extends string, Identity extends object>(
  from: State,
  to: State,
  reasonCode: string,
  identity: Identity,
) {
  return {
    schemaVersion: 1 as const,
    decision: "REJECTED" as const,
    from,
    to,
    reasonCode,
    effects: [] as const,
    ...identity,
  };
}

/**
 * Decides one persisted payment-attempt transition. The returned identity and
 * expectedVersion must be used together in the repository update predicate.
 * PROVIDER_EVENT must come from a verified webhook inbox or an authenticated,
 * audited reconcile path; schema parsing does not prove its signature or DB
 * origin. AUDITED_BUSINESS_CANCEL must be constructed by an authenticated,
 * authorized application workflow and reference an already-persisted audit
 * row; never copy this authority from a request body.
 */
export function decidePaymentAttemptTransitionCommand(
  input: unknown,
): PaymentAttemptTransitionDecision {
  const parsed = paymentAttemptTransitionCommandSchema.safeParse(input);
  if (!parsed.success) {
    return paymentAttemptTransitionDecisionSchema.parse({
      schemaVersion: 1,
      decision: "INVALID",
      reasonCode: "INVALID_PAYMENT_ATTEMPT_TRANSITION_COMMAND",
      effects: [],
    });
  }

  const { subject, expectedVersion, target, authority } = parsed.data;
  const identity = {
    paymentAttemptId: subject.id,
    orderId: subject.orderId,
    expectedVersion,
  };
  if (expectedVersion !== subject.version) {
    return paymentAttemptTransitionDecisionSchema.parse(
      rejectedDecision(
        subject.status,
        target,
        "PAYMENT_STALE_VERSION",
        identity,
      ),
    );
  }

  if (
    authority.kind === "PROVIDER_EVENT" &&
    target === "SUCCEEDED" &&
    authority.event.status === "SUCCEEDED"
  ) {
    return paymentAttemptTransitionDecisionSchema.parse(
      rejectedDecision(
        subject.status,
        target,
        "PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
        identity,
      ),
    );
  }

  if (authority.kind === "PROVIDER_EVENT") {
    const validation = validatePaymentEvidence(
      authority.paymentAttempt,
      authority.event,
    );
    if (validation.decision === "REJECTED") {
      return paymentAttemptTransitionDecisionSchema.parse(
        rejectedDecision(
          subject.status,
          target,
          "PAYMENT_PROVIDER_EVIDENCE_INVALID",
          identity,
        ),
      );
    }
    return paymentAttemptTransitionDecisionSchema.parse(
      attachIdentity(
        decidePaymentAttemptTransition(subject.status, target, {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: subject.id,
          evidence: validation.evidence,
        }),
        identity,
      ),
    );
  }

  const domainAuthority = (() => {
    switch (authority.kind) {
      case "AUDITED_BUSINESS_CANCEL":
        return { ...authority, providerCallStarted: false as const };
      case "SAFE_EXPIRY":
        return { ...authority, providerCallStarted: false as const };
      default:
        return authority;
    }
  })();
  return paymentAttemptTransitionDecisionSchema.parse(
    attachIdentity(
      decidePaymentAttemptTransition(subject.status, target, domainAuthority),
      identity,
    ),
  );
}

/**
 * Decides one persisted order-lifecycle transition. Late payment recovery is
 * intentionally excluded and must use planLatePaymentSuccessCommand.
 * PROVIDER_EVENT must come from a verified webhook inbox or an authenticated,
 * audited reconcile path; schema parsing does not prove its signature or DB
 * origin. AUDITED_BUSINESS_CANCEL must be constructed by an authenticated,
 * authorized application workflow and reference an already-persisted audit
 * row; never copy this authority from a request body.
 */
export function decideOrderLifecycleTransitionCommand(
  input: unknown,
): OrderLifecycleTransitionDecision {
  const parsed = orderLifecycleTransitionCommandSchema.safeParse(input);
  if (!parsed.success) {
    return orderLifecycleTransitionDecisionSchema.parse({
      schemaVersion: 1,
      decision: "INVALID",
      reasonCode: "INVALID_ORDER_LIFECYCLE_TRANSITION_COMMAND",
      effects: [],
    });
  }

  const { subject, expectedVersion, target, authority } = parsed.data;
  const identity = {
    orderId: subject.id,
    paymentAttemptId: subject.currentPaymentAttemptId,
    expectedVersion,
  };
  if (expectedVersion !== subject.version) {
    return orderLifecycleTransitionDecisionSchema.parse(
      rejectedDecision(
        subject.orderStatus,
        target,
        "ORDER_LIFECYCLE_STALE_VERSION",
        identity,
      ),
    );
  }

  if (
    authority.kind === "PROVIDER_EVENT" &&
    target === "OPEN" &&
    authority.event.status === "SUCCEEDED"
  ) {
    return orderLifecycleTransitionDecisionSchema.parse(
      rejectedDecision(
        subject.orderStatus,
        target,
        "ORDER_LATE_SUCCESS_PLANNER_REQUIRED",
        identity,
      ),
    );
  }

  if (
    authority.kind === "PROVIDER_EVENT" &&
    authority.paymentAttempt.status === "SUCCEEDED" &&
    authority.event.status !== "SUCCEEDED"
  ) {
    return orderLifecycleTransitionDecisionSchema.parse(
      rejectedDecision(
        subject.orderStatus,
        target,
        "ORDER_PROVIDER_EVIDENCE_INVALID",
        identity,
      ),
    );
  }

  if (authority.kind === "PROVIDER_EVENT") {
    const validation = validatePaymentEvidence(
      authority.paymentAttempt,
      authority.event,
    );
    if (validation.decision === "REJECTED") {
      return orderLifecycleTransitionDecisionSchema.parse(
        rejectedDecision(
          subject.orderStatus,
          target,
          "ORDER_PROVIDER_EVIDENCE_INVALID",
          identity,
        ),
      );
    }
    return orderLifecycleTransitionDecisionSchema.parse(
      attachIdentity(
        decideOrderLifecycleTransition(subject.orderStatus, target, {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: authority.paymentAttempt.id,
          evidence: validation.evidence,
        }),
        identity,
      ),
    );
  }

  return orderLifecycleTransitionDecisionSchema.parse(
    attachIdentity(
      decideOrderLifecycleTransition(subject.orderStatus, target, authority),
      identity,
    ),
  );
}

/**
 * Decides one persisted order-payment aggregate transition and binds any
 * attempt evidence to the order's currentPaymentAttemptId.
 * PROVIDER_EVENT must come from a verified webhook inbox or an authenticated,
 * audited reconcile path; schema parsing does not prove its signature or DB
 * origin. REFUND_TOTALS must be computed from persisted, order-scoped refunds
 * under the same optimistic-lock boundary.
 */
export function decideOrderPaymentTransitionCommand(
  input: unknown,
): OrderPaymentTransitionDecision {
  const parsed = orderPaymentTransitionCommandSchema.safeParse(input);
  if (!parsed.success) {
    return orderPaymentTransitionDecisionSchema.parse({
      schemaVersion: 1,
      decision: "INVALID",
      reasonCode: "INVALID_ORDER_PAYMENT_TRANSITION_COMMAND",
      effects: [],
    });
  }

  const { subject, expectedVersion, target, authority } = parsed.data;
  const identity = {
    orderId: subject.id,
    paymentAttemptId: subject.currentPaymentAttemptId,
    expectedVersion,
  };
  if (expectedVersion !== subject.version) {
    return orderPaymentTransitionDecisionSchema.parse(
      rejectedDecision(
        subject.paymentStatus,
        target,
        "ORDER_PAYMENT_STALE_VERSION",
        identity,
      ),
    );
  }

  if (
    authority.kind === "PROVIDER_EVENT" &&
    target === "PAID" &&
    authority.event.status === "SUCCEEDED"
  ) {
    return orderPaymentTransitionDecisionSchema.parse(
      rejectedDecision(
        subject.paymentStatus,
        target,
        "ORDER_PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
        identity,
      ),
    );
  }

  if (authority.kind === "PROVIDER_EVENT") {
    const validation = validatePaymentEvidence(
      authority.paymentAttempt,
      authority.event,
    );
    if (validation.decision === "REJECTED") {
      return orderPaymentTransitionDecisionSchema.parse(
        rejectedDecision(
          subject.paymentStatus,
          target,
          "ORDER_PROVIDER_EVIDENCE_INVALID",
          identity,
        ),
      );
    }
    return orderPaymentTransitionDecisionSchema.parse(
      attachIdentity(
        decideOrderPaymentTransition(subject.paymentStatus, target, {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: authority.paymentAttempt.id,
          evidence: validation.evidence,
        }),
        identity,
      ),
    );
  }

  const domainAuthority =
    authority.kind === "ATTEMPT_CREATED"
      ? ({ kind: "ATTEMPT_CREATED" } as const)
      : authority;
  return orderPaymentTransitionDecisionSchema.parse(
    attachIdentity(
      decideOrderPaymentTransition(
        subject.paymentStatus,
        target,
        domainAuthority,
      ),
      identity,
    ),
  );
}

/**
 * Decides one persisted refund transition with payment and PSP binding.
 * PROVIDER_EVENT must come from a verified webhook inbox or an authenticated,
 * audited reconcile path; schema parsing does not prove its signature or DB
 * origin. SUBMIT_COMMAND refunds must be the complete versioned set loaded
 * under the same transaction lock used to apply every returned predicate.
 */
export function decideRefundTransitionCommand(
  input: unknown,
): RefundTransitionDecision {
  const parsed = refundTransitionCommandSchema.safeParse(input);
  if (!parsed.success) {
    return refundTransitionDecisionSchema.parse({
      schemaVersion: 1,
      decision: "INVALID",
      reasonCode: "INVALID_REFUND_TRANSITION_COMMAND",
      effects: [],
    });
  }

  const { subject, order, paymentAttempt, expectedVersion, target, authority } =
    parsed.data;
  const identity = {
    refundId: subject.id,
    orderId: subject.orderId,
    paymentAttemptId: subject.paymentAttemptId,
    providerReference: subject.providerReference,
    expectedVersion,
    orderExpectedVersion: order.version,
    paymentAttemptExpectedVersion: paymentAttempt.version,
  };
  if (expectedVersion !== subject.version) {
    return refundTransitionDecisionSchema.parse(
      rejectedDecision(
        subject.status,
        target,
        "REFUND_STALE_VERSION",
        identity,
      ),
    );
  }

  if (authority.kind === "SUBMIT_COMMAND") {
    const capacity = evaluateRefundCapacity({
      schemaVersion: 1,
      order,
      paymentAttempt,
      refund: subject,
      refunds: authority.refunds,
    });
    if (capacity.kind === "REJECTED") {
      return refundTransitionDecisionSchema.parse(
        rejectedDecision(
          subject.status,
          target,
          capacity.code === "REFUND_CAPACITY_EXCEEDED"
            ? "REFUND_CAPACITY_EXCEEDED"
            : "REFUND_CAPACITY_CONTEXT_INVALID",
          identity,
        ),
      );
    }
    const transition = decideRefundTransition(subject.status, target, {
      kind: "SUBMIT_COMMAND",
    });
    return refundTransitionDecisionSchema.parse(
      attachIdentity(
        transition,
        transition.decision === "APPLIED" &&
          transition.reasonCode === "REFUND_SUBMISSION_STARTED"
          ? { ...identity, capacity }
          : identity,
      ),
    );
  }

  if (authority.kind === "PROVIDER_EVENT") {
    const validation = validateCommandEvidence(
      evidenceTarget(
        "REFUND_STATUS",
        authority.paymentAttempt,
        subject.requestedAmountMinor,
        subject.currency,
        subject.providerReference,
      ),
      authority.event,
    );
    if (validation.decision === "REJECTED") {
      return refundTransitionDecisionSchema.parse(
        rejectedDecision(
          subject.status,
          target,
          "REFUND_PROVIDER_EVIDENCE_INVALID",
          identity,
        ),
      );
    }
    return refundTransitionDecisionSchema.parse(
      attachIdentity(
        decideRefundTransition(subject.status, target, {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: subject.paymentAttemptId,
          expectedProviderReference: subject.providerReference,
          evidence: validation.evidence,
        }),
        identity,
      ),
    );
  }

  return refundTransitionDecisionSchema.parse(
    attachIdentity(
      decideRefundTransition(subject.status, target, authority),
      identity,
    ),
  );
}

/**
 * Decides one persisted dispute transition with payment and PSP binding.
 * PROVIDER_EVENT must come from a verified webhook inbox or an authenticated,
 * audited reconcile path; schema parsing does not prove its signature or DB
 * origin.
 */
export function decideDisputeTransitionCommand(
  input: unknown,
): DisputeTransitionDecision {
  const parsed = disputeTransitionCommandSchema.safeParse(input);
  if (!parsed.success) {
    return disputeTransitionDecisionSchema.parse({
      schemaVersion: 1,
      decision: "INVALID",
      reasonCode: "INVALID_DISPUTE_TRANSITION_COMMAND",
      effects: [],
    });
  }

  const { subject, order, paymentAttempt, expectedVersion, target, authority } =
    parsed.data;
  const identity = {
    disputeId: subject.id,
    orderId: subject.orderId,
    paymentAttemptId: subject.paymentAttemptId,
    providerReference: subject.providerReference,
    expectedVersion,
    orderExpectedVersion: order.version,
    paymentAttemptExpectedVersion: paymentAttempt.version,
  };
  if (expectedVersion !== subject.version) {
    return disputeTransitionDecisionSchema.parse(
      rejectedDecision(
        subject.status,
        target,
        "DISPUTE_STALE_VERSION",
        identity,
      ),
    );
  }

  if (authority.kind === "PROVIDER_EVENT") {
    const validation = validateCommandEvidence(
      evidenceTarget(
        "DISPUTE_STATUS",
        authority.paymentAttempt,
        subject.amountMinor,
        subject.currency,
        subject.providerReference,
      ),
      authority.event,
    );
    if (validation.decision === "REJECTED") {
      return disputeTransitionDecisionSchema.parse(
        rejectedDecision(
          subject.status,
          target,
          "DISPUTE_PROVIDER_EVIDENCE_INVALID",
          identity,
        ),
      );
    }
    return disputeTransitionDecisionSchema.parse(
      attachIdentity(
        decideDisputeTransition(subject.status, target, {
          kind: "PROVIDER_EVIDENCE",
          expectedPaymentAttemptId: subject.paymentAttemptId,
          expectedProviderReference: subject.providerReference,
          evidence: validation.evidence,
        }),
        identity,
      ),
    );
  }

  return disputeTransitionDecisionSchema.parse(
    attachIdentity(
      decideDisputeTransition(subject.status, target, authority),
      identity,
    ),
  );
}

/**
 * Decides one versioned fulfillment transition bound to its persisted order.
 * The repository must apply both fulfillment and order expected versions in
 * the same transaction; schema parsing does not prove either DB snapshot.
 * OPERATOR_COMMAND must be constructed by an authenticated, authorized
 * application workflow and never copied from a request body.
 */
export function decideFulfillmentTransitionCommand(
  input: unknown,
): FulfillmentTransitionDecision {
  const parsed = fulfillmentTransitionCommandSchema.safeParse(input);
  if (!parsed.success) {
    return fulfillmentTransitionDecisionSchema.parse({
      schemaVersion: 1,
      decision: "INVALID",
      reasonCode: "INVALID_FULFILLMENT_TRANSITION_COMMAND",
      effects: [],
    });
  }

  const { subject, order, expectedVersion, target, authority } = parsed.data;
  const identity = {
    fulfillmentId: subject.id,
    orderId: subject.orderId,
    orderItemId: subject.orderItemId,
    expectedVersion,
    orderExpectedVersion: order.version,
  };
  if (expectedVersion !== subject.version) {
    return fulfillmentTransitionDecisionSchema.parse(
      rejectedDecision(
        subject.status,
        target,
        "FULFILLMENT_STALE_VERSION",
        identity,
      ),
    );
  }

  return fulfillmentTransitionDecisionSchema.parse(
    attachIdentity(
      decideFulfillmentTransition(subject.status, target, {
        kind: "OPERATOR_COMMAND",
        expectedVersion,
        currentVersion: subject.version,
        ...(authority.reasonCode === undefined
          ? {}
          : { reasonCode: authority.reasonCode }),
      }),
      identity,
    ),
  );
}

function latePaymentSubjectVersions(state: LatePaymentSuccessState) {
  return {
    paymentAttempt: {
      id: state.paymentAttempt.id,
      expectedVersion: state.paymentAttempt.version,
    },
    order: { id: state.order.id, expectedVersion: state.order.version },
    cart: { id: state.cart.id, expectedVersion: state.cart.version },
    reservations: state.reservations.map((subject) => ({
      id: subject.id,
      expectedVersion: subject.version,
    })),
    fulfillments: state.fulfillments.map((subject) => ({
      id: subject.id,
      expectedVersion: subject.version,
    })),
  };
}

/**
 * Plans the coordinated, multi-subject late-payment recovery. Callers must
 * apply every returned mutation atomically with its ID/version predicate.
 * PROVIDER_EVENT must come from a verified webhook inbox or an authenticated,
 * audited reconcile path; schema parsing does not prove its signature or DB
 * origin. auditActor must be derived from an authenticated admin session or a
 * fixed trusted system task, never copied from a request body; this pure
 * function cannot authenticate that actor.
 */
export function planLatePaymentSuccessCommand(
  input: unknown,
): LatePaymentSuccessDecision {
  const parsed = latePaymentSuccessCommandSchema.safeParse(input);
  if (!parsed.success) {
    return latePaymentSuccessDecisionSchema.parse({
      schemaVersion: 1,
      decision: "INVALID",
      reasonCode: "INVALID_LATE_PAYMENT_SUCCESS_COMMAND",
      effects: [],
    });
  }

  const command = parsed.data;
  const validation = validatePaymentEvidence(
    command.authority.paymentAttempt,
    command.authority.event,
  );
  if (validation.decision === "REJECTED") {
    return latePaymentSuccessDecisionSchema.parse({
      schemaVersion: 1,
      decision: "REJECTED",
      reasonCode: "LATE_SUCCESS_TRUSTED_EVIDENCE_REQUIRED",
      subjects: latePaymentSubjectVersions(command.state),
      effects: [],
    });
  }

  return latePaymentSuccessDecisionSchema.parse(
    planLatePaymentSuccess({
      ...command.state,
      evidence: validation.evidence,
      providerEventId: command.authority.event.providerEventId,
      auditActor: command.auditActor,
    }),
  );
}
