import { describe, expect, test } from "vitest";

import {
  createTransitionDecisionSchema,
  decideIdempotencyInputSchema,
  disputeTransitionCommandSchema,
  disputeTransitionDecisionSchema,
  fixedPaymentAttemptRouteSchema,
  fulfillmentTransitionCommandSchema,
  fulfillmentTransitionDecisionSchema,
  giftEligibilityDecisionSchema,
  giftEligibilityInputSchema,
  idempotencyDecisionSchema,
  idempotencyRecordSchema,
  inventoryReservationCreationDecisionSchema,
  inventoryReservationCreationInputSchema,
  inventoryReservationTransitionDecisionSchema,
  inventoryReservationTransitionInputSchema,
  lineAmountCalculationDecisionSchema,
  lineAmountCalculationInputSchema,
  latePaymentSuccessCommandSchema,
  latePaymentSuccessDecisionSchema,
  orderAmountCalculationDecisionSchema,
  orderAmountCalculationInputSchema,
  orderLifecycleTransitionCommandSchema,
  orderLifecycleTransitionDecisionSchema,
  orderPaymentTransitionCommandSchema,
  orderPaymentTransitionDecisionSchema,
  paymentAttemptTransitionCommandSchema,
  paymentAttemptTransitionDecisionSchema,
  paymentRouteDecisionSchema,
  paymentRouteRuleSchema,
  priceSelectionDecisionSchema,
  priceSelectionInputSchema,
  providerEventAuthoritySchema,
  providerEvidenceTargetSchema,
  publishedPaymentRouteRuleSetSchema,
  refundCapacityDecisionSchema,
  refundCapacityInputSchema,
  refundTransitionCommandSchema,
  refundTransitionDecisionSchema,
  selectPaymentRouteInputSchema,
} from "./domain-rules.js";
import { paymentAttemptStatusSchema } from "./payment.js";

const IDS = {
  cart: "77777777-7777-4777-8777-777777777777",
  cartItem: "c0d51f36-f139-4fd7-9205-fb6d9db1666e",
  checkoutQuote: "dc7db228-5757-42a8-af9e-c610bc80ea55",
  dispute: "99999999-9999-4999-8999-999999999999",
  fulfillment: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  admin: "9f32d43f-1814-435a-8752-e681d360a6d3",
  auditLog: "22b9856e-2159-41f1-a15d-aacff253fbef",
  gift: "7fd728b5-4304-4de8-bd09-f62f315b4a0c",
  giftRevision: "e7816b86-83b2-443f-ab50-f2503771e5c7",
  inventoryItem: "0b91add0-e78b-4898-8b3d-3ab50c50a9dc",
  inventoryLocation: "88aab92a-fd64-43f1-8f59-15a4e4cb6dce",
  inventoryReservation: "fc2bdc97-5cd3-4584-9215-fb13476aa83c",
  idol: "c24a7022-5ab1-4fe6-bc3e-c69f4fa7af7a",
  idolRevision: "f0546030-a4ec-4f47-a28e-d743ad6f4293",
  paymentAttempt: "22222222-2222-4222-8222-222222222222",
  otherPaymentAttempt: "66666666-6666-4666-8666-666666666666",
  order: "44444444-4444-4444-8444-444444444444",
  orderItem: "55555555-5555-4555-8555-555555555555",
  price: "ec4caf66-6e49-4112-876a-11e405b89cc7",
  priceBook: "33650349-95d0-43df-9c85-9dcb486c35c7",
  provider: "00000000-0000-4000-8000-0000000000a1",
  refund: "88888888-8888-4888-8888-888888888888",
  variant: "9fa44c67-1a8e-45e9-afc2-887f0422cc8e",
  webhookInbox: "f219e263-c97d-4249-94ed-7c5473020cca",
} as const;

const routeRule = {
  schemaVersion: 1,
  id: "route-primary",
  providerAccountId: IDS.provider,
  paymentMethod: "card",
  enabled: true,
  countries: ["US"],
  markets: ["AMERICAS"],
  currencies: ["USD"],
  minimumAmountMinor: 100,
  maximumAmountMinor: 100_000,
  requiredDeviceCapabilities: ["REDIRECT"],
  priority: 100,
} as const;

const routeInput = {
  schemaVersion: 1,
  context: {
    schemaVersion: 1,
    country: "US",
    market: "AMERICAS",
    currency: "USD",
    amountMinor: 5_000,
    deviceCapabilities: ["REDIRECT"],
  },
  publishedRuleSet: {
    schemaVersion: 1,
    status: "PUBLISHED",
    ruleVersion: 7,
    rules: [routeRule],
  },
  providerHealth: [
    {
      schemaVersion: 1,
      providerAccountId: IDS.provider,
      status: "HEALTHY",
    },
  ],
} as const;

const quoteLine = {
  schemaVersion: 1,
  cartItemId: IDS.cartItem,
  giftVariantId: IDS.variant,
  priceId: IDS.price,
  priceRevision: 2,
  quantity: 2,
  unitAmountMinor: 1_000,
  lineSubtotalMinor: 2_000,
  taxAmountMinor: 100,
  discountAmountMinor: 50,
  lineTotalMinor: 2_050,
  currency: "USD",
} as const;

const priceBook = {
  schemaVersion: 1,
  id: IDS.priceBook,
  revision: 4,
  market: "AMERICAS",
  currency: "USD",
  status: "PUBLISHED",
  validFrom: "2026-09-03T00:00:00Z",
  validUntil: "2026-10-03T00:00:00Z",
} as const;

const price = {
  schemaVersion: 1,
  id: IDS.price,
  revision: 2,
  priceBookId: IDS.priceBook,
  priceBookRevision: 4,
  giftVariantId: IDS.variant,
  unitAmountMinor: 2_500,
  validFrom: "2026-09-03T00:00:00Z",
  validUntil: "2026-10-03T00:00:00Z",
} as const;

const inventoryItem = {
  schemaVersion: 1,
  id: IDS.inventoryItem,
  giftVariantId: IDS.variant,
  sku: "AURORA-KEEPSAKE-01",
  policy: "TRACKED",
  status: "ACTIVE",
} as const;

const inventoryBalance = {
  schemaVersion: 1,
  inventoryItemId: IDS.inventoryItem,
  inventoryLocationId: IDS.inventoryLocation,
  onHand: 10,
  reserved: 2,
  version: 7,
} as const;

const inventoryReservation = {
  schemaVersion: 1,
  id: IDS.inventoryReservation,
  checkoutQuoteId: IDS.checkoutQuote,
  cartItemId: IDS.cartItem,
  giftVariantId: IDS.variant,
  inventoryLocationId: IDS.inventoryLocation,
  quantity: 3,
  status: "ACTIVE",
  expiresAt: "2026-09-03T01:00:00Z",
  version: 4,
} as const;

const paymentAttemptSubject = {
  schemaVersion: 1,
  id: IDS.paymentAttempt,
  orderId: IDS.order,
  version: 7,
  status: "PROCESSING",
  providerAccountId: IDS.provider,
  environment: "TEST",
  externalReference: "pay_1",
  amountMinor: 2_500,
  currency: "USD",
  providerCallStarted: true,
} as const;

const paymentEvidenceTarget = {
  schemaVersion: 1,
  eventType: "PAYMENT_STATUS",
  paymentAttempt: paymentAttemptSubject,
} as const;

const refundEvidenceTarget = {
  schemaVersion: 1,
  eventType: "REFUND_STATUS",
  paymentAttempt: { ...paymentAttemptSubject, status: "SUCCEEDED" },
  providerReference: "refund_1",
} as const;

const disputeEvidenceTarget = {
  schemaVersion: 1,
  eventType: "DISPUTE_STATUS",
  paymentAttempt: { ...paymentAttemptSubject, status: "SUCCEEDED" },
  providerReference: "dispute_1",
} as const;

const providerEventBase = {
  schemaVersion: 1,
  providerAccountId: IDS.provider,
  environment: "TEST",
  evidence: {
    kind: "VERIFIED_WEBHOOK",
    webhookInboxId: IDS.webhookInbox,
  },
  occurredAt: "2026-09-03T02:00:00Z",
  association: {
    status: "MATCHED",
    paymentAttemptId: IDS.paymentAttempt,
    externalReference: "pay_1",
  },
} as const;

const paymentSuccessEvent = {
  ...providerEventBase,
  eventType: "PAYMENT_STATUS",
  providerEventId: "evt_payment_success",
  status: "SUCCEEDED",
  amountMinor: 2_500,
  currency: "USD",
} as const;

const refundSuccessEvent = {
  ...providerEventBase,
  eventType: "REFUND_STATUS",
  providerEventId: "evt_refund_success",
  refundReference: "refund_1",
  status: "SUCCEEDED",
  amountMinor: 1_000,
  currency: "USD",
} as const;

const disputeOpenEvent = {
  ...providerEventBase,
  eventType: "DISPUTE_STATUS",
  providerEventId: "evt_dispute_open",
  disputeReference: "dispute_1",
  status: "OPEN",
  amountMinor: 2_500,
  currency: "USD",
} as const;

