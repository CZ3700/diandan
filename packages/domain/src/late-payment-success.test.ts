import { describe, expect, test } from "vitest";

import {
  adminIdentityIdSchema,
  inventoryReservationIdSchema,
  latePaymentSuccessDecisionSchema,
  latePaymentSuccessStateSchema,
  paymentAttemptIdSchema,
  providerEventSchema,
  type LatePaymentSuccessAuditActor,
} from "@fan-support/contracts";

import {
  validateProviderEvidence,
  type AcceptedProviderEvidence,
} from "./provider-evidence.js";
import { planLatePaymentSuccess } from "./late-payment-success.js";

const IDS = {
  paymentAttempt: "5ec6cdcb-a13b-4167-a4ec-17c01432fdd2",
  otherPaymentAttempt: "a2f80a06-1c38-4591-a0e7-a86cc00e98ad",
  order: "1ccf12cb-1d43-40ba-b37f-d3c02b48a74d",
  cart: "f2a136de-b233-46b6-bbab-77a5e2778798",
  reservationOne: "5bf0a205-17e0-4ca5-97a7-44037c504c16",
  reservationTwo: "518412da-99b1-4750-ae62-b31432981ec5",
  reservationThree: "1017ea40-c66d-4d7b-975d-2b9b03b6017f",
  reservationFour: "d577622c-6e38-4cae-bbb4-344de33fc6ba",
  fulfillmentOne: "5cd5609d-da46-440d-8402-66992da8e72f",
  fulfillmentTwo: "68ca6222-1cbc-47b4-9679-2b4da6aac911",
  orderItemOne: "9cdb416b-fc0f-4778-a42e-ed853c492d34",
  orderItemTwo: "5f37be7e-4f0f-48d5-8908-87ab039f779d",
  providerAccount: "2d6f6e95-168c-4be6-950e-73d1e33d815b",
  auditLog: "22b9856e-2159-41f1-a15d-aacff253fbef",
  admin: "52156582-6521-472d-89ef-ec72a8ce41c5",
} as const;

const PROVIDER_EVENT_ID = "evt_late_success";
const OTHER_PAYMENT_ATTEMPT_ID = paymentAttemptIdSchema.parse(
  IDS.otherPaymentAttempt,
);
const RESERVATION_THREE_ID = inventoryReservationIdSchema.parse(
  IDS.reservationThree,
);
const RESERVATION_FOUR_ID = inventoryReservationIdSchema.parse(
  IDS.reservationFour,
);
const ADMIN_ID = adminIdentityIdSchema.parse(IDS.admin);

function validatedSuccessEvidence(): Extract<
  AcceptedProviderEvidence,
  { eventType: "PAYMENT_STATUS" }
> {
  const result = validateProviderEvidence(
    {
      eventType: "PAYMENT_STATUS",
      paymentAttemptId: IDS.paymentAttempt,
      providerAccountId: IDS.providerAccount,
      environment: "TEST",
      externalReference: "pay_1",
      amountMinor: 2_500,
      currency: "USD",
    },
    providerEventSchema.parse({
      schemaVersion: 1,
      eventType: "PAYMENT_STATUS",
      providerAccountId: IDS.providerAccount,
      environment: "TEST",
      providerEventId: PROVIDER_EVENT_ID,
      evidence: {
        kind: "AUTHENTICATED_RECONCILE",
        auditLogId: IDS.auditLog,
      },
      occurredAt: "2026-09-03T02:00:00Z",
      association: {
        status: "MATCHED",
        paymentAttemptId: IDS.paymentAttempt,
        externalReference: "pay_1",
      },
      status: "SUCCEEDED",
      amountMinor: 2_500,
      currency: "USD",
    }),
  );
  if (
    result.decision !== "ACCEPTED" ||
    result.evidence.eventType !== "PAYMENT_STATUS"
  ) {
    throw new Error("payment evidence fixture must validate");
  }
  return result.evidence;
}

const successEvidence = validatedSuccessEvidence();

