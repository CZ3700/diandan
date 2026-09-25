import { z } from "zod";

import {
  countrySchema,
  currencySchema,
  marketSchema,
  minorAmountSchema,
  checkoutQuoteLineSchema,
} from "./commerce.js";
import {
  giftBaseSchema,
  giftVariantDefinitionSchema,
  giftVariantIdolEligibilitySchema,
  idolBaseSchema,
} from "./catalog-content.js";
import { inventoryReservationSchema } from "./catalog.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { publicErrorCodeSchema } from "./envelopes.js";
import {
  adminIdentityIdSchema,
  auditLogIdSchema,
  cartIdSchema,
  disputeIdSchema,
  externalPaymentReferenceSchema,
  fulfillmentIdSchema,
  giftVariantIdSchema,
  idempotencyKeySchema,
  inventoryItemIdSchema,
  inventoryLocationIdSchema,
  inventoryReservationIdSchema,
  orderIdSchema,
  orderItemIdSchema,
  paymentAttemptIdSchema,
  priceBookIdSchema,
  priceIdSchema,
  providerAccountIdSchema,
  providerDisputeReferenceSchema,
  providerEventReferenceSchema,
  providerRefundReferenceSchema,
  refundIdSchema,
  webhookInboxIdSchema,
} from "./identifiers.js";
import {
  orderPaymentStatusSchema,
  paymentActionTypeSchema,
  paymentAttemptStatusSchema,
  providerEventSchema,
  refundStatusSchema,
} from "./payment.js";
import {
  disputeStatusSchema,
  fulfillmentStatusSchema,
  orderStatusSchema,
} from "./order.js";
import {
  inventoryBalanceSchema,
  inventoryItemSchema,
  inventoryLocationSchema,
  priceBookRevisionSchema,
  priceSchema,
} from "./pricing-inventory-content.js";
import { schemaVersionSchema } from "./versioning.js";

const positiveVersionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const positiveQuantitySchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const safeIntegerSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const paymentMethodSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/u);
const routeRuleIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export const paymentDeviceCapabilitySchema = paymentActionTypeSchema.exclude([
  "WAIT",
]);

export const paymentRouteContextSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  country: countrySchema,
  market: marketSchema,
  currency: currencySchema,
  amountMinor: minorAmountSchema,
  deviceCapabilities: z.array(paymentDeviceCapabilitySchema).max(4),
});

export const paymentRouteRuleSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: routeRuleIdSchema,
    providerAccountId: providerAccountIdSchema,
    paymentMethod: paymentMethodSchema,
    enabled: z.boolean(),
    countries: z.array(countrySchema).min(1),
    markets: z.array(marketSchema).min(1),
    currencies: z.array(currencySchema).min(1),
    minimumAmountMinor: minorAmountSchema,
    maximumAmountMinor: minorAmountSchema,
    requiredDeviceCapabilities: z.array(paymentDeviceCapabilitySchema).max(4),
    priority: safeIntegerSchema,
  })
  .superRefine((rule, context) => {
    if (rule.minimumAmountMinor > rule.maximumAmountMinor) {
      context.addIssue({
        code: "custom",
        message: "maximum amount must be at least the minimum amount",
        path: ["maximumAmountMinor"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "minimumAmountMinor <= maximumAmountMinor",
      "locale is not a routing input",
    ],
  });

export const publishedPaymentRouteRuleSetSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  status: z.literal("PUBLISHED"),
  ruleVersion: positiveVersionSchema,
  rules: z.array(paymentRouteRuleSchema),
});

export const paymentProviderHealthSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  providerAccountId: providerAccountIdSchema,
  status: z.enum(["HEALTHY", "UNAVAILABLE"]),
});

const fixedPaymentAttemptStatusSchema = paymentAttemptStatusSchema.exclude([
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "EXPIRED",
]);

export const fixedPaymentAttemptRouteSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  status: fixedPaymentAttemptStatusSchema,
  providerAccountId: providerAccountIdSchema,
  paymentMethod: paymentMethodSchema,
  ruleVersion: positiveVersionSchema,
});

export const selectPaymentRouteInputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  context: paymentRouteContextSchema,
  publishedRuleSet: publishedPaymentRouteRuleSetSchema,
  providerHealth: z.array(paymentProviderHealthSchema),
  fixedAttempt: fixedPaymentAttemptRouteSchema.optional(),
});

const selectedPaymentRouteSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  ruleId: routeRuleIdSchema,
  ruleVersion: positiveVersionSchema,
  providerAccountId: providerAccountIdSchema,
  paymentMethod: paymentMethodSchema,
});

const pinnedPaymentRouteSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  ruleVersion: positiveVersionSchema,
  providerAccountId: providerAccountIdSchema,
  paymentMethod: paymentMethodSchema,
});

export const paymentRouteDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("SELECTED"),
    route: selectedPaymentRouteSchema,
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("PINNED"),
    attemptStatus: fixedPaymentAttemptStatusSchema,
    route: pinnedPaymentRouteSchema,
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("UNAVAILABLE"),
    reason: z.enum(["NO_ELIGIBLE_ROUTE", "INVALID_ROUTING_INPUT"]),
  }),
]);

export type PaymentDeviceCapability = z.infer<
  typeof paymentDeviceCapabilitySchema
>;
export type PaymentRouteContext = z.infer<typeof paymentRouteContextSchema>;
export type PaymentRouteRule = z.infer<typeof paymentRouteRuleSchema>;
export type PublishedPaymentRouteRuleSet = z.infer<
  typeof publishedPaymentRouteRuleSetSchema
>;
export type PaymentProviderHealth = z.infer<typeof paymentProviderHealthSchema>;
export type FixedPaymentAttemptRoute = z.infer<
  typeof fixedPaymentAttemptRouteSchema
>;
export type SelectPaymentRouteInput = z.infer<
  typeof selectPaymentRouteInputSchema
>;
export type PaymentRouteDecision = z.infer<typeof paymentRouteDecisionSchema>;

export const idempotencyActorSchema = z
  .string()
  .regex(
    /^actor-ref:v1:(guest|admin|system|worker):([a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u,
  );
export const idempotencyOperationSchema = z
  .string()
  .min(2)
  .max(128)
  .regex(/^[a-z][a-z0-9._:-]{1,127}$/u);
export const canonicalRequestHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const safeResultRefSchema = z.union([
  z
    .string()
    .regex(
      /^result-ref:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    ),
  z.templateLiteral(["error-ref:v1:", publicErrorCodeSchema]),
]);

const idempotencyRequestShape = {
  schemaVersion: schemaVersionSchema,
  actor: idempotencyActorSchema,
  operation: idempotencyOperationSchema,
  key: idempotencyKeySchema,
  canonicalRequestHash: canonicalRequestHashSchema,
} as const;

export const idempotencyRequestIdentitySchema = z.strictObject(
  idempotencyRequestShape,
);

export const idempotencyRecordSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...idempotencyRequestShape,
    status: z.literal("IN_PROGRESS"),
    expiresAt: contentTimestampSchema,
  }),
  z.strictObject({
    ...idempotencyRequestShape,
    status: z.literal("SUCCEEDED"),
    safeResultRef: safeResultRefSchema,
    expiresAt: contentTimestampSchema,
  }),
  z.strictObject({
    ...idempotencyRequestShape,
    status: z.literal("FAILED"),
    safeResultRef: safeResultRefSchema,
    expiresAt: contentTimestampSchema,
  }),
]);

export const decideIdempotencyInputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  evaluatedAt: contentTimestampSchema,
  request: idempotencyRequestIdentitySchema,
  existingRecord: idempotencyRecordSchema.nullable(),
});

export const idempotencyDecisionSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("EXECUTE"),
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("CONFLICT"),
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("INVALID"),
    reason: z.enum(["INVALID_IDEMPOTENCY_INPUT", "INVALID_TIMESTAMP"]),
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("REPLAY"),
    status: z.literal("IN_PROGRESS"),
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("REPLAY"),
    status: z.enum(["SUCCEEDED", "FAILED"]),
    safeResultRef: safeResultRefSchema,
  }),
]);

export type IdempotencyRequestIdentity = z.infer<
  typeof idempotencyRequestIdentitySchema
>;
export type IdempotencyRecord = z.infer<typeof idempotencyRecordSchema>;
export type DecideIdempotencyInput = z.infer<
  typeof decideIdempotencyInputSchema
>;
export type IdempotencyDecision = z.infer<typeof idempotencyDecisionSchema>;

export const amountCalculationRejectionCodeSchema = z.enum([
  "AMOUNT_OVERFLOW",
  "CURRENCY_MISMATCH",
  "DISCOUNT_EXCEEDS_GROSS",
  "DUPLICATE_CART_ITEM",
  "INVALID_AMOUNT",
]);

const amountCalculationRejectionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  kind: z.literal("REJECTED"),
  code: amountCalculationRejectionCodeSchema,
});

export const lineAmountCalculationInputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  unitAmountMinor: minorAmountSchema,
  quantity: positiveQuantitySchema,
  taxAmountMinor: minorAmountSchema,
  discountAmountMinor: minorAmountSchema,
});

export const lineAmountCalculationDecisionSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("CALCULATED"),
    lineSubtotalMinor: minorAmountSchema,
    lineTotalMinor: minorAmountSchema,
  }),
  amountCalculationRejectionSchema,
]);

export const orderAmountCalculationLineSchema =
  checkoutQuoteLineSchema.safeExtend({
    currency: currencySchema,
  });

export const orderAmountCalculationInputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  currency: currencySchema,
  lines: z.array(orderAmountCalculationLineSchema).min(1),
  shippingAmountMinor: minorAmountSchema,
  feeAmountMinor: minorAmountSchema,
});

export const orderAmountCalculationDecisionSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("CALCULATED"),
    subtotalMinor: minorAmountSchema,
    taxAmountMinor: minorAmountSchema,
    shippingAmountMinor: minorAmountSchema,
    feeAmountMinor: minorAmountSchema,
    discountAmountMinor: minorAmountSchema,
    totalAmountMinor: minorAmountSchema,
  }),
  amountCalculationRejectionSchema,
]);

export type AmountCalculationRejectionCode = z.infer<
  typeof amountCalculationRejectionCodeSchema
>;
export type LineAmountCalculationInput = z.infer<
  typeof lineAmountCalculationInputSchema
>;
export type LineAmountCalculationDecision = z.infer<
  typeof lineAmountCalculationDecisionSchema
>;
export type OrderAmountCalculationLine = z.infer<
  typeof orderAmountCalculationLineSchema
>;
export type OrderAmountCalculationInput = z.infer<
  typeof orderAmountCalculationInputSchema
>;
export type OrderAmountCalculationDecision = z.infer<
  typeof orderAmountCalculationDecisionSchema
>;

export const priceSelectionInputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  evaluatedAt: contentTimestampSchema,
  market: marketSchema,
  currency: currencySchema,
  giftVariantId: giftVariantIdSchema,
  priceBooks: z.array(priceBookRevisionSchema),
  prices: z.array(priceSchema),
});

export const priceSelectionDecisionSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("SELECTED"),
    priceId: priceIdSchema,
    priceRevision: positiveVersionSchema,
    priceBookId: priceBookIdSchema,
    priceBookRevision: positiveVersionSchema,
    unitAmountMinor: minorAmountSchema,
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("REJECTED"),
    code: z.enum(["PRICE_AMBIGUOUS", "PRICE_DATA_INVALID", "PRICE_NOT_FOUND"]),
  }),
]);

export type PriceSelectionInput = z.infer<typeof priceSelectionInputSchema>;
export type PriceSelectionDecision = z.infer<
  typeof priceSelectionDecisionSchema
>;

export const giftEligibilityInputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  gift: giftBaseSchema,
  variant: giftVariantDefinitionSchema,
  idol: idolBaseSchema,
  eligibility: z.array(giftVariantIdolEligibilitySchema),
});

export const giftEligibilityDecisionSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("ELIGIBLE"),
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("REJECTED"),
    code: z.enum([
      "ELIGIBILITY_AMBIGUOUS",
      "ELIGIBILITY_DATA_INVALID",
      "ELIGIBILITY_MISSING",
      "GIFT_NOT_ACTIVE",
      "GIFT_NOT_PUBLISHED",
      "IDOL_NOT_ACCEPTING_GIFTS",
      "IDOL_NOT_ACTIVE",
      "IDOL_NOT_PUBLISHED",
      "VARIANT_GIFT_MISMATCH",
      "VARIANT_NOT_ACTIVE",
    ]),
  }),
]);

export type GiftEligibilityInput = z.infer<typeof giftEligibilityInputSchema>;
export type GiftEligibilityDecision = z.infer<
  typeof giftEligibilityDecisionSchema
>;

