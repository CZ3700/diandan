import { z } from "zod";

import {
  countrySchema,
  currencySchema,
  marketSchema,
  minorAmountSchema,
  orderAmountSnapshotSchema,
} from "./commerce.js";
import {
  auditLogIdSchema,
  disputeIdSchema,
  externalPaymentReferenceSchema,
  merchantReferenceSchema,
  orderIdSchema,
  orderItemIdSchema,
  paymentAttemptIdSchema,
  paymentCapabilityIdSchema,
  paymentReturnStateSchema,
  providerAccountIdSchema,
  providerClientTokenSchema,
  providerDisputeReferenceSchema,
  providerEventReferenceSchema,
  providerIdempotencyKeySchema,
  providerRefundReferenceSchema,
  providerTransactionReferenceSchema,
  refundIdSchema,
  webhookInboxIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { publicHttpsUrlSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

const timestampSchema = z.iso.datetime({ offset: true });
const positiveVersionSchema = z.number().int().positive();
const paymentMethodSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/u);
const paymentEnvironmentSchema = z.enum(["TEST", "LIVE"]);

export const paymentAttemptStatusSchema = z.enum([
  "CREATED",
  "REQUIRES_ACTION",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "EXPIRED",
  "UNKNOWN",
]);

export const orderPaymentStatusSchema = z.enum([
  "UNPAID",
  "PENDING",
  "PAID",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);

const paymentActionTypes = [
  "REDIRECT",
  "PROVIDER_HOSTED_IFRAME",
  "PROVIDER_COMPONENT",
  "QR_CODE",
  "WAIT",
] as const;
export const paymentActionTypeSchema = z.enum(paymentActionTypes);

const redirectActionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  type: z.literal("REDIRECT"),
  url: publicHttpsUrlSchema,
});
const providerHostedIframeActionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  type: z.literal("PROVIDER_HOSTED_IFRAME"),
  url: publicHttpsUrlSchema,
});
const providerComponentActionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  type: z.literal("PROVIDER_COMPONENT"),
  componentKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/u),
  clientToken: providerClientTokenSchema,
});
const qrCodeActionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  type: z.literal("QR_CODE"),
  payload: z.string().min(1).max(4_096),
  expiresAt: timestampSchema,
});
const waitActionSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  type: z.literal("WAIT"),
  pollAfterMs: z.number().int().min(500).max(60_000),
});

const interactivePaymentActionSchema = z.discriminatedUnion("type", [
  redirectActionSchema,
  providerHostedIframeActionSchema,
  providerComponentActionSchema,
  qrCodeActionSchema,
]);

export const paymentActionSchema = z.discriminatedUnion("type", [
  redirectActionSchema,
  providerHostedIframeActionSchema,
  providerComponentActionSchema,
  qrCodeActionSchema,
  waitActionSchema,
]);

export type PaymentAction = z.infer<typeof paymentActionSchema>;

export const paymentCapabilitySchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: paymentCapabilityIdSchema,
    paymentMethod: paymentMethodSchema,
    displayName: z.string().min(1).max(80),
    market: marketSchema,
    country: countrySchema,
    currency: currencySchema,
    minimumAmountMinor: minorAmountSchema,
    maximumAmountMinor: minorAmountSchema,
    actionTypes: z.array(paymentActionTypeSchema).min(1),
    available: z.boolean(),
  })
  .refine(
    (capability) =>
      capability.minimumAmountMinor <= capability.maximumAmountMinor,
    {
      path: ["maximumAmountMinor"],
      message: "maximum amount must be at least the minimum amount",
    },
  )
  .meta({
    "x-runtime-invariants": ["minimumAmountMinor <= maximumAmountMinor"],
  });

export type PaymentCapability = z.infer<typeof paymentCapabilitySchema>;

const paymentAttemptBaseShape = {
  schemaVersion: schemaVersionSchema,
  id: paymentAttemptIdSchema,
  orderId: orderIdSchema,
  providerAccountId: providerAccountIdSchema,
  environment: paymentEnvironmentSchema,
  paymentMethod: paymentMethodSchema,
  amountMinor: minorAmountSchema,
  currency: currencySchema,
  requestedLocale: supportedLocaleSchema,
  providerLocale: z.string().min(1).max(35),
  providerLocaleFallbackUsed: z.boolean(),
  configVersion: positiveVersionSchema,
  ruleVersion: positiveVersionSchema,
  merchantReference: merchantReferenceSchema,
  providerIdempotencyKey: providerIdempotencyKeySchema,
  externalReference: externalPaymentReferenceSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
} as const;

