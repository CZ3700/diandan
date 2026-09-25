import { z } from "zod";

import {
  contentRevisionIdSchema,
  customerContactIdSchema,
  fulfillmentIdSchema,
  idempotencyKeySchema,
  notificationDeliveryIdSchema,
  orderIdSchema,
  orderItemIdSchema,
} from "./identifiers.js";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./locale.js";
import { fulfillmentStatusSchema } from "./order.js";
import { schemaVersionSchema } from "./versioning.js";

const timestampSchema = z.iso.datetime({ offset: true });
const reasonCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/u);

export const giftFulfillmentSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: fulfillmentIdSchema,
  orderId: orderIdSchema,
  orderItemId: orderItemIdSchema,
  status: fulfillmentStatusSchema,
  version: z.number().int().positive(),
  holdReasonCode: reasonCodeSchema.optional(),
  preparedAt: timestampSchema.optional(),
  deliveredAt: timestampSchema.optional(),
  updatedAt: timestampSchema,
});

export type GiftFulfillment = z.infer<typeof giftFulfillmentSchema>;

export type NotificationLocaleSnapshot = Readonly<{
  schemaVersion: 1;
  requestedLocale: SupportedLocale;
  resolvedLocale: SupportedLocale;
  fallbackUsed: boolean;
  templateKey: string;
  templateVersion: string;
  contentRevisionIds: readonly string[];
}>;

const notificationLocaleBaseShape = {
  schemaVersion: schemaVersionSchema,
  templateKey: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/u),
  templateVersion: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  contentRevisionIds: z
    .array(contentRevisionIdSchema)
    .max(64)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "notification content revision IDs must be unique",
    }),
} as const;
const directNotificationLocaleSchemas = SUPPORTED_LOCALES.map((locale) =>
  z.strictObject({
    ...notificationLocaleBaseShape,
    requestedLocale: z.literal(locale),
    resolvedLocale: z.literal(locale),
    fallbackUsed: z.literal(false),
  }),
);
const fallbackNotificationLocaleSchemas = SUPPORTED_LOCALES.filter(
  (locale) => locale !== DEFAULT_LOCALE,
).map((locale) =>
  z.strictObject({
    ...notificationLocaleBaseShape,
    requestedLocale: z.literal(locale),
    resolvedLocale: z.literal(DEFAULT_LOCALE),
    fallbackUsed: z.literal(true),
  }),
);
const notificationLocaleVariants = [
  ...directNotificationLocaleSchemas,
  ...fallbackNotificationLocaleSchemas,
] as unknown as readonly [
  z.ZodType<NotificationLocaleSnapshot>,
  z.ZodType<NotificationLocaleSnapshot>,
  ...z.ZodType<NotificationLocaleSnapshot>[],
];

export const notificationLocaleSnapshotSchema = z.union(
  notificationLocaleVariants,
);

export const notificationCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: notificationDeliveryIdSchema,
  orderId: orderIdSchema,
  customerContactId: customerContactIdSchema,
  eventType: z.enum(["PAYMENT_CONFIRMED", "PREPARING", "DELIVERED"]),
  locale: notificationLocaleSnapshotSchema,
  idempotencyKey: idempotencyKeySchema,
  correlationId: z.uuid(),
});

export type NotificationCommand = z.infer<typeof notificationCommandSchema>;