const inventoryLedgerDeltaSchema = z.strictObject({
  deltaOnHand: safeIntegerSchema,
  deltaReserved: safeIntegerSchema,
});

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

const inventoryReservationCreationRejectionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  kind: z.literal("REJECTED"),
  code: z.enum([
    "INSUFFICIENT_INVENTORY",
    "INVENTORY_IDENTITY_MISMATCH",
    "INVENTORY_NOT_TRACKED",
    "INVENTORY_NOT_USABLE",
    "RESERVATION_ALREADY_EXPIRED",
    "RESERVATION_IDEMPOTENCY_CONFLICT",
    "RESERVATION_NOT_ACTIVE",
    "VERSION_OVERFLOW",
  ]),
});

export const inventoryReservationCreationInputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  inventoryItem: inventoryItemSchema,
  inventoryLocation: inventoryLocationSchema,
  balance: inventoryBalanceSchema,
  reservation: inventoryReservationSchema,
  existingReservation: inventoryReservationSchema.nullable(),
  evaluatedAt: contentTimestampSchema,
});

export const inventoryReservationCreationApplySchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("APPLY"),
    inventoryItem: inventoryItemSchema,
    inventoryItemId: inventoryItemIdSchema,
    inventoryLocationId: inventoryLocationIdSchema,
    reservationId: inventoryReservationIdSchema,
    expectedBalanceVersion: positiveVersionSchema,
    expectedReservationAbsent: z.literal(true),
    previousBalance: inventoryBalanceSchema,
    nextBalance: inventoryBalanceSchema,
    nextReservation: inventoryReservationSchema,
    ledgerDelta: inventoryLedgerDeltaSchema,
    reasonCode: z.literal("RESERVATION_CREATED"),
  })
  .superRefine((decision, context) => {
    const identityMatches =
      sameUuid(decision.inventoryItemId, decision.inventoryItem.id) &&
      sameUuid(
        decision.inventoryItemId,
        decision.previousBalance.inventoryItemId,
      ) &&
      sameUuid(
        decision.inventoryItemId,
        decision.nextBalance.inventoryItemId,
      ) &&
      sameUuid(
        decision.inventoryLocationId,
        decision.previousBalance.inventoryLocationId,
      ) &&
      sameUuid(
        decision.inventoryLocationId,
        decision.nextBalance.inventoryLocationId,
      ) &&
      sameUuid(
        decision.inventoryLocationId,
        decision.nextReservation.inventoryLocationId,
      ) &&
      sameUuid(
        decision.inventoryItem.giftVariantId,
        decision.nextReservation.giftVariantId,
      ) &&
      sameUuid(decision.reservationId, decision.nextReservation.id);
    const versionMatches =
      decision.expectedBalanceVersion === decision.previousBalance.version &&
      decision.nextBalance.version === decision.previousBalance.version + 1;
    const deltaMatches =
      decision.nextReservation.status === "ACTIVE" &&
      decision.ledgerDelta.deltaOnHand === 0 &&
      decision.ledgerDelta.deltaReserved ===
        decision.nextReservation.quantity &&
      decision.nextBalance.onHand === decision.previousBalance.onHand &&
      decision.nextBalance.reserved ===
        decision.previousBalance.reserved + decision.nextReservation.quantity;
    if (!identityMatches || !versionMatches || !deltaMatches) {
      context.addIssue({
        code: "custom",
        message:
          "reservation creation must bind one balance target and exact ledger arithmetic",
      });
    }
  });

const inventoryReservationCreationReplaySchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("REPLAY"),
    inventoryItem: inventoryItemSchema,
    inventoryItemId: inventoryItemIdSchema,
    inventoryLocationId: inventoryLocationIdSchema,
    reservationId: inventoryReservationIdSchema,
    reservation: inventoryReservationSchema,
    reasonCode: z.literal("RESERVATION_ALREADY_CREATED"),
  })
  .superRefine((decision, context) => {
    if (
      !sameUuid(decision.inventoryItemId, decision.inventoryItem.id) ||
      !sameUuid(
        decision.inventoryItem.giftVariantId,
        decision.reservation.giftVariantId,
      ) ||
      !sameUuid(
        decision.inventoryLocationId,
        decision.reservation.inventoryLocationId,
      ) ||
      !sameUuid(decision.reservationId, decision.reservation.id)
    ) {
      context.addIssue({
        code: "custom",
        message: "reservation replay location must match the reservation",
        path: ["inventoryLocationId"],
      });
    }
  });

export const inventoryReservationCreationDecisionSchema = z
  .union([
    inventoryReservationCreationApplySchema,
    inventoryReservationCreationReplaySchema,
    inventoryReservationCreationRejectionSchema,
  ])
  .meta({
    "x-runtime-invariants": [
      "APPLY and REPLAY bind inventoryItemId, inventoryLocationId, and reservationId to nested snapshots",
      "APPLY advances balance version exactly once and applies exact reservation ledger arithmetic",
    ],
  });

export const inventoryReservationTransitionInputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  inventoryItem: inventoryItemSchema,
  balance: inventoryBalanceSchema,
  reservation: inventoryReservationSchema,
  targetStatus: z.enum(["COMMITTED", "RELEASED", "EXPIRED"]),
  evaluatedAt: contentTimestampSchema,
});

export const inventoryReservationTransitionApplySchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("APPLY"),
    inventoryItem: inventoryItemSchema,
    inventoryItemId: inventoryItemIdSchema,
    inventoryLocationId: inventoryLocationIdSchema,
    reservationId: inventoryReservationIdSchema,
    expectedBalanceVersion: positiveVersionSchema,
    expectedReservationVersion: positiveVersionSchema,
    previousBalance: inventoryBalanceSchema,
    previousReservation: inventoryReservationSchema,
    nextBalance: inventoryBalanceSchema,
    nextReservation: inventoryReservationSchema,
    ledgerDelta: inventoryLedgerDeltaSchema,
    reasonCode: z.enum([
      "RESERVATION_COMMITTED",
      "RESERVATION_RELEASED",
      "RESERVATION_EXPIRED",
    ]),
  })
  .superRefine((decision, context) => {
    const identityMatches =
      sameUuid(decision.inventoryItemId, decision.inventoryItem.id) &&
      sameUuid(
        decision.inventoryItemId,
        decision.previousBalance.inventoryItemId,
      ) &&
      sameUuid(
        decision.inventoryItemId,
        decision.nextBalance.inventoryItemId,
      ) &&
      sameUuid(
        decision.inventoryLocationId,
        decision.previousBalance.inventoryLocationId,
      ) &&
      sameUuid(
        decision.inventoryLocationId,
        decision.nextBalance.inventoryLocationId,
      ) &&
      sameUuid(
        decision.inventoryLocationId,
        decision.previousReservation.inventoryLocationId,
      ) &&
      sameUuid(
        decision.inventoryLocationId,
        decision.nextReservation.inventoryLocationId,
      ) &&
      sameUuid(
        decision.inventoryItem.giftVariantId,
        decision.previousReservation.giftVariantId,
      ) &&
      sameUuid(
        decision.inventoryItem.giftVariantId,
        decision.nextReservation.giftVariantId,
      ) &&
      sameUuid(decision.reservationId, decision.previousReservation.id) &&
      sameUuid(decision.reservationId, decision.nextReservation.id);
    const sameReservation =
      sameUuid(decision.previousReservation.id, decision.nextReservation.id) &&
      sameUuid(
        decision.previousReservation.checkoutQuoteId,
        decision.nextReservation.checkoutQuoteId,
      ) &&
      sameUuid(
        decision.previousReservation.cartItemId,
        decision.nextReservation.cartItemId,
      ) &&
      sameUuid(
        decision.previousReservation.giftVariantId,
        decision.nextReservation.giftVariantId,
      ) &&
      decision.previousReservation.quantity ===
        decision.nextReservation.quantity &&
      decision.previousReservation.expiresAt ===
        decision.nextReservation.expiresAt;
    const versionMatches =
      decision.expectedBalanceVersion === decision.previousBalance.version &&
      decision.nextBalance.version === decision.previousBalance.version + 1 &&
      decision.expectedReservationVersion ===
        decision.previousReservation.version &&
      decision.nextReservation.version ===
        decision.previousReservation.version + 1;
    const expectedReasonCode =
      decision.nextReservation.status === "ACTIVE"
        ? undefined
        : {
            COMMITTED: "RESERVATION_COMMITTED",
            RELEASED: "RESERVATION_RELEASED",
            EXPIRED: "RESERVATION_EXPIRED",
          }[decision.nextReservation.status];
    const expectedDeltaOnHand =
      decision.nextReservation.status === "COMMITTED"
        ? -decision.previousReservation.quantity
        : 0;
    const expectedDeltaReserved = -decision.previousReservation.quantity;
    const transitionMatches =
      decision.previousReservation.status === "ACTIVE" &&
      decision.reasonCode === expectedReasonCode &&
      decision.ledgerDelta.deltaOnHand === expectedDeltaOnHand &&
      decision.ledgerDelta.deltaReserved === expectedDeltaReserved &&
      decision.nextBalance.onHand ===
        decision.previousBalance.onHand + expectedDeltaOnHand &&
      decision.nextBalance.reserved ===
        decision.previousBalance.reserved + expectedDeltaReserved;
    if (
      !identityMatches ||
      !sameReservation ||
      !versionMatches ||
      !transitionMatches
    ) {
      context.addIssue({
        code: "custom",
        message:
          "reservation transition must bind one target and exact state/ledger arithmetic",
      });
    }
  });

const inventoryReservationTransitionReplaySchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("REPLAY"),
    inventoryItem: inventoryItemSchema,
    inventoryItemId: inventoryItemIdSchema,
    inventoryLocationId: inventoryLocationIdSchema,
    reservationId: inventoryReservationIdSchema,
    reservation: inventoryReservationSchema,
  })
  .superRefine((decision, context) => {
    if (
      !sameUuid(decision.inventoryItemId, decision.inventoryItem.id) ||
      !sameUuid(
        decision.inventoryItem.giftVariantId,
        decision.reservation.giftVariantId,
      ) ||
      !sameUuid(
        decision.inventoryLocationId,
        decision.reservation.inventoryLocationId,
      ) ||
      !sameUuid(decision.reservationId, decision.reservation.id) ||
      decision.reservation.status === "ACTIVE"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "reservation transition replay must reference a matching terminal reservation",
      });
    }
  });

export const inventoryReservationTransitionDecisionSchema = z
  .union([
    inventoryReservationTransitionApplySchema,
    inventoryReservationTransitionReplaySchema,
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      kind: z.literal("REJECTED"),
      code: z.enum([
        "BALANCE_INCONSISTENT",
        "INVENTORY_IDENTITY_MISMATCH",
        "RESERVATION_NOT_ACTIVE",
        "RESERVATION_NOT_EXPIRED",
        "VERSION_OVERFLOW",
      ]),
    }),
  ])
  .meta({
    "x-runtime-invariants": [
      "APPLY binds inventory and reservation IDs to both previous and next snapshots",
      "APPLY advances both versions exactly once and applies exact commit, release, or expiry arithmetic",
      "REPLAY references the same terminal reservation and inventory target",
    ],
  });

export type InventoryReservationCreationInput = z.infer<
  typeof inventoryReservationCreationInputSchema
>;
export type InventoryReservationCreationDecision = z.infer<
  typeof inventoryReservationCreationDecisionSchema
>;
export type InventoryReservationCreationApplyDecision = z.infer<
  typeof inventoryReservationCreationApplySchema
>;
export type InventoryReservationTransitionInput = z.infer<
  typeof inventoryReservationTransitionInputSchema
>;
export type InventoryReservationTransitionDecision = z.infer<
  typeof inventoryReservationTransitionDecisionSchema
>;
export type InventoryReservationTransitionApplyDecision = z.infer<
  typeof inventoryReservationTransitionApplySchema
>;

const transitionCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/u);

export const transitionEffectSchema = z.strictObject({
  type: transitionCodeSchema,
});

export type TransitionEffect = z.infer<typeof transitionEffectSchema>;

