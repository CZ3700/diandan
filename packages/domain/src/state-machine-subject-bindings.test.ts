import { describe, expect, test } from "vitest";

import {
  disputeTransitionDecisionSchema,
  fulfillmentTransitionDecisionSchema,
  latePaymentSuccessDecisionSchema,
  orderLifecycleTransitionDecisionSchema,
  orderPaymentTransitionDecisionSchema,
  paymentAttemptTransitionDecisionSchema,
  refundTransitionDecisionSchema,
} from "@fan-support/contracts";

import {
  decideDisputeTransitionCommand,
  decideFulfillmentTransitionCommand,
  decideOrderLifecycleTransitionCommand,
  decideOrderPaymentTransitionCommand,
  decidePaymentAttemptTransitionCommand,
  decideRefundTransitionCommand,
  planLatePaymentSuccessCommand,
} from "./state-machine-commands.js";

const ORDER_A = "31a119d7-30dd-407b-b3c7-419ee2e2d623";
const ORDER_B = "656b54bb-7dd8-4f35-8fea-a5b1cf05c18b";
const PAYMENT_A = "5ec6cdcb-a13b-4167-a4ec-17c01432fdd2";
const PAYMENT_B = "a2f80a06-1c38-4591-a0e7-a86cc00e98ad";
const PROVIDER_ACCOUNT = "2d6f6e95-168c-4be6-950e-73d1e33d815b";
const REFUND_A = "1f21a1f9-f3dd-4448-af8a-4fcb2eb7fb81";
const DISPUTE_A = "d98c672e-d3b0-49bb-8685-cbe5c124af3c";
const FULFILLMENT_A = "2aa5f8e7-b01d-43ab-8447-ef48022d47e9";
const ORDER_ITEM_A = "267a8cd4-19fe-48db-8e70-cdab5db3244e";
const CART_A = "8d7f0040-c271-4b8f-895a-b32f50c61f3a";
const RESERVATION_A = "7c2cba11-9307-480e-9344-69964bafca0e";

function paymentAttempt(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    id: PAYMENT_A,
    orderId: ORDER_A,
    version: 3,
    status: "PROCESSING",
    providerAccountId: PROVIDER_ACCOUNT,
    environment: "TEST",
    externalReference: "pay_1",
    amountMinor: 2_500,
    currency: "USD",
    providerCallStarted: true,
    ...overrides,
  };
}

function orderSubject(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    id: ORDER_A,
    version: 7,
    orderStatus: "PENDING_PAYMENT",
    paymentStatus: "PENDING",
    currentPaymentAttemptId: PAYMENT_A,
    ...overrides,
  };
}

function providerEvent(
  eventType: "PAYMENT_STATUS" | "REFUND_STATUS" | "DISPUTE_STATUS",
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const common = {
    schemaVersion: 1,
    eventType,
    providerAccountId: PROVIDER_ACCOUNT,
    environment: "TEST",
    providerEventId: `evt_${eventType.toLowerCase()}_1`,
    evidence: {
      kind: "VERIFIED_WEBHOOK",
      webhookInboxId: "f219e263-c97d-4249-94ed-7c5473020cca",
    },
    occurredAt: "2026-09-03T02:00:00Z",
    association: {
      status: "MATCHED",
      paymentAttemptId: PAYMENT_A,
      externalReference: "pay_1",
    },
    currency: "USD",
  };

  if (eventType === "PAYMENT_STATUS") {
    return {
      ...common,
      status: "SUCCEEDED",
      amountMinor: 2_500,
      ...overrides,
    };
  }
  if (eventType === "REFUND_STATUS") {
    return {
      ...common,
      refundReference: "refund_1",
      status: "SUCCEEDED",
      amountMinor: 1_000,
      ...overrides,
    };
  }
  return {
    ...common,
    disputeReference: "dispute_1",
    status: "OPEN",
    amountMinor: 2_500,
    ...overrides,
  };
}

function paymentAuthority(
  attemptOverrides: Readonly<Record<string, unknown>> = {},
  eventOverrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    kind: "PROVIDER_EVENT",
    paymentAttempt: paymentAttempt(attemptOverrides),
    event: providerEvent("PAYMENT_STATUS", eventOverrides),
  };
}

function refundSubject(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    id: REFUND_A,
    orderId: ORDER_A,
    paymentAttemptId: PAYMENT_A,
    version: 5,
    status: "PROCESSING",
    providerReference: "refund_1",
    capturedCurrency: "USD",
    capturedAmountMinor: 2_500,
    requestedAmountMinor: 1_000,
    currency: "USD",
    ...overrides,
  };
}