export const paymentAttemptSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...paymentAttemptBaseShape,
      status: z.literal("CREATED"),
    }),
    z.strictObject({
      ...paymentAttemptBaseShape,
      status: z.literal("REQUIRES_ACTION"),
      action: interactivePaymentActionSchema,
    }),
    z.strictObject({
      ...paymentAttemptBaseShape,
      status: z.literal("PROCESSING"),
      action: waitActionSchema.optional(),
    }),
    z.strictObject({
      ...paymentAttemptBaseShape,
      status: z.literal("SUCCEEDED"),
    }),
    z.strictObject({
      ...paymentAttemptBaseShape,
      status: z.literal("FAILED"),
    }),
    z.strictObject({
      ...paymentAttemptBaseShape,
      status: z.literal("CANCELED"),
    }),
    z.strictObject({
      ...paymentAttemptBaseShape,
      status: z.literal("EXPIRED"),
    }),
    z.strictObject({
      ...paymentAttemptBaseShape,
      status: z.literal("UNKNOWN"),
    }),
  ])
  .superRefine((attempt, refinement) => {
    if (
      String(attempt.id) !== String(attempt.merchantReference) ||
      String(attempt.id) !== String(attempt.providerIdempotencyKey)
    ) {
      refinement.addIssue({
        code: "custom",
        path: ["merchantReference"],
        message:
          "merchant reference and provider idempotency key must equal the attempt ID",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "merchantReference and providerIdempotencyKey equal the payment attempt ID",
    ],
  });

export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>;

const publicPaymentAttemptBaseShape = {
  schemaVersion: schemaVersionSchema,
  id: paymentAttemptIdSchema,
  updatedAt: timestampSchema,
} as const;

export const publicPaymentAttemptViewSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...publicPaymentAttemptBaseShape,
    status: z.literal("CREATED"),
  }),
  z.strictObject({
    ...publicPaymentAttemptBaseShape,
    status: z.literal("REQUIRES_ACTION"),
    action: interactivePaymentActionSchema,
  }),
  z.strictObject({
    ...publicPaymentAttemptBaseShape,
    status: z.literal("PROCESSING"),
    action: waitActionSchema.optional(),
  }),
  z.strictObject({
    ...publicPaymentAttemptBaseShape,
    status: z.literal("SUCCEEDED"),
  }),
  z.strictObject({
    ...publicPaymentAttemptBaseShape,
    status: z.literal("FAILED"),
  }),
  z.strictObject({
    ...publicPaymentAttemptBaseShape,
    status: z.literal("CANCELED"),
  }),
  z.strictObject({
    ...publicPaymentAttemptBaseShape,
    status: z.literal("EXPIRED"),
  }),
  z.strictObject({
    ...publicPaymentAttemptBaseShape,
    status: z.literal("UNKNOWN"),
  }),
]);

export type PublicPaymentAttemptView = z.infer<
  typeof publicPaymentAttemptViewSchema
>;

export const paymentReturnQuerySchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  attemptId: paymentAttemptIdSchema,
  state: paymentReturnStateSchema,
});

export const refundStatusSchema = z.enum([
  "REQUESTED",
  "SUBMITTING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
]);

export const providerEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("VERIFIED_WEBHOOK"),
    webhookInboxId: webhookInboxIdSchema,
  }),
  z.strictObject({
    kind: z.literal("AUTHENTICATED_RECONCILE"),
    auditLogId: auditLogIdSchema,
  }),
]);

export const providerEventAssociationSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("MATCHED"),
    paymentAttemptId: paymentAttemptIdSchema,
    externalReference: externalPaymentReferenceSchema,
  }),
  z.strictObject({
    status: z.literal("UNMATCHED"),
    externalReference: externalPaymentReferenceSchema,
  }),
]);

const providerEventBaseShape = {
  schemaVersion: schemaVersionSchema,
  providerAccountId: providerAccountIdSchema,
  environment: paymentEnvironmentSchema,
  providerEventId: providerEventReferenceSchema,
  evidence: providerEvidenceSchema,
  occurredAt: timestampSchema,
  association: providerEventAssociationSchema,
  transaction: z
    .strictObject({
      type: z.enum([
        "AUTHORIZATION",
        "CAPTURE",
        "VOID",
        "REFUND",
        "CHARGEBACK",
        "ADJUSTMENT",
      ]),
      providerReference: providerTransactionReferenceSchema,
    })
    .optional(),
} as const;

/**
 * Shape validation does not establish provider authenticity. Payment adapters
 * may parse this branded event only after the referenced webhook/reconcile
 * evidence has been persisted by the trusted verification path.
 */