export function createTransitionDecisionSchema<State extends string>(
  stateSchema: z.ZodType<State>,
) {
  return z
    .discriminatedUnion("decision", [
      z.strictObject({
        schemaVersion: schemaVersionSchema,
        decision: z.literal("APPLIED"),
        from: stateSchema,
        to: stateSchema,
        reasonCode: transitionCodeSchema,
        effects: z.array(transitionEffectSchema).min(1),
      }),
      z.strictObject({
        schemaVersion: schemaVersionSchema,
        decision: z.literal("NOOP"),
        from: stateSchema,
        to: stateSchema,
        reasonCode: z.literal("ALREADY_APPLIED"),
        effects: z.tuple([]),
      }),
      z.strictObject({
        schemaVersion: schemaVersionSchema,
        decision: z.literal("REJECTED"),
        from: stateSchema,
        to: stateSchema,
        reasonCode: transitionCodeSchema,
        effects: z.tuple([]),
      }),
      z.strictObject({
        schemaVersion: schemaVersionSchema,
        decision: z.literal("CONFLICT"),
        from: stateSchema,
        to: stateSchema,
        reasonCode: transitionCodeSchema,
        effects: z.tuple([]),
      }),
    ])
    .superRefine((decision, context) => {
      if (decision.decision === "NOOP" && decision.from !== decision.to) {
        context.addIssue({
          code: "custom",
          message: "NOOP transitions must keep the same state",
          path: ["to"],
        });
      }
    });
}

export type TransitionDecision<State extends string> = z.infer<
  ReturnType<typeof createTransitionDecisionSchema<State>>
>;

export function createCommandTransitionDecisionSchema<
  State extends string,
  InvalidReasonCode extends string,
>(stateSchema: z.ZodType<State>, invalidReasonCode: InvalidReasonCode) {
  return z.union([
    createTransitionDecisionSchema(stateSchema),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      decision: z.literal("INVALID"),
      reasonCode: z.literal(invalidReasonCode),
      effects: z.tuple([]),
    }),
  ]);
}

const providerEnvironmentSchema = z.enum(["TEST", "LIVE"]);

export const paymentAttemptSubjectSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: paymentAttemptIdSchema,
  orderId: orderIdSchema,
  version: positiveVersionSchema,
  status: paymentAttemptStatusSchema,
  providerAccountId: providerAccountIdSchema,
  environment: providerEnvironmentSchema,
  externalReference: externalPaymentReferenceSchema.optional(),
  amountMinor: minorAmountSchema,
  currency: currencySchema,
  providerCallStarted: z.boolean(),
});

const boundPaymentAttemptSubjectSchema = paymentAttemptSubjectSchema.safeExtend(
  {
    externalReference: externalPaymentReferenceSchema,
  },
);

const capturedPaymentAttemptSubjectSchema =
  boundPaymentAttemptSubjectSchema.safeExtend({
    status: z.literal("SUCCEEDED"),
  });

export const orderStateSubjectSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: orderIdSchema,
  version: positiveVersionSchema,
  orderStatus: orderStatusSchema,
  paymentStatus: orderPaymentStatusSchema,
  currentPaymentAttemptId: paymentAttemptIdSchema.nullable(),
});

export const refundStateSubjectSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: refundIdSchema,
  orderId: orderIdSchema,
  paymentAttemptId: paymentAttemptIdSchema,
  version: positiveVersionSchema,
  status: refundStatusSchema,
  providerReference: providerRefundReferenceSchema,
  capturedCurrency: currencySchema,
  capturedAmountMinor: minorAmountSchema,
  requestedAmountMinor: minorAmountSchema,
  currency: currencySchema,
});

const refundCapacityRecordSchema = refundStateSubjectSchema.safeExtend({
  processedAmountMinor: minorAmountSchema,
});

export const disputeStateSubjectSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: disputeIdSchema,
  orderId: orderIdSchema,
  paymentAttemptId: paymentAttemptIdSchema,
  version: positiveVersionSchema,
  status: disputeStatusSchema,
  providerReference: providerDisputeReferenceSchema,
  amountMinor: minorAmountSchema,
  currency: currencySchema,
});

export const fulfillmentStateSubjectSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: fulfillmentIdSchema,
  orderId: orderIdSchema,
  orderItemId: orderItemIdSchema,
  version: positiveVersionSchema,
  status: fulfillmentStatusSchema,
});

const refundCapacityIdentityShape = {
  refundId: refundIdSchema,
  orderId: orderIdSchema,
  paymentAttemptId: paymentAttemptIdSchema,
  refundExpectedVersion: positiveVersionSchema,
  orderExpectedVersion: positiveVersionSchema,
  paymentAttemptExpectedVersion: positiveVersionSchema,
  capturedCurrency: currencySchema,
  capturedAmountMinor: minorAmountSchema,
  requestedCurrency: currencySchema,
  requestedAmountMinor: minorAmountSchema,
} as const;

export const refundCapacityInputSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    order: orderStateSubjectSchema,
    paymentAttempt: capturedPaymentAttemptSubjectSchema,
    refund: refundStateSubjectSchema,
    refunds: z.array(refundCapacityRecordSchema).min(1).max(100),
  })
  .superRefine((input, context) => {
    const currentRefunds = input.refunds.filter((refund) =>
      sameUuid(refund.id, input.refund.id),
    );
    const currentRefund = currentRefunds[0];
    const uniqueRefundIds = new Set(
      input.refunds.map((refund) => refund.id.toLowerCase()),
    );
    if (
      !sameUuid(input.order.id, input.paymentAttempt.orderId) ||
      input.order.currentPaymentAttemptId === null ||
      !sameUuid(input.order.currentPaymentAttemptId, input.paymentAttempt.id) ||
      !sameUuid(input.refund.orderId, input.order.id) ||
      !sameUuid(input.refund.paymentAttemptId, input.paymentAttempt.id) ||
      input.refund.status !== "REQUESTED" ||
      (input.order.paymentStatus !== "PAID" &&
        input.order.paymentStatus !== "PARTIALLY_REFUNDED")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "refund capacity requires the order's current captured payment attempt",
        path: ["paymentAttempt"],
      });
    }
    if (
      currentRefunds.length !== 1 ||
      uniqueRefundIds.size !== input.refunds.length ||
      currentRefund === undefined ||
      currentRefund.version !== input.refund.version ||
      currentRefund.status !== input.refund.status ||
      currentRefund.providerReference !== input.refund.providerReference ||
      currentRefund.capturedCurrency !== input.refund.capturedCurrency ||
      currentRefund.capturedAmountMinor !== input.refund.capturedAmountMinor ||
      currentRefund.requestedAmountMinor !==
        input.refund.requestedAmountMinor ||
      currentRefund.currency !== input.refund.currency ||
      currentRefund.processedAmountMinor !== 0 ||
      input.refunds.some(
        (refund) =>
          !sameUuid(refund.orderId, input.order.id) ||
          !sameUuid(refund.paymentAttemptId, input.paymentAttempt.id) ||
          refund.capturedCurrency !== input.paymentAttempt.currency ||
          (!sameUuid(refund.id, input.refund.id) &&
            refund.currency !== input.paymentAttempt.currency) ||
          refund.capturedAmountMinor !== input.paymentAttempt.amountMinor ||
          refund.processedAmountMinor > refund.requestedAmountMinor ||
          (refund.status === "FAILED" && refund.processedAmountMinor !== 0) ||
          (refund.status === "SUCCEEDED" &&
            refund.processedAmountMinor !== refund.requestedAmountMinor),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "refund capacity requires one complete, identity-consistent persisted refund set",
        path: ["refunds"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "order and paymentAttempt identify the same order",
      "order.currentPaymentAttemptId equals the captured SUCCEEDED paymentAttempt id",
      "order paymentStatus is PAID or PARTIALLY_REFUNDED",
      "refund is REQUESTED and appears exactly once in the complete versioned refund set",
      "all records share the order, payment attempt, capture amount, and capture currency; persisted companion refunds use capture currency while the current request is evaluated explicitly",
    ],
  });

const refundCapacityAvailableDecisionSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    ...refundCapacityIdentityShape,
    kind: z.literal("AVAILABLE"),
    occupiedAmountMinor: minorAmountSchema,
    availableAmountMinor: minorAmountSchema,
  })
  .superRefine((decision, context) => {
    if (
      BigInt(decision.occupiedAmountMinor) +
        BigInt(decision.availableAmountMinor) !==
        BigInt(decision.capturedAmountMinor) ||
      decision.requestedAmountMinor === 0 ||
      decision.requestedCurrency !== decision.capturedCurrency ||
      decision.requestedAmountMinor > decision.occupiedAmountMinor
    ) {
      context.addIssue({
        code: "custom",
        message:
          "available refund capacity must contain exact same-currency capture arithmetic",
      });
    }
  });

const evaluatedRefundCapacityDecisionSchema = z
  .union([
    refundCapacityAvailableDecisionSchema,
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      ...refundCapacityIdentityShape,
      kind: z.literal("REJECTED"),
      code: z.literal("REFUND_CAPACITY_EXCEEDED"),
      occupiedAmountMinor: minorAmountSchema,
      availableAmountMinor: minorAmountSchema,
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      ...refundCapacityIdentityShape,
      kind: z.literal("REJECTED"),
      code: z.enum([
        "REFUND_AMOUNT_INVALID",
        "REFUND_CURRENCY_MISMATCH",
        "REFUND_DATA_INVALID",
      ]),
    }),
  ])
  .superRefine((decision, context) => {
    if (decision.kind === "AVAILABLE") {
      if (
        BigInt(decision.occupiedAmountMinor) +
          BigInt(decision.availableAmountMinor) !==
        BigInt(decision.capturedAmountMinor)
      ) {
        context.addIssue({
          code: "custom",
          message: "occupied and available capacity must equal the capture",
        });
      }
    } else if (
      decision.code === "REFUND_CAPACITY_EXCEEDED" &&
      (decision.occupiedAmountMinor <= decision.capturedAmountMinor ||
        decision.availableAmountMinor !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "exceeded capacity must be over capture with zero available",
      });
    }
    if (
      decision.kind === "AVAILABLE" ||
      decision.code === "REFUND_CAPACITY_EXCEEDED"
    ) {
      if (
        decision.requestedAmountMinor === 0 ||
        decision.requestedCurrency !== decision.capturedCurrency ||
        decision.requestedAmountMinor > decision.occupiedAmountMinor
      ) {
        context.addIssue({
          code: "custom",
          message:
            "evaluated capacity requires a positive same-currency occupied request",
        });
      }
    } else if (
      (decision.code === "REFUND_AMOUNT_INVALID" &&
        decision.requestedAmountMinor !== 0) ||
      (decision.code === "REFUND_CURRENCY_MISMATCH" &&
        (decision.requestedAmountMinor === 0 ||
          decision.requestedCurrency === decision.capturedCurrency))
    ) {
      context.addIssue({
        code: "custom",
        message: "refund rejection code must match the request",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "AVAILABLE means occupiedAmountMinor includes the current request and plus availableAmountMinor equals capturedAmountMinor",
      "REFUND_CAPACITY_EXCEEDED means occupiedAmountMinor exceeds capture and availableAmountMinor is zero",
      "evaluated requests are positive and use capturedCurrency",
    ],
  });

export const refundCapacityDecisionSchema = z.union([
  evaluatedRefundCapacityDecisionSchema,
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    kind: z.literal("REJECTED"),
    code: z.literal("REFUND_DATA_INVALID"),
  }),
]);

export type RefundCapacityInput = z.infer<typeof refundCapacityInputSchema>;
export type RefundCapacityDecision = z.infer<
  typeof refundCapacityDecisionSchema
>;

const paymentProviderEvidenceTargetSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  eventType: z.literal("PAYMENT_STATUS"),
  paymentAttempt: paymentAttemptSubjectSchema,
});
const refundProviderEvidenceTargetSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  eventType: z.literal("REFUND_STATUS"),
  paymentAttempt: capturedPaymentAttemptSubjectSchema,
  providerReference: providerRefundReferenceSchema,
});
const disputeProviderEvidenceTargetSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  eventType: z.literal("DISPUTE_STATUS"),
  paymentAttempt: capturedPaymentAttemptSubjectSchema,
  providerReference: providerDisputeReferenceSchema,
});

export const providerEvidenceTargetSchema = z.discriminatedUnion("eventType", [
  paymentProviderEvidenceTargetSchema,
  refundProviderEvidenceTargetSchema,
  disputeProviderEvidenceTargetSchema,
]);

type ProviderEventValue = z.infer<typeof providerEventSchema>;

function eventMatchesPaymentAttempt(
  event: ProviderEventValue,
  paymentAttempt: PaymentAttemptSubject,
  eventType: ProviderEventValue["eventType"],
): boolean {
  return (
    event.eventType === eventType &&
    event.providerAccountId === paymentAttempt.providerAccountId &&
    event.environment === paymentAttempt.environment &&
    event.currency === paymentAttempt.currency &&
    event.association.status === "MATCHED" &&
    event.association.paymentAttemptId === paymentAttempt.id &&
    (paymentAttempt.externalReference === undefined ||
      event.association.externalReference === paymentAttempt.externalReference)
  );
}