function currentCaptureBinding(
  orderOverrides: Readonly<Record<string, unknown>> = {},
  paymentOverrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    order: orderSubject({ paymentStatus: "PAID", ...orderOverrides }),
    paymentAttempt: paymentAttempt({
      status: "SUCCEEDED",
      ...paymentOverrides,
    }),
  };
}

function refundRecordFor(
  subject: ReturnType<typeof refundSubject>,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return { ...subject, processedAmountMinor: 0, ...overrides };
}

function refundAuthority(
  attemptOverrides: Readonly<Record<string, unknown>> = {},
  eventOverrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    kind: "PROVIDER_EVENT",
    paymentAttempt: paymentAttempt({
      status: "SUCCEEDED",
      ...attemptOverrides,
    }),
    providerReference: "refund_1",
    event: providerEvent("REFUND_STATUS", eventOverrides),
  };
}

function disputeSubject(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    id: DISPUTE_A,
    orderId: ORDER_A,
    paymentAttemptId: PAYMENT_A,
    version: 4,
    status: "NONE",
    providerReference: "dispute_1",
    amountMinor: 2_500,
    currency: "USD",
    ...overrides,
  };
}

function disputeAuthority(
  attemptOverrides: Readonly<Record<string, unknown>> = {},
  eventOverrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    kind: "PROVIDER_EVENT",
    paymentAttempt: paymentAttempt({
      status: "SUCCEEDED",
      ...attemptOverrides,
    }),
    providerReference: "dispute_1",
    event: providerEvent("DISPUTE_STATUS", eventOverrides),
  };
}

function fulfillmentSubject(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    id: FULFILLMENT_A,
    orderId: ORDER_A,
    orderItemId: ORDER_ITEM_A,
    version: 9,
    status: "PENDING",
    ...overrides,
  };
}

function fulfillableOrder(overrides: Readonly<Record<string, unknown>> = {}) {
  return orderSubject({
    orderStatus: "OPEN",
    paymentStatus: "PAID",
    ...overrides,
  });
}

