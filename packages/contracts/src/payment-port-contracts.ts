import { z } from "zod";

import {
  countrySchema,
  currencySchema,
  marketSchema,
  minorAmountSchema,
} from "./commerce.js";
import {
  auditLogIdSchema,
  externalPaymentReferenceSchema,
  merchantReferenceSchema,
  orderIdSchema,
  paymentAttemptIdSchema,
  providerAccountIdSchema,
  providerIdempotencyKeySchema,
  providerRefundReferenceSchema,
  refundIdSchema,
  webhookInboxIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  paymentActionSchema,
  paymentActionTypeSchema,
  paymentAttemptStatusSchema,
  paymentCapabilitySchema,
  paymentEnvironmentSchema,
  paymentMethodSchema,
  providerEventSchema,
} from "./payment.js";
import {
  containsC0OrDelControlCharacter,
  portBase64Schema,
  portErrorBaseShape,
  portTimestampSchema,
  validatePortErrorRecovery,
  validatePortErrorPolicy,
} from "./port-common.js";
import { publicHttpsUrlSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

export const paymentPortOperationSchema = z.enum([
  "GET_CAPABILITIES",
  "CREATE_PAYMENT",
  "VERIFY_AND_PARSE_WEBHOOK",
  "GET_PAYMENT",
  "CANCEL_PAYMENT",
  "REFUND_PAYMENT",
  "RECONCILE_PAYMENT",
  "RECONCILE_REFUND",
]);
export const paymentPortErrorCodeSchema = z.enum([
  "INVALID_COMMAND",
  "CAPABILITY_UNAVAILABLE",
  "PAYMENT_NOT_FOUND",
  "REFUND_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "PROVIDER_DECLINED",
  "INVALID_SIGNATURE",
  "EVENT_OUTSIDE_TOLERANCE",
  "UNSUPPORTED_EVENT",
  "AUTHENTICATION_FAILED",
  "RATE_LIMITED",
  "TEMPORARY_UNAVAILABLE",
  "TIMEOUT_OUTCOME_UNKNOWN",
  "CONFIGURATION_ERROR",
  "MALFORMED_PROVIDER_RESPONSE",
  "UNEXPECTED_ADAPTER_FAILURE",
]);
export const paymentPortErrorSchema = z
  .strictObject({
    ...portErrorBaseShape,
    code: paymentPortErrorCodeSchema,
  })
  .superRefine((error, context) => {
    if (error.code === "MALFORMED_PROVIDER_RESPONSE") {
      validatePortErrorRecovery(error, context);
      if (!["NONE", "RECONCILE_REQUIRED"].includes(error.recovery)) {
        context.addIssue({
          code: "custom",
          path: ["recovery"],
          message:
            "malformed payment responses are reconciled only for mutations",
        });
      }
      return;
    }
    validatePortErrorPolicy(error, context, {
      retryableCodes: [
        "RATE_LIMITED",
        "TEMPORARY_UNAVAILABLE",
        "UNEXPECTED_ADAPTER_FAILURE",
      ],
      reconcileCodes: ["TIMEOUT_OUTCOME_UNKNOWN"],
    });
  });

const providerContextShape = {
  providerAccountId: providerAccountIdSchema,
  environment: paymentEnvironmentSchema,
} as const;

const capabilitiesCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("GET_CAPABILITIES"),
  ...providerContextShape,
  market: marketSchema,
  country: countrySchema,
  currency: currencySchema,
  amountMinor: minorAmountSchema,
  requestedLocale: supportedLocaleSchema,
  supportedActionTypes: z
    .array(paymentActionTypeSchema)
    .min(1)
    .max(5)
    .refine((actions) => new Set(actions).size === actions.length, {
      message: "requested payment action types must be unique",
    }),
});
const createPaymentCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("CREATE_PAYMENT"),
    ...providerContextShape,
    attemptId: paymentAttemptIdSchema,
    orderId: orderIdSchema,
    paymentMethod: paymentMethodSchema,
    amountMinor: minorAmountSchema,
    currency: currencySchema,
    requestedLocale: supportedLocaleSchema,
    merchantReference: merchantReferenceSchema,
    providerIdempotencyKey: providerIdempotencyKeySchema,
    returnUrl: publicHttpsUrlSchema,
    cancelUrl: publicHttpsUrlSchema,
  })
  .superRefine((command, context) => {
    if (
      String(command.attemptId) !== String(command.merchantReference) ||
      String(command.attemptId) !== String(command.providerIdempotencyKey)
    ) {
      context.addIssue({
        code: "custom",
        path: ["merchantReference"],
        message:
          "merchant reference and provider idempotency key must equal attempt ID",
      });
    }
  });
const webhookCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("VERIFY_AND_PARSE_WEBHOOK"),
  ...providerContextShape,
  webhookInboxId: webhookInboxIdSchema,
  rawBodyBase64: portBase64Schema,
  headers: z
    .record(
      z
        .string()
        .min(1)
        .max(128)
        .regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/u),
      z
        .string()
        .max(8_192)
        .refine((value) => !containsC0OrDelControlCharacter(value), {
          message: "webhook header values must not contain control characters",
        }),
    )
    .superRefine((headers, context) => {
      const entries = Object.entries(headers);
      if (entries.length > 64) {
        context.addIssue({
          code: "custom",
          message: "webhook headers must contain at most 64 fields",
        });
      }
      const encodedBytes = entries.reduce(
        (total, [name, value]) =>
          total +
          new TextEncoder().encode(name).byteLength +
          new TextEncoder().encode(value).byteLength +
          4,
        0,
      );
      if (encodedBytes > 32_768) {
        context.addIssue({
          code: "custom",
          message: "webhook headers must not exceed 32 KiB",
        });
      }
    }),
  receivedAt: portTimestampSchema,
});
const paymentLookupShape = {
  ...providerContextShape,
  attemptId: paymentAttemptIdSchema,
  externalReference: externalPaymentReferenceSchema,
} as const;
const getPaymentCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("GET_PAYMENT"),
  ...paymentLookupShape,
});
const cancelPaymentCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("CANCEL_PAYMENT"),
  ...paymentLookupShape,
  idempotencyKey: providerIdempotencyKeySchema,
  reasonCode: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/u),
});
const refundPaymentCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("REFUND_PAYMENT"),
    ...providerContextShape,
    refundId: refundIdSchema,
    paymentAttemptId: paymentAttemptIdSchema,
    externalReference: externalPaymentReferenceSchema,
    /**
     * Platform-generated, provider-facing refund correlation. Adapters must
     * round-trip it through provider metadata/idempotency. A provider-native
     * refund/transaction ID belongs in ProviderEvent.transaction.
     */
    refundReference: providerRefundReferenceSchema,
    amountMinor: minorAmountSchema,
    currency: currencySchema,
    idempotencyKey: providerIdempotencyKeySchema,
  })
  .superRefine((command, context) => {
    if (String(command.refundId) !== String(command.idempotencyKey)) {
      context.addIssue({
        code: "custom",
        path: ["idempotencyKey"],
        message: "provider idempotency key must equal refund ID",
      });
    }
  });
const reconcilePaymentCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("RECONCILE_PAYMENT"),
    ...providerContextShape,
    attemptId: paymentAttemptIdSchema,
    merchantReference: merchantReferenceSchema,
    providerIdempotencyKey: providerIdempotencyKeySchema,
    externalReference: externalPaymentReferenceSchema.optional(),
    amountMinor: minorAmountSchema,
    currency: currencySchema,
    auditLogId: auditLogIdSchema,
  })
  .superRefine((command, context) => {
    if (
      String(command.attemptId) !== String(command.merchantReference) ||
      String(command.attemptId) !== String(command.providerIdempotencyKey)
    ) {
      context.addIssue({
        code: "custom",
        path: ["merchantReference"],
        message:
          "reconcile merchant reference and idempotency key must equal attempt ID",
      });
    }
  });
const reconcileRefundCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("RECONCILE_REFUND"),
    ...providerContextShape,
    refundId: refundIdSchema,
    paymentAttemptId: paymentAttemptIdSchema,
    externalReference: externalPaymentReferenceSchema,
    refundReference: providerRefundReferenceSchema,
    amountMinor: minorAmountSchema,
    currency: currencySchema,
    idempotencyKey: providerIdempotencyKeySchema,
    auditLogId: auditLogIdSchema,
  })
  .superRefine((command, context) => {
    if (String(command.refundId) !== String(command.idempotencyKey)) {
      context.addIssue({
        code: "custom",
        path: ["idempotencyKey"],
        message: "provider idempotency key must equal refund ID",
      });
    }
  });

export const paymentPortCommandSchema = z.union([
  capabilitiesCommandSchema,
  createPaymentCommandSchema,
  webhookCommandSchema,
  getPaymentCommandSchema,
  cancelPaymentCommandSchema,
  refundPaymentCommandSchema,
  reconcilePaymentCommandSchema,
  reconcileRefundCommandSchema,
]);

const failureSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: paymentPortOperationSchema,
    outcome: z.literal("FAILURE"),
    error: paymentPortErrorSchema,
  })
  .superRefine((failure, context) => {
    const mutationOperation = [
      "CREATE_PAYMENT",
      "CANCEL_PAYMENT",
      "REFUND_PAYMENT",
    ].includes(failure.operation);
    if (
      failure.error.code === "TIMEOUT_OUTCOME_UNKNOWN" &&
      !mutationOperation
    ) {
      context.addIssue({
        code: "custom",
        path: ["error", "code"],
        message:
          "unknown outcomes are valid only for payment mutation operations",
      });
    }
    if (failure.error.code === "MALFORMED_PROVIDER_RESPONSE") {
      const expectedRecovery = mutationOperation
        ? "RECONCILE_REQUIRED"
        : "NONE";
      if (failure.error.recovery !== expectedRecovery) {
        context.addIssue({
          code: "custom",
          path: ["error", "recovery"],
          message:
            "malformed mutation responses require reconcile; reads do not",
        });
      }
    }
  });
const capabilitiesSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("GET_CAPABILITIES"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    capabilities: z
      .array(paymentCapabilitySchema)
      .max(64)
      .refine(
        (capabilities) =>
          new Set(capabilities.map((capability) => capability.id)).size ===
          capabilities.length,
        { message: "payment capability IDs must be unique" },
      ),
  }),
});
const paymentObservationSchema = z
  .strictObject({
    status: paymentAttemptStatusSchema,
    externalReference: externalPaymentReferenceSchema,
    providerLocale: z.string().min(1).max(35),
    fallbackUsed: z.boolean(),
    action: paymentActionSchema.optional(),
    observedAt: portTimestampSchema,
  })
  .superRefine((observation, context) => {
    const actionType = observation.action?.type;
    const valid =
      (observation.status === "REQUIRES_ACTION" &&
        actionType !== undefined &&
        actionType !== "WAIT") ||
      (observation.status === "PROCESSING" &&
        (actionType === undefined || actionType === "WAIT")) ||
      (!["REQUIRES_ACTION", "PROCESSING"].includes(observation.status) &&
        actionType === undefined);
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["action"],
        message: "payment action does not match the observed status",
      });
    }
  });
const createPaymentSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("CREATE_PAYMENT"),
  outcome: z.literal("SUCCESS"),
  value: paymentObservationSchema.safeExtend({
    status: z.enum(["REQUIRES_ACTION", "PROCESSING"]),
    providerAccountId: providerAccountIdSchema,
    environment: paymentEnvironmentSchema,
    attemptId: paymentAttemptIdSchema,
    orderId: orderIdSchema,
    amountMinor: minorAmountSchema,
    currency: currencySchema,
  }),
});
const webhookSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("VERIFY_AND_PARSE_WEBHOOK"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({ event: providerEventSchema }),
});
const getPaymentSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("GET_PAYMENT"),
  outcome: z.literal("SUCCESS"),
  value: paymentObservationSchema.safeExtend({
    providerAccountId: providerAccountIdSchema,
    environment: paymentEnvironmentSchema,
    attemptId: paymentAttemptIdSchema,
  }),
});
const cancelPaymentSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("CANCEL_PAYMENT"),
  outcome: z.literal("SUCCESS"),
  value: paymentObservationSchema.safeExtend({
    providerAccountId: providerAccountIdSchema,
    environment: paymentEnvironmentSchema,
    attemptId: paymentAttemptIdSchema,
  }),
});
const refundPaymentSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("REFUND_PAYMENT"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    providerAccountId: providerAccountIdSchema,
    environment: paymentEnvironmentSchema,
    refundId: refundIdSchema,
    paymentAttemptId: paymentAttemptIdSchema,
    status: z.literal("PROCESSING"),
    refundReference: providerRefundReferenceSchema,
    amountMinor: minorAmountSchema,
    currency: currencySchema,
    observedAt: portTimestampSchema,
  }),
});
const reconcilePaymentSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECONCILE_PAYMENT"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({ event: providerEventSchema }),
});
const reconcileRefundSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RECONCILE_REFUND"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    refundId: refundIdSchema,
    idempotencyKey: providerIdempotencyKeySchema,
    event: providerEventSchema,
  }),
});

export const paymentPortResponseSchema = z.union([
  capabilitiesSuccessSchema,
  createPaymentSuccessSchema,
  webhookSuccessSchema,
  getPaymentSuccessSchema,
  cancelPaymentSuccessSchema,
  refundPaymentSuccessSchema,
  reconcilePaymentSuccessSchema,
  reconcileRefundSuccessSchema,
  failureSchema,
]);