const paymentProviderEventAuthoritySchema = z
  .strictObject({
    kind: z.literal("PROVIDER_EVENT"),
    paymentAttempt: paymentAttemptSubjectSchema,
    event: providerEventSchema,
  })
  .superRefine((authority, context) => {
    if (
      !eventMatchesPaymentAttempt(
        authority.event,
        authority.paymentAttempt,
        "PAYMENT_STATUS",
      ) ||
      authority.event.amountMinor !== authority.paymentAttempt.amountMinor
    ) {
      context.addIssue({
        code: "custom",
        message: "payment event must match the persisted payment attempt",
        path: ["event"],
      });
    }
  });

const refundProviderEventAuthoritySchema = z
  .strictObject({
    kind: z.literal("PROVIDER_EVENT"),
    paymentAttempt: capturedPaymentAttemptSubjectSchema,
    providerReference: providerRefundReferenceSchema,
    event: providerEventSchema,
  })
  .superRefine((authority, context) => {
    if (
      !eventMatchesPaymentAttempt(
        authority.event,
        authority.paymentAttempt,
        "REFUND_STATUS",
      ) ||
      authority.event.eventType !== "REFUND_STATUS" ||
      authority.event.refundReference !== authority.providerReference
    ) {
      context.addIssue({
        code: "custom",
        message: "refund event must match the persisted payment attempt",
        path: ["event"],
      });
    }
  });

const disputeProviderEventAuthoritySchema = z
  .strictObject({
    kind: z.literal("PROVIDER_EVENT"),
    paymentAttempt: capturedPaymentAttemptSubjectSchema,
    providerReference: providerDisputeReferenceSchema,
    event: providerEventSchema,
  })
  .superRefine((authority, context) => {
    if (
      !eventMatchesPaymentAttempt(
        authority.event,
        authority.paymentAttempt,
        "DISPUTE_STATUS",
      ) ||
      authority.event.eventType !== "DISPUTE_STATUS" ||
      authority.event.disputeReference !== authority.providerReference
    ) {
      context.addIssue({
        code: "custom",
        message: "dispute event must match the persisted payment attempt",
        path: ["event"],
      });
    }
  });

export const providerEventAuthoritySchema = z.union([
  paymentProviderEventAuthoritySchema,
  refundProviderEventAuthoritySchema,
  disputeProviderEventAuthoritySchema,
]);

export type PaymentAttemptSubject = z.infer<typeof paymentAttemptSubjectSchema>;
export type OrderStateSubject = z.infer<typeof orderStateSubjectSchema>;
export type RefundStateSubject = z.infer<typeof refundStateSubjectSchema>;
export type DisputeStateSubject = z.infer<typeof disputeStateSubjectSchema>;
export type FulfillmentStateSubject = z.infer<
  typeof fulfillmentStateSubjectSchema
>;
export type ProviderEvidenceTarget = z.infer<
  typeof providerEvidenceTargetSchema
>;
export type ProviderEventAuthority = z.infer<
  typeof providerEventAuthoritySchema
>;

function samePaymentAttemptSubject(
  left: PaymentAttemptSubject,
  right: PaymentAttemptSubject,
): boolean {
  return (
    left.id === right.id &&
    left.orderId === right.orderId &&
    left.version === right.version &&
    left.status === right.status &&
    left.providerAccountId === right.providerAccountId &&
    left.environment === right.environment &&
    left.externalReference === right.externalReference &&
    left.amountMinor === right.amountMinor &&
    left.currency === right.currency &&
    left.providerCallStarted === right.providerCallStarted
  );
}

function orderBindsCapturedPaymentAttempt(
  order: OrderStateSubject,
  paymentAttempt: PaymentAttemptSubject,
): boolean {
  return (
    sameUuid(order.id, paymentAttempt.orderId) &&
    order.currentPaymentAttemptId !== null &&
    sameUuid(order.currentPaymentAttemptId, paymentAttempt.id)
  );
}

function hasRefundableOrderPaymentState(order: OrderStateSubject): boolean {
  return (
    order.paymentStatus === "PAID" ||
    order.paymentStatus === "PARTIALLY_REFUNDED"
  );
}

function hasCapturedOrderPaymentState(order: OrderStateSubject): boolean {
  return (
    hasRefundableOrderPaymentState(order) || order.paymentStatus === "REFUNDED"
  );
}

const paymentTransitionAuthoritySchema = z.union([
  z.strictObject({ kind: z.literal("CREATE_RESULT") }),
  paymentProviderEventAuthoritySchema,
  z.strictObject({
    kind: z.literal("NETWORK_UNCERTAINTY"),
    operationMayHaveCommitted: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("AUDITED_BUSINESS_CANCEL"),
    auditLogId: auditLogIdSchema,
    reasonCode: transitionCodeSchema,
  }),
  z.strictObject({ kind: z.literal("SAFE_EXPIRY") }),
  z.strictObject({ kind: z.literal("BROWSER_RETURN") }),
]);

export const paymentAttemptTransitionCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    subject: paymentAttemptSubjectSchema,
    expectedVersion: positiveVersionSchema,
    target: paymentAttemptStatusSchema,
    authority: paymentTransitionAuthoritySchema,
  })
  .superRefine((command, context) => {
    if (
      (command.authority.kind === "AUDITED_BUSINESS_CANCEL" ||
        command.authority.kind === "SAFE_EXPIRY") &&
      command.subject.providerCallStarted
    ) {
      context.addIssue({
        code: "custom",
        message: "provider call must not have started",
        path: ["subject", "providerCallStarted"],
      });
    }
    if (
      command.authority.kind === "PROVIDER_EVENT" &&
      !samePaymentAttemptSubject(
        command.subject,
        command.authority.paymentAttempt,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "provider evidence must target the command subject",
        path: ["authority", "paymentAttempt"],
      });
    }
  });

const orderLifecycleTransitionAuthoritySchema = z.union([
  z.strictObject({ kind: z.literal("CHECKOUT_CREATED") }),
  paymentProviderEventAuthoritySchema,
  z.strictObject({
    kind: z.literal("AUDITED_BUSINESS_CANCEL"),
    auditLogId: auditLogIdSchema,
    reasonCode: transitionCodeSchema,
  }),
  z.strictObject({ kind: z.literal("FULFILLMENT_COMPLETED") }),
  z.strictObject({ kind: z.literal("HTTP_TIMEOUT") }),
]);

export const orderLifecycleTransitionCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    subject: orderStateSubjectSchema,
    expectedVersion: positiveVersionSchema,
    target: orderStatusSchema,
    authority: orderLifecycleTransitionAuthoritySchema,
  })
  .superRefine((command, context) => {
    if (
      command.authority.kind === "PROVIDER_EVENT" &&
      (command.authority.paymentAttempt.orderId !== command.subject.id ||
        command.authority.paymentAttempt.id !==
          command.subject.currentPaymentAttemptId)
    ) {
      context.addIssue({
        code: "custom",
        message: "payment attempt must belong to the order subject",
        path: ["authority", "paymentAttempt", "orderId"],
      });
    }
  });

const orderPaymentTransitionAuthoritySchema = z.union([
  z.strictObject({
    kind: z.literal("ATTEMPT_CREATED"),
    paymentAttempt: paymentAttemptSubjectSchema,
  }),
  paymentProviderEventAuthoritySchema,
  z.strictObject({
    kind: z.literal("REFUND_TOTALS"),
    paymentAttempt: capturedPaymentAttemptSubjectSchema,
    capturedAmountMinor: minorAmountSchema,
    succeededRefundAmountMinor: minorAmountSchema,
  }),
]);

export const orderPaymentTransitionCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    subject: orderStateSubjectSchema,
    expectedVersion: positiveVersionSchema,
    target: orderPaymentStatusSchema,
    authority: orderPaymentTransitionAuthoritySchema,
  })
  .superRefine((command, context) => {
    const authority = command.authority;
    if (
      (authority.kind === "PROVIDER_EVENT" ||
        authority.kind === "ATTEMPT_CREATED" ||
        authority.kind === "REFUND_TOTALS") &&
      (!sameUuid(authority.paymentAttempt.orderId, command.subject.id) ||
        command.subject.currentPaymentAttemptId === null ||
        !sameUuid(
          authority.paymentAttempt.id,
          command.subject.currentPaymentAttemptId,
        ))
    ) {
      context.addIssue({
        code: "custom",
        message: "payment attempt must belong to the order subject",
        path: ["authority", "paymentAttempt", "orderId"],
      });
    }
    if (
      authority.kind === "REFUND_TOTALS" &&
      authority.capturedAmountMinor !== authority.paymentAttempt.amountMinor
    ) {
      context.addIssue({
        code: "custom",
        message: "refund totals must match the captured payment attempt",
        path: ["authority", "capturedAmountMinor"],
      });
    }
  });

const refundTransitionAuthoritySchema = z.union([
  z.strictObject({
    kind: z.literal("SUBMIT_COMMAND"),
    refunds: z.array(refundCapacityRecordSchema).min(1).max(100),
  }),
  refundProviderEventAuthoritySchema,
  z.strictObject({
    kind: z.literal("NETWORK_UNCERTAINTY"),
    operationMayHaveCommitted: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("BROWSER_RETURN") }),
]);

export const refundTransitionCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    subject: refundStateSubjectSchema,
    order: orderStateSubjectSchema,
    paymentAttempt: capturedPaymentAttemptSubjectSchema,
    expectedVersion: positiveVersionSchema,
    target: refundStatusSchema,
    authority: refundTransitionAuthoritySchema,
  })
  .superRefine((command, context) => {
    if (
      !orderBindsCapturedPaymentAttempt(
        command.order,
        command.paymentAttempt,
      ) ||
      !hasCapturedOrderPaymentState(command.order) ||
      !sameUuid(command.subject.orderId, command.order.id) ||
      !sameUuid(command.subject.paymentAttemptId, command.paymentAttempt.id) ||
      command.subject.capturedCurrency !== command.paymentAttempt.currency ||
      command.subject.capturedAmountMinor !==
        command.paymentAttempt.amountMinor ||
      command.subject.currency !== command.paymentAttempt.currency ||
      command.subject.requestedAmountMinor === 0 ||
      command.subject.requestedAmountMinor > command.paymentAttempt.amountMinor
    ) {
      context.addIssue({
        code: "custom",
        message:
          "refund must bind to the order's current captured payment attempt",
        path: ["paymentAttempt"],
      });
    }
    if (
      command.authority.kind === "SUBMIT_COMMAND" &&
      (!hasRefundableOrderPaymentState(command.order) ||
        !refundCapacityInputSchema.safeParse({
          schemaVersion: 1,
          order: command.order,
          paymentAttempt: command.paymentAttempt,
          refund: command.subject,
          refunds: command.authority.refunds,
        }).success)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "refund submission requires a refundable paid order and complete persisted refund set",
        path: ["authority", "refunds"],
      });
    }
    if (
      command.order.paymentStatus === "REFUNDED" &&
      command.subject.status !== "SUCCEEDED" &&
      command.subject.status !== "FAILED"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "a fully refunded order only accepts terminal refund replay or conflict observation",
        path: ["subject", "status"],
      });
    }
    if (
      command.authority.kind === "PROVIDER_EVENT" &&
      (!samePaymentAttemptSubject(
        command.paymentAttempt,
        command.authority.paymentAttempt,
      ) ||
        !sameUuid(
          command.subject.paymentAttemptId,
          command.authority.paymentAttempt.id,
        ) ||
        !sameUuid(
          command.subject.orderId,
          command.authority.paymentAttempt.orderId,
        ) ||
        command.subject.providerReference !==
          command.authority.providerReference ||
        command.subject.requestedAmountMinor !==
          command.authority.event.amountMinor ||
        command.subject.currency !== command.authority.event.currency)
    ) {
      context.addIssue({
        code: "custom",
        message: "refund evidence must match the refund subject",
        path: ["authority"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "refund, order, and captured SUCCEEDED paymentAttempt share identity",
      "order.currentPaymentAttemptId equals paymentAttempt.id",
      "all authorities require a captured order payment state; only SUBMIT_COMMAND requires remaining refundable capacity",
      "a REFUNDED order accepts only terminal refund subjects, so no further refund mutation can be applied",
      "refund currency matches capture currency and requested amount does not exceed capture",
      "SUBMIT_COMMAND carries one complete versioned refund set loaded under the same transaction lock",
      "provider authority paymentAttempt exactly matches the persisted paymentAttempt snapshot",
    ],
  });

const disputeTransitionAuthoritySchema = z.union([
  disputeProviderEventAuthoritySchema,
  z.strictObject({ kind: z.literal("BROWSER_RETURN") }),
]);

export const disputeTransitionCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    subject: disputeStateSubjectSchema,
    order: orderStateSubjectSchema,
    paymentAttempt: capturedPaymentAttemptSubjectSchema,
    expectedVersion: positiveVersionSchema,
    target: disputeStatusSchema,
    authority: disputeTransitionAuthoritySchema,
  })
  .superRefine((command, context) => {
    if (
      !orderBindsCapturedPaymentAttempt(
        command.order,
        command.paymentAttempt,
      ) ||
      !hasCapturedOrderPaymentState(command.order) ||
      !sameUuid(command.subject.orderId, command.order.id) ||
      !sameUuid(command.subject.paymentAttemptId, command.paymentAttempt.id) ||
      command.subject.currency !== command.paymentAttempt.currency ||
      command.subject.amountMinor > command.paymentAttempt.amountMinor
    ) {
      context.addIssue({
        code: "custom",
        message:
          "dispute must bind to the order's current captured payment attempt",
        path: ["paymentAttempt"],
      });
    }
    if (
      command.authority.kind === "PROVIDER_EVENT" &&
      (!samePaymentAttemptSubject(
        command.paymentAttempt,
        command.authority.paymentAttempt,
      ) ||
        !sameUuid(
          command.subject.paymentAttemptId,
          command.authority.paymentAttempt.id,
        ) ||
        !sameUuid(
          command.subject.orderId,
          command.authority.paymentAttempt.orderId,
        ) ||
        command.subject.providerReference !==
          command.authority.providerReference ||
        command.subject.amountMinor !== command.authority.event.amountMinor ||
        command.subject.currency !== command.authority.event.currency)
    ) {
      context.addIssue({
        code: "custom",
        message: "dispute evidence must match the dispute subject",
        path: ["authority"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "dispute, order, and captured SUCCEEDED paymentAttempt share identity",
      "order.currentPaymentAttemptId equals paymentAttempt.id",
      "order paymentStatus reflects a captured payment, including a fully refunded capture",
      "dispute currency matches capture currency and amount does not exceed capture",
      "provider authority paymentAttempt exactly matches the persisted paymentAttempt snapshot",
    ],
  });

const fulfillmentOperatorAuthoritySchema = z.strictObject({
  kind: z.literal("OPERATOR_COMMAND"),
  reasonCode: transitionCodeSchema.optional(),
});

export const fulfillmentTransitionCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    subject: fulfillmentStateSubjectSchema,
    order: orderStateSubjectSchema,
    expectedVersion: positiveVersionSchema,
    target: fulfillmentStatusSchema,
    authority: fulfillmentOperatorAuthoritySchema,
  })
  .superRefine((command, context) => {
    if (!sameUuid(command.subject.orderId, command.order.id)) {
      context.addIssue({
        code: "custom",
        message: "fulfillment must belong to the persisted order subject",
        path: ["order", "id"],
      });
    }
    if (
      (command.target === "PENDING" ||
        command.target === "PREPARING" ||
        command.target === "DELIVERED") &&
      (command.order.orderStatus !== "OPEN" ||
        (command.order.paymentStatus !== "PAID" &&
          command.order.paymentStatus !== "PARTIALLY_REFUNDED"))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "active fulfillment requires an open paid or partially refunded order",
        path: ["order", "paymentStatus"],
      });
    }
    if (
      (command.target === "ON_HOLD" || command.target === "CANCELED") &&
      command.authority.reasonCode === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "hold and cancellation commands require a reason code",
        path: ["authority", "reasonCode"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "fulfillment.orderId equals order.id",
      "PENDING, PREPARING, and DELIVERED targets require an OPEN order with PAID or PARTIALLY_REFUNDED paymentStatus",
    ],
  });

