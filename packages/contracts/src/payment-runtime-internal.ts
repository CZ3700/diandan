import { z } from "zod";
import {
  cartRuntimeAccessesSchema,
  cartRuntimeHeaderSchema,
} from "./cart-runtime.js";
import { checkoutPreflightSessionRecordSchema } from "./checkout-preflight-internal.js";
import { checkoutVersionSchema } from "./checkout-preflight.js";
import {
  countrySchema,
  currencySchema,
  encryptedValueSchema,
  keyVersionSchema,
  marketSchema,
  minorAmountSchema,
} from "./commerce.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { paymentRouteRuleSchema } from "./domain-rules.js";
import {
  cartIdSchema,
  checkoutSessionIdSchema,
  externalPaymentReferenceSchema,
  idempotencyKeySchema,
  merchantReferenceSchema,
  orderIdSchema,
  paymentAttemptIdSchema,
  providerAccountIdSchema,
  providerIdempotencyKeySchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { createPaymentCommandSchema } from "./payment-port-contracts.js";
import {
  paymentAttemptStatusSchema,
  paymentEnvironmentSchema,
  paymentMethodSchema,
  providerEventSchema,
} from "./payment.js";
import {
  paymentRuntimeRecoverySchema,
  paymentRuntimeSupportedActionsSchema,
} from "./payment-runtime.js";

const version = checkoutVersionSchema;
const timestamp = contentTimestampSchema;
const retryAfterMs = z.number().int().min(1000).max(86400000);
const uuid = z.uuid();
const code = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/u);
const taskName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*([-_:][a-z0-9]+)*$/u);
const adapterKey = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/u);
const trace = { requestId: uuid, correlationId: uuid, taskName };
const identity = {
  schemaVersion: z.literal(1),
  accesses: cartRuntimeAccessesSchema,
  checkoutSessionId: checkoutSessionIdSchema,
};
const lease = {
  leaseTokenDigest: sourceHashSchema,
  leaseDurationMs: z.number().int().min(1000).max(300000),
};
const sameId = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
function actionMatches(status: string, action: { type: string } | null) {
  if (status === "REQUIRES_ACTION")
    return action !== null && action.type !== "WAIT";
  if (status === "PROCESSING") return action === null || action.type === "WAIT";
  return action === null;
}

/** Ciphertext is internal only; an authorized Application decrypts outside its transaction. */
export const paymentRuntimeEncryptedActionSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal(1),
    type: z.enum([
      "REDIRECT",
      "PROVIDER_HOSTED_IFRAME",
      "PROVIDER_COMPONENT",
      "QR_CODE",
    ]),
    ciphertext: encryptedValueSchema,
    encryptedDataKey: encryptedValueSchema,
    encryptionKeyVersion: keyVersionSchema,
    expiresAt: timestamp,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    type: z.literal("WAIT"),
    pollAfterMs: z.number().int().min(500).max(60000),
  }),
]);
export const paymentRuntimeAttemptRecordSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: paymentAttemptIdSchema,
    cartId: cartIdSchema,
    checkoutSessionId: checkoutSessionIdSchema,
    orderId: orderIdSchema,
    providerAccountId: providerAccountIdSchema,
    adapterKey,
    environment: paymentEnvironmentSchema,
    paymentMethod: paymentMethodSchema,
    amountMinor: minorAmountSchema,
    market: marketSchema,
    currency: currencySchema,
    requestedLocale: supportedLocaleSchema,
    providerLocale: z.string().min(1).max(35),
    providerLocaleFallbackUsed: z.boolean(),
    configVersionId: uuid,
    configVersion: version,
    routeRuleId: uuid,
    ruleVersion: version,
    merchantReference: merchantReferenceSchema,
    providerIdempotencyKey: providerIdempotencyKeySchema,
    externalReference: externalPaymentReferenceSchema.nullable(),
    status: paymentAttemptStatusSchema,
    version,
    providerCallStarted: z.boolean(),
    action: paymentRuntimeEncryptedActionSchema.nullable(),
    recovery: paymentRuntimeRecoverySchema,
    canRetry: z.boolean(),
    actionExpired: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .refine(
    (value) =>
      sameId(value.id, value.merchantReference) &&
      sameId(value.id, value.providerIdempotencyKey) &&
      actionMatches(value.status, value.action) &&
      (!value.canRetry ||
        (["FAILED", "CANCELED", "EXPIRED"].includes(value.status) &&
          value.recovery === "NONE")) &&
      (value.status !== "CREATED" ||
        (!value.providerCallStarted &&
          value.externalReference === null &&
          value.recovery === "CREATE_PENDING")) &&
      (value.status !== "UNKNOWN" ||
        ["RECONCILE_REQUIRED", "EVIDENCE_PENDING"].includes(value.recovery)) &&
      (!value.actionExpired || value.status === "REQUIRES_ACTION"),
    "Stored payment identity, action and recovery must match the actual status",
  );