describe("public state commands bind decisions to persisted subjects", () => {
  test("returns IDs and expected versions for every subject-bound decision", () => {
    expect(
      decidePaymentAttemptTransitionCommand({
        schemaVersion: 1,
        subject: paymentAttempt(),
        expectedVersion: 3,
        target: "SUCCEEDED",
        authority: paymentAuthority(),
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
      paymentAttemptId: PAYMENT_A,
      orderId: ORDER_A,
      expectedVersion: 3,
    });

    expect(
      decideOrderLifecycleTransitionCommand({
        schemaVersion: 1,
        subject: orderSubject(),
        expectedVersion: 7,
        target: "OPEN",
        authority: paymentAuthority(),
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "ORDER_LATE_SUCCESS_PLANNER_REQUIRED",
      orderId: ORDER_A,
      paymentAttemptId: PAYMENT_A,
      expectedVersion: 7,
    });

    expect(
      decideOrderPaymentTransitionCommand({
        schemaVersion: 1,
        subject: orderSubject(),
        expectedVersion: 7,
        target: "PAID",
        authority: paymentAuthority(),
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "ORDER_PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
      orderId: ORDER_A,
      paymentAttemptId: PAYMENT_A,
      expectedVersion: 7,
    });

    expect(
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: refundSubject(),
        expectedVersion: 5,
        target: "SUCCEEDED",
        authority: refundAuthority(),
      }),
    ).toMatchObject({
      decision: "APPLIED",
      refundId: REFUND_A,
      orderId: ORDER_A,
      paymentAttemptId: PAYMENT_A,
      providerReference: "refund_1",
      expectedVersion: 5,
      orderExpectedVersion: 7,
      paymentAttemptExpectedVersion: 3,
    });

    expect(
      decideDisputeTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: disputeSubject(),
        expectedVersion: 4,
        target: "OPEN",
        authority: disputeAuthority(),
      }),
    ).toMatchObject({
      decision: "APPLIED",
      disputeId: DISPUTE_A,
      orderId: ORDER_A,
      paymentAttemptId: PAYMENT_A,
      providerReference: "dispute_1",
      expectedVersion: 4,
      orderExpectedVersion: 7,
      paymentAttemptExpectedVersion: 3,
    });

    expect(
      decideFulfillmentTransitionCommand({
        schemaVersion: 1,
        order: fulfillableOrder(),
        subject: fulfillmentSubject(),
        expectedVersion: 9,
        target: "PREPARING",
        authority: { kind: "OPERATOR_COMMAND" },
      }),
    ).toMatchObject({
      decision: "APPLIED",
      fulfillmentId: FULFILLMENT_A,
      orderId: ORDER_A,
      orderItemId: ORDER_ITEM_A,
      expectedVersion: 9,
      orderExpectedVersion: 7,
    });
  });

  test.each([
    {
      name: "payment",
      decide: decidePaymentAttemptTransitionCommand,
      schema: paymentAttemptTransitionDecisionSchema,
      input: {
        schemaVersion: 1,
        subject: paymentAttempt(),
        expectedVersion: 2,
        target: "SUCCEEDED",
        authority: paymentAuthority(),
      },
      reasonCode: "PAYMENT_STALE_VERSION",
    },
    {
      name: "order lifecycle",
      decide: decideOrderLifecycleTransitionCommand,
      schema: orderLifecycleTransitionDecisionSchema,
      input: {
        schemaVersion: 1,
        subject: orderSubject(),
        expectedVersion: 6,
        target: "OPEN",
        authority: paymentAuthority(),
      },
      reasonCode: "ORDER_LIFECYCLE_STALE_VERSION",
    },
    {
      name: "order payment",
      decide: decideOrderPaymentTransitionCommand,
      schema: orderPaymentTransitionDecisionSchema,
      input: {
        schemaVersion: 1,
        subject: orderSubject(),
        expectedVersion: 6,
        target: "PAID",
        authority: paymentAuthority(),
      },
      reasonCode: "ORDER_PAYMENT_STALE_VERSION",
    },
    {
      name: "refund",
      decide: decideRefundTransitionCommand,
      schema: refundTransitionDecisionSchema,
      input: {
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: refundSubject(),
        expectedVersion: 4,
        target: "SUCCEEDED",
        authority: refundAuthority(),
      },
      reasonCode: "REFUND_STALE_VERSION",
    },
    {
      name: "dispute",
      decide: decideDisputeTransitionCommand,
      schema: disputeTransitionDecisionSchema,
      input: {
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: disputeSubject(),
        expectedVersion: 3,
        target: "OPEN",
        authority: disputeAuthority(),
      },
      reasonCode: "DISPUTE_STALE_VERSION",
    },
    {
      name: "fulfillment",
      decide: decideFulfillmentTransitionCommand,
      schema: fulfillmentTransitionDecisionSchema,
      input: {
        schemaVersion: 1,
        order: fulfillableOrder(),
        subject: fulfillmentSubject(),
        expectedVersion: 8,
        target: "PREPARING",
        authority: { kind: "OPERATOR_COMMAND" },
      },
      reasonCode: "FULFILLMENT_STALE_VERSION",
    },
  ])(
    "rejects stale $name snapshots before evaluating authority",
    ({ decide, schema, input, reasonCode }) => {
      const result = decide(input);
      expect(result).toMatchObject({
        decision: "REJECTED",
        reasonCode,
        effects: [],
      });
      expect(schema.parse(result)).toEqual(result);
    },
  );

  test("rejects cross-order and non-current payment-attempt bindings", () => {
    for (const input of [
      {
        schemaVersion: 1,
        subject: orderSubject({ currentPaymentAttemptId: PAYMENT_B }),
        expectedVersion: 7,
        target: "OPEN",
        authority: paymentAuthority(),
      },
      {
        schemaVersion: 1,
        subject: orderSubject(),
        expectedVersion: 7,
        target: "PAID",
        authority: paymentAuthority({ orderId: ORDER_B }),
      },
    ]) {
      const decide =
        input.target === "OPEN"
          ? decideOrderLifecycleTransitionCommand
          : decideOrderPaymentTransitionCommand;
      expect(decide(input)).toMatchObject({ decision: "INVALID" });
    }

    expect(
      decideFulfillmentTransitionCommand({
        schemaVersion: 1,
        order: fulfillableOrder(),
        subject: fulfillmentSubject(),
        expectedVersion: 9,
        target: "ON_HOLD",
        authority: {
          kind: "LATE_PAYMENT_HOLD",
          reasonCode: "LATE_PAYMENT_INVENTORY_UNAVAILABLE",
          paymentAttempt: paymentAttempt({ orderId: ORDER_B }),
          event: providerEvent("PAYMENT_STATUS"),
        },
      }),
    ).toMatchObject({ decision: "INVALID" });

    expect(
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: refundSubject(),
        expectedVersion: 5,
        target: "SUCCEEDED",
        authority: refundAuthority({ status: "FAILED" }),
      }),
    ).toMatchObject({ decision: "INVALID" });

    expect(
      decideDisputeTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: disputeSubject(),
        expectedVersion: 4,
        target: "OPEN",
        authority: disputeAuthority({ status: "UNKNOWN" }),
      }),
    ).toMatchObject({ decision: "INVALID" });
  });

  test("rejects refund and dispute subjects linked to a different attempt", () => {
    expect(
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: refundSubject({ paymentAttemptId: PAYMENT_B }),
        expectedVersion: 5,
        target: "SUCCEEDED",
        authority: refundAuthority(),
      }),
    ).toMatchObject({ decision: "INVALID" });

    expect(
      decideDisputeTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: disputeSubject({ orderId: ORDER_B }),
        expectedVersion: 4,
        target: "OPEN",
        authority: disputeAuthority(),
      }),
    ).toMatchObject({ decision: "INVALID" });
  });

  test("rejects every refund and dispute authority for a non-refundable order payment state", () => {
    for (const paymentStatus of ["UNPAID", "PENDING"] as const) {
      const binding = currentCaptureBinding({ paymentStatus });

      expect(
        decideRefundTransitionCommand({
          schemaVersion: 1,
          ...binding,
          subject: refundSubject({ status: "SUBMITTING" }),
          expectedVersion: 5,
          target: "UNKNOWN",
          authority: {
            kind: "NETWORK_UNCERTAINTY",
            operationMayHaveCommitted: true,
          },
        }),
      ).toMatchObject({ decision: "INVALID" });

      expect(
        decideRefundTransitionCommand({
          schemaVersion: 1,
          ...binding,
          subject: refundSubject(),
          expectedVersion: 5,
          target: "SUCCEEDED",
          authority: refundAuthority(),
        }),
      ).toMatchObject({ decision: "INVALID" });

      expect(
        decideDisputeTransitionCommand({
          schemaVersion: 1,
          ...binding,
          subject: disputeSubject(),
          expectedVersion: 4,
          target: "OPEN",
          authority: disputeAuthority(),
        }),
      ).toMatchObject({ decision: "INVALID" });

      expect(
        decideDisputeTransitionCommand({
          schemaVersion: 1,
          ...binding,
          subject: disputeSubject(),
          expectedVersion: 4,
          target: "OPEN",
          authority: { kind: "BROWSER_RETURN" },
        }),
      ).toMatchObject({ decision: "INVALID" });
    }

    const refundedBinding = currentCaptureBinding({
      paymentStatus: "REFUNDED",
    });
    expect(
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...refundedBinding,
        subject: refundSubject({ status: "SUCCEEDED" }),
        expectedVersion: 5,
        target: "SUCCEEDED",
        authority: refundAuthority(),
      }),
    ).toMatchObject({ decision: "NOOP" });
    expect(
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...refundedBinding,
        subject: refundSubject({ status: "FAILED" }),
        expectedVersion: 5,
        target: "FAILED",
        authority: refundAuthority({}, { status: "FAILED" }),
      }),
    ).toMatchObject({ decision: "NOOP" });
    expect(
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...refundedBinding,
        subject: refundSubject({ status: "SUCCEEDED" }),
        expectedVersion: 5,
        target: "FAILED",
        authority: refundAuthority({}, { status: "FAILED" }),
      }),
    ).toMatchObject({ decision: "CONFLICT" });
    expect(
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...refundedBinding,
        subject: refundSubject({ status: "SUBMITTING" }),
        expectedVersion: 5,
        target: "UNKNOWN",
        authority: {
          kind: "NETWORK_UNCERTAINTY",
          operationMayHaveCommitted: true,
        },
      }),
    ).toMatchObject({ decision: "INVALID" });
    expect(
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...refundedBinding,
        subject: refundSubject({ status: "PROCESSING" }),
        expectedVersion: 5,
        target: "SUCCEEDED",
        authority: refundAuthority(),
      }),
    ).toMatchObject({ decision: "INVALID" });
    expect(
      decideDisputeTransitionCommand({
        schemaVersion: 1,
        ...refundedBinding,
        subject: disputeSubject(),
        expectedVersion: 4,
        target: "OPEN",
        authority: disputeAuthority(),
      }),
    ).toMatchObject({ decision: "APPLIED" });

    const requestedRefund = refundSubject({ status: "REQUESTED" });
    expect(
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...refundedBinding,
        subject: requestedRefund,
        expectedVersion: 5,
        target: "SUBMITTING",
        authority: {
          kind: "SUBMIT_COMMAND",
          refunds: [refundRecordFor(requestedRefund)],
        },
      }),
    ).toMatchObject({ decision: "INVALID" });
  });

  test("requires external references and routes associated payment success to the aggregate planner", () => {
    const { externalReference, ...earlyAttempt } = paymentAttempt();
    expect(externalReference).toBe("pay_1");

    expect(
      decidePaymentAttemptTransitionCommand({
        schemaVersion: 1,
        subject: earlyAttempt,
        expectedVersion: 3,
        target: "SUCCEEDED",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: earlyAttempt,
          event: providerEvent("PAYMENT_STATUS"),
        },
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
    });

    expect(
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: refundSubject(),
        expectedVersion: 5,
        target: "SUCCEEDED",
        authority: refundAuthority({ externalReference: undefined }),
      }),
    ).toMatchObject({ decision: "INVALID" });

    expect(
      decideDisputeTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: disputeSubject(),
        expectedVersion: 4,
        target: "OPEN",
        authority: disputeAuthority({ externalReference: undefined }),
      }),
    ).toMatchObject({ decision: "INVALID" });
  });

  test("derives the pre-provider-call safety fact from the persisted payment subject", () => {
    const command = {
      schemaVersion: 1,
      subject: paymentAttempt({
        status: "CREATED",
        providerCallStarted: false,
      }),
      expectedVersion: 3,
      target: "CANCELED",
      authority: {
        kind: "AUDITED_BUSINESS_CANCEL",
        auditLogId: "020745e1-48d2-437f-8f3f-780cc11d8734",
        reasonCode: "CUSTOMER_REQUESTED_CANCEL",
      },
    };

    expect(decidePaymentAttemptTransitionCommand(command)).toMatchObject({
      decision: "APPLIED",
      paymentAttemptId: PAYMENT_A,
    });
    expect(
      decidePaymentAttemptTransitionCommand({
        ...command,
        subject: paymentAttempt({
          status: "CREATED",
          providerCallStarted: true,
        }),
      }),
    ).toMatchObject({ decision: "INVALID" });
    expect(
      decidePaymentAttemptTransitionCommand({
        ...command,
        authority: { ...command.authority, providerCallStarted: false },
      }),
    ).toMatchObject({ decision: "INVALID" });
  });

  test("does not expose a direct late-order-reopen command", () => {
    expect(
      decideOrderLifecycleTransitionCommand({
        schemaVersion: 1,
        subject: orderSubject({ orderStatus: "CANCELED" }),
        expectedVersion: 7,
        target: "OPEN",
        authority: {
          kind: "LATE_PROVIDER_SUCCESS",
          paymentAttempt: paymentAttempt(),
          event: providerEvent("PAYMENT_STATUS"),
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      decision: "INVALID",
      reasonCode: "INVALID_ORDER_LIFECYCLE_TRANSITION_COMMAND",
      effects: [],
    });
  });

  test("supports direct non-provider authorities without dropping subject identities", () => {
    const requestedRefund = refundSubject({ status: "REQUESTED" });
    const decisions = [
      decidePaymentAttemptTransitionCommand({
        schemaVersion: 1,
        subject: paymentAttempt({
          status: "CREATED",
          providerCallStarted: false,
        }),
        expectedVersion: 3,
        target: "PROCESSING",
        authority: { kind: "CREATE_RESULT" },
      }),
      decideOrderLifecycleTransitionCommand({
        schemaVersion: 1,
        subject: orderSubject({
          orderStatus: "DRAFT",
          paymentStatus: "UNPAID",
          currentPaymentAttemptId: null,
        }),
        expectedVersion: 7,
        target: "PENDING_PAYMENT",
        authority: { kind: "CHECKOUT_CREATED" },
      }),
      decideOrderPaymentTransitionCommand({
        schemaVersion: 1,
        subject: orderSubject({ paymentStatus: "UNPAID" }),
        expectedVersion: 7,
        target: "PENDING",
        authority: {
          kind: "ATTEMPT_CREATED",
          paymentAttempt: paymentAttempt({
            status: "CREATED",
            providerCallStarted: false,
          }),
        },
      }),
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: requestedRefund,
        expectedVersion: 5,
        target: "SUBMITTING",
        authority: {
          kind: "SUBMIT_COMMAND",
          refunds: [refundRecordFor(requestedRefund)],
        },
      }),
      decideFulfillmentTransitionCommand({
        schemaVersion: 1,
        order: fulfillableOrder(),
        subject: fulfillmentSubject(),
        expectedVersion: 9,
        target: "PREPARING",
        authority: { kind: "OPERATOR_COMMAND" },
      }),
    ];

    for (const decision of decisions) {
      expect(decision.decision).toBe("APPLIED");
      expect(decision).toHaveProperty("expectedVersion");
    }
    expect(decisions[3]).toMatchObject({
      orderExpectedVersion: 7,
      paymentAttemptExpectedVersion: 3,
      capacity: {
        kind: "AVAILABLE",
        refundId: REFUND_A,
        occupiedAmountMinor: 1_000,
        availableAmountMinor: 1_500,
      },
    });

    expect(
      decideDisputeTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: disputeSubject(),
        expectedVersion: 4,
        target: "OPEN",
        authority: { kind: "BROWSER_RETURN" },
      }),
    ).toMatchObject({
      decision: "REJECTED",
      disputeId: DISPUTE_A,
      reasonCode: "DISPUTE_PROVIDER_EVIDENCE_REQUIRED",
    });
  });

  test("fails closed when refund submission is not bound to the current captured attempt", () => {
    const requestedRefund = refundSubject({ status: "REQUESTED" });
    expect(
      decideRefundTransitionCommand({
        schemaVersion: 1,
        subject: requestedRefund,
        expectedVersion: 5,
        target: "SUBMITTING",
        authority: {
          kind: "SUBMIT_COMMAND",
          refunds: [refundRecordFor(requestedRefund)],
        },
      }),
    ).toMatchObject({ decision: "INVALID" });
  });

  test("fails closed when fulfillment is not bound to a fulfillable order", () => {
    expect(
      decideFulfillmentTransitionCommand({
        schemaVersion: 1,
        subject: fulfillmentSubject(),
        expectedVersion: 9,
        target: "PREPARING",
        authority: { kind: "OPERATOR_COMMAND" },
      }),
    ).toMatchObject({ decision: "INVALID" });
    for (const order of [
      fulfillableOrder({ id: ORDER_B }),
      fulfillableOrder({ paymentStatus: "PENDING" }),
      fulfillableOrder({ orderStatus: "CLOSED" }),
    ]) {
      expect(
        decideFulfillmentTransitionCommand({
          schemaVersion: 1,
          order,
          subject: fulfillmentSubject(),
          expectedVersion: 9,
          target: "PREPARING",
          authority: { kind: "OPERATOR_COMMAND" },
        }),
      ).toMatchObject({ decision: "INVALID" });
    }
  });

  test("rejects stale capture bindings, inflated amounts, and aggregate over-refunds", () => {
    const requestedRefund = refundSubject({ status: "REQUESTED" });
    const base = {
      schemaVersion: 1,
      ...currentCaptureBinding(),
      subject: requestedRefund,
      expectedVersion: 5,
      target: "SUBMITTING",
      authority: {
        kind: "SUBMIT_COMMAND",
        refunds: [refundRecordFor(requestedRefund)],
      },
    } as const;

    expect(() =>
      decideRefundTransitionCommand({ ...base, target: "SUCCEEDED" }),
    ).not.toThrow();
    expect(
      decideRefundTransitionCommand({ ...base, target: "SUCCEEDED" }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "REFUND_TRANSITION_NOT_ALLOWED",
      effects: [],
    });

    expect(
      decideRefundTransitionCommand({
        ...base,
        ...currentCaptureBinding({ currentPaymentAttemptId: PAYMENT_B }),
      }),
    ).toMatchObject({ decision: "INVALID" });

    const inflatedRefund = refundSubject({
      status: "REQUESTED",
      requestedAmountMinor: 1_000_000,
    });
    expect(
      decideRefundTransitionCommand({
        ...base,
        subject: inflatedRefund,
        authority: {
          kind: "SUBMIT_COMMAND",
          refunds: [refundRecordFor(inflatedRefund)],
        },
      }),
    ).toMatchObject({ decision: "INVALID" });

    const previousUnknown = refundSubject({
      id: "a37113e9-cc9a-48c6-91a5-572d6dbf94ac",
      version: 4,
      status: "UNKNOWN",
      providerReference: "refund_previous",
      requestedAmountMinor: 2_000,
    });
    expect(
      decideRefundTransitionCommand({
        ...base,
        authority: {
          kind: "SUBMIT_COMMAND",
          refunds: [
            refundRecordFor(requestedRefund),
            refundRecordFor(previousUnknown),
          ],
        },
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "REFUND_CAPACITY_EXCEEDED",
      effects: [],
    });

    expect(
      decideDisputeTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding({ currentPaymentAttemptId: PAYMENT_B }),
        subject: disputeSubject(),
        expectedVersion: 4,
        target: "OPEN",
        authority: disputeAuthority(),
      }),
    ).toMatchObject({ decision: "INVALID" });
    expect(
      decideDisputeTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: disputeSubject({ amountMinor: 1_000_000 }),
        expectedVersion: 4,
        target: "OPEN",
        authority: disputeAuthority({}, { amountMinor: 1_000_000 }),
      }),
    ).toMatchObject({ decision: "INVALID" });
  });

  test("binds refund aggregates to the order's current captured attempt", () => {
    const subject = orderSubject({ paymentStatus: "PAID" });
    const payment = paymentAttempt({ status: "SUCCEEDED" });
    const authority = {
      kind: "REFUND_TOTALS",
      paymentAttempt: payment,
      capturedAmountMinor: 2_500,
      succeededRefundAmountMinor: 1_000,
    };

    expect(
      decideOrderPaymentTransitionCommand({
        schemaVersion: 1,
        subject,
        expectedVersion: 7,
        target: "PARTIALLY_REFUNDED",
        authority,
      }),
    ).toMatchObject({
      decision: "APPLIED",
      orderId: ORDER_A,
      paymentAttemptId: PAYMENT_A,
      expectedVersion: 7,
    });

    for (const invalidAuthority of [
      {
        ...authority,
        paymentAttempt: { ...payment, id: PAYMENT_B },
      },
      {
        ...authority,
        paymentAttempt: { ...payment, orderId: ORDER_B },
      },
      { ...authority, capturedAmountMinor: 2_499 },
    ]) {
      expect(
        decideOrderPaymentTransitionCommand({
          schemaVersion: 1,
          subject,
          expectedVersion: 7,
          target: "PARTIALLY_REFUNDED",
          authority: invalidAuthority,
        }),
      ).toMatchObject({ decision: "INVALID" });
    }
  });

  test("returns schema-valid INVALID decisions for malformed commands", () => {
    const cases = [
      [
        decidePaymentAttemptTransitionCommand,
        paymentAttemptTransitionDecisionSchema,
        "INVALID_PAYMENT_ATTEMPT_TRANSITION_COMMAND",
      ],
      [
        decideOrderLifecycleTransitionCommand,
        orderLifecycleTransitionDecisionSchema,
        "INVALID_ORDER_LIFECYCLE_TRANSITION_COMMAND",
      ],
      [
        decideOrderPaymentTransitionCommand,
        orderPaymentTransitionDecisionSchema,
        "INVALID_ORDER_PAYMENT_TRANSITION_COMMAND",
      ],
      [
        decideRefundTransitionCommand,
        refundTransitionDecisionSchema,
        "INVALID_REFUND_TRANSITION_COMMAND",
      ],
      [
        decideDisputeTransitionCommand,
        disputeTransitionDecisionSchema,
        "INVALID_DISPUTE_TRANSITION_COMMAND",
      ],
      [
        decideFulfillmentTransitionCommand,
        fulfillmentTransitionDecisionSchema,
        "INVALID_FULFILLMENT_TRANSITION_COMMAND",
      ],
      [
        planLatePaymentSuccessCommand,
        latePaymentSuccessDecisionSchema,
        "INVALID_LATE_PAYMENT_SUCCESS_COMMAND",
      ],
    ] as const;

    for (const [decide, schema, reasonCode] of cases) {
      const decision = decide(null);
      expect(decision).toEqual({
        schemaVersion: 1,
        decision: "INVALID",
        reasonCode,
        effects: [],
      });
      expect(schema.parse(decision)).toEqual(decision);
    }
  });

  test("rejects malformed provider bindings before creating runtime evidence", () => {
    const invalidDecisions = [
      decidePaymentAttemptTransitionCommand({
        schemaVersion: 1,
        subject: paymentAttempt(),
        expectedVersion: 3,
        target: "SUCCEEDED",
        authority: paymentAuthority(
          {},
          {
            association: {
              status: "MATCHED",
              paymentAttemptId: PAYMENT_B,
              externalReference: "pay_1",
            },
          },
        ),
      }),
      decideOrderLifecycleTransitionCommand({
        schemaVersion: 1,
        subject: orderSubject(),
        expectedVersion: 7,
        target: "OPEN",
        authority: paymentAuthority(
          {},
          { providerAccountId: "3c8cff59-cb48-429a-8cdc-4f5a55ef8d4a" },
        ),
      }),
      decideRefundTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: refundSubject(),
        expectedVersion: 5,
        target: "SUCCEEDED",
        authority: refundAuthority({}, { refundReference: "refund_wrong" }),
      }),
      decideDisputeTransitionCommand({
        schemaVersion: 1,
        ...currentCaptureBinding(),
        subject: disputeSubject(),
        expectedVersion: 4,
        target: "OPEN",
        authority: disputeAuthority({}, { amountMinor: 2_499 }),
      }),
    ];

    for (const decision of invalidDecisions) {
      expect(decision).toMatchObject({ decision: "INVALID", effects: [] });
    }
  });

  test("plans late success through the only public recovery boundary", () => {
    const lateAttempt = paymentAttempt({ status: "UNKNOWN" });
    const state = {
      schemaVersion: 1,
      paymentAttempt: lateAttempt,
      order: orderSubject(),
      cart: {
        schemaVersion: 1,
        id: CART_A,
        orderId: ORDER_A,
        version: 2,
        status: "LOCKED",
      },
      reservations: [
        {
          schemaVersion: 1,
          id: RESERVATION_A,
          orderId: ORDER_A,
          version: 4,
          status: "ACTIVE",
        },
      ],
      fulfillments: [fulfillmentSubject()],
      competingPaymentAttemptIds: [],
    };
    const authority = {
      kind: "PROVIDER_EVENT",
      paymentAttempt: lateAttempt,
      event: providerEvent("PAYMENT_STATUS"),
    };

    const decision = planLatePaymentSuccessCommand({
      schemaVersion: 1,
      state,
      authority,
      auditActor: { kind: "SYSTEM", taskName: "payment-reconcile" },
    });
    expect(decision).toMatchObject({
      decision: "APPLIED",
      subjects: {
        paymentAttempt: { id: PAYMENT_A, expectedVersion: 3 },
        order: { id: ORDER_A, expectedVersion: 7 },
        cart: { id: CART_A, expectedVersion: 2 },
      },
      plan: {
        reservations: [
          {
            id: RESERVATION_A,
            expectedVersion: 4,
            status: "COMMITTED",
          },
        ],
      },
      audit: { providerEventId: "evt_payment_status_1" },
    });
    expect(latePaymentSuccessDecisionSchema.parse(decision)).toEqual(decision);
    expect(JSON.stringify(decision)).not.toContain(
      "ACCEPTED_PROVIDER_EVIDENCE",
    );
  });

  test("routes every provider-confirmed success through the coordinated aggregate planner", () => {
    const unknownAttempt = paymentAttempt({ status: "UNKNOWN" });
    const authority = {
      kind: "PROVIDER_EVENT",
      paymentAttempt: unknownAttempt,
      event: providerEvent("PAYMENT_STATUS"),
    };

    expect(
      decidePaymentAttemptTransitionCommand({
        schemaVersion: 1,
        subject: unknownAttempt,
        expectedVersion: 3,
        target: "SUCCEEDED",
        authority,
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
    });

    expect(
      decidePaymentAttemptTransitionCommand({
        schemaVersion: 1,
        subject: paymentAttempt({ status: "PROCESSING" }),
        expectedVersion: 3,
        target: "SUCCEEDED",
        authority: paymentAuthority(),
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
    });

    expect(
      decideOrderLifecycleTransitionCommand({
        schemaVersion: 1,
        subject: orderSubject(),
        expectedVersion: 7,
        target: "OPEN",
        authority,
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "ORDER_LATE_SUCCESS_PLANNER_REQUIRED",
    });

    expect(
      decideOrderPaymentTransitionCommand({
        schemaVersion: 1,
        subject: orderSubject({ orderStatus: "CANCELED" }),
        expectedVersion: 7,
        target: "PAID",
        authority,
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "ORDER_PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
    });

    expect(
      decideOrderPaymentTransitionCommand({
        schemaVersion: 1,
        subject: orderSubject({ orderStatus: "CANCELED" }),
        expectedVersion: 7,
        target: "PAID",
        authority: paymentAuthority({}, { status: "FAILED" }),
      }),
    ).not.toMatchObject({
      reasonCode: "ORDER_PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
    });

    for (const target of ["CANCELED", "EXPIRED"] as const) {
      const attempt = paymentAttempt({ status: "UNKNOWN" });
      expect(
        decidePaymentAttemptTransitionCommand({
          schemaVersion: 1,
          subject: attempt,
          expectedVersion: 3,
          target,
          authority: {
            kind: "PROVIDER_EVENT",
            paymentAttempt: attempt,
            event: providerEvent("PAYMENT_STATUS", { status: target }),
          },
        }),
      ).toMatchObject({
        decision: "APPLIED",
        from: "UNKNOWN",
        to: target,
        reasonCode: "PAYMENT_PROVIDER_STATUS_CONFIRMED",
      });
    }
  });

  test("does not cancel an order from stale failure evidence after payment succeeded", () => {
    const succeededAttempt = paymentAttempt({ status: "SUCCEEDED" });
    expect(
      decideOrderLifecycleTransitionCommand({
        schemaVersion: 1,
        subject: orderSubject(),
        expectedVersion: 7,
        target: "CANCELED",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: succeededAttempt,
          event: providerEvent("PAYMENT_STATUS", { status: "FAILED" }),
        },
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "ORDER_PROVIDER_EVIDENCE_INVALID",
      orderId: ORDER_A,
      paymentAttemptId: PAYMENT_A,
      expectedVersion: 7,
    });
  });
});