describe("payment-routing domain contracts", () => {
  test("accepts only versioned strict input without locale", () => {
    expect(selectPaymentRouteInputSchema.safeParse(routeInput).success).toBe(
      true,
    );
    expect(
      selectPaymentRouteInputSchema.safeParse({ ...routeInput, locale: "en" })
        .success,
    ).toBe(false);
    expect(
      selectPaymentRouteInputSchema.safeParse({
        ...routeInput,
        context: {
          ...routeInput.context,
          deviceCapabilities: ["WAIT"],
        },
      }).success,
    ).toBe(false);
  });

  test("rejects inverted amount ranges and unsafe priorities", () => {
    expect(
      paymentRouteRuleSchema.safeParse({
        ...routeRule,
        minimumAmountMinor: 101,
        maximumAmountMinor: 100,
      }).success,
    ).toBe(false);
    expect(
      paymentRouteRuleSchema.safeParse({
        ...routeRule,
        priority: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
  });

  test("freezes positive rule versions and only pins non-terminal attempts", () => {
    expect(
      publishedPaymentRouteRuleSetSchema.safeParse({
        ...routeInput.publishedRuleSet,
        ruleVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      fixedPaymentAttemptRouteSchema.safeParse({
        schemaVersion: 1,
        status: "UNKNOWN",
        providerAccountId: IDS.provider,
        paymentMethod: "card",
        ruleVersion: 4,
      }).success,
    ).toBe(true);
    expect(
      fixedPaymentAttemptRouteSchema.safeParse({
        schemaVersion: 1,
        status: "FAILED",
        providerAccountId: IDS.provider,
        paymentMethod: "card",
        ruleVersion: 4,
      }).success,
    ).toBe(false);
  });

  test.each(["NO_ELIGIBLE_ROUTE", "INVALID_ROUTING_INPUT"] as const)(
    "accepts the %s fail-closed decision",
    (reason) => {
      expect(
        paymentRouteDecisionSchema.safeParse({
          schemaVersion: 1,
          kind: "UNAVAILABLE",
          reason,
        }).success,
      ).toBe(true);
    },
  );
});

describe("idempotency domain contracts", () => {
  const request = {
    schemaVersion: 1,
    actor: "cart:opaque-actor",
    operation: "checkout.create",
    key: "idempotency-key-0001",
    canonicalRequestHash: "sha256:request-a",
  } as const;

  test("models in-progress and finished records without raw payloads", () => {
    expect(
      idempotencyRecordSchema.safeParse({
        ...request,
        status: "IN_PROGRESS",
        expiresAt: "2026-09-03T04:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      idempotencyRecordSchema.safeParse({
        ...request,
        status: "SUCCEEDED",
        safeResultRef: "order:public-safe-reference",
        expiresAt: "2026-09-03T04:00:00Z",
        rawRequest: { fanMessage: "private" },
      }).success,
    ).toBe(false);
  });

  test("requires canonical timestamps and controlled non-empty fields", () => {
    expect(
      decideIdempotencyInputSchema.safeParse({
        schemaVersion: 1,
        evaluatedAt: "not-a-timestamp",
        request,
        existingRecord: null,
      }).success,
    ).toBe(false);
    expect(
      decideIdempotencyInputSchema.safeParse({
        schemaVersion: 1,
        evaluatedAt: "2026-09-03T03:00:00Z",
        request: { ...request, actor: "   " },
        existingRecord: null,
      }).success,
    ).toBe(false);
  });

  test("accepts replay and fail-closed invalid-input decisions", () => {
    expect(
      idempotencyDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "REPLAY",
        status: "SUCCEEDED",
        safeResultRef: "order:public-safe-reference",
      }).success,
    ).toBe(true);
    expect(
      idempotencyDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "INVALID",
        reason: "INVALID_TIMESTAMP",
      }).success,
    ).toBe(true);
    expect(
      idempotencyDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "INVALID",
        reason: "INVALID_IDEMPOTENCY_INPUT",
      }).success,
    ).toBe(true);
  });
});

describe("money domain contracts", () => {
  test("requires safe minor-unit line inputs and strict calculated decisions", () => {
    expect(
      lineAmountCalculationInputSchema.safeParse({
        schemaVersion: 1,
        unitAmountMinor: 1_250,
        quantity: 2,
        taxAmountMinor: 100,
        discountAmountMinor: 50,
      }).success,
    ).toBe(true);
    expect(
      lineAmountCalculationDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "CALCULATED",
        lineSubtotalMinor: 2_500,
        lineTotalMinor: 2_550,
      }).success,
    ).toBe(true);
    expect(
      lineAmountCalculationInputSchema.safeParse({
        schemaVersion: 1,
        unitAmountMinor: Number.MAX_SAFE_INTEGER + 1,
        quantity: 1,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
      }).success,
    ).toBe(false);
  });

  test("extends every checkout quote line with an independent currency", () => {
    const input = {
      schemaVersion: 1,
      currency: "USD",
      lines: [quoteLine],
      shippingAmountMinor: 0,
      feeAmountMinor: 0,
    };
    expect(orderAmountCalculationInputSchema.safeParse(input).success).toBe(
      true,
    );
    const lineWithoutCurrency = Object.fromEntries(
      Object.entries(quoteLine).filter(([key]) => key !== "currency"),
    );
    expect(
      orderAmountCalculationInputSchema.safeParse({
        ...input,
        lines: [lineWithoutCurrency],
      }).success,
    ).toBe(false);
    expect(
      orderAmountCalculationDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "CURRENCY_MISMATCH",
      }).success,
    ).toBe(true);
  });
});