export const paymentRuntimeRouteSchema = z.strictObject({
  schemaVersion: z.literal(1),
  rule: paymentRouteRuleSchema,
  ruleVersion: version,
  providerConfigId: uuid,
  environment: paymentEnvironmentSchema,
  adapterKey,
  providerEnabled: z.boolean(),
  accountStatus: z.enum([
    "DISABLED",
    "INTERNAL",
    "ACTIVE",
    "SUSPENDED",
    "ARCHIVED",
  ]),
  merchantStatus: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]),
  healthStatus: z.enum(["HEALTHY", "UNAVAILABLE"]),
  rolloutBasisPoints: z.number().int().min(0).max(10000),
  providerRolloutBasisPoints: z.number().int().min(0).max(10000),
  displayOrder: z.number().int().min(0),
  displayName: z.string().min(1).max(80),
  customerHint: z.string().min(1).max(280),
  displayLocale: supportedLocaleSchema,
});
export const paymentRuntimeRoutingSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    publicationId: uuid,
    manifestHash: sourceHashSchema,
    configVersionId: uuid,
    configVersion: version,
    ruleVersion: version,
    routes: z.array(paymentRuntimeRouteSchema).max(200),
  })
  .refine(
    (value) =>
      new Set(value.routes.map((route) => route.rule.id.toLowerCase())).size ===
        value.routes.length &&
      value.routes.every((route) => route.ruleVersion === value.ruleVersion),
    "Published routing must have unique rules in its exact version",
  );
export const paymentRuntimeContextSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    evaluatedAt: timestamp,
    cart: cartRuntimeHeaderSchema,
    checkout: checkoutPreflightSessionRecordSchema,
    orderVersion: version,
    readiness: z.enum(["READY", "RECHECKOUT_REQUIRED", "SESSION_NOT_READY"]),
    currentAttempt: paymentRuntimeAttemptRecordSchema.nullable(),
    routing: paymentRuntimeRoutingSchema.nullable(),
  })
  .refine(
    (value) =>
      sameId(value.cart.id, value.checkout.receipt.cartId) &&
      (value.currentAttempt === null ||
        (sameId(value.currentAttempt.cartId, value.cart.id) &&
          sameId(
            value.currentAttempt.checkoutSessionId,
            value.checkout.receipt.checkoutSessionId,
          ) &&
          sameId(
            value.currentAttempt.orderId,
            value.checkout.receipt.orderId,
          ))),
    "Payment context must belong to the exact authorized checkout",
  );
export const paymentRuntimeCurrentCheckoutSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    checkout: checkoutPreflightSessionRecordSchema,
    attempt: paymentRuntimeAttemptRecordSchema.nullable(),
  })
  .refine(
    (value) =>
      value.attempt === null ||
      (sameId(value.attempt.cartId, value.checkout.receipt.cartId) &&
        sameId(
          value.attempt.checkoutSessionId,
          value.checkout.receipt.checkoutSessionId,
        ) &&
        sameId(value.attempt.orderId, value.checkout.receipt.orderId)),
    "Current payment belongs to the checkout",
  );