function createSubjectTransitionDecisionSchema<
  State extends string,
  SubjectShape extends z.ZodRawShape,
  ReasonCode extends string,
  EffectType extends string,
  InvalidReasonCode extends string,
>(
  stateSchema: z.ZodType<State>,
  subjectShape: SubjectShape,
  reasonCodeSchema: z.ZodType<ReasonCode>,
  effectTypeSchema: z.ZodType<EffectType>,
  invalidReasonCode: InvalidReasonCode,
) {
  const identityShape = {
    ...subjectShape,
    expectedVersion: positiveVersionSchema,
  } as const;
  const effectSchema = z.strictObject({ type: effectTypeSchema });
  return z.union([
    z
      .discriminatedUnion("decision", [
        z.strictObject({
          schemaVersion: schemaVersionSchema,
          ...identityShape,
          decision: z.literal("APPLIED"),
          from: stateSchema,
          to: stateSchema,
          reasonCode: reasonCodeSchema,
          effects: z.array(effectSchema).min(1),
        }),
        z.strictObject({
          schemaVersion: schemaVersionSchema,
          ...identityShape,
          decision: z.literal("NOOP"),
          from: stateSchema,
          to: stateSchema,
          reasonCode: z.literal("ALREADY_APPLIED"),
          effects: z.tuple([]),
        }),
        z.strictObject({
          schemaVersion: schemaVersionSchema,
          ...identityShape,
          decision: z.literal("REJECTED"),
          from: stateSchema,
          to: stateSchema,
          reasonCode: reasonCodeSchema,
          effects: z.tuple([]),
        }),
        z.strictObject({
          schemaVersion: schemaVersionSchema,
          ...identityShape,
          decision: z.literal("CONFLICT"),
          from: stateSchema,
          to: stateSchema,
          reasonCode: reasonCodeSchema,
          effects: z.tuple([]),
        }),
      ])
      .superRefine((decision, context) => {
        const transition = decision as {
          decision: "APPLIED" | "NOOP" | "REJECTED" | "CONFLICT";
          from: State;
          to: State;
        };
        if (
          transition.decision === "NOOP" &&
          transition.from !== transition.to
        ) {
          context.addIssue({
            code: "custom",
            message: "NOOP transitions must keep the same state",
            path: ["to"],
          });
        }
        if (
          transition.decision === "APPLIED" &&
          transition.from === transition.to
        ) {
          context.addIssue({
            code: "custom",
            message: "APPLIED transitions must change state",
            path: ["to"],
          });
        }
      }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      decision: z.literal("INVALID"),
      reasonCode: z.literal(invalidReasonCode),
      effects: z.tuple([]),
    }),
  ]);
}

type TransitionDecisionSemanticValue = Readonly<{
  decision: "APPLIED" | "NOOP" | "REJECTED" | "CONFLICT" | "INVALID";
  from?: string;
  to?: string;
  reasonCode: string;
  effects: readonly Readonly<{ type: string }>[];
}>;

type AppliedTransitionSemanticRule = Readonly<{
  from: string;
  to: string;
  reasonCode: string;
  effects: readonly string[];
}>;

type ConflictTransitionSemanticRule = Readonly<{
  from: string;
  reasonCode: string;
}>;

type TransitionSemanticRules = Readonly<{
  applied: readonly AppliedTransitionSemanticRule[];
  rejectedReasonCodes: ReadonlySet<string>;
  conflicts: readonly ConflictTransitionSemanticRule[];
}>;

function hasExactTransitionEffects(
  effects: readonly Readonly<{ type: string }>[],
  expected: readonly string[],
): boolean {
  return (
    effects.length === expected.length &&
    effects.every(({ type }, index) => type === expected[index])
  );
}

function hasValidTransitionSemantics(
  decision: TransitionDecisionSemanticValue,
  rules: TransitionSemanticRules,
): boolean {
  switch (decision.decision) {
    case "INVALID":
      return true;
    case "NOOP":
      return decision.from === decision.to;
    case "REJECTED":
      return rules.rejectedReasonCodes.has(decision.reasonCode);
    case "CONFLICT":
      return (
        decision.from !== decision.to &&
        rules.conflicts.some(
          (rule) =>
            rule.from === decision.from &&
            rule.reasonCode === decision.reasonCode,
        )
      );
    case "APPLIED":
      return rules.applied.some(
        (rule) =>
          rule.from === decision.from &&
          rule.to === decision.to &&
          rule.reasonCode === decision.reasonCode &&
          hasExactTransitionEffects(decision.effects, rule.effects),
      );
  }
}

function addTransitionSemanticIssue(
  decision: TransitionDecisionSemanticValue,
  rules: TransitionSemanticRules,
  context: z.core.$RefinementCtx,
) {
  if (!hasValidTransitionSemantics(decision, rules)) {
    context.addIssue({
      code: "custom",
      message:
        "transition decision must match an allowed edge, reason, and exact effect set",
    });
  }
}

const PAYMENT_STATUS_CHANGED_EFFECT = ["PAYMENT_STATUS_CHANGED"] as const;
const PAYMENT_UNKNOWN_EFFECTS = [
  "PAYMENT_STATUS_CHANGED",
  "PAYMENT_RECONCILIATION_REQUIRED",
] as const;
const paymentProviderAppliedEdges = [
  ["CREATED", "REQUIRES_ACTION"],
  ["CREATED", "PROCESSING"],
  ["CREATED", "FAILED"],
  ["CREATED", "CANCELED"],
  ["CREATED", "EXPIRED"],
  ["REQUIRES_ACTION", "PROCESSING"],
  ["REQUIRES_ACTION", "FAILED"],
  ["REQUIRES_ACTION", "CANCELED"],
  ["REQUIRES_ACTION", "EXPIRED"],
  ["PROCESSING", "FAILED"],
  ["PROCESSING", "CANCELED"],
  ["PROCESSING", "EXPIRED"],
  ["UNKNOWN", "PROCESSING"],
  ["UNKNOWN", "FAILED"],
  ["UNKNOWN", "CANCELED"],
  ["UNKNOWN", "EXPIRED"],
] as const;
const paymentTransitionSemanticRules: TransitionSemanticRules = {
  applied: [
    {
      from: "CREATED",
      to: "REQUIRES_ACTION",
      reasonCode: "PAYMENT_CREATE_RESULT_RECORDED",
      effects: PAYMENT_STATUS_CHANGED_EFFECT,
    },
    {
      from: "CREATED",
      to: "PROCESSING",
      reasonCode: "PAYMENT_CREATE_RESULT_RECORDED",
      effects: PAYMENT_STATUS_CHANGED_EFFECT,
    },
    {
      from: "CREATED",
      to: "CANCELED",
      reasonCode: "PAYMENT_CANCELED_BEFORE_PROVIDER_CALL",
      effects: PAYMENT_STATUS_CHANGED_EFFECT,
    },
    {
      from: "CREATED",
      to: "EXPIRED",
      reasonCode: "PAYMENT_EXPIRED_BEFORE_PROVIDER_CALL",
      effects: PAYMENT_STATUS_CHANGED_EFFECT,
    },
    ...(["CREATED", "REQUIRES_ACTION", "PROCESSING"] as const).map((from) => ({
      from,
      to: "UNKNOWN",
      reasonCode: "PAYMENT_RESULT_UNCERTAIN",
      effects: PAYMENT_UNKNOWN_EFFECTS,
    })),
    ...paymentProviderAppliedEdges.map(([from, to]) => ({
      from,
      to,
      reasonCode: "PAYMENT_PROVIDER_STATUS_CONFIRMED",
      effects: PAYMENT_STATUS_CHANGED_EFFECT,
    })),
  ],
  rejectedReasonCodes: new Set([
    "PAYMENT_STALE_VERSION",
    "PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
    "PAYMENT_TRANSITION_NOT_ALLOWED",
    "PAYMENT_UNCERTAINTY_NOT_ESTABLISHED",
    "PAYMENT_AUDITED_CANCEL_INVALID",
    "PAYMENT_PROVIDER_EVIDENCE_REQUIRED",
    "PAYMENT_PROVIDER_EVIDENCE_INVALID",
    "PAYMENT_EVIDENCE_STATUS_MISMATCH",
  ]),
  conflicts: ["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].map((from) => ({
    from,
    reasonCode: "PAYMENT_TERMINAL_STATE_CONFLICT",
  })),
};

const ORDER_STATUS_CHANGED_EFFECT = ["ORDER_STATUS_CHANGED"] as const;
const orderLifecycleTransitionSemanticRules: TransitionSemanticRules = {
  applied: [
    {
      from: "DRAFT",
      to: "PENDING_PAYMENT",
      reasonCode: "ORDER_CHECKOUT_CREATED",
      effects: ORDER_STATUS_CHANGED_EFFECT,
    },
    {
      from: "PENDING_PAYMENT",
      to: "CANCELED",
      reasonCode: "ORDER_CANCELED",
      effects: ORDER_STATUS_CHANGED_EFFECT,
    },
    {
      from: "OPEN",
      to: "CLOSED",
      reasonCode: "ORDER_FULFILLMENT_COMPLETED",
      effects: ORDER_STATUS_CHANGED_EFFECT,
    },
  ],
  rejectedReasonCodes: new Set([
    "ORDER_LIFECYCLE_STALE_VERSION",
    "ORDER_LATE_SUCCESS_PLANNER_REQUIRED",
    "ORDER_TRANSITION_NOT_ALLOWED",
    "ORDER_PROVIDER_EVIDENCE_INVALID",
    "ORDER_AUDITED_CANCEL_INVALID",
    "ORDER_CANCELLATION_NOT_AUTHORIZED",
    "ORDER_AUTHORITY_REQUIRED",
  ]),
  conflicts: [{ from: "CLOSED", reasonCode: "ORDER_TERMINAL_STATE_CONFLICT" }],
};

