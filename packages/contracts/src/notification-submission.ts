import { z } from "zod";
import { idempotencyKeySchema } from "./identifiers.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { notificationGatewayProfileSchema } from "./order-notification.js";
import { notificationPortResponseSchema } from "./notification-port-contracts.js";

/** This cutoff bounds platform admission, not a provider-side deduplication promise. */
export const notificationZeptoMailProfileSchema =
  notificationGatewayProfileSchema.extend({
    protocol: z.literal("zeptomail-v1"),
    bounceEmail: z.email().max(254).optional(),
  });
export type NotificationZeptoMailProfile = z.infer<
  typeof notificationZeptoMailProfileSchema
>;

const version = z.literal(1);
export const notificationSubmissionClaimCommandSchema = z.strictObject({
  schemaVersion: version,
  transportKey: sourceHashSchema,
  idempotencyKey: idempotencyKeySchema,
  notificationId: z.uuid(),
  requestHash: sourceHashSchema,
  dispatchNotAfter: contentTimestampSchema,
  claimToken: z.uuid(),
});

/** Uncertain results must remain unresolved; a later attempt cannot authorize another send. */
export const notificationSubmissionDefiniteResultSchema =
  notificationPortResponseSchema.refine(
    (result) =>
      result.outcome === "SUCCESS" ||
      ![
        "TIMEOUT_OUTCOME_UNKNOWN",
        "MALFORMED_PROVIDER_RESPONSE",
        "UNEXPECTED_ADAPTER_FAILURE",
      ].includes(result.error.code),
    "Only a definite normalized mail result may be recorded",
  );
export const notificationSubmissionClaimResultSchema = z.discriminatedUnion(
  "decision",
  [
    z.strictObject({ schemaVersion: version, decision: z.literal("SEND") }),
    z.strictObject({ schemaVersion: version, decision: z.literal("UNKNOWN") }),
    z.strictObject({ schemaVersion: version, decision: z.literal("CONFLICT") }),
    z.strictObject({ schemaVersion: version, decision: z.literal("EXPIRED") }),
    z.strictObject({
      schemaVersion: version,
      decision: z.literal("REPLAY"),
      result: notificationSubmissionDefiniteResultSchema,
    }),
  ],
);
export const notificationSubmissionFinishCommandSchema =
  notificationSubmissionClaimCommandSchema.extend({
    result: notificationSubmissionDefiniteResultSchema,
  });
export const notificationSubmissionFinishResultSchema = z.strictObject({
  schemaVersion: version,
  decision: z.enum(["STORED", "REPLAY", "CONFLICT"]),
});
export type NotificationSubmissionClaimCommand = z.infer<
  typeof notificationSubmissionClaimCommandSchema
>;
export type NotificationSubmissionClaimResult = z.infer<
  typeof notificationSubmissionClaimResultSchema
>;
export type NotificationSubmissionFinishCommand = z.infer<
  typeof notificationSubmissionFinishCommandSchema
>;
export type NotificationSubmissionFinishResult = z.infer<
  typeof notificationSubmissionFinishResultSchema
>;