export const paymentRuntimeLoadContextCommandSchema = z.strictObject({
  ...identity,
  presentationLocale: supportedLocaleSchema,
  country: countrySchema.nullable(),
  supportedActionTypes: paymentRuntimeSupportedActionsSchema,
});
export const paymentRuntimeLoadCurrentCheckoutCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  accesses: cartRuntimeAccessesSchema,
});
export const paymentRuntimeReadAttemptCommandSchema = z.strictObject({
  ...identity,
  attemptId: paymentAttemptIdSchema,
  expectedVersion: version.optional(),
});
export const paymentRuntimeFindCreateReceiptCommandSchema = z.strictObject({
  ...identity,
  idempotencyKey: idempotencyKeySchema,
});
/** Permanent identity survives expiry of the generic idempotency cache. */
export const paymentRuntimeCreateReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  receiptId: uuid,
  operationId: uuid,
  cartId: cartIdSchema,
  checkoutSessionId: checkoutSessionIdSchema,
  attemptId: paymentAttemptIdSchema,
  idempotencyKey: idempotencyKeySchema,
  canonicalRequestHash: sourceHashSchema,
  occurredAt: timestamp,
});
export const paymentRuntimeBeginCreateCommandSchema = z
  .strictObject({
    ...identity,
    ...trace,
    ...lease,
    expectedOrderVersion: version,
    receiptId: uuid,
    operationId: uuid,
    attemptId: paymentAttemptIdSchema,
    idempotencyKey: idempotencyKeySchema,
    canonicalRequestHash: sourceHashSchema,
    configPublicationId: uuid,
    configVersionId: uuid,
    configVersion: version,
    routeRuleId: uuid,
    ruleVersion: version,
    country: countrySchema,
    supportedActionTypes: paymentRuntimeSupportedActionsSchema,
    providerLocale: z.string().min(1).max(35),
    providerLocaleFallbackUsed: z.boolean(),
    createCommand: createPaymentCommandSchema,
    returnStateDigest: sourceHashSchema,
    returnStateExpiresAt: timestamp,
    attemptEventId: uuid,
    orderEventId: uuid,
    outboxEventId: uuid,
  })
  .refine(
    (value) => sameId(value.attemptId, value.createCommand.attemptId),
    "The frozen provider command must target this attempt",
  );
export const paymentRuntimeClaimSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    ...trace,
    operationId: uuid,
    generation: version,
    leaseTokenDigest: sourceHashSchema,
    leaseExpiresAt: timestamp,
    mode: z.enum(["CREATE", "RECONCILE"]),
    attempt: paymentRuntimeAttemptRecordSchema,
    createCommand: createPaymentCommandSchema,
    auditLogId: uuid.nullable(),
    supportedActionTypes: paymentRuntimeSupportedActionsSchema,
  })
  .refine((value) => {
    const { attempt, createCommand: command } = value;
    return (
      sameId(attempt.id, command.attemptId) &&
      sameId(attempt.orderId, command.orderId) &&
      sameId(attempt.providerAccountId, command.providerAccountId) &&
      attempt.environment === command.environment &&
      attempt.amountMinor === command.amountMinor &&
      attempt.currency === command.currency &&
      attempt.paymentMethod === command.paymentMethod &&
      attempt.requestedLocale === command.requestedLocale &&
      (value.mode === "CREATE"
        ? attempt.status === "CREATED" && value.auditLogId === null
        : value.auditLogId !== null &&
          ["UNKNOWN", "PROCESSING", "REQUIRES_ACTION"].includes(attempt.status))
    );
  }, "A fenced claim must preserve the persisted payment and its allowed operation");
export const paymentRuntimeBeginCreateResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    receipt: paymentRuntimeCreateReceiptSchema,
    claim: paymentRuntimeClaimSchema,
  })
  .refine(
    (value) =>
      sameId(value.receipt.operationId, value.claim.operationId) &&
      sameId(value.receipt.attemptId, value.claim.attempt.id) &&
      sameId(value.receipt.cartId, value.claim.attempt.cartId) &&
      sameId(
        value.receipt.checkoutSessionId,
        value.claim.attempt.checkoutSessionId,
      ),
    "A created receipt must identify its exact claim",
  );
export const paymentRuntimeSettleCreateCommandSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    claim: paymentRuntimeClaimSchema,
    retryAfterMs,
    eventId: uuid,
    outboxEventId: uuid,
    result: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("CREATE_RESULT"),
        status: z.enum(["REQUIRES_ACTION", "PROCESSING"]),
        externalReference: externalPaymentReferenceSchema,
        providerLocale: z.string().min(1).max(35),
        providerLocaleFallbackUsed: z.boolean(),
        action: paymentRuntimeEncryptedActionSchema.nullable(),
      }),
      z.strictObject({
        kind: z.literal("NETWORK_UNCERTAINTY"),
        reasonCode: code,
      }),
    ]),
  })
  .refine(
    (value) =>
      value.claim.mode === "CREATE" &&
      (value.result.kind === "NETWORK_UNCERTAINTY" ||
        (value.result.providerLocale === value.claim.attempt.providerLocale &&
          value.result.providerLocaleFallbackUsed ===
            value.claim.attempt.providerLocaleFallbackUsed &&
          actionMatches(value.result.status, value.result.action) &&
          (value.result.action === null ||
            value.result.action.type === "WAIT" ||
            value.claim.supportedActionTypes.includes(
              value.result.action.type,
            )))),
    "Only a matching create result can settle the original create claim",
  );