const baseState = latePaymentSuccessStateSchema.parse({
  schemaVersion: 1,
  paymentAttempt: {
    schemaVersion: 1,
    id: IDS.paymentAttempt,
    orderId: IDS.order,
    version: 7,
    status: "UNKNOWN",
    providerAccountId: IDS.providerAccount,
    environment: "TEST",
    externalReference: "pay_1",
    amountMinor: 2_500,
    currency: "USD",
    providerCallStarted: true,
  },
  order: {
    schemaVersion: 1,
    id: IDS.order,
    version: 11,
    orderStatus: "PENDING_PAYMENT",
    paymentStatus: "PENDING",
    currentPaymentAttemptId: IDS.paymentAttempt,
  },
  cart: {
    schemaVersion: 1,
    id: IDS.cart,
    orderId: IDS.order,
    version: 5,
    status: "LOCKED",
  },
  reservations: [
    {
      schemaVersion: 1,
      id: IDS.reservationOne,
      orderId: IDS.order,
      version: 4,
      status: "ACTIVE",
    },
    {
      schemaVersion: 1,
      id: IDS.reservationTwo,
      orderId: IDS.order,
      version: 8,
      status: "COMMITTED",
    },
  ],
  fulfillments: [
    {
      schemaVersion: 1,
      id: IDS.fulfillmentOne,
      orderId: IDS.order,
      orderItemId: IDS.orderItemOne,
      version: 6,
      status: "PENDING",
    },
    {
      schemaVersion: 1,
      id: IDS.fulfillmentTwo,
      orderId: IDS.order,
      orderItemId: IDS.orderItemTwo,
      version: 3,
      status: "PENDING",
    },
  ],
  competingPaymentAttemptIds: [],
});

const [reservationOne, reservationTwo] = baseState.reservations;
const [fulfillmentOne, fulfillmentTwo] = baseState.fulfillments;
if (
  reservationOne === undefined ||
  reservationTwo === undefined ||
  fulfillmentOne === undefined ||
  fulfillmentTwo === undefined
) {
  throw new Error("late payment aggregate fixture must contain all subjects");
}

const baseInput = {
  paymentAttempt: baseState.paymentAttempt,
  order: baseState.order,
  cart: baseState.cart,
  reservations: baseState.reservations,
  fulfillments: baseState.fulfillments,
  competingPaymentAttemptIds: baseState.competingPaymentAttemptIds,
  evidence: successEvidence,
  providerEventId: PROVIDER_EVENT_ID,
  auditActor: {
    kind: "SYSTEM",
    taskName: "payment-reconcile",
  },
} as const;

const expectedSubjects = {
  paymentAttempt: { id: IDS.paymentAttempt, expectedVersion: 7 },
  order: { id: IDS.order, expectedVersion: 11 },
  cart: { id: IDS.cart, expectedVersion: 5 },
  reservations: [
    { id: IDS.reservationOne, expectedVersion: 4 },
    { id: IDS.reservationTwo, expectedVersion: 8 },
  ],
  fulfillments: [
    { id: IDS.fulfillmentOne, expectedVersion: 6 },
    { id: IDS.fulfillmentTwo, expectedVersion: 3 },
  ],
} as const;