export function paymentPortResponseMatchesCommand(
  command: unknown,
  response: unknown,
): boolean {
  const parsedCommand = paymentPortCommandSchema.safeParse(command);
  const parsedResponse = paymentPortResponseSchema.safeParse(response);
  if (
    !parsedCommand.success ||
    !parsedResponse.success ||
    parsedCommand.data.operation !== parsedResponse.data.operation
  ) {
    return false;
  }
  if (parsedResponse.data.outcome === "FAILURE") {
    return true;
  }

  switch (parsedCommand.data.operation) {
    case "GET_CAPABILITIES": {
      if (parsedResponse.data.operation !== "GET_CAPABILITIES") {
        return false;
      }
      const command = parsedCommand.data;
      const requestedActions = new Set(command.supportedActionTypes);
      const capabilities = parsedResponse.data.value.capabilities;
      const matchesRequest = (capability: (typeof capabilities)[number]) =>
        capability.market === command.market &&
        capability.country === command.country &&
        capability.currency === command.currency &&
        capability.actionTypes.every((action) => requestedActions.has(action));
      return (
        capabilities.every(matchesRequest) &&
        capabilities.some(
          (capability) =>
            capability.available &&
            capability.minimumAmountMinor <= command.amountMinor &&
            capability.maximumAmountMinor >= command.amountMinor,
        )
      );
    }
    case "CREATE_PAYMENT":
      return (
        parsedResponse.data.operation === "CREATE_PAYMENT" &&
        parsedResponse.data.value.providerAccountId ===
          parsedCommand.data.providerAccountId &&
        parsedResponse.data.value.environment ===
          parsedCommand.data.environment &&
        parsedResponse.data.value.attemptId === parsedCommand.data.attemptId &&
        parsedResponse.data.value.orderId === parsedCommand.data.orderId &&
        parsedResponse.data.value.amountMinor ===
          parsedCommand.data.amountMinor &&
        parsedResponse.data.value.currency === parsedCommand.data.currency
      );
    case "VERIFY_AND_PARSE_WEBHOOK": {
      if (parsedResponse.data.operation !== "VERIFY_AND_PARSE_WEBHOOK") {
        return false;
      }
      const event = parsedResponse.data.value.event;
      return (
        event.providerAccountId === parsedCommand.data.providerAccountId &&
        event.environment === parsedCommand.data.environment &&
        event.evidence.kind === "VERIFIED_WEBHOOK" &&
        event.evidence.webhookInboxId === parsedCommand.data.webhookInboxId
      );
    }
    case "GET_PAYMENT":
    case "CANCEL_PAYMENT":
      return (
        parsedResponse.data.operation === parsedCommand.data.operation &&
        parsedResponse.data.value.providerAccountId ===
          parsedCommand.data.providerAccountId &&
        parsedResponse.data.value.environment ===
          parsedCommand.data.environment &&
        parsedResponse.data.value.attemptId === parsedCommand.data.attemptId &&
        parsedResponse.data.value.externalReference ===
          parsedCommand.data.externalReference
      );
    case "REFUND_PAYMENT":
      return (
        parsedResponse.data.operation === "REFUND_PAYMENT" &&
        parsedResponse.data.value.providerAccountId ===
          parsedCommand.data.providerAccountId &&
        parsedResponse.data.value.environment ===
          parsedCommand.data.environment &&
        parsedResponse.data.value.refundId === parsedCommand.data.refundId &&
        parsedResponse.data.value.paymentAttemptId ===
          parsedCommand.data.paymentAttemptId &&
        parsedResponse.data.value.refundReference ===
          parsedCommand.data.refundReference &&
        parsedResponse.data.value.amountMinor ===
          parsedCommand.data.amountMinor &&
        parsedResponse.data.value.currency === parsedCommand.data.currency
      );
    case "RECONCILE_PAYMENT":
      if (parsedResponse.data.operation !== "RECONCILE_PAYMENT") {
        return false;
      }
      return (
        parsedResponse.data.value.event.eventType === "PAYMENT_STATUS" &&
        parsedResponse.data.value.event.providerAccountId ===
          parsedCommand.data.providerAccountId &&
        parsedResponse.data.value.event.environment ===
          parsedCommand.data.environment &&
        parsedResponse.data.value.event.evidence.kind ===
          "AUTHENTICATED_RECONCILE" &&
        parsedResponse.data.value.event.evidence.auditLogId ===
          parsedCommand.data.auditLogId &&
        parsedResponse.data.value.event.association.status === "MATCHED" &&
        parsedResponse.data.value.event.association.paymentAttemptId ===
          parsedCommand.data.attemptId &&
        (parsedCommand.data.externalReference === undefined ||
          parsedResponse.data.value.event.association.externalReference ===
            parsedCommand.data.externalReference) &&
        parsedResponse.data.value.event.amountMinor ===
          parsedCommand.data.amountMinor &&
        parsedResponse.data.value.event.currency === parsedCommand.data.currency
      );
    case "RECONCILE_REFUND": {
      if (parsedResponse.data.operation !== "RECONCILE_REFUND") {
        return false;
      }
      const event = parsedResponse.data.value.event;
      return (
        event.eventType === "REFUND_STATUS" &&
        parsedResponse.data.value.refundId === parsedCommand.data.refundId &&
        parsedResponse.data.value.idempotencyKey ===
          parsedCommand.data.idempotencyKey &&
        event.providerAccountId === parsedCommand.data.providerAccountId &&
        event.environment === parsedCommand.data.environment &&
        event.evidence.kind === "AUTHENTICATED_RECONCILE" &&
        event.evidence.auditLogId === parsedCommand.data.auditLogId &&
        event.association.status === "MATCHED" &&
        event.association.paymentAttemptId ===
          parsedCommand.data.paymentAttemptId &&
        event.association.externalReference ===
          parsedCommand.data.externalReference &&
        event.refundReference === parsedCommand.data.refundReference &&
        event.amountMinor === parsedCommand.data.amountMinor &&
        event.currency === parsedCommand.data.currency
      );
    }
    default:
      return true;
  }
}