describe("commerce-rule composite contracts", () => {
  test("parses price selection input and both decision variants", () => {
    expect(
      priceSelectionInputSchema.safeParse({
        schemaVersion: 1,
        evaluatedAt: "2026-09-15T00:00:00Z",
        market: "AMERICAS",
        currency: "USD",
        giftVariantId: IDS.variant,
        priceBooks: [priceBook],
        prices: [price],
      }).success,
    ).toBe(true);
    expect(
      priceSelectionDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "SELECTED",
        priceId: IDS.price,
        priceRevision: 2,
        priceBookId: IDS.priceBook,
        priceBookRevision: 4,
        unitAmountMinor: 2_500,
      }).success,
    ).toBe(true);
    expect(
      priceSelectionDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "PRICE_AMBIGUOUS",
      }).success,
    ).toBe(true);
  });

  test("parses explicit gift eligibility input and decisions", () => {
    const input = {
      schemaVersion: 1,
      gift: {
        schemaVersion: 1,
        id: IDS.gift,
        handle: "celebration-bouquet",
        status: "active",
        draftRevisionId: null,
        publishedRevisionId: IDS.giftRevision,
        version: 3,
      },
      variant: {
        schemaVersion: 1,
        id: IDS.variant,
        giftId: IDS.gift,
        sku: "CELEBRATION-01",
        status: "active",
        inventoryPolicy: "TRACKED",
      },
      idol: {
        schemaVersion: 1,
        id: IDS.idol,
        handle: "idol-one",
        status: "active",
        acceptingGifts: true,
        draftRevisionId: null,
        publishedRevisionId: IDS.idolRevision,
        version: 2,
      },
      eligibility: [
        {
          schemaVersion: 1,
          giftVariantId: IDS.variant,
          idolId: IDS.idol,
          eligible: true,
        },
      ],
    } as const;
    expect(giftEligibilityInputSchema.safeParse(input).success).toBe(true);
    expect(
      giftEligibilityDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "ELIGIBILITY_MISSING",
      }).success,
    ).toBe(true);
  });

  test("keeps inventory creation and transition plans separate", () => {
    const creationInput = {
      schemaVersion: 1,
      inventoryItem,
      inventoryLocation: {
        schemaVersion: 1,
        id: IDS.inventoryLocation,
        code: "PRIMARY",
        status: "ACTIVE",
      },
      balance: inventoryBalance,
      reservation: inventoryReservation,
      existingReservation: null,
      evaluatedAt: "2026-09-03T00:00:00Z",
    } as const;
    expect(
      inventoryReservationCreationInputSchema.safeParse(creationInput).success,
    ).toBe(true);
    expect(
      inventoryReservationTransitionInputSchema.safeParse({
        schemaVersion: 1,
        inventoryItem,
        balance: { ...inventoryBalance, reserved: 5 },
        reservation: inventoryReservation,
        targetStatus: "COMMITTED",
        evaluatedAt: "2026-09-03T01:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      inventoryReservationCreationDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "INSUFFICIENT_INVENTORY",
      }).success,
    ).toBe(true);
    expect(
      inventoryReservationTransitionDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "REPLAY",
        inventoryItem,
        inventoryItemId: IDS.inventoryItem,
        inventoryLocationId: IDS.inventoryLocation,
        reservationId: IDS.inventoryReservation,
        reservation: {
          ...inventoryReservation,
          status: "COMMITTED",
          version: 5,
        },
      }).success,
    ).toBe(true);
  });

  test("binds inventory decision identities, versions, and ledger arithmetic", () => {
    const creationDecision = {
      schemaVersion: 1,
      kind: "APPLY",
      inventoryItem,
      inventoryItemId: IDS.inventoryItem,
      inventoryLocationId: IDS.inventoryLocation,
      reservationId: IDS.inventoryReservation,
      expectedBalanceVersion: 7,
      expectedReservationAbsent: true,
      previousBalance: inventoryBalance,
      nextBalance: { ...inventoryBalance, reserved: 5, version: 8 },
      nextReservation: inventoryReservation,
      ledgerDelta: { deltaOnHand: 0, deltaReserved: 3 },
      reasonCode: "RESERVATION_CREATED",
    } as const;
    expect(
      inventoryReservationCreationDecisionSchema.safeParse(creationDecision)
        .success,
    ).toBe(true);
    for (const tampered of [
      { ...creationDecision, inventoryItemId: IDS.gift },
      { ...creationDecision, inventoryLocationId: IDS.idol },
      { ...creationDecision, expectedBalanceVersion: 6 },
      {
        ...creationDecision,
        nextBalance: { ...creationDecision.nextBalance, reserved: 6 },
      },
      {
        ...creationDecision,
        ledgerDelta: { ...creationDecision.ledgerDelta, deltaReserved: 2 },
      },
      {
        ...creationDecision,
        nextReservation: {
          ...creationDecision.nextReservation,
          giftVariantId: IDS.gift,
        },
      },
      {
        ...creationDecision,
        nextReservation: {
          ...creationDecision.nextReservation,
          id: IDS.refund,
        },
      },
    ]) {
      expect(
        inventoryReservationCreationDecisionSchema.safeParse(tampered).success,
      ).toBe(false);
    }

    const transitionDecision = {
      schemaVersion: 1,
      kind: "APPLY",
      inventoryItem,
      inventoryItemId: IDS.inventoryItem,
      inventoryLocationId: IDS.inventoryLocation,
      reservationId: IDS.inventoryReservation,
      expectedBalanceVersion: 7,
      expectedReservationVersion: 4,
      previousBalance: { ...inventoryBalance, reserved: 5 },
      previousReservation: inventoryReservation,
      nextBalance: {
        ...inventoryBalance,
        onHand: 7,
        reserved: 2,
        version: 8,
      },
      nextReservation: {
        ...inventoryReservation,
        status: "COMMITTED",
        version: 5,
      },
      ledgerDelta: { deltaOnHand: -3, deltaReserved: -3 },
      reasonCode: "RESERVATION_COMMITTED",
    } as const;
    expect(
      inventoryReservationTransitionDecisionSchema.safeParse(transitionDecision)
        .success,
    ).toBe(true);
    for (const tampered of [
      { ...transitionDecision, inventoryItemId: IDS.gift },
      { ...transitionDecision, inventoryLocationId: IDS.idol },
      { ...transitionDecision, reservationId: IDS.refund },
      { ...transitionDecision, expectedReservationVersion: 3 },
      {
        ...transitionDecision,
        nextBalance: { ...transitionDecision.nextBalance, onHand: 8 },
      },
      {
        ...transitionDecision,
        nextReservation: {
          ...transitionDecision.nextReservation,
          status: "RELEASED",
        },
      },
      {
        ...transitionDecision,
        ledgerDelta: { deltaOnHand: 0, deltaReserved: -3 },
      },
      {
        ...transitionDecision,
        previousReservation: {
          ...transitionDecision.previousReservation,
          giftVariantId: IDS.gift,
        },
        nextReservation: {
          ...transitionDecision.nextReservation,
          giftVariantId: IDS.gift,
        },
      },
      {
        ...transitionDecision,
        previousReservation: {
          ...transitionDecision.previousReservation,
          id: IDS.refund,
        },
        nextReservation: {
          ...transitionDecision.nextReservation,
          id: IDS.refund,
        },
      },
    ]) {
      expect(
        inventoryReservationTransitionDecisionSchema.safeParse(tampered)
          .success,
      ).toBe(false);
    }

    expect(
      inventoryReservationTransitionDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "REPLAY",
        inventoryItem,
        inventoryItemId: IDS.inventoryItem,
        inventoryLocationId: IDS.idol,
        reservation: inventoryReservation,
      }).success,
    ).toBe(false);
  });

  test("parses refund capacity input and exact capacity rejection", () => {
    const refund = {
      schemaVersion: 1,
      id: IDS.refund,
      orderId: IDS.order,
      paymentAttemptId: IDS.paymentAttempt,
      version: 3,
      status: "REQUESTED",
      providerReference: "refund_1",
      capturedCurrency: "USD",
      capturedAmountMinor: 2_500,
      requestedAmountMinor: 2_000,
      currency: "USD",
    } as const;
    expect(
      refundCapacityInputSchema.safeParse({
        schemaVersion: 1,
        order: {
          schemaVersion: 1,
          id: IDS.order,
          version: 11,
          orderStatus: "OPEN",
          paymentStatus: "PAID",
          currentPaymentAttemptId: IDS.paymentAttempt,
        },
        paymentAttempt: {
          ...paymentAttemptSubject,
          status: "SUCCEEDED",
        },
        refund,
        refunds: [{ ...refund, processedAmountMinor: 0 }],
      }).success,
    ).toBe(true);
    expect(
      refundCapacityInputSchema.safeParse({
        schemaVersion: 1,
        order: {
          schemaVersion: 1,
          id: IDS.order,
          version: 11,
          orderStatus: "OPEN",
          paymentStatus: "PAID",
          currentPaymentAttemptId: IDS.paymentAttempt,
        },
        paymentAttempt: {
          ...paymentAttemptSubject,
          status: "SUCCEEDED",
        },
        refund,
        refunds: [
          { ...refund, processedAmountMinor: 0 },
          {
            ...refund,
            id: IDS.dispute,
            version: 4,
            status: "UNKNOWN",
            providerReference: "refund_other",
            requestedAmountMinor: 500,
            currency: "EUR",
            processedAmountMinor: 0,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      refundCapacityDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "REFUND_CAPACITY_EXCEEDED",
        refundId: IDS.refund,
        orderId: IDS.order,
        paymentAttemptId: IDS.paymentAttempt,
        refundExpectedVersion: 3,
        orderExpectedVersion: 11,
        paymentAttemptExpectedVersion: 7,
        capturedCurrency: "USD",
        capturedAmountMinor: 2_500,
        requestedCurrency: "USD",
        requestedAmountMinor: 2_000,
        occupiedAmountMinor: 3_000,
        availableAmountMinor: 0,
      }).success,
    ).toBe(true);
    expect(
      refundCapacityDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "REFUND_DATA_INVALID",
        availableAmountMinor: 1,
      }).success,
    ).toBe(false);
  });
});

test("transition decision factory enforces strict state-aware variants", () => {
  const schema = createTransitionDecisionSchema(paymentAttemptStatusSchema);
  expect(
    schema.safeParse({
      schemaVersion: 1,
      decision: "APPLIED",
      from: "CREATED",
      to: "PROCESSING",
      reasonCode: "PAYMENT_CREATE_RESULT_RECORDED",
      effects: [{ type: "PAYMENT_STATUS_CHANGED" }],
    }).success,
  ).toBe(true);
  expect(
    schema.safeParse({
      schemaVersion: 1,
      decision: "NOOP",
      from: "CREATED",
      to: "PROCESSING",
      reasonCode: "ALREADY_APPLIED",
      effects: [],
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      schemaVersion: 1,
      decision: "REJECTED",
      from: "CREATED",
      to: "SUCCEEDED",
      reasonCode: "PAYMENT_PROVIDER_EVIDENCE_REQUIRED",
      effects: [{ type: "PAYMENT_SUCCEEDED" }],
    }).success,
  ).toBe(false);
});

describe("provider event command boundary", () => {
  test("requires event-specific target identities and provider references", () => {
    expect(
      providerEvidenceTargetSchema.safeParse(paymentEvidenceTarget).success,
    ).toBe(true);
    expect(
      providerEvidenceTargetSchema.safeParse(refundEvidenceTarget).success,
    ).toBe(true);
    expect(
      providerEvidenceTargetSchema.safeParse({
        ...refundEvidenceTarget,
        providerReference: "",
      }).success,
    ).toBe(false);
    const refundWithoutReference = Object.fromEntries(
      Object.entries(refundEvidenceTarget).filter(
        ([key]) => key !== "providerReference",
      ),
    );
    expect(
      providerEvidenceTargetSchema.safeParse(refundWithoutReference).success,
    ).toBe(false);
    expect(
      providerEvidenceTargetSchema.safeParse({
        ...disputeEvidenceTarget,
        paymentAttempt: {
          ...disputeEvidenceTarget.paymentAttempt,
          id: "not-an-attempt-id",
        },
      }).success,
    ).toBe(false);
  });

  test("accepts a matching raw event and rejects cross-event or unknown fields", () => {
    expect(
      providerEventAuthoritySchema.safeParse({
        kind: "PROVIDER_EVENT",
        paymentAttempt: paymentAttemptSubject,
        event: paymentSuccessEvent,
      }).success,
    ).toBe(true);
    expect(
      paymentAttemptTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: {
          ...paymentAttemptSubject,
          providerCallStarted: false,
          externalReference: undefined,
        },
        expectedVersion: 7,
        target: "SUCCEEDED",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: {
            ...paymentAttemptSubject,
            providerCallStarted: true,
            externalReference: undefined,
          },
          event: paymentSuccessEvent,
        },
      }).success,
    ).toBe(false);
    expect(
      providerEventAuthoritySchema.safeParse({
        kind: "PROVIDER_EVENT",
        paymentAttempt: {
          ...paymentAttemptSubject,
          id: IDS.otherPaymentAttempt,
        },
        event: paymentSuccessEvent,
      }).success,
    ).toBe(false);
    expect(
      providerEventAuthoritySchema.safeParse({
        kind: "PROVIDER_EVENT",
        paymentAttempt: paymentAttemptSubject,
        providerReference: "refund_other",
        event: refundSuccessEvent,
      }).success,
    ).toBe(false);
    expect(
      providerEventAuthoritySchema.safeParse({
        kind: "PROVIDER_EVENT",
        paymentAttempt: paymentAttemptSubject,
        event: refundSuccessEvent,
      }).success,
    ).toBe(false);
    expect(
      providerEventAuthoritySchema.safeParse({
        kind: "PROVIDER_EVENT",
        paymentAttempt: paymentAttemptSubject,
        event: paymentSuccessEvent,
        acceptedEvidence: "opaque-runtime-token",
      }).success,
    ).toBe(false);
  });
});

