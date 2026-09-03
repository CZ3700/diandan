import { z } from "zod";

import { currencySchema, marketSchema } from "./commerce.js";
import {
  cartIdSchema,
  cartItemIdSchema,
  contentPublicationIdSchema,
  disputeIdSchema,
  eventIdSchema,
  fulfillmentIdSchema,
  notificationDeliveryIdSchema,
  orderIdSchema,
  paymentAttemptIdSchema,
  paymentConfigPublicationIdSchema,
  paymentConfigVersionIdSchema,
  priceBookIdSchema,
  priceBookPublicationIdSchema,
  refundIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { disputeStatusSchema, fulfillmentStatusSchema } from "./order.js";
import { paymentAttemptStatusSchema, refundStatusSchema } from "./payment.js";
import { schemaVersionSchema } from "./versioning.js";

export const canonicalRequestIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  )
  .brand<"CanonicalRequestId">();

export const publicErrorCodeSchema = z.enum([
  "NOT_FOUND",
  "REQUEST_REJECTED",
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "STALE_VERSION",
  "RATE_LIMITED",
  "PAYMENT_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export const publicFieldIssueSchema = z.strictObject({
  field: z.enum([
    "request",
    "locale",
    "idolId",
    "giftId",
    "giftVariantId",
    "fanMessage",
    "displayMode",
    "displayName",
    "presentationLocale",
    "fanMessageLocale",
    "quantity",
    "expectedVersion",
    "email",
    "paymentMethod",
    "state",
  ]),
  code: z.enum([
    "REQUIRED",
    "INVALID",
    "TOO_SHORT",
    "TOO_LONG",
    "OUT_OF_RANGE",
    "CONFLICT",
  ]),
});

export const publicErrorEnvelopeSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  code: publicErrorCodeSchema,
  requestId: canonicalRequestIdSchema,
  fieldIssues: z.array(publicFieldIssueSchema).min(1).optional(),
});

export type PublicErrorEnvelope = z.infer<typeof publicErrorEnvelopeSchema>;

const eventEnvelopeBaseShape = {
  schemaVersion: schemaVersionSchema,
  eventId: eventIdSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  correlationId: z.uuid(),
  causationId: eventIdSchema.optional(),
  requestId: canonicalRequestIdSchema,
  traceId: z
    .string()
    .regex(/^[0-9a-f]{32}$/u)
    .optional(),
} as const;

const eventAggregateVersionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const eventEnvelopeSchema = z
  .discriminatedUnion("eventType", [
    z.strictObject({
      ...eventEnvelopeBaseShape,
      eventType: z.literal("CART_ITEM_ADDED"),
      aggregateId: cartIdSchema,
      payload: z.strictObject({
        cartId: cartIdSchema,
        cartItemId: cartItemIdSchema,
      }),
    }),
    z.strictObject({
      ...eventEnvelopeBaseShape,
      eventType: z.literal("ORDER_PAYMENT_CONFIRMED"),
      aggregateId: orderIdSchema,
      payload: z.strictObject({
        orderId: orderIdSchema,
        paymentAttemptId: paymentAttemptIdSchema,
      }),
    }),
    z.strictObject({
      ...eventEnvelopeBaseShape,
      eventType: z.literal("FULFILLMENT_STATUS_CHANGED"),
      aggregateId: fulfillmentIdSchema,
      payload: z.strictObject({
        fulfillmentId: fulfillmentIdSchema,
        orderId: orderIdSchema,
        status: fulfillmentStatusSchema,
      }),
    }),
    z.strictObject({
      ...eventEnvelopeBaseShape,
      eventType: z.literal("NOTIFICATION_REQUESTED"),
      aggregateId: notificationDeliveryIdSchema,
      payload: z.strictObject({
        notificationDeliveryId: notificationDeliveryIdSchema,
        orderId: orderIdSchema,
      }),
    }),
    z.strictObject({
      ...eventEnvelopeBaseShape,
      eventType: z.literal("CONTENT_PUBLICATION_CHANGED"),
      aggregateId: contentPublicationIdSchema,
      locale: supportedLocaleSchema,
      payload: z.strictObject({
        contentPublicationId: contentPublicationIdSchema,
      }),
    }),
    z.strictObject({
      ...eventEnvelopeBaseShape,
      eventType: z.literal("PAYMENT_STATUS_CHANGED"),
      aggregateId: paymentAttemptIdSchema,
      payload: z.strictObject({
        paymentAttemptId: paymentAttemptIdSchema,
        orderId: orderIdSchema,
        status: paymentAttemptStatusSchema,
      }),
    }),
    z.strictObject({
      ...eventEnvelopeBaseShape,
      eventType: z.literal("REFUND_STATUS_CHANGED"),
      aggregateId: refundIdSchema,
      payload: z.strictObject({
        refundId: refundIdSchema,
        orderId: orderIdSchema,
        status: refundStatusSchema,
      }),
    }),
    z.strictObject({
      ...eventEnvelopeBaseShape,
      eventType: z.literal("DISPUTE_STATUS_CHANGED"),
      aggregateId: disputeIdSchema,
      payload: z.strictObject({
        disputeId: disputeIdSchema,
        orderId: orderIdSchema,
        status: disputeStatusSchema,
      }),
    }),
    z.strictObject({
      ...eventEnvelopeBaseShape,
      eventType: z.literal("PAYMENT_CONFIG_PUBLISHED"),
      aggregateId: paymentConfigVersionIdSchema,
      payload: z.strictObject({
        paymentConfigVersionId: paymentConfigVersionIdSchema,
        paymentConfigPublicationId: paymentConfigPublicationIdSchema,
      }),
    }),
    z.strictObject({
      ...eventEnvelopeBaseShape,
      eventType: z.literal("PRICE_BOOK_PUBLISHED"),
      aggregateId: priceBookIdSchema,
      payload: z.strictObject({
        priceBookPublicationId: priceBookPublicationIdSchema,
        priceBookId: priceBookIdSchema,
        priceBookRevision: eventAggregateVersionSchema,
        market: marketSchema,
        currency: currencySchema,
      }),
    }),
  ])
  .superRefine((event, refinement) => {
    let expectedAggregateId: string;
    switch (event.eventType) {
      case "CART_ITEM_ADDED":
        expectedAggregateId = event.payload.cartId;
        break;
      case "ORDER_PAYMENT_CONFIRMED":
        expectedAggregateId = event.payload.orderId;
        break;
      case "FULFILLMENT_STATUS_CHANGED":
        expectedAggregateId = event.payload.fulfillmentId;
        break;
      case "NOTIFICATION_REQUESTED":
        expectedAggregateId = event.payload.notificationDeliveryId;
        break;
      case "CONTENT_PUBLICATION_CHANGED":
        expectedAggregateId = event.payload.contentPublicationId;
        break;
      case "PAYMENT_STATUS_CHANGED":
        expectedAggregateId = event.payload.paymentAttemptId;
        break;
      case "REFUND_STATUS_CHANGED":
        expectedAggregateId = event.payload.refundId;
        break;
      case "DISPUTE_STATUS_CHANGED":
        expectedAggregateId = event.payload.disputeId;
        break;
      case "PAYMENT_CONFIG_PUBLISHED":
        expectedAggregateId = event.payload.paymentConfigVersionId;
        break;
      case "PRICE_BOOK_PUBLISHED":
        expectedAggregateId = event.payload.priceBookId;
        break;
    }
    if (event.aggregateId !== expectedAggregateId) {
      refinement.addIssue({
        code: "custom",
        path: ["aggregateId"],
        message: "aggregateId must identify the event aggregate",
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "aggregateId must equal the aggregate identifier selected by eventType",
    ],
  });

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