const ORDER_PAYMENT_STATUS_CHANGED_EFFECT = [
  "ORDER_PAYMENT_STATUS_CHANGED",
] as const;
const orderPaymentTransitionSemanticRules: TransitionSemanticRules = {
  applied: [
    {
      from: "UNPAID",
      to: "PENDING",
      reasonCode: "ORDER_PAYMENT_ATTEMPT_CREATED",
      effects: ORDER_PAYMENT_STATUS_CHANGED_EFFECT,
    },
    ...(
      [
        ["PAID", "PARTIALLY_REFUNDED"],
        ["PAID", "REFUNDED"],
        ["PARTIALLY_REFUNDED", "REFUNDED"],
      ] as const
    ).map(([from, to]) => ({
      from,
      to,
      reasonCode: "ORDER_REFUND_TOTAL_CONFIRMED",
      effects: ORDER_PAYMENT_STATUS_CHANGED_EFFECT,
    })),
  ],
  rejectedReasonCodes: new Set([
    "ORDER_PAYMENT_STALE_VERSION",
    "ORDER_PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
    "ORDER_PAYMENT_TRANSITION_NOT_ALLOWED",
    "ORDER_PROVIDER_EVIDENCE_INVALID",
    "ORDER_REFUND_TOTAL_MISMATCH",
    "ORDER_PAYMENT_AUTHORITY_REQUIRED",
  ]),
  conflicts: [
    {
      from: "REFUNDED",
      reasonCode: "ORDER_PAYMENT_TERMINAL_STATE_CONFLICT",
    },
  ],
};

const REFUND_STATUS_CHANGED_EFFECT = ["REFUND_STATUS_CHANGED"] as const;
const refundProviderAppliedEdges = [
  ["SUBMITTING", "PROCESSING"],
  ["SUBMITTING", "SUCCEEDED"],
  ["SUBMITTING", "FAILED"],
  ["PROCESSING", "SUCCEEDED"],
  ["PROCESSING", "FAILED"],
  ["UNKNOWN", "PROCESSING"],
  ["UNKNOWN", "SUCCEEDED"],
  ["UNKNOWN", "FAILED"],
] as const;
const refundTransitionSemanticRules: TransitionSemanticRules = {
  applied: [
    {
      from: "REQUESTED",
      to: "SUBMITTING",
      reasonCode: "REFUND_SUBMISSION_STARTED",
      effects: REFUND_STATUS_CHANGED_EFFECT,
    },
    ...(["SUBMITTING", "PROCESSING"] as const).map((from) => ({
      from,
      to: "UNKNOWN",
      reasonCode: "REFUND_RESULT_UNCERTAIN",
      effects: ["REFUND_STATUS_CHANGED", "REFUND_RECONCILIATION_REQUIRED"],
    })),
    ...refundProviderAppliedEdges.map(([from, to]) => ({
      from,
      to,
      reasonCode: "REFUND_PROVIDER_STATUS_CONFIRMED",
      effects:
        to === "SUCCEEDED"
          ? (["REFUND_STATUS_CHANGED", "REFUND_SUCCEEDED"] as const)
          : REFUND_STATUS_CHANGED_EFFECT,
    })),
  ],
  rejectedReasonCodes: new Set([
    "REFUND_STALE_VERSION",
    "REFUND_CAPACITY_EXCEEDED",
    "REFUND_CAPACITY_CONTEXT_INVALID",
    "REFUND_TRANSITION_NOT_ALLOWED",
    "REFUND_UNCERTAINTY_NOT_ESTABLISHED",
    "REFUND_PROVIDER_EVIDENCE_REQUIRED",
    "REFUND_PROVIDER_EVIDENCE_INVALID",
    "REFUND_EVIDENCE_STATUS_MISMATCH",
  ]),
  conflicts: ["SUCCEEDED", "FAILED"].map((from) => ({
    from,
    reasonCode: "REFUND_TERMINAL_STATE_CONFLICT",
  })),
};

const disputeTransitionSemanticRules: TransitionSemanticRules = {
  applied: [
    ...(["OPEN", "WON", "LOST"] as const).map((to) => ({
      from: "NONE",
      to,
      reasonCode: "DISPUTE_PROVIDER_STATUS_CONFIRMED",
      effects: ["DISPUTE_STATUS_CHANGED"],
    })),
    ...(["WON", "LOST"] as const).map((to) => ({
      from: "OPEN",
      to,
      reasonCode: "DISPUTE_PROVIDER_STATUS_CONFIRMED",
      effects: ["DISPUTE_STATUS_CHANGED"],
    })),
  ],
  rejectedReasonCodes: new Set([
    "DISPUTE_STALE_VERSION",
    "DISPUTE_TRANSITION_NOT_ALLOWED",
    "DISPUTE_PROVIDER_EVIDENCE_REQUIRED",
    "DISPUTE_PROVIDER_EVIDENCE_INVALID",
    "DISPUTE_EVIDENCE_STATUS_MISMATCH",
  ]),
  conflicts: ["WON", "LOST"].map((from) => ({
    from,
    reasonCode: "DISPUTE_TERMINAL_STATE_CONFLICT",
  })),
};

const fulfillmentAppliedEdges = [
  ["PENDING", "PREPARING"],
  ["PENDING", "ON_HOLD"],
  ["PENDING", "CANCELED"],
  ["PREPARING", "DELIVERED"],
  ["PREPARING", "ON_HOLD"],
  ["PREPARING", "CANCELED"],
  ["ON_HOLD", "PENDING"],
  ["ON_HOLD", "PREPARING"],
  ["ON_HOLD", "CANCELED"],
] as const;
const fulfillmentTransitionSemanticRules: TransitionSemanticRules = {
  applied: fulfillmentAppliedEdges.map(([from, to]) => ({
    from,
    to,
    reasonCode: "FULFILLMENT_OPERATOR_TRANSITION",
    effects: ["FULFILLMENT_STATUS_CHANGED"],
  })),
  rejectedReasonCodes: new Set([
    "FULFILLMENT_TRANSITION_NOT_ALLOWED",
    "FULFILLMENT_STALE_VERSION",
    "FULFILLMENT_REASON_REQUIRED",
  ]),
  conflicts: ["DELIVERED", "CANCELED"].map((from) => ({
    from,
    reasonCode: "FULFILLMENT_TERMINAL_STATE_CONFLICT",
  })),
};

const paymentTransitionReasonCodeSchema = z.enum([
  "PAYMENT_STALE_VERSION",
  "PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
  "PAYMENT_TERMINAL_STATE_CONFLICT",
  "PAYMENT_TRANSITION_NOT_ALLOWED",
  "PAYMENT_RESULT_UNCERTAIN",
  "PAYMENT_UNCERTAINTY_NOT_ESTABLISHED",
  "PAYMENT_CREATE_RESULT_RECORDED",
  "PAYMENT_AUDITED_CANCEL_INVALID",
  "PAYMENT_CANCELED_BEFORE_PROVIDER_CALL",
  "PAYMENT_EXPIRED_BEFORE_PROVIDER_CALL",
  "PAYMENT_PROVIDER_EVIDENCE_REQUIRED",
  "PAYMENT_PROVIDER_EVIDENCE_INVALID",
  "PAYMENT_EVIDENCE_STATUS_MISMATCH",
  "PAYMENT_PROVIDER_STATUS_CONFIRMED",
]);
const paymentTransitionEffectTypeSchema = z.enum([
  "PAYMENT_STATUS_CHANGED",
  "PAYMENT_RECONCILIATION_REQUIRED",
  "PAYMENT_SUCCEEDED",
]);
const orderLifecycleTransitionReasonCodeSchema = z.enum([
  "ORDER_LIFECYCLE_STALE_VERSION",
  "ORDER_LATE_SUCCESS_PLANNER_REQUIRED",
  "ORDER_TERMINAL_STATE_CONFLICT",
  "ORDER_TRANSITION_NOT_ALLOWED",
  "ORDER_PROVIDER_EVIDENCE_INVALID",
  "ORDER_CHECKOUT_CREATED",
  "ORDER_PAYMENT_CONFIRMED",
  "ORDER_AUDITED_CANCEL_INVALID",
  "ORDER_CANCELED",
  "ORDER_CANCELLATION_NOT_AUTHORIZED",
  "ORDER_FULFILLMENT_COMPLETED",
  "ORDER_AUTHORITY_REQUIRED",
]);
const orderPaymentTransitionReasonCodeSchema = z.enum([
  "ORDER_PAYMENT_STALE_VERSION",
  "ORDER_PAYMENT_LATE_SUCCESS_PLANNER_REQUIRED",
  "ORDER_PAYMENT_TERMINAL_STATE_CONFLICT",
  "ORDER_PAYMENT_TRANSITION_NOT_ALLOWED",
  "ORDER_PROVIDER_EVIDENCE_INVALID",
  "ORDER_PAYMENT_ATTEMPT_CREATED",
  "ORDER_PAYMENT_CONFIRMED",
  "ORDER_REFUND_TOTAL_MISMATCH",
  "ORDER_REFUND_TOTAL_CONFIRMED",
  "ORDER_PAYMENT_AUTHORITY_REQUIRED",
]);
const refundTransitionReasonCodeSchema = z.enum([
  "REFUND_STALE_VERSION",
  "REFUND_CAPACITY_EXCEEDED",
  "REFUND_CAPACITY_CONTEXT_INVALID",
  "REFUND_TERMINAL_STATE_CONFLICT",
  "REFUND_TRANSITION_NOT_ALLOWED",
  "REFUND_SUBMISSION_STARTED",
  "REFUND_RESULT_UNCERTAIN",
  "REFUND_UNCERTAINTY_NOT_ESTABLISHED",
  "REFUND_PROVIDER_EVIDENCE_REQUIRED",
  "REFUND_PROVIDER_EVIDENCE_INVALID",
  "REFUND_EVIDENCE_STATUS_MISMATCH",
  "REFUND_PROVIDER_STATUS_CONFIRMED",
]);
const disputeTransitionReasonCodeSchema = z.enum([
  "DISPUTE_STALE_VERSION",
  "DISPUTE_TERMINAL_STATE_CONFLICT",
  "DISPUTE_TRANSITION_NOT_ALLOWED",
  "DISPUTE_PROVIDER_EVIDENCE_REQUIRED",
  "DISPUTE_PROVIDER_EVIDENCE_INVALID",
  "DISPUTE_EVIDENCE_STATUS_MISMATCH",
  "DISPUTE_PROVIDER_STATUS_CONFIRMED",
]);
const fulfillmentTransitionReasonCodeSchema = z.enum([
  "FULFILLMENT_TERMINAL_STATE_CONFLICT",
  "FULFILLMENT_TRANSITION_NOT_ALLOWED",
  "FULFILLMENT_STALE_VERSION",
  "FULFILLMENT_REASON_REQUIRED",
  "FULFILLMENT_OPERATOR_TRANSITION",
]);

export const paymentAttemptTransitionDecisionSchema =
  createSubjectTransitionDecisionSchema(
    paymentAttemptStatusSchema,
    {
      paymentAttemptId: paymentAttemptIdSchema,
      orderId: orderIdSchema,
    },
    paymentTransitionReasonCodeSchema,
    paymentTransitionEffectTypeSchema,
    "INVALID_PAYMENT_ATTEMPT_TRANSITION_COMMAND",
  )
    .superRefine((decision, context) => {
      addTransitionSemanticIssue(
        decision as TransitionDecisionSemanticValue,
        paymentTransitionSemanticRules,
        context,
      );
    })
    .meta({
      "x-runtime-invariants": [
        "decision, from/to edge, reasonCode, and ordered effects must match the payment transition matrix",
        "public payment success is rejected in favor of the aggregate late-success planner",
      ],
    });
export const orderLifecycleTransitionDecisionSchema =
  createSubjectTransitionDecisionSchema(
    orderStatusSchema,
    {
      orderId: orderIdSchema,
      paymentAttemptId: paymentAttemptIdSchema.nullable(),
    },
    orderLifecycleTransitionReasonCodeSchema,
    z.literal("ORDER_STATUS_CHANGED"),
    "INVALID_ORDER_LIFECYCLE_TRANSITION_COMMAND",
  )
    .superRefine((decision, context) => {
      addTransitionSemanticIssue(
        decision as TransitionDecisionSemanticValue,
        orderLifecycleTransitionSemanticRules,
        context,
      );
    })
    .meta({
      "x-runtime-invariants": [
        "decision, from/to edge, reasonCode, and effects must match the order lifecycle transition matrix",
        "public order payment success is rejected in favor of the aggregate late-success planner",
      ],
    });