describe("state-machine command contracts", () => {
  const paymentProviderAuthority = {
    kind: "PROVIDER_EVENT",
    paymentAttempt: paymentAttemptSubject,
    event: paymentSuccessEvent,
  } as const;
  const orderSubject = {
    schemaVersion: 1,
    id: IDS.order,
    version: 3,
    orderStatus: "PENDING_PAYMENT",
    paymentStatus: "PENDING",
    currentPaymentAttemptId: IDS.paymentAttempt,
  } as const;
  const capturedPaymentAttempt = {
    ...paymentAttemptSubject,
    status: "SUCCEEDED",
  } as const;
  const capturedOrderSubject = {
    ...orderSubject,
    orderStatus: "OPEN",
    paymentStatus: "PAID",
  } as const;

  test("models payment commands and rejects invalid audited cancellation", () => {
    expect(
      paymentAttemptTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: paymentAttemptSubject,
        expectedVersion: 7,
        target: "SUCCEEDED",
        authority: paymentProviderAuthority,
      }).success,
    ).toBe(true);
    expect(
      paymentAttemptTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: paymentAttemptSubject,
        expectedVersion: 7,
        target: "SUCCEEDED",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: paymentAttemptSubject,
          providerReference: "refund_1",
          event: refundSuccessEvent,
        },
      }).success,
    ).toBe(false);

    for (const authority of [
      {
        kind: "AUDITED_BUSINESS_CANCEL",
        auditLogId: "not-an-audit-id",
        reasonCode: "CUSTOMER_REQUESTED_CANCEL",
      },
      {
        kind: "AUDITED_BUSINESS_CANCEL",
        auditLogId: IDS.auditLog,
        reasonCode: "",
      },
      {
        kind: "AUDITED_BUSINESS_CANCEL",
        auditLogId: IDS.auditLog,
        reasonCode: "customer requested cancel",
      },
    ]) {
      expect(
        paymentAttemptTransitionCommandSchema.safeParse({
          schemaVersion: 1,
          subject: {
            ...paymentAttemptSubject,
            status: "CREATED",
            providerCallStarted: false,
          },
          expectedVersion: 7,
          target: "CANCELED",
          authority,
        }).success,
      ).toBe(false);
    }
  });

  test("models orthogonal order lifecycle and payment commands", () => {
    expect(
      orderLifecycleTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: orderSubject,
        expectedVersion: 3,
        target: "OPEN",
        authority: paymentProviderAuthority,
      }).success,
    ).toBe(true);
    expect(
      orderLifecycleTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: orderSubject,
        expectedVersion: 3,
        target: "CANCELED",
        authority: {
          kind: "AUDITED_BUSINESS_CANCEL",
          auditLogId: IDS.auditLog,
          reasonCode: "CUSTOMER_REQUESTED_CANCEL",
        },
      }).success,
    ).toBe(true);
    expect(
      orderPaymentTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: orderSubject,
        expectedVersion: 3,
        target: "PAID",
        authority: paymentProviderAuthority,
      }).success,
    ).toBe(true);
    expect(
      orderPaymentTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: {
          ...orderSubject,
          paymentStatus: "UNPAID",
          currentPaymentAttemptId: IDS.otherPaymentAttempt,
        },
        expectedVersion: 11,
        target: "PENDING",
        authority: {
          kind: "ATTEMPT_CREATED",
          paymentAttempt: paymentAttemptSubject,
        },
      }).success,
    ).toBe(false);
    expect(
      orderPaymentTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: orderSubject,
        expectedVersion: 3,
        target: "PAID",
        authority: {
          ...paymentProviderAuthority,
          paymentAttempt: {
            ...paymentAttemptSubject,
            id: IDS.otherPaymentAttempt,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      orderPaymentTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: { ...orderSubject, paymentStatus: "PAID" },
        expectedVersion: 3,
        target: "PARTIALLY_REFUNDED",
        authority: {
          kind: "REFUND_TOTALS",
          paymentAttempt: { ...paymentAttemptSubject, status: "SUCCEEDED" },
          capturedAmountMinor: 2_500,
          succeededRefundAmountMinor: 1_000,
        },
      }).success,
    ).toBe(true);
  });

  test("binds refund and dispute commands to their matching provider event", () => {
    expect(
      refundTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: capturedOrderSubject,
        paymentAttempt: capturedPaymentAttempt,
        subject: {
          schemaVersion: 1,
          id: IDS.refund,
          orderId: IDS.order,
          paymentAttemptId: IDS.paymentAttempt,
          version: 2,
          status: "PROCESSING",
          providerReference: "refund_1",
          capturedCurrency: "USD",
          capturedAmountMinor: 2_500,
          requestedAmountMinor: 1_000,
          currency: "USD",
        },
        expectedVersion: 2,
        target: "SUCCEEDED",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: capturedPaymentAttempt,
          providerReference: "refund_1",
          event: refundSuccessEvent,
        },
      }).success,
    ).toBe(true);
    expect(
      disputeTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: capturedOrderSubject,
        paymentAttempt: capturedPaymentAttempt,
        subject: {
          schemaVersion: 1,
          id: IDS.dispute,
          orderId: IDS.order,
          paymentAttemptId: IDS.paymentAttempt,
          version: 2,
          status: "NONE",
          providerReference: "dispute_1",
          amountMinor: 2_500,
          currency: "USD",
        },
        expectedVersion: 2,
        target: "OPEN",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: capturedPaymentAttempt,
          providerReference: "dispute_1",
          event: disputeOpenEvent,
        },
      }).success,
    ).toBe(true);
    expect(
      disputeTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: capturedOrderSubject,
        paymentAttempt: capturedPaymentAttempt,
        subject: {
          schemaVersion: 1,
          id: IDS.dispute,
          orderId: IDS.order,
          paymentAttemptId: IDS.paymentAttempt,
          version: 2,
          status: "NONE",
          providerReference: "dispute_1",
          amountMinor: 2_500,
          currency: "USD",
        },
        expectedVersion: 2,
        target: "OPEN",
        authority: paymentProviderAuthority,
      }).success,
    ).toBe(false);
  });

  test("requires a refundable order payment state for every refund and dispute authority", () => {
    const refundSubject = {
      schemaVersion: 1,
      id: IDS.refund,
      orderId: IDS.order,
      paymentAttemptId: IDS.paymentAttempt,
      version: 2,
      status: "PROCESSING",
      providerReference: "refund_1",
      capturedCurrency: "USD",
      capturedAmountMinor: 2_500,
      requestedAmountMinor: 1_000,
      currency: "USD",
    } as const;
    const disputeSubject = {
      schemaVersion: 1,
      id: IDS.dispute,
      orderId: IDS.order,
      paymentAttemptId: IDS.paymentAttempt,
      version: 2,
      status: "NONE",
      providerReference: "dispute_1",
      amountMinor: 2_500,
      currency: "USD",
    } as const;

    for (const paymentStatus of ["UNPAID", "PENDING"] as const) {
      const order = { ...capturedOrderSubject, paymentStatus };
      expect(
        refundTransitionCommandSchema.safeParse({
          schemaVersion: 1,
          order,
          paymentAttempt: capturedPaymentAttempt,
          subject: { ...refundSubject, status: "SUBMITTING" },
          expectedVersion: 2,
          target: "UNKNOWN",
          authority: {
            kind: "NETWORK_UNCERTAINTY",
            operationMayHaveCommitted: true,
          },
        }).success,
      ).toBe(false);
      expect(
        refundTransitionCommandSchema.safeParse({
          schemaVersion: 1,
          order,
          paymentAttempt: capturedPaymentAttempt,
          subject: refundSubject,
          expectedVersion: 2,
          target: "SUCCEEDED",
          authority: {
            kind: "PROVIDER_EVENT",
            paymentAttempt: capturedPaymentAttempt,
            providerReference: "refund_1",
            event: refundSuccessEvent,
          },
        }).success,
      ).toBe(false);
      expect(
        disputeTransitionCommandSchema.safeParse({
          schemaVersion: 1,
          order,
          paymentAttempt: capturedPaymentAttempt,
          subject: disputeSubject,
          expectedVersion: 2,
          target: "OPEN",
          authority: {
            kind: "PROVIDER_EVENT",
            paymentAttempt: capturedPaymentAttempt,
            providerReference: "dispute_1",
            event: disputeOpenEvent,
          },
        }).success,
      ).toBe(false);
      expect(
        disputeTransitionCommandSchema.safeParse({
          schemaVersion: 1,
          order,
          paymentAttempt: capturedPaymentAttempt,
          subject: disputeSubject,
          expectedVersion: 2,
          target: "OPEN",
          authority: { kind: "BROWSER_RETURN" },
        }).success,
      ).toBe(false);
    }

    const refundedOrder = {
      ...capturedOrderSubject,
      paymentStatus: "REFUNDED",
    } as const;
    expect(
      refundTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: refundedOrder,
        paymentAttempt: capturedPaymentAttempt,
        subject: { ...refundSubject, status: "SUCCEEDED" },
        expectedVersion: 2,
        target: "SUCCEEDED",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: capturedPaymentAttempt,
          providerReference: "refund_1",
          event: refundSuccessEvent,
        },
      }).success,
    ).toBe(true);
    expect(
      refundTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: refundedOrder,
        paymentAttempt: capturedPaymentAttempt,
        subject: { ...refundSubject, status: "FAILED" },
        expectedVersion: 2,
        target: "SUCCEEDED",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: capturedPaymentAttempt,
          providerReference: "refund_1",
          event: refundSuccessEvent,
        },
      }).success,
    ).toBe(true);
    expect(
      refundTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: refundedOrder,
        paymentAttempt: capturedPaymentAttempt,
        subject: { ...refundSubject, status: "SUBMITTING" },
        expectedVersion: 2,
        target: "UNKNOWN",
        authority: {
          kind: "NETWORK_UNCERTAINTY",
          operationMayHaveCommitted: true,
        },
      }).success,
    ).toBe(false);
    expect(
      refundTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: refundedOrder,
        paymentAttempt: capturedPaymentAttempt,
        subject: refundSubject,
        expectedVersion: 2,
        target: "SUCCEEDED",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: capturedPaymentAttempt,
          providerReference: "refund_1",
          event: refundSuccessEvent,
        },
      }).success,
    ).toBe(false);
    expect(
      disputeTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: refundedOrder,
        paymentAttempt: capturedPaymentAttempt,
        subject: disputeSubject,
        expectedVersion: 2,
        target: "OPEN",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: capturedPaymentAttempt,
          providerReference: "dispute_1",
          event: disputeOpenEvent,
        },
      }).success,
    ).toBe(true);
    expect(
      refundTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: refundedOrder,
        paymentAttempt: capturedPaymentAttempt,
        subject: { ...refundSubject, status: "REQUESTED" },
        expectedVersion: 2,
        target: "SUBMITTING",
        authority: {
          kind: "SUBMIT_COMMAND",
          refunds: [
            {
              ...refundSubject,
              status: "REQUESTED",
              processedAmountMinor: 0,
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  test("requires positive fulfillment versions and controlled hold reasons", () => {
    const base = {
      schemaVersion: 1,
      order: capturedOrderSubject,
      subject: {
        schemaVersion: 1,
        id: IDS.fulfillment,
        orderId: IDS.order,
        orderItemId: IDS.orderItem,
        version: 3,
        status: "PENDING",
      },
      expectedVersion: 3,
      target: "PREPARING",
      authority: {
        kind: "OPERATOR_COMMAND",
      },
    } as const;
    expect(fulfillmentTransitionCommandSchema.safeParse(base).success).toBe(
      true,
    );
    expect(
      fulfillmentTransitionCommandSchema.safeParse({
        ...base,
        order: { ...base.order, id: IDS.cart },
      }).success,
    ).toBe(false);
    expect(
      fulfillmentTransitionCommandSchema.safeParse({
        ...base,
        order: { ...base.order, paymentStatus: "PENDING" },
      }).success,
    ).toBe(false);
    expect(
      fulfillmentTransitionCommandSchema.safeParse({
        ...base,
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      fulfillmentTransitionCommandSchema.safeParse({
        ...base,
        target: "ON_HOLD",
      }).success,
    ).toBe(false);
    expect(
      fulfillmentTransitionCommandSchema.safeParse({
        ...base,
        target: "ON_HOLD",
        authority: { ...base.authority, reasonCode: "" },
      }).success,
    ).toBe(false);
    expect(
      fulfillmentTransitionCommandSchema.safeParse({
        ...base,
        target: "ON_HOLD",
        authority: {
          ...base.authority,
          reasonCode: "OPERATIONS_REVIEW",
          unexpected: true,
        },
      }).success,
    ).toBe(false);
    const lateHold = {
      schemaVersion: 1,
      order: base.order,
      subject: base.subject,
      expectedVersion: 3,
      target: "ON_HOLD",
      authority: {
        kind: "LATE_PAYMENT_HOLD",
        reasonCode: "LATE_PAYMENT_INVENTORY_UNAVAILABLE",
        paymentAttempt: paymentAttemptSubject,
        event: paymentSuccessEvent,
      },
    } as const;
    expect(fulfillmentTransitionCommandSchema.safeParse(lateHold).success).toBe(
      false,
    );
    expect(
      fulfillmentTransitionCommandSchema.safeParse({
        ...lateHold,
        authority: {
          ...lateHold.authority,
          paymentAttempt: {
            ...paymentAttemptSubject,
            orderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        },
      }).success,
    ).toBe(false);
  });
});

test("exports strict transition-decision schemas for every state family", () => {
  const schemasAndStates = [
    [
      paymentAttemptTransitionDecisionSchema,
      "PROCESSING",
      "INVALID_PAYMENT_ATTEMPT_TRANSITION_COMMAND",
      {
        paymentAttemptId: IDS.paymentAttempt,
        orderId: IDS.order,
        expectedVersion: 7,
      },
    ],
    [
      orderLifecycleTransitionDecisionSchema,
      "OPEN",
      "INVALID_ORDER_LIFECYCLE_TRANSITION_COMMAND",
      {
        orderId: IDS.order,
        paymentAttemptId: IDS.paymentAttempt,
        expectedVersion: 3,
      },
    ],
    [
      orderPaymentTransitionDecisionSchema,
      "PAID",
      "INVALID_ORDER_PAYMENT_TRANSITION_COMMAND",
      {
        orderId: IDS.order,
        paymentAttemptId: IDS.paymentAttempt,
        expectedVersion: 3,
      },
    ],
    [
      refundTransitionDecisionSchema,
      "PROCESSING",
      "INVALID_REFUND_TRANSITION_COMMAND",
      {
        refundId: IDS.refund,
        orderId: IDS.order,
        paymentAttemptId: IDS.paymentAttempt,
        providerReference: "refund_1",
        expectedVersion: 2,
        orderExpectedVersion: 3,
        paymentAttemptExpectedVersion: 7,
      },
    ],
    [
      disputeTransitionDecisionSchema,
      "OPEN",
      "INVALID_DISPUTE_TRANSITION_COMMAND",
      {
        disputeId: IDS.dispute,
        orderId: IDS.order,
        paymentAttemptId: IDS.paymentAttempt,
        providerReference: "dispute_1",
        expectedVersion: 2,
        orderExpectedVersion: 3,
        paymentAttemptExpectedVersion: 7,
      },
    ],
    [
      fulfillmentTransitionDecisionSchema,
      "PREPARING",
      "INVALID_FULFILLMENT_TRANSITION_COMMAND",
      {
        fulfillmentId: IDS.fulfillment,
        orderId: IDS.order,
        orderItemId: IDS.orderItem,
        expectedVersion: 3,
        orderExpectedVersion: 3,
      },
    ],
  ] as const;

  for (const [schema, state, invalidReasonCode, identity] of schemasAndStates) {
    expect(
      schema.safeParse({
        schemaVersion: 1,
        ...identity,
        decision: "NOOP",
        from: state,
        to: state,
        reasonCode: "ALREADY_APPLIED",
        effects: [],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        schemaVersion: 1,
        decision: "INVALID",
        reasonCode: invalidReasonCode,
        effects: [],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        schemaVersion: 1,
        decision: "INVALID",
        reasonCode: invalidReasonCode,
        from: state,
        effects: [],
      }).success,
    ).toBe(false);
  }
});

test("accepts explicit stale-version rejections with full subject identity", () => {
  const staleDecisions = [
    [
      paymentAttemptTransitionDecisionSchema,
      {
        paymentAttemptId: IDS.paymentAttempt,
        orderId: IDS.order,
        from: "PROCESSING",
        to: "SUCCEEDED",
        reasonCode: "PAYMENT_STALE_VERSION",
      },
    ],
    [
      orderLifecycleTransitionDecisionSchema,
      {
        orderId: IDS.order,
        paymentAttemptId: IDS.paymentAttempt,
        from: "PENDING_PAYMENT",
        to: "OPEN",
        reasonCode: "ORDER_LIFECYCLE_STALE_VERSION",
      },
    ],
    [
      orderPaymentTransitionDecisionSchema,
      {
        orderId: IDS.order,
        paymentAttemptId: IDS.paymentAttempt,
        from: "PENDING",
        to: "PAID",
        reasonCode: "ORDER_PAYMENT_STALE_VERSION",
      },
    ],
    [
      refundTransitionDecisionSchema,
      {
        refundId: IDS.refund,
        orderId: IDS.order,
        paymentAttemptId: IDS.paymentAttempt,
        providerReference: "refund_1",
        orderExpectedVersion: 11,
        paymentAttemptExpectedVersion: 7,
        from: "PROCESSING",
        to: "SUCCEEDED",
        reasonCode: "REFUND_STALE_VERSION",
      },
    ],
    [
      disputeTransitionDecisionSchema,
      {
        disputeId: IDS.dispute,
        orderId: IDS.order,
        paymentAttemptId: IDS.paymentAttempt,
        providerReference: "dispute_1",
        orderExpectedVersion: 11,
        paymentAttemptExpectedVersion: 7,
        from: "NONE",
        to: "OPEN",
        reasonCode: "DISPUTE_STALE_VERSION",
      },
    ],
  ] as const;

  for (const [schema, decision] of staleDecisions) {
    expect(
      schema.safeParse({
        schemaVersion: 1,
        decision: "REJECTED",
        expectedVersion: 99,
        ...decision,
        effects: [],
      }).success,
    ).toBe(true);
  }
});

test("binds an applied refund submission to one exact AVAILABLE capacity decision", () => {
  const capacity = {
    schemaVersion: 1,
    kind: "AVAILABLE",
    refundId: IDS.refund,
    orderId: IDS.order,
    paymentAttemptId: IDS.paymentAttempt,
    refundExpectedVersion: 3,
    orderExpectedVersion: 11,
    paymentAttemptExpectedVersion: 7,
    capturedCurrency: "USD",
    capturedAmountMinor: 2_500,
    requestedCurrency: "USD",
    requestedAmountMinor: 1_000,
    occupiedAmountMinor: 1_000,
    availableAmountMinor: 1_500,
  } as const;
  const decision = {
    schemaVersion: 1,
    decision: "APPLIED",
    refundId: IDS.refund,
    orderId: IDS.order,
    paymentAttemptId: IDS.paymentAttempt,
    providerReference: "refund_1",
    expectedVersion: 3,
    orderExpectedVersion: 11,
    paymentAttemptExpectedVersion: 7,
    from: "REQUESTED",
    to: "SUBMITTING",
    reasonCode: "REFUND_SUBMISSION_STARTED",
    effects: [{ type: "REFUND_STATUS_CHANGED" }],
    capacity,
  } as const;

  expect(refundTransitionDecisionSchema.safeParse(decision).success).toBe(true);
  for (const invalid of [
    { ...decision, capacity: undefined },
    {
      ...decision,
      capacity: { ...capacity, paymentAttemptId: IDS.otherPaymentAttempt },
    },
    {
      ...decision,
      capacity: { ...capacity, occupiedAmountMinor: 999 },
    },
    {
      ...decision,
      from: "SUBMITTING",
      to: "PROCESSING",
      reasonCode: "REFUND_PROVIDER_STATUS_CONFIRMED",
    },
  ]) {
    expect(refundTransitionDecisionSchema.safeParse(invalid).success).toBe(
      false,
    );
  }
});

describe("late payment success command and result contracts", () => {
  const state = {
    schemaVersion: 1,
    paymentAttempt: { ...paymentAttemptSubject, status: "UNKNOWN" },
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
        id: IDS.inventoryReservation,
        orderId: IDS.order,
        version: 4,
        status: "ACTIVE",
      },
    ],
    fulfillments: [
      {
        schemaVersion: 1,
        id: IDS.fulfillment,
        orderId: IDS.order,
        orderItemId: IDS.orderItem,
        version: 6,
        status: "PENDING",
      },
    ],
    competingPaymentAttemptIds: [],
  } as const;
  const command = {
    schemaVersion: 1,
    state,
    authority: {
      kind: "PROVIDER_EVENT",
      paymentAttempt: state.paymentAttempt,
      event: paymentSuccessEvent,
    },
    auditActor: {
      kind: "SYSTEM",
      taskName: "payment-reconcile",
    },
  } as const;

  test("publishes runtime-only invariant metadata for both artifact roots", () => {
    expect(latePaymentSuccessCommandSchema.meta()).toMatchObject({
      "x-runtime-invariants": expect.any(Array),
    });
    expect(latePaymentSuccessDecisionSchema.meta()).toMatchObject({
      "x-runtime-invariants": expect.any(Array),
    });
  });

  test("accepts a successful payment event and strict audit actor", () => {
    expect(latePaymentSuccessCommandSchema.safeParse(command).success).toBe(
      true,
    );
    expect(
      latePaymentSuccessCommandSchema.safeParse({
        ...command,
        auditActor: { kind: "SYSTEM", taskName: "" },
      }).success,
    ).toBe(false);
    expect(
      latePaymentSuccessCommandSchema.safeParse({
        ...command,
        auditActor: { kind: "ADMIN", adminIdentityId: "not-an-admin-id" },
      }).success,
    ).toBe(false);
    expect(
      latePaymentSuccessCommandSchema.safeParse({
        ...command,
        auditActor: { kind: "ADMIN", adminIdentityId: IDS.admin },
      }).success,
    ).toBe(true);
  });

  test("rejects cross-event, non-success, and unknown command shapes", () => {
    expect(
      latePaymentSuccessCommandSchema.safeParse({
        ...command,
        authority: {
          ...command.authority,
          paymentAttempt: {
            ...command.authority.paymentAttempt,
            id: IDS.otherPaymentAttempt,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      latePaymentSuccessCommandSchema.safeParse({
        ...command,
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: state.paymentAttempt,
          providerReference: "dispute_1",
          event: disputeOpenEvent,
        },
      }).success,
    ).toBe(false);
    expect(
      latePaymentSuccessCommandSchema.safeParse({
        ...command,
        authority: {
          ...command.authority,
          event: { ...paymentSuccessEvent, status: "FAILED" },
        },
      }).success,
    ).toBe(false);
    expect(
      latePaymentSuccessCommandSchema.safeParse({
        ...command,
        acceptedEvidence: "opaque-runtime-token",
      }).success,
    ).toBe(false);
    expect(
      latePaymentSuccessCommandSchema.safeParse({
        ...command,
        state: {
          ...state,
          reservations: [
            state.reservations[0],
            {
              ...state.reservations[0],
              id: state.reservations[0].id.toUpperCase(),
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  test("parses the serializable applied plan and safe audit projection", () => {
    const subjects = {
      paymentAttempt: { id: IDS.paymentAttempt, expectedVersion: 7 },
      order: { id: IDS.order, expectedVersion: 11 },
      cart: { id: IDS.cart, expectedVersion: 5 },
      reservations: [{ id: IDS.inventoryReservation, expectedVersion: 4 }],
      fulfillments: [{ id: IDS.fulfillment, expectedVersion: 6 }],
    } as const;
    const appliedDecision = {
      schemaVersion: 1,
      decision: "APPLIED",
      reasonCode: "PAYMENT_SUCCESS_RECONCILED",
      subjects,
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
            id: IDS.inventoryReservation,
            expectedVersion: 4,
            status: "COMMITTED",
            inventoryAction: "COMMIT_RESERVED",
          },
        ],
        fulfillments: [
          {
            id: IDS.fulfillment,
            expectedVersion: 6,
            status: "PENDING",
          },
        ],
      },
      audit: {
        original: state,
        providerEventId: "evt_payment_success",
        providerEvidence: {
          kind: "VERIFIED_WEBHOOK",
          referenceId: IDS.webhookInbox,
        },
        actor: command.auditActor,
      },
      effects: [
        { type: "PAYMENT_SUCCEEDED" },
        { type: "ORDER_OPENED" },
        { type: "INVENTORY_RESERVATION_COMMIT_REQUIRED" },
        { type: "AUDIT_REQUIRED" },
      ],
    } as const;
    expect(
      latePaymentSuccessDecisionSchema.safeParse(appliedDecision).success,
    ).toBe(true);

    for (const inconsistent of [
      {
        ...appliedDecision,
        plan: {
          ...appliedDecision.plan,
          order: { ...appliedDecision.plan.order, id: IDS.orderItem },
        },
      },
      {
        ...appliedDecision,
        plan: { ...appliedDecision.plan, reservations: [] },
      },
      {
        ...appliedDecision,
        plan: {
          ...appliedDecision.plan,
          reservations: [
            appliedDecision.plan.reservations[0],
            appliedDecision.plan.reservations[0],
          ],
        },
      },
      {
        ...appliedDecision,
        audit: {
          ...appliedDecision.audit,
          original: {
            ...appliedDecision.audit.original,
            order: {
              ...appliedDecision.audit.original.order,
              version: 12,
            },
          },
        },
      },
      {
        ...appliedDecision,
        audit: {
          ...appliedDecision.audit,
          original: {
            ...appliedDecision.audit.original,
            competingPaymentAttemptIds: [IDS.otherPaymentAttempt],
          },
        },
      },
      {
        ...appliedDecision,
        audit: {
          ...appliedDecision.audit,
          original: {
            ...appliedDecision.audit.original,
            paymentAttempt: {
              ...appliedDecision.audit.original.paymentAttempt,
              status: "FAILED",
            },
          },
        },
      },
      {
        ...appliedDecision,
        audit: {
          ...appliedDecision.audit,
          original: {
            ...appliedDecision.audit.original,
            order: {
              ...appliedDecision.audit.original.order,
              currentPaymentAttemptId: IDS.otherPaymentAttempt,
            },
          },
        },
      },
      {
        ...appliedDecision,
        audit: {
          ...appliedDecision.audit,
          original: {
            ...appliedDecision.audit.original,
            fulfillments: [
              {
                ...appliedDecision.audit.original.fulfillments[0],
                status: "DELIVERED",
              },
            ],
          },
        },
      },
      {
        ...appliedDecision,
        plan: {
          ...appliedDecision.plan,
          reservations: [
            {
              ...appliedDecision.plan.reservations[0],
              inventoryAction: "NONE",
            },
          ],
        },
        audit: {
          ...appliedDecision.audit,
          original: {
            ...appliedDecision.audit.original,
            paymentAttempt: {
              ...appliedDecision.audit.original.paymentAttempt,
              status: "SUCCEEDED",
            },
            order: {
              ...appliedDecision.audit.original.order,
              orderStatus: "OPEN",
              paymentStatus: "PAID",
            },
            cart: {
              ...appliedDecision.audit.original.cart,
              status: "CONVERTED",
            },
            reservations: [
              {
                ...appliedDecision.audit.original.reservations[0],
                status: "COMMITTED",
              },
            ],
          },
        },
        effects: [
          { type: "PAYMENT_SUCCEEDED" },
          { type: "ORDER_OPENED" },
          { type: "AUDIT_REQUIRED" },
        ],
      },
    ]) {
      expect(
        latePaymentSuccessDecisionSchema.safeParse(inconsistent).success,
      ).toBe(false);
    }
    expect(
      latePaymentSuccessDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: "REJECTED",
        reasonCode: "LATE_SUCCESS_ORDER_STATE_INVALID",
        subjects,
        effects: [{ type: "PAYMENT_SUCCEEDED" }],
      }).success,
    ).toBe(false);
  });

  test("represents malformed commands without inventing current or target state", () => {
    expect(
      latePaymentSuccessDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: "INVALID",
        reasonCode: "INVALID_LATE_PAYMENT_SUCCESS_COMMAND",
        effects: [],
      }).success,
    ).toBe(true);
    expect(
      latePaymentSuccessDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: "INVALID",
        reasonCode: "INVALID_LATE_PAYMENT_SUCCESS_COMMAND",
        paymentAttemptStatus: "UNKNOWN",
        effects: [],
      }).success,
    ).toBe(false);
  });
});

describe("persisted subject binding contracts", () => {
  const paymentAttempt = {
    schemaVersion: 1,
    id: IDS.paymentAttempt,
    orderId: IDS.order,
    version: 7,
    status: "PROCESSING",
    providerAccountId: IDS.provider,
    environment: "TEST",
    externalReference: "pay_1",
    amountMinor: 2_500,
    currency: "USD",
    providerCallStarted: true,
  } as const;
  const paymentAuthority = {
    kind: "PROVIDER_EVENT",
    paymentAttempt,
    event: paymentSuccessEvent,
  } as const;
  const order = {
    schemaVersion: 1,
    id: IDS.order,
    version: 11,
    orderStatus: "PENDING_PAYMENT",
    paymentStatus: "PENDING",
    currentPaymentAttemptId: IDS.paymentAttempt,
  } as const;
  const capturedPaymentAttempt = {
    ...paymentAttempt,
    status: "SUCCEEDED",
  } as const;
  const capturedOrder = {
    ...order,
    paymentStatus: "PAID",
  } as const;

  test("requires a concrete persisted subject and links provider evidence to it", () => {
    expect(
      paymentAttemptTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: paymentAttempt,
        expectedVersion: 7,
        target: "SUCCEEDED",
        authority: paymentAuthority,
      }).success,
    ).toBe(true);
    expect(
      paymentAttemptTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        current: "PROCESSING",
        target: "SUCCEEDED",
        authority: {
          kind: "PROVIDER_EVENT",
          expectedPaymentAttemptId: IDS.paymentAttempt,
          target: paymentEvidenceTarget,
          event: paymentSuccessEvent,
        },
      }).success,
    ).toBe(false);

    expect(
      orderLifecycleTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: order,
        expectedVersion: 11,
        target: "OPEN",
        authority: paymentAuthority,
      }).success,
    ).toBe(true);
    expect(
      orderLifecycleTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: { ...order, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        expectedVersion: 11,
        target: "OPEN",
        authority: paymentAuthority,
      }).success,
    ).toBe(false);
    expect(
      orderLifecycleTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: { ...order, orderStatus: "CANCELED" },
        expectedVersion: 11,
        target: "OPEN",
        authority: {
          kind: "LATE_PROVIDER_SUCCESS",
          paymentAttempt,
          event: paymentSuccessEvent,
        },
      }).success,
    ).toBe(false);
  });

  test("binds refund, dispute, and fulfillment subjects to the same order and attempt", () => {
    const refund = {
      schemaVersion: 1,
      id: IDS.refund,
      orderId: IDS.order,
      paymentAttemptId: IDS.paymentAttempt,
      version: 3,
      status: "PROCESSING",
      providerReference: "refund_1",
      capturedCurrency: "USD",
      capturedAmountMinor: 2_500,
      requestedAmountMinor: 1_000,
      currency: "USD",
    } as const;
    const dispute = {
      schemaVersion: 1,
      id: IDS.dispute,
      orderId: IDS.order,
      paymentAttemptId: IDS.paymentAttempt,
      version: 2,
      status: "NONE",
      providerReference: "dispute_1",
      amountMinor: 2_500,
      currency: "USD",
    } as const;
    expect(
      refundTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: capturedOrder,
        paymentAttempt: capturedPaymentAttempt,
        subject: refund,
        expectedVersion: 3,
        target: "SUCCEEDED",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: capturedPaymentAttempt,
          providerReference: "refund_1",
          event: refundSuccessEvent,
        },
      }).success,
    ).toBe(true);
    expect(
      disputeTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: capturedOrder,
        paymentAttempt: capturedPaymentAttempt,
        subject: dispute,
        expectedVersion: 2,
        target: "OPEN",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: capturedPaymentAttempt,
          providerReference: "dispute_1",
          event: disputeOpenEvent,
        },
      }).success,
    ).toBe(true);
    expect(
      refundTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: capturedOrder,
        paymentAttempt: capturedPaymentAttempt,
        subject: { ...refund, paymentAttemptId: IDS.otherPaymentAttempt },
        expectedVersion: 3,
        target: "SUCCEEDED",
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: capturedPaymentAttempt,
          providerReference: "refund_1",
          event: refundSuccessEvent,
        },
      }).success,
    ).toBe(false);
    expect(
      fulfillmentTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        order: capturedOrder,
        subject: {
          schemaVersion: 1,
          id: IDS.fulfillment,
          orderId: IDS.order,
          orderItemId: IDS.orderItem,
          version: 4,
          status: "PENDING",
        },
        expectedVersion: 4,
        target: "ON_HOLD",
        authority: {
          kind: "LATE_PAYMENT_HOLD",
          reasonCode: "LATE_PAYMENT_INVENTORY_UNAVAILABLE",
          paymentAttempt,
          event: paymentSuccessEvent,
        },
      }).success,
    ).toBe(false);
  });

  test("requires subject identity and expected version on every parsed transition decision", () => {
    expect(
      paymentAttemptTransitionDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: "APPLIED",
        paymentAttemptId: IDS.paymentAttempt,
        orderId: IDS.order,
        expectedVersion: 7,
        from: "PROCESSING",
        to: "FAILED",
        reasonCode: "PAYMENT_PROVIDER_STATUS_CONFIRMED",
        effects: [{ type: "PAYMENT_STATUS_CHANGED" }],
      }).success,
    ).toBe(true);
    expect(
      paymentAttemptTransitionDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: "NOOP",
        from: "PROCESSING",
        to: "PROCESSING",
        reasonCode: "ALREADY_APPLIED",
        effects: [],
      }).success,
    ).toBe(false);
    expect(
      paymentAttemptTransitionDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: "INVALID",
        reasonCode: "INVALID_PAYMENT_ATTEMPT_TRANSITION_COMMAND",
        effects: [],
      }).success,
    ).toBe(true);
    expect(
      paymentAttemptTransitionDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: "APPLIED",
        paymentAttemptId: IDS.paymentAttempt,
        orderId: IDS.order,
        expectedVersion: 7,
        from: "PROCESSING",
        to: "SUCCEEDED",
        reasonCode: "UNREGISTERED_REASON",
        effects: [{ type: "UNREGISTERED_EFFECT" }],
      }).success,
    ).toBe(false);
  });

  test("rejects impossible or internally contradictory state decisions", () => {
    const invalidAppliedDecisions = [
      [
        paymentAttemptTransitionDecisionSchema,
        {
          paymentAttemptId: IDS.paymentAttempt,
          orderId: IDS.order,
          expectedVersion: 7,
          from: "SUCCEEDED",
          to: "FAILED",
          reasonCode: "PAYMENT_PROVIDER_STATUS_CONFIRMED",
          effects: [{ type: "PAYMENT_STATUS_CHANGED" }],
        },
      ],
      [
        paymentAttemptTransitionDecisionSchema,
        {
          paymentAttemptId: IDS.paymentAttempt,
          orderId: IDS.order,
          expectedVersion: 7,
          from: "PROCESSING",
          to: "FAILED",
          reasonCode: "PAYMENT_PROVIDER_STATUS_CONFIRMED",
          effects: [{ type: "PAYMENT_SUCCEEDED" }],
        },
      ],
      [
        orderLifecycleTransitionDecisionSchema,
        {
          orderId: IDS.order,
          paymentAttemptId: IDS.paymentAttempt,
          expectedVersion: 11,
          from: "CANCELED",
          to: "OPEN",
          reasonCode: "ORDER_CHECKOUT_CREATED",
          effects: [{ type: "ORDER_STATUS_CHANGED" }],
        },
      ],
      [
        orderPaymentTransitionDecisionSchema,
        {
          orderId: IDS.order,
          paymentAttemptId: IDS.paymentAttempt,
          expectedVersion: 11,
          from: "REFUNDED",
          to: "PAID",
          reasonCode: "ORDER_REFUND_TOTAL_CONFIRMED",
          effects: [{ type: "ORDER_PAYMENT_STATUS_CHANGED" }],
        },
      ],
      [
        refundTransitionDecisionSchema,
        {
          refundId: IDS.refund,
          orderId: IDS.order,
          paymentAttemptId: IDS.paymentAttempt,
          providerReference: "refund_1",
          expectedVersion: 3,
          orderExpectedVersion: 11,
          paymentAttemptExpectedVersion: 7,
          from: "SUCCEEDED",
          to: "FAILED",
          reasonCode: "REFUND_PROVIDER_STATUS_CONFIRMED",
          effects: [{ type: "REFUND_STATUS_CHANGED" }],
        },
      ],
      [
        disputeTransitionDecisionSchema,
        {
          disputeId: IDS.dispute,
          orderId: IDS.order,
          paymentAttemptId: IDS.paymentAttempt,
          providerReference: "dispute_1",
          expectedVersion: 2,
          orderExpectedVersion: 11,
          paymentAttemptExpectedVersion: 7,
          from: "WON",
          to: "LOST",
          reasonCode: "DISPUTE_PROVIDER_STATUS_CONFIRMED",
          effects: [{ type: "DISPUTE_STATUS_CHANGED" }],
        },
      ],
      [
        fulfillmentTransitionDecisionSchema,
        {
          fulfillmentId: IDS.fulfillment,
          orderId: IDS.order,
          orderItemId: IDS.orderItem,
          expectedVersion: 4,
          orderExpectedVersion: 11,
          from: "DELIVERED",
          to: "PREPARING",
          reasonCode: "FULFILLMENT_OPERATOR_TRANSITION",
          effects: [{ type: "FULFILLMENT_STATUS_CHANGED" }],
        },
      ],
    ] as const;

    for (const [schema, transition] of invalidAppliedDecisions) {
      expect(
        schema.safeParse({
          schemaVersion: 1,
          decision: "APPLIED",
          ...transition,
        }).success,
      ).toBe(false);
    }

    expect(
      paymentAttemptTransitionDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: "REJECTED",
        paymentAttemptId: IDS.paymentAttempt,
        orderId: IDS.order,
        expectedVersion: 7,
        from: "PROCESSING",
        to: "FAILED",
        reasonCode: "PAYMENT_PROVIDER_STATUS_CONFIRMED",
        effects: [],
      }).success,
    ).toBe(false);
    expect(
      refundTransitionDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: "CONFLICT",
        refundId: IDS.refund,
        orderId: IDS.order,
        paymentAttemptId: IDS.paymentAttempt,
        providerReference: "refund_1",
        expectedVersion: 3,
        orderExpectedVersion: 11,
        paymentAttemptExpectedVersion: 7,
        from: "SUCCEEDED",
        to: "FAILED",
        reasonCode: "REFUND_PROVIDER_STATUS_CONFIRMED",
        effects: [],
      }).success,
    ).toBe(false);
  });

  test("uses concrete late-success aggregate subjects and competing attempt IDs", () => {
    const state = {
      schemaVersion: 1,
      paymentAttempt: { ...paymentAttempt, status: "UNKNOWN" },
      order,
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
          id: IDS.inventoryReservation,
          orderId: IDS.order,
          version: 4,
          status: "ACTIVE",
        },
      ],
      fulfillments: [
        {
          schemaVersion: 1,
          id: IDS.fulfillment,
          orderId: IDS.order,
          orderItemId: IDS.orderItem,
          version: 6,
          status: "PENDING",
        },
      ],
      competingPaymentAttemptIds: [],
    } as const;
    expect(
      latePaymentSuccessCommandSchema.safeParse({
        schemaVersion: 1,
        state,
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: state.paymentAttempt,
          event: paymentSuccessEvent,
        },
        auditActor: { kind: "SYSTEM", taskName: "payment-reconcile" },
      }).success,
    ).toBe(true);
    expect(
      latePaymentSuccessCommandSchema.safeParse({
        schemaVersion: 1,
        state: {
          ...state,
          reservations: [
            {
              ...state.reservations[0],
              orderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            },
          ],
        },
        authority: {
          kind: "PROVIDER_EVENT",
          paymentAttempt: state.paymentAttempt,
          event: paymentSuccessEvent,
        },
        auditActor: { kind: "SYSTEM", taskName: "payment-reconcile" },
      }).success,
    ).toBe(false);
  });

  test("derives cancellation, current-attempt binding, and audit identity from persisted subjects", () => {
    const unboundPaymentAttempt = {
      ...paymentAttempt,
      providerCallStarted: false,
      externalReference: undefined,
    };
    expect(
      paymentAttemptTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: unboundPaymentAttempt,
        expectedVersion: 7,
        target: "CANCELED",
        authority: {
          kind: "AUDITED_BUSINESS_CANCEL",
          auditLogId: IDS.auditLog,
          reasonCode: "CUSTOMER_REQUESTED_CANCEL",
        },
      }).success,
    ).toBe(true);
    expect(
      paymentAttemptTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: { ...unboundPaymentAttempt, providerCallStarted: true },
        expectedVersion: 7,
        target: "CANCELED",
        authority: {
          kind: "AUDITED_BUSINESS_CANCEL",
          auditLogId: IDS.auditLog,
          reasonCode: "CUSTOMER_REQUESTED_CANCEL",
        },
      }).success,
    ).toBe(false);
    expect(
      providerEventAuthoritySchema.safeParse({
        kind: "PROVIDER_EVENT",
        paymentAttempt: unboundPaymentAttempt,
        event: paymentSuccessEvent,
      }).success,
    ).toBe(true);

    const orderWithAttempt = {
      ...order,
      currentPaymentAttemptId: IDS.paymentAttempt,
    };
    expect(
      orderPaymentTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: { ...orderWithAttempt, paymentStatus: "UNPAID" },
        expectedVersion: 11,
        target: "PENDING",
        authority: { kind: "ATTEMPT_CREATED", paymentAttempt },
      }).success,
    ).toBe(true);
    expect(
      orderLifecycleTransitionCommandSchema.safeParse({
        schemaVersion: 1,
        subject: {
          ...orderWithAttempt,
          currentPaymentAttemptId: IDS.otherPaymentAttempt,
        },
        expectedVersion: 11,
        target: "OPEN",
        authority: paymentAuthority,
      }).success,
    ).toBe(false);

    expect(
      paymentAttemptTransitionDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: "NOOP",
        paymentAttemptId: IDS.paymentAttempt,
        orderId: IDS.order,
        expectedVersion: 7,
        from: "PROCESSING",
        to: "PROCESSING",
        reasonCode: "ALREADY_APPLIED",
        effects: [],
      }).success,
    ).toBe(true);
    expect(
      refundTransitionDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: "NOOP",
        refundId: IDS.refund,
        orderId: IDS.order,
        paymentAttemptId: IDS.paymentAttempt,
        providerReference: "refund_1",
        expectedVersion: 3,
        orderExpectedVersion: 11,
        paymentAttemptExpectedVersion: 7,
        from: "PROCESSING",
        to: "PROCESSING",
        reasonCode: "ALREADY_APPLIED",
        effects: [],
      }).success,
    ).toBe(true);
  });
});