/** Worker credentials are supplied by a trusted composition, never by the public route. */
export const paymentRuntimeClaimRecoveryCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...lease,
  ...trace,
  auditLogId: uuid,
  target: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("CHECKOUT"),
      accesses: cartRuntimeAccessesSchema,
      checkoutSessionId: checkoutSessionIdSchema,
      attemptId: paymentAttemptIdSchema,
    }),
    z.strictObject({ kind: z.literal("DUE") }),
  ]),
});
export const paymentRuntimeRecordReconcileCommandSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    claim: paymentRuntimeClaimSchema,
    retryAfterMs,
    providerEventId: uuid,
    associationId: uuid,
    eventId: uuid,
    outboxEventId: uuid,
    receiptId: uuid,
    event: providerEventSchema,
    action: paymentRuntimeEncryptedActionSchema.optional(),
  })
  .refine((value) => {
    const { claim, event } = value;
    return (
      claim.mode === "RECONCILE" &&
      claim.auditLogId !== null &&
      event.eventType === "PAYMENT_STATUS" &&
      event.evidence.kind === "AUTHENTICATED_RECONCILE" &&
      sameId(event.evidence.auditLogId, claim.auditLogId) &&
      event.association.status === "MATCHED" &&
      sameId(event.association.paymentAttemptId, claim.attempt.id) &&
      sameId(event.providerAccountId, claim.attempt.providerAccountId) &&
      event.environment === claim.attempt.environment &&
      event.amountMinor === claim.attempt.amountMinor &&
      event.currency === claim.attempt.currency &&
      (value.action === undefined ||
        (claim.attempt.status === "UNKNOWN" &&
          event.status === "REQUIRES_ACTION" &&
          value.action.type !== "WAIT" &&
          claim.supportedActionTypes.includes(value.action.type))) &&
      (claim.attempt.externalReference === null ||
        claim.attempt.externalReference === event.association.externalReference)
    );
  }, "Reconcile must retain the exact authenticated audit, attempt and financial identity");
export const paymentRuntimeDeferRecoveryCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  claim: paymentRuntimeClaimSchema,
  errorCode: code,
  retryAfterMs,
});

export type PaymentRuntimeEncryptedAction = z.infer<
  typeof paymentRuntimeEncryptedActionSchema
>;
export type PaymentRuntimeAttemptRecord = z.infer<
  typeof paymentRuntimeAttemptRecordSchema
>;
export type PaymentRuntimeRoute = z.infer<typeof paymentRuntimeRouteSchema>;
export type PaymentRuntimeRouting = z.infer<typeof paymentRuntimeRoutingSchema>;
export type PaymentRuntimeContext = z.infer<typeof paymentRuntimeContextSchema>;
export type PaymentRuntimeCurrentCheckout = z.infer<
  typeof paymentRuntimeCurrentCheckoutSchema
>;
export type PaymentRuntimeLoadContextCommand = z.infer<
  typeof paymentRuntimeLoadContextCommandSchema
>;
export type PaymentRuntimeLoadCurrentCheckoutCommand = z.infer<
  typeof paymentRuntimeLoadCurrentCheckoutCommandSchema
>;
export type PaymentRuntimeReadAttemptCommand = z.infer<
  typeof paymentRuntimeReadAttemptCommandSchema
>;
export type PaymentRuntimeFindCreateReceiptCommand = z.infer<
  typeof paymentRuntimeFindCreateReceiptCommandSchema
>;
export type PaymentRuntimeCreateReceipt = z.infer<
  typeof paymentRuntimeCreateReceiptSchema
>;
export type PaymentRuntimeBeginCreateCommand = z.infer<
  typeof paymentRuntimeBeginCreateCommandSchema
>;
export type PaymentRuntimeClaim = z.infer<typeof paymentRuntimeClaimSchema>;
export type PaymentRuntimeBeginCreateResult = z.infer<
  typeof paymentRuntimeBeginCreateResultSchema
>;
export type PaymentRuntimeSettleCreateCommand = z.infer<
  typeof paymentRuntimeSettleCreateCommandSchema
>;
export type PaymentRuntimeClaimRecoveryCommand = z.infer<
  typeof paymentRuntimeClaimRecoveryCommandSchema
>;
export type PaymentRuntimeRecordReconcileCommand = z.infer<
  typeof paymentRuntimeRecordReconcileCommandSchema
>;
export type PaymentRuntimeDeferRecoveryCommand = z.infer<
  typeof paymentRuntimeDeferRecoveryCommandSchema
>;