export const orderPaymentTransitionDecisionSchema =
  createSubjectTransitionDecisionSchema(
    orderPaymentStatusSchema,
    {
      orderId: orderIdSchema,
      paymentAttemptId: paymentAttemptIdSchema.nullable(),
    },
    orderPaymentTransitionReasonCodeSchema,
    z.literal("ORDER_PAYMENT_STATUS_CHANGED"),
    "INVALID_ORDER_PAYMENT_TRANSITION_COMMAND",
  )
    .superRefine((decision, context) => {
      addTransitionSemanticIssue(
        decision as TransitionDecisionSemanticValue,
        orderPaymentTransitionSemanticRules,
        context,
      );
    })
    .meta({
      "x-runtime-invariants": [
        "decision, from/to edge, reasonCode, and effects must match the order payment transition matrix",
        "public PAID confirmation is rejected in favor of the aggregate late-success planner",
      ],
    });
export const refundTransitionDecisionSchema =
  createSubjectTransitionDecisionSchema(
    refundStatusSchema,
    {
      refundId: refundIdSchema,
      orderId: orderIdSchema,
      paymentAttemptId: paymentAttemptIdSchema,
      providerReference: providerRefundReferenceSchema,
      orderExpectedVersion: positiveVersionSchema,
      paymentAttemptExpectedVersion: positiveVersionSchema,
      capacity: refundCapacityAvailableDecisionSchema.optional(),
    },
    refundTransitionReasonCodeSchema,
    z.enum([
      "REFUND_STATUS_CHANGED",
      "REFUND_RECONCILIATION_REQUIRED",
      "REFUND_SUCCEEDED",
    ]),
    "INVALID_REFUND_TRANSITION_COMMAND",
  )
    .superRefine((decision, context) => {
      addTransitionSemanticIssue(
        decision as TransitionDecisionSemanticValue,
        refundTransitionSemanticRules,
        context,
      );
      const boundDecision = decision as TransitionDecisionSemanticValue & {
        refundId?: string;
        orderId?: string;
        paymentAttemptId?: string;
        expectedVersion?: number;
        orderExpectedVersion?: number;
        paymentAttemptExpectedVersion?: number;
        capacity?: RefundCapacityDecision;
      };
      const isAppliedSubmission =
        boundDecision.decision === "APPLIED" &&
        boundDecision.reasonCode === "REFUND_SUBMISSION_STARTED";
      const hasCapacity = boundDecision.capacity !== undefined;
      if (
        isAppliedSubmission !== hasCapacity ||
        (isAppliedSubmission && boundDecision.capacity?.kind !== "AVAILABLE")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "only an applied refund submission must carry an AVAILABLE capacity decision",
          path: ["capacity"],
        });
      }
      if (
        boundDecision.capacity?.kind === "AVAILABLE" &&
        (boundDecision.refundId === undefined ||
          !sameUuid(boundDecision.refundId, boundDecision.capacity.refundId) ||
          boundDecision.orderId === undefined ||
          !sameUuid(boundDecision.orderId, boundDecision.capacity.orderId) ||
          boundDecision.paymentAttemptId === undefined ||
          !sameUuid(
            boundDecision.paymentAttemptId,
            boundDecision.capacity.paymentAttemptId,
          ) ||
          boundDecision.expectedVersion !==
            boundDecision.capacity.refundExpectedVersion ||
          boundDecision.orderExpectedVersion !==
            boundDecision.capacity.orderExpectedVersion ||
          boundDecision.paymentAttemptExpectedVersion !==
            boundDecision.capacity.paymentAttemptExpectedVersion)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "refund submission capacity must match all decision subjects",
          path: ["capacity"],
        });
      }
    })
    .meta({
      "x-runtime-invariants": [
        "decision, from/to edge, reasonCode, and ordered effects must match the refund transition matrix",
        "only APPLIED REFUND_SUBMISSION_STARTED carries AVAILABLE capacity bound to all IDs and expected versions",
      ],
    });
export const disputeTransitionDecisionSchema =
  createSubjectTransitionDecisionSchema(
    disputeStatusSchema,
    {
      disputeId: disputeIdSchema,
      orderId: orderIdSchema,
      paymentAttemptId: paymentAttemptIdSchema,
      providerReference: providerDisputeReferenceSchema,
      orderExpectedVersion: positiveVersionSchema,
      paymentAttemptExpectedVersion: positiveVersionSchema,
    },
    disputeTransitionReasonCodeSchema,
    z.literal("DISPUTE_STATUS_CHANGED"),
    "INVALID_DISPUTE_TRANSITION_COMMAND",
  )
    .superRefine((decision, context) => {
      addTransitionSemanticIssue(
        decision as TransitionDecisionSemanticValue,
        disputeTransitionSemanticRules,
        context,
      );
    })
    .meta({
      "x-runtime-invariants": [
        "decision, from/to edge, reasonCode, and effects must match the dispute transition matrix",
      ],
    });
export const fulfillmentTransitionDecisionSchema =
  createSubjectTransitionDecisionSchema(
    fulfillmentStatusSchema,
    {
      fulfillmentId: fulfillmentIdSchema,
      orderId: orderIdSchema,
      orderItemId: orderItemIdSchema,
      orderExpectedVersion: positiveVersionSchema,
    },
    fulfillmentTransitionReasonCodeSchema,
    z.literal("FULFILLMENT_STATUS_CHANGED"),
    "INVALID_FULFILLMENT_TRANSITION_COMMAND",
  )
    .superRefine((decision, context) => {
      addTransitionSemanticIssue(
        decision as TransitionDecisionSemanticValue,
        fulfillmentTransitionSemanticRules,
        context,
      );
    })
    .meta({
      "x-runtime-invariants": [
        "decision, from/to edge, reasonCode, and effects must match the fulfillment transition matrix",
      ],
    });

export type PaymentAttemptTransitionCommand = z.infer<
  typeof paymentAttemptTransitionCommandSchema
>;
export type OrderLifecycleTransitionCommand = z.infer<
  typeof orderLifecycleTransitionCommandSchema
>;
export type OrderPaymentTransitionCommand = z.infer<
  typeof orderPaymentTransitionCommandSchema
>;
export type RefundTransitionCommand = z.infer<
  typeof refundTransitionCommandSchema
>;
export type DisputeTransitionCommand = z.infer<
  typeof disputeTransitionCommandSchema
>;
export type FulfillmentTransitionCommand = z.infer<
  typeof fulfillmentTransitionCommandSchema
>;
export type PaymentAttemptTransitionDecision = z.infer<
  typeof paymentAttemptTransitionDecisionSchema
>;
export type OrderLifecycleTransitionDecision = z.infer<
  typeof orderLifecycleTransitionDecisionSchema
>;
export type OrderPaymentTransitionDecision = z.infer<
  typeof orderPaymentTransitionDecisionSchema
>;
export type RefundTransitionDecision = z.infer<
  typeof refundTransitionDecisionSchema
>;
export type DisputeTransitionDecision = z.infer<
  typeof disputeTransitionDecisionSchema
>;
export type FulfillmentTransitionDecision = z.infer<
  typeof fulfillmentTransitionDecisionSchema
>;

const inventoryReservationStatusSchema = z.enum([
  "ACTIVE",
  "COMMITTED",
  "RELEASED",
  "EXPIRED",
]);
const cartLifecycleStatusSchema = z.enum([
  "ACTIVE",
  "LOCKED",
  "CONVERTED",
  "EXPIRED",
]);
const systemTaskNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[-_:][a-z0-9]+)*$/u);

export const latePaymentSuccessAuditActorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("SYSTEM"),
    taskName: systemTaskNameSchema,
  }),
  z.strictObject({
    kind: z.literal("ADMIN"),
    adminIdentityId: adminIdentityIdSchema,
  }),
]);

export const cartStateSubjectSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: cartIdSchema,
  orderId: orderIdSchema,
  version: positiveVersionSchema,
  status: cartLifecycleStatusSchema,
});

export const inventoryReservationStateSubjectSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: inventoryReservationIdSchema,
  orderId: orderIdSchema,
  version: positiveVersionSchema,
  status: inventoryReservationStatusSchema,
});

export const latePaymentSuccessStateSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    paymentAttempt: paymentAttemptSubjectSchema,
    order: orderStateSubjectSchema,
    cart: cartStateSubjectSchema,
    reservations: z.array(inventoryReservationStateSubjectSchema).max(100),
    fulfillments: z.array(fulfillmentStateSubjectSchema).min(1).max(100),
    competingPaymentAttemptIds: z.array(paymentAttemptIdSchema).max(20),
  })
  .superRefine((state, context) => {
    const orderId = state.order.id;
    const linkedToOrder =
      state.paymentAttempt.orderId === orderId &&
      state.cart.orderId === orderId &&
      state.reservations.every((subject) => subject.orderId === orderId) &&
      state.fulfillments.every((subject) => subject.orderId === orderId);
    if (!linkedToOrder) {
      context.addIssue({
        code: "custom",
        message: "all late-success subjects must belong to the same order",
        path: ["order", "id"],
      });
    }
    if (
      new Set(state.reservations.map((subject) => subject.id.toLowerCase()))
        .size !== state.reservations.length
    ) {
      context.addIssue({
        code: "custom",
        message: "reservation subjects must be unique",
        path: ["reservations"],
      });
    }
    if (
      new Set(state.fulfillments.map((subject) => subject.id.toLowerCase()))
        .size !== state.fulfillments.length
    ) {
      context.addIssue({
        code: "custom",
        message: "fulfillment subjects must be unique",
        path: ["fulfillments"],
      });
    }
    const competingIds = new Set(
      state.competingPaymentAttemptIds.map((id) => id.toLowerCase()),
    );
    if (
      competingIds.size !== state.competingPaymentAttemptIds.length ||
      competingIds.has(state.paymentAttempt.id.toLowerCase())
    ) {
      context.addIssue({
        code: "custom",
        message:
          "competing payment attempts must be unique and exclude the subject",
        path: ["competingPaymentAttemptIds"],
      });
    }
  });