export type PaymentPortCommand = z.infer<typeof paymentPortCommandSchema>;
export type PaymentPortResponse = z.infer<typeof paymentPortResponseSchema>;
export type PaymentPortError = z.infer<typeof paymentPortErrorSchema>;
export type PaymentPortFailure = z.infer<typeof failureSchema>;
type PaymentFailureFor<Operation extends PaymentPortCommand["operation"]> =
  Omit<PaymentPortFailure, "operation"> & Readonly<{ operation: Operation }>;
export type GetPaymentCapabilitiesCommand = z.infer<
  typeof capabilitiesCommandSchema
>;
export type GetPaymentCapabilitiesResponse =
  | Extract<PaymentPortResponse, { operation: "GET_CAPABILITIES" }>
  | PaymentFailureFor<"GET_CAPABILITIES">;
export type CreatePaymentCommand = z.infer<typeof createPaymentCommandSchema>;
export type CreatePaymentResponse =
  | Extract<PaymentPortResponse, { operation: "CREATE_PAYMENT" }>
  | PaymentFailureFor<"CREATE_PAYMENT">;
export type VerifyAndParseWebhookCommand = z.infer<typeof webhookCommandSchema>;
export type VerifyAndParseWebhookResponse =
  | Extract<PaymentPortResponse, { operation: "VERIFY_AND_PARSE_WEBHOOK" }>
  | PaymentFailureFor<"VERIFY_AND_PARSE_WEBHOOK">;
export type GetPaymentCommand = z.infer<typeof getPaymentCommandSchema>;
export type GetPaymentResponse =
  | Extract<PaymentPortResponse, { operation: "GET_PAYMENT" }>
  | PaymentFailureFor<"GET_PAYMENT">;
export type CancelPaymentCommand = z.infer<typeof cancelPaymentCommandSchema>;
export type CancelPaymentResponse =
  | Extract<PaymentPortResponse, { operation: "CANCEL_PAYMENT" }>
  | PaymentFailureFor<"CANCEL_PAYMENT">;
export type RefundPaymentCommand = z.infer<typeof refundPaymentCommandSchema>;
export type RefundPaymentResponse =
  | Extract<PaymentPortResponse, { operation: "REFUND_PAYMENT" }>
  | PaymentFailureFor<"REFUND_PAYMENT">;
export type ReconcilePaymentCommand = z.infer<
  typeof reconcilePaymentCommandSchema
>;
export type ReconcilePaymentResponse =
  | Extract<PaymentPortResponse, { operation: "RECONCILE_PAYMENT" }>
  | PaymentFailureFor<"RECONCILE_PAYMENT">;
export type ReconcileRefundCommand = z.infer<
  typeof reconcileRefundCommandSchema
>;
export type ReconcileRefundResponse =
  | Extract<PaymentPortResponse, { operation: "RECONCILE_REFUND" }>
  | PaymentFailureFor<"RECONCILE_REFUND">;
