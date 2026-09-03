import { z } from "zod";

import { notificationCommandSchema } from "./fulfillment-notification.js";
import {
  containsC0OrDelControlCharacter,
  portErrorBaseShape,
  portOpaqueReferenceSchema,
  portTimestampSchema,
  validatePortErrorPolicy,
} from "./port-common.js";
import { schemaVersionSchema } from "./versioning.js";

export const notificationPortOperationSchema = z.literal("SEND_NOTIFICATION");
export const notificationPortErrorCodeSchema = z.enum([
  "INVALID_COMMAND",
  "RECIPIENT_REJECTED",
  "TEMPLATE_CONTENT_INVALID",
  "IDEMPOTENCY_CONFLICT",
  "AUTHENTICATION_FAILED",
  "RATE_LIMITED",
  "TEMPORARY_UNAVAILABLE",
  "TIMEOUT_OUTCOME_UNKNOWN",
  "CONFIGURATION_ERROR",
  "MALFORMED_PROVIDER_RESPONSE",
  "UNEXPECTED_ADAPTER_FAILURE",
]);
export const notificationPortErrorSchema = z
  .strictObject({
    ...portErrorBaseShape,
    code: notificationPortErrorCodeSchema,
  })
  .superRefine((error, context) =>
    validatePortErrorPolicy(error, context, {
      retryableCodes: [
        "RATE_LIMITED",
        "TEMPORARY_UNAVAILABLE",
        "TIMEOUT_OUTCOME_UNKNOWN",
        "MALFORMED_PROVIDER_RESPONSE",
        "UNEXPECTED_ADAPTER_FAILURE",
      ],
    }),
  );

const sendNotificationCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("SEND_NOTIFICATION"),
  notification: notificationCommandSchema,
  channel: z.literal("EMAIL"),
  content: z.strictObject({
    subject: z
      .string()
      .min(1)
      .max(998)
      .refine((value) => !containsC0OrDelControlCharacter(value), {
        message: "notification subject must not contain control characters",
      }),
    preheader: z
      .string()
      .max(998)
      .refine((value) => !containsC0OrDelControlCharacter(value), {
        message: "notification preheader must not contain control characters",
      })
      .optional(),
    text: z.string().min(1).max(100_000),
    html: z.string().min(1).max(250_000),
  }),
});
export const notificationPortCommandSchema = sendNotificationCommandSchema;

const failureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: notificationPortOperationSchema,
  outcome: z.literal("FAILURE"),
  error: notificationPortErrorSchema,
});
const successSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("SEND_NOTIFICATION"),
  outcome: z.literal("SUCCESS"),
  value: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("ACCEPTED"),
      providerReference: portOpaqueReferenceSchema,
      acceptedAt: portTimestampSchema,
    }),
    z.strictObject({ status: z.literal("REJECTED") }),
  ]),
});
export const notificationPortResponseSchema = z.union([
  successSchema,
  failureSchema,
]);

export type NotificationPortCommand = z.infer<
  typeof notificationPortCommandSchema
>;
export type NotificationPortResponse = z.infer<
  typeof notificationPortResponseSchema
>;
export type NotificationPortError = z.infer<typeof notificationPortErrorSchema>;
export type NotificationPortFailure = z.infer<typeof failureSchema>;
export type SendNotificationCommand = z.infer<
  typeof sendNotificationCommandSchema
>;
export type SendNotificationResponse = NotificationPortResponse;