describe("inventory reservation creation idempotency contract", () => {
  test("declares expected absence and supports explicit same-reservation replay", () => {
    const input = {
      schemaVersion: 1,
      inventoryItem,
      inventoryLocation: {
        schemaVersion: 1,
        id: IDS.inventoryLocation,
        code: "PRIMARY",
        status: "ACTIVE",
      },
      balance: inventoryBalance,
      reservation: inventoryReservation,
      existingReservation: null,
      evaluatedAt: "2026-09-03T00:00:00Z",
    } as const;
    expect(
      inventoryReservationCreationInputSchema.safeParse(input).success,
    ).toBe(true);
    expect(
      inventoryReservationCreationDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "APPLY",
        inventoryItem,
        inventoryItemId: IDS.inventoryItem,
        inventoryLocationId: IDS.inventoryLocation,
        reservationId: IDS.inventoryReservation,
        expectedBalanceVersion: 7,
        expectedReservationAbsent: true,
        previousBalance: inventoryBalance,
        nextBalance: { ...inventoryBalance, reserved: 5, version: 8 },
        nextReservation: inventoryReservation,
        ledgerDelta: { deltaOnHand: 0, deltaReserved: 3 },
        reasonCode: "RESERVATION_CREATED",
      }).success,
    ).toBe(true);
    expect(
      inventoryReservationCreationDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "REPLAY",
        inventoryItem,
        inventoryItemId: IDS.inventoryItem,
        inventoryLocationId: IDS.inventoryLocation,
        reservationId: IDS.inventoryReservation,
        reservation: inventoryReservation,
        reasonCode: "RESERVATION_ALREADY_CREATED",
      }).success,
    ).toBe(true);
    expect(
      inventoryReservationCreationDecisionSchema.safeParse({
        schemaVersion: 1,
        kind: "REJECTED",
        code: "RESERVATION_IDEMPOTENCY_CONFLICT",
      }).success,
    ).toBe(true);
  });
});