describe("late payment success aggregate plan", () => {
  test("plans each subject by ID/version and commits only active reservations", () => {
    const decision = planLatePaymentSuccess(baseInput);

    expect(latePaymentSuccessDecisionSchema.parse(decision)).toEqual({
      schemaVersion: 1,
      decision: "APPLIED",
      reasonCode: "PAYMENT_SUCCESS_RECONCILED",
      subjects: expectedSubjects,
      plan: {
        paymentAttempt: {
          id: IDS.paymentAttempt,
          expectedVersion: 7,
          status: "SUCCEEDED",
        },
        order: {
          id: IDS.order,
          expectedVersion: 11,
          paymentStatus: "PAID",
          orderStatus: "OPEN",
        },
        cart: {
          id: IDS.cart,
          expectedVersion: 5,
          status: "CONVERTED",
        },
        reservations: [
          {
            id: IDS.reservationOne,
            expectedVersion: 4,
            status: "COMMITTED",
            inventoryAction: "COMMIT_RESERVED",
          },
          {
            id: IDS.reservationTwo,
            expectedVersion: 8,
            status: "COMMITTED",
            inventoryAction: "NONE",
          },
        ],
        fulfillments: [
          {
            id: IDS.fulfillmentOne,
            expectedVersion: 6,
            status: "PENDING",
          },
          {
            id: IDS.fulfillmentTwo,
            expectedVersion: 3,
            status: "PENDING",
          },
        ],
      },
      audit: {
        original: baseState,
        providerEventId: PROVIDER_EVENT_ID,
        providerEvidence: successEvidence.evidence,
        actor: baseInput.auditActor,
      },
      effects: [
        { type: "PAYMENT_SUCCEEDED" },
        { type: "ORDER_OPENED" },
        { type: "INVENTORY_RESERVATION_COMMIT_REQUIRED" },
        { type: "AUDIT_REQUIRED" },
      ],
    });
  });

  test("keeps unavailable reservations and puts every fulfillment on hold", () => {
    const reservations = [
      reservationOne,
      { ...reservationTwo, status: "RELEASED" as const },
      {
        ...reservationOne,
        id: RESERVATION_THREE_ID,
        version: 9,
        status: "EXPIRED" as const,
      },
      {
        ...reservationOne,
        id: RESERVATION_FOUR_ID,
        version: 10,
        status: "COMMITTED" as const,
      },
    ];

    const decision = planLatePaymentSuccess({
      ...baseInput,
      order: { ...baseInput.order, orderStatus: "CANCELED" },
      reservations,
      fulfillments: [fulfillmentOne, { ...fulfillmentTwo, status: "ON_HOLD" }],
    });

    expect(decision).toMatchObject({
      decision: "APPLIED",
      reasonCode: "LATE_PAYMENT_INVENTORY_UNAVAILABLE",
      plan: {
        reservations: [
          {
            id: IDS.reservationOne,
            status: "COMMITTED",
            inventoryAction: "COMMIT_RESERVED",
          },
          {
            id: IDS.reservationTwo,
            status: "RELEASED",
            inventoryAction: "NONE",
          },
          {
            id: IDS.reservationThree,
            status: "EXPIRED",
            inventoryAction: "NONE",
          },
          {
            id: IDS.reservationFour,
            status: "COMMITTED",
            inventoryAction: "NONE",
          },
        ],
        fulfillments: [
          { id: IDS.fulfillmentOne, status: "ON_HOLD" },
          { id: IDS.fulfillmentTwo, status: "ON_HOLD" },
        ],
      },
      effects: [
        { type: "PAYMENT_SUCCEEDED" },
        { type: "ORDER_OPENED" },
        { type: "INVENTORY_RESERVATION_COMMIT_REQUIRED" },
        { type: "FULFILLMENT_REVIEW_REQUIRED" },
        { type: "AUDIT_REQUIRED" },
      ],
    });
    expect(latePaymentSuccessDecisionSchema.safeParse(decision).success).toBe(
      true,
    );
  });

  test("returns subject-bound NOOP without recommitting inventory", () => {
    const decision = planLatePaymentSuccess({
      ...baseInput,
      paymentAttempt: { ...baseInput.paymentAttempt, status: "SUCCEEDED" },
      order: {
        ...baseInput.order,
        orderStatus: "OPEN",
        paymentStatus: "PAID",
      },
      cart: { ...baseInput.cart, status: "CONVERTED" },
      reservations: baseInput.reservations.map((reservation) => ({
        ...reservation,
        status: "COMMITTED" as const,
      })),
    });

    expect(decision).toEqual({
      schemaVersion: 1,
      decision: "NOOP",
      reasonCode: "ALREADY_APPLIED",
      subjects: expectedSubjects,
      effects: [],
    });
    expect(latePaymentSuccessDecisionSchema.safeParse(decision).success).toBe(
      true,
    );
  });

  test("does not request another inventory commit when every reservation is committed", () => {
    const decision = planLatePaymentSuccess({
      ...baseInput,
      reservations: baseInput.reservations.map((reservation) => ({
        ...reservation,
        status: "COMMITTED" as const,
      })),
    });

    expect(decision).toMatchObject({
      decision: "APPLIED",
      plan: {
        reservations: [
          { id: IDS.reservationOne, inventoryAction: "NONE" },
          { id: IDS.reservationTwo, inventoryAction: "NONE" },
        ],
      },
    });
    expect(decision.effects).not.toContainEqual({
      type: "INVENTORY_RESERVATION_COMMIT_REQUIRED",
    });
    expect(latePaymentSuccessDecisionSchema.safeParse(decision).success).toBe(
      true,
    );
  });

  test("fails closed on terminal attempts and competing attempts with subjects", () => {
    for (const status of ["FAILED", "CANCELED", "EXPIRED"] as const) {
      expect(
        planLatePaymentSuccess({
          ...baseInput,
          paymentAttempt: { ...baseInput.paymentAttempt, status },
        }),
      ).toEqual({
        schemaVersion: 1,
        decision: "CONFLICT",
        reasonCode: "LATE_SUCCESS_PAYMENT_TERMINAL_CONFLICT",
        subjects: expectedSubjects,
        effects: [],
      });
    }

    expect(
      planLatePaymentSuccess({
        ...baseInput,
        competingPaymentAttemptIds: [OTHER_PAYMENT_ATTEMPT_ID],
      }),
    ).toEqual({
      schemaVersion: 1,
      decision: "CONFLICT",
      reasonCode: "LATE_SUCCESS_SECOND_ATTEMPT_CONFLICT",
      subjects: expectedSubjects,
      effects: [],
    });
  });

  test("rejects mismatched, copied, or differently referenced evidence", () => {
    for (const input of [
      { ...baseInput, providerEventId: "evt_other" },
      {
        ...baseInput,
        paymentAttempt: {
          ...baseInput.paymentAttempt,
          id: OTHER_PAYMENT_ATTEMPT_ID,
        },
      },
      {
        ...baseInput,
        evidence: JSON.parse(
          JSON.stringify(successEvidence),
        ) as typeof successEvidence,
      },
    ]) {
      expect(planLatePaymentSuccess(input)).toMatchObject({
        schemaVersion: 1,
        decision: "REJECTED",
        reasonCode: "LATE_SUCCESS_TRUSTED_EVIDENCE_REQUIRED",
        effects: [],
      });
    }
  });

  test("rejects invalid aggregate states and contradictory fulfillment states", () => {
    for (const input of [
      {
        ...baseInput,
        order: { ...baseInput.order, orderStatus: "DRAFT" as const },
      },
      {
        ...baseInput,
        order: { ...baseInput.order, paymentStatus: "REFUNDED" as const },
      },
      { ...baseInput, cart: { ...baseInput.cart, status: "ACTIVE" as const } },
    ]) {
      expect(planLatePaymentSuccess(input)).toMatchObject({
        decision: "REJECTED",
        reasonCode: "LATE_SUCCESS_ORDER_STATE_INVALID",
        subjects: expectedSubjects,
        effects: [],
      });
    }

    for (const input of [
      {
        ...baseInput,
        fulfillments: [
          { ...fulfillmentOne, status: "PREPARING" as const },
          fulfillmentTwo,
        ],
      },
      {
        ...baseInput,
        reservations: [
          { ...reservationOne, status: "RELEASED" as const },
          reservationTwo,
        ],
        fulfillments: [
          { ...fulfillmentOne, status: "DELIVERED" as const },
          fulfillmentTwo,
        ],
      },
    ]) {
      expect(planLatePaymentSuccess(input)).toMatchObject({
        decision: "CONFLICT",
        reasonCode: "LATE_SUCCESS_FULFILLMENT_STATE_CONFLICT",
        subjects: expectedSubjects,
        effects: [],
      });
    }
  });

  test("validates the audit actor before planning mutations", () => {
    for (const auditActor of [
      { kind: "SYSTEM" as const, taskName: "" },
      { kind: "SYSTEM" as const, taskName: "Payment Reconcile" },
      { kind: "ADMIN" as const, adminIdentityId: "not-an-admin-id" },
    ]) {
      expect(
        planLatePaymentSuccess({
          ...baseInput,
          auditActor: auditActor as unknown as LatePaymentSuccessAuditActor,
        }),
      ).toMatchObject({
        decision: "REJECTED",
        reasonCode: "LATE_SUCCESS_AUDIT_ACTOR_INVALID",
        subjects: expectedSubjects,
        effects: [],
      });
    }

    expect(
      planLatePaymentSuccess({
        ...baseInput,
        auditActor: { kind: "ADMIN", adminIdentityId: ADMIN_ID },
      }).decision,
    ).toBe("APPLIED");
  });
});