export const providerEventSchema = z
  .discriminatedUnion("eventType", [
    z.strictObject({
      ...providerEventBaseShape,
      eventType: z.literal("PAYMENT_STATUS"),
      status: paymentAttemptStatusSchema,
      amountMinor: minorAmountSchema,
      currency: currencySchema,
    }),
    z.strictObject({
      ...providerEventBaseShape,
      eventType: z.literal("REFUND_STATUS"),
      refundReference: providerRefundReferenceSchema,
      status: refundStatusSchema,
      amountMinor: minorAmountSchema,
      currency: currencySchema,
    }),
    z.strictObject({
      ...providerEventBaseShape,
      eventType: z.literal("DISPUTE_STATUS"),
      disputeReference: providerDisputeReferenceSchema,
      status: z.enum(["OPEN", "WON", "LOST"]),
      amountMinor: minorAmountSchema,
      currency: currencySchema,
    }),
  ])
  .superRefine((event, refinement) => {
    const transaction = event.transaction;
    if (transaction === undefined) {
      return;
    }

    const compatible = (() => {
      switch (transaction.type) {
        case "AUTHORIZATION":
          return (
            event.eventType === "PAYMENT_STATUS" &&
            ["PROCESSING", "SUCCEEDED"].includes(event.status)
          );
        case "CAPTURE":
          return (
            event.eventType === "PAYMENT_STATUS" && event.status === "SUCCEEDED"
          );
        case "VOID":
          return (
            event.eventType === "PAYMENT_STATUS" && event.status === "CANCELED"
          );
        case "REFUND":
          return (
            event.eventType === "REFUND_STATUS" && event.status === "SUCCEEDED"
          );
        case "CHARGEBACK":
          return (
            event.eventType === "DISPUTE_STATUS" &&
            ["OPEN", "LOST"].includes(event.status)
          );
        case "ADJUSTMENT":
          return (
            event.eventType === "PAYMENT_STATUS" &&
            event.status === "SUCCEEDED" &&
            event.evidence.kind === "AUTHENTICATED_RECONCILE"
          );
      }
    })();

    if (!compatible) {
      refinement.addIssue({
        code: "custom",
        path: ["transaction", "type"],
        message: "provider transaction type does not match normalized evidence",
      });
    }
  })
  .brand<"VerifiedProviderEvent">();

export type ProviderEvent = z.infer<typeof providerEventSchema>;

export const paymentAttemptWithOrderAmountSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    orderAmount: orderAmountSnapshotSchema,
    attempt: paymentAttemptSchema,
  })
  .superRefine((value, refinement) => {
    if (
      value.attempt.amountMinor !== value.orderAmount.totalAmountMinor ||
      value.attempt.currency !== value.orderAmount.currency
    ) {
      refinement.addIssue({
        code: "custom",
        path: ["attempt", "amountMinor"],
        message:
          "payment attempt must use the persisted order total and currency",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "attempt.amountMinor and currency equal the persisted order amount snapshot",
    ],
  });

export const refundAllocationSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  orderItemId: orderItemIdSchema,
  amountMinor: minorAmountSchema,
});

export const refundSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: refundIdSchema,
    orderId: orderIdSchema,
    paymentAttemptId: paymentAttemptIdSchema,
    capturedCurrency: currencySchema,
    currency: currencySchema,
    capturedAmountMinor: minorAmountSchema,
    requestedAmountMinor: minorAmountSchema,
    processedAmountMinor: minorAmountSchema,
    status: refundStatusSchema,
    allocations: z.array(refundAllocationSchema).min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((refund, refinement) => {
    const allocationTotal = refund.allocations.reduce(
      (sum, allocation) => sum + BigInt(allocation.amountMinor),
      0n,
    );
    if (
      refund.currency !== refund.capturedCurrency ||
      refund.requestedAmountMinor > refund.capturedAmountMinor ||
      refund.processedAmountMinor > refund.requestedAmountMinor ||
      (refund.status === "SUCCEEDED" &&
        refund.processedAmountMinor !== refund.requestedAmountMinor) ||
      allocationTotal !== BigInt(refund.requestedAmountMinor)
    ) {
      refinement.addIssue({
        code: "custom",
        path: ["requestedAmountMinor"],
        message:
          "refund currency and allocation amounts must remain within capture",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "refund currency equals capture currency",
      "processed <= requested <= captured and allocations sum to requested",
      "SUCCEEDED refunds have processedAmountMinor equal to requestedAmountMinor",
    ],
  });

export type Refund = z.infer<typeof refundSchema>;

export const disputeSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: disputeIdSchema,
  orderId: orderIdSchema,
  paymentAttemptId: paymentAttemptIdSchema,
  status: z.enum(["NONE", "OPEN", "WON", "LOST"]),
  amountMinor: minorAmountSchema,
  currency: currencySchema,
  openedAt: timestampSchema.optional(),
  updatedAt: timestampSchema,
});

export type Dispute = z.infer<typeof disputeSchema>;