export const latePaymentSuccessCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    state: latePaymentSuccessStateSchema,
    authority: paymentProviderEventAuthoritySchema,
    auditActor: latePaymentSuccessAuditActorSchema,
  })
  .superRefine((command, context) => {
    if (
      command.authority.event.status !== "SUCCEEDED" ||
      !samePaymentAttemptSubject(
        command.state.paymentAttempt,
        command.authority.paymentAttempt,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "late payment success requires evidence for the payment subject",
        path: ["authority"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "payment, order, cart, reservations, and fulfillments belong to one order and repeated subjects are unique",
      "competing payment attempt IDs are unique and exclude the subject payment attempt",
      "authority is a SUCCEEDED provider event exactly bound to the persisted payment attempt snapshot",
      "auditActor identity must come from a trusted authenticated application workflow",
    ],
  });

const subjectVersionReferenceSchema = <Id extends string>(
  idSchema: z.ZodType<Id>,
) =>
  z.strictObject({
    id: idSchema,
    expectedVersion: positiveVersionSchema,
  });

const paymentAttemptVersionReferenceSchema = subjectVersionReferenceSchema(
  paymentAttemptIdSchema,
);
const orderVersionReferenceSchema =
  subjectVersionReferenceSchema(orderIdSchema);
const cartVersionReferenceSchema = subjectVersionReferenceSchema(cartIdSchema);
const reservationVersionReferenceSchema = subjectVersionReferenceSchema(
  inventoryReservationIdSchema,
);
const fulfillmentVersionReferenceSchema =
  subjectVersionReferenceSchema(fulfillmentIdSchema);

type VersionReference = Readonly<{ id: string; expectedVersion: number }>;
type VersionedSubject = Readonly<{ id: string; version: number }>;

function hasUniqueReferenceIds(references: readonly VersionReference[]) {
  return (
    new Set(references.map(({ id }) => id.toLowerCase())).size ===
    references.length
  );
}

function sameVersionReference(left: VersionReference, right: VersionReference) {
  return (
    left.id.toLowerCase() === right.id.toLowerCase() &&
    left.expectedVersion === right.expectedVersion
  );
}

function sameVersionReferenceSet(
  left: readonly VersionReference[],
  right: readonly VersionReference[],
) {
  if (
    left.length !== right.length ||
    !hasUniqueReferenceIds(left) ||
    !hasUniqueReferenceIds(right)
  ) {
    return false;
  }
  const rightById = new Map(
    right.map((reference) => [
      reference.id.toLowerCase(),
      reference.expectedVersion,
    ]),
  );
  return left.every(
    (reference) =>
      rightById.get(reference.id.toLowerCase()) === reference.expectedVersion,
  );
}

function referenceMatchesSubject(
  reference: VersionReference,
  subject: VersionedSubject,
) {
  return (
    reference.id.toLowerCase() === subject.id.toLowerCase() &&
    reference.expectedVersion === subject.version
  );
}

function referenceSetMatchesSubjects(
  references: readonly VersionReference[],
  subjects: readonly VersionedSubject[],
) {
  return sameVersionReferenceSet(
    references,
    subjects.map(({ id, version }) => ({ id, expectedVersion: version })),
  );
}

export const latePaymentSuccessSubjectVersionsSchema = z
  .strictObject({
    paymentAttempt: paymentAttemptVersionReferenceSchema,
    order: orderVersionReferenceSchema,
    cart: cartVersionReferenceSchema,
    reservations: z.array(reservationVersionReferenceSchema).max(100),
    fulfillments: z.array(fulfillmentVersionReferenceSchema).min(1).max(100),
  })
  .superRefine((subjects, context) => {
    if (!hasUniqueReferenceIds(subjects.reservations)) {
      context.addIssue({
        code: "custom",
        message: "reservation subject references must be unique",
        path: ["reservations"],
      });
    }
    if (!hasUniqueReferenceIds(subjects.fulfillments)) {
      context.addIssue({
        code: "custom",
        message: "fulfillment subject references must be unique",
        path: ["fulfillments"],
      });
    }
  });

export const latePaymentSuccessPlanSchema = z
  .strictObject({
    paymentAttempt: paymentAttemptVersionReferenceSchema.safeExtend({
      status: z.literal("SUCCEEDED"),
    }),
    order: orderVersionReferenceSchema.safeExtend({
      paymentStatus: z.literal("PAID"),
      orderStatus: z.literal("OPEN"),
    }),
    cart: cartVersionReferenceSchema.safeExtend({
      status: z.literal("CONVERTED"),
    }),
    reservations: z
      .array(
        reservationVersionReferenceSchema.safeExtend({
          status: z.enum(["COMMITTED", "RELEASED", "EXPIRED"]),
          inventoryAction: z.enum(["COMMIT_RESERVED", "NONE"]),
        }),
      )
      .max(100),
    fulfillments: z
      .array(
        fulfillmentVersionReferenceSchema.safeExtend({
          status: z.enum(["PENDING", "ON_HOLD"]),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((plan, context) => {
    if (!hasUniqueReferenceIds(plan.reservations)) {
      context.addIssue({
        code: "custom",
        message: "reservation plan references must be unique",
        path: ["reservations"],
      });
    }
    if (!hasUniqueReferenceIds(plan.fulfillments)) {
      context.addIssue({
        code: "custom",
        message: "fulfillment plan references must be unique",
        path: ["fulfillments"],
      });
    }
  });

export const providerEvidenceAuditReferenceSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("VERIFIED_WEBHOOK"),
      referenceId: webhookInboxIdSchema,
    }),
    z.strictObject({
      kind: z.literal("AUTHENTICATED_RECONCILE"),
      referenceId: auditLogIdSchema,
    }),
  ],
);

export const latePaymentSuccessAuditSchema = z.strictObject({
  original: latePaymentSuccessStateSchema,
  providerEventId: providerEventReferenceSchema,
  providerEvidence: providerEvidenceAuditReferenceSchema,
  actor: latePaymentSuccessAuditActorSchema,
});

const latePaymentSuccessEffectSchema = z.strictObject({
  type: z.enum([
    "PAYMENT_SUCCEEDED",
    "ORDER_OPENED",
    "INVENTORY_RESERVATION_COMMIT_REQUIRED",
    "FULFILLMENT_REVIEW_REQUIRED",
    "AUDIT_REQUIRED",
  ]),
});

export const latePaymentSuccessDecisionSchema = z
  .discriminatedUnion("decision", [
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      decision: z.literal("APPLIED"),
      reasonCode: z.enum([
        "PAYMENT_SUCCESS_RECONCILED",
        "LATE_PAYMENT_INVENTORY_UNAVAILABLE",
      ]),
      subjects: latePaymentSuccessSubjectVersionsSchema,
      plan: latePaymentSuccessPlanSchema,
      audit: latePaymentSuccessAuditSchema,
      effects: z.array(latePaymentSuccessEffectSchema).min(1),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      decision: z.literal("NOOP"),
      reasonCode: z.literal("ALREADY_APPLIED"),
      subjects: latePaymentSuccessSubjectVersionsSchema,
      effects: z.tuple([]),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      decision: z.literal("REJECTED"),
      reasonCode: z.enum([
        "LATE_SUCCESS_TRUSTED_EVIDENCE_REQUIRED",
        "LATE_SUCCESS_AUDIT_ACTOR_INVALID",
        "LATE_SUCCESS_ORDER_STATE_INVALID",
      ]),
      subjects: latePaymentSuccessSubjectVersionsSchema,
      effects: z.tuple([]),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      decision: z.literal("CONFLICT"),
      reasonCode: z.enum([
        "LATE_SUCCESS_SECOND_ATTEMPT_CONFLICT",
        "LATE_SUCCESS_PAYMENT_TERMINAL_CONFLICT",
        "LATE_SUCCESS_FULFILLMENT_STATE_CONFLICT",
      ]),
      subjects: latePaymentSuccessSubjectVersionsSchema,
      effects: z.tuple([]),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      decision: z.literal("INVALID"),
      reasonCode: z.literal("INVALID_LATE_PAYMENT_SUCCESS_COMMAND"),
      effects: z.tuple([]),
    }),
  ])
  .superRefine((decision, context) => {
    if (decision.decision !== "APPLIED") {
      return;
    }

    const { audit, plan, subjects } = decision;
    const planMatchesSubjects =
      sameVersionReference(subjects.paymentAttempt, plan.paymentAttempt) &&
      sameVersionReference(subjects.order, plan.order) &&
      sameVersionReference(subjects.cart, plan.cart) &&
      sameVersionReferenceSet(subjects.reservations, plan.reservations) &&
      sameVersionReferenceSet(subjects.fulfillments, plan.fulfillments);
    if (!planMatchesSubjects) {
      context.addIssue({
        code: "custom",
        message: "late-success plan must exactly match all subject references",
        path: ["plan"],
      });
    }

    const original = audit.original;
    const auditMatchesSubjects =
      referenceMatchesSubject(
        subjects.paymentAttempt,
        original.paymentAttempt,
      ) &&
      referenceMatchesSubject(subjects.order, original.order) &&
      referenceMatchesSubject(subjects.cart, original.cart) &&
      referenceSetMatchesSubjects(
        subjects.reservations,
        original.reservations,
      ) &&
      referenceSetMatchesSubjects(subjects.fulfillments, original.fulfillments);
    if (!auditMatchesSubjects) {
      context.addIssue({
        code: "custom",
        message:
          "late-success audit snapshot must exactly match all subject references",
        path: ["audit", "original"],
      });
    }

    const currentPaymentAttemptId = original.order.currentPaymentAttemptId;
    const originalAggregateCanApply =
      original.competingPaymentAttemptIds.length === 0 &&
      !["FAILED", "CANCELED", "EXPIRED"].includes(
        original.paymentAttempt.status,
      ) &&
      ["PENDING_PAYMENT", "CANCELED", "OPEN"].includes(
        original.order.orderStatus,
      ) &&
      ["PENDING", "PAID"].includes(original.order.paymentStatus) &&
      ["LOCKED", "CONVERTED"].includes(original.cart.status) &&
      (currentPaymentAttemptId === null ||
        currentPaymentAttemptId.toLowerCase() ===
          original.paymentAttempt.id.toLowerCase());
    if (!originalAggregateCanApply) {
      context.addIssue({
        code: "custom",
        message:
          "late-success applied decisions require an eligible, non-competing original aggregate",
        path: ["audit", "original"],
      });
    }

    const reservationPlanIsConsistent = plan.reservations.every((mutation) => {
      const reservation = original.reservations.find(
        ({ id }) => id.toLowerCase() === mutation.id.toLowerCase(),
      );
      if (reservation === undefined) {
        return false;
      }
      return reservation.status === "ACTIVE"
        ? mutation.status === "COMMITTED" &&
            mutation.inventoryAction === "COMMIT_RESERVED"
        : mutation.status === reservation.status &&
            mutation.inventoryAction === "NONE";
    });
    if (!reservationPlanIsConsistent) {
      context.addIssue({
        code: "custom",
        message:
          "reservation mutations must preserve terminal states and commit active inventory",
        path: ["plan", "reservations"],
      });
    }

    const inventoryUnavailable = original.reservations.some(
      ({ status }) => status === "RELEASED" || status === "EXPIRED",
    );
    const expectedFulfillmentStatus = inventoryUnavailable
      ? "ON_HOLD"
      : "PENDING";
    const originalAlreadyApplied =
      original.paymentAttempt.status === "SUCCEEDED" &&
      original.order.paymentStatus === "PAID" &&
      original.order.orderStatus === "OPEN" &&
      original.cart.status === "CONVERTED" &&
      original.reservations.every(({ status }) => status !== "ACTIVE") &&
      original.fulfillments.every(
        ({ status }) => status === expectedFulfillmentStatus,
      );
    if (originalAlreadyApplied) {
      context.addIssue({
        code: "custom",
        message:
          "an already-applied late-success aggregate must be represented as NOOP",
        path: ["decision"],
      });
    }
    const originalFulfillmentsCanApply = original.fulfillments.every(
      ({ status }) =>
        inventoryUnavailable
          ? status === "PENDING" || status === "ON_HOLD"
          : status === "PENDING",
    );
    if (!originalFulfillmentsCanApply) {
      context.addIssue({
        code: "custom",
        message:
          "late-success applied decisions require eligible original fulfillment states",
        path: ["audit", "original", "fulfillments"],
      });
    }
    if (
      plan.fulfillments.some(
        ({ status }) => status !== expectedFulfillmentStatus,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "fulfillment mutations must reflect aggregate inventory availability",
        path: ["plan", "fulfillments"],
      });
    }

    const expectedReasonCode = inventoryUnavailable
      ? "LATE_PAYMENT_INVENTORY_UNAVAILABLE"
      : "PAYMENT_SUCCESS_RECONCILED";
    if (decision.reasonCode !== expectedReasonCode) {
      context.addIssue({
        code: "custom",
        message: "late-success reason must reflect inventory availability",
        path: ["reasonCode"],
      });
    }

    const expectedEffects: (typeof decision.effects)[number]["type"][] = [
      "PAYMENT_SUCCEEDED",
      "ORDER_OPENED",
      "AUDIT_REQUIRED",
    ];
    if (original.reservations.some(({ status }) => status === "ACTIVE")) {
      expectedEffects.push("INVENTORY_RESERVATION_COMMIT_REQUIRED");
    }
    if (inventoryUnavailable) {
      expectedEffects.push("FULFILLMENT_REVIEW_REQUIRED");
    }
    const actualEffects = decision.effects.map(({ type }) => type);
    if (
      actualEffects.length !== expectedEffects.length ||
      new Set(actualEffects).size !== actualEffects.length ||
      expectedEffects.some((effect) => !actualEffects.includes(effect))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "late-success effects must exactly describe the aggregate plan",
        path: ["effects"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "APPLIED plan and audit snapshots exactly bind every subject ID and expected version",
      "APPLIED requires an eligible non-competing original aggregate and never represents an already-applied aggregate",
      "reservation and fulfillment mutations preserve terminal state and reflect inventory availability",
      "reasonCode and the unique effect set exactly describe the aggregate plan",
    ],
  });

export type LatePaymentSuccessAuditActor = z.infer<
  typeof latePaymentSuccessAuditActorSchema
>;
export type CartStateSubject = z.infer<typeof cartStateSubjectSchema>;
export type InventoryReservationStateSubject = z.infer<
  typeof inventoryReservationStateSubjectSchema
>;
export type LatePaymentSuccessState = z.infer<
  typeof latePaymentSuccessStateSchema
>;
export type LatePaymentSuccessCommand = z.infer<
  typeof latePaymentSuccessCommandSchema
>;
export type LatePaymentSuccessPlan = z.infer<
  typeof latePaymentSuccessPlanSchema
>;
export type LatePaymentSuccessSubjectVersions = z.infer<
  typeof latePaymentSuccessSubjectVersionsSchema
>;
export type ProviderEvidenceAuditReference = z.infer<
  typeof providerEvidenceAuditReferenceSchema
>;
export type LatePaymentSuccessAudit = z.infer<
  typeof latePaymentSuccessAuditSchema
>;
export type LatePaymentSuccessDecision = z.infer<
  typeof latePaymentSuccessDecisionSchema
>;
