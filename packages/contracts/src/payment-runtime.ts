import { z } from "zod";
import {
  checkoutPreflightFailureCodeSchema,
  checkoutText,
  checkoutVersionSchema,
} from "./checkout-preflight.js";
import { checkoutSessionViewSchema } from "./checkout-preflight-public.js";
import {
  countrySchema,
  currencySchema,
  marketSchema,
  minorAmountSchema,
} from "./commerce.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { paymentDeviceCapabilitySchema } from "./domain-rules.js";
import {
  checkoutSessionIdSchema,
  paymentAttemptIdSchema,
  paymentCapabilityIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  paymentActionSchema,
  paymentAttemptStatusSchema,
  paymentEnvironmentSchema,
  paymentMethodSchema,
} from "./payment.js";

export const paymentRuntimeSupportedActionsSchema = z
  .array(paymentDeviceCapabilitySchema)
  .min(1)
  .max(4)
  .refine((values) => new Set(values).size === values.length);
const session = {
  schemaVersion: z.literal(1),
  checkoutSessionId: checkoutSessionIdSchema,
};
export const paymentRuntimeCapabilitiesCommandSchema = z.strictObject({
  ...session,
  operation: z.literal("READ_PAYMENT_CAPABILITIES"),
  presentationLocale: supportedLocaleSchema,
  country: countrySchema.optional(),
  supportedActionTypes: paymentRuntimeSupportedActionsSchema,
});
/** The browser selects an eligible published rule, never an account, amount, currency or return URL. */
export const paymentRuntimeCreateCommandSchema = z.strictObject({
  ...session,
  operation: z.literal("CREATE_PAYMENT_ATTEMPT"),
  capabilityId: paymentCapabilityIdSchema,
  country: countrySchema,
  configVersion: checkoutVersionSchema,
  ruleVersion: checkoutVersionSchema,
  supportedActionTypes: paymentRuntimeSupportedActionsSchema,
});
export const paymentRuntimeReadCommandSchema = z.strictObject({
  ...session,
  operation: z.literal("READ_PAYMENT_ATTEMPT"),
  attemptId: paymentAttemptIdSchema,
});
export const paymentRuntimeRecoverCommandSchema = z.strictObject({
  ...session,
  operation: z.literal("RECOVER_PAYMENT_ATTEMPT"),
  attemptId: paymentAttemptIdSchema,
});
export const paymentRuntimeCurrentCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal("READ_CURRENT_CHECKOUT"),
});
export const paymentRuntimeCommandSchema = z.discriminatedUnion("operation", [
  paymentRuntimeCapabilitiesCommandSchema,
  paymentRuntimeCreateCommandSchema,
  paymentRuntimeReadCommandSchema,
  paymentRuntimeRecoverCommandSchema,
  paymentRuntimeCurrentCommandSchema,
]);
export const paymentRuntimeCapabilitiesRequestSchema =
  paymentRuntimeCapabilitiesCommandSchema.omit({
    operation: true,
    checkoutSessionId: true,
  });
export const paymentRuntimeCreateRequestSchema =
  paymentRuntimeCreateCommandSchema.omit({
    operation: true,
    checkoutSessionId: true,
  });
export const paymentRuntimeReadRequestSchema =
  paymentRuntimeReadCommandSchema.omit({
    operation: true,
    checkoutSessionId: true,
    attemptId: true,
  });
export const paymentRuntimeRecoverRequestSchema =
  paymentRuntimeRecoverCommandSchema.omit({
    operation: true,
    checkoutSessionId: true,
    attemptId: true,
  });
export const paymentRuntimeCurrentRequestSchema =
  paymentRuntimeCurrentCommandSchema.omit({ operation: true });
export const paymentRuntimeFailureCodeSchema = z.enum([
  ...checkoutPreflightFailureCodeSchema.options,
  "PROVIDER_UNAVAILABLE",
  "CAPABILITY_UNAVAILABLE",
  "PAYMENT_IN_PROGRESS",
  "ATTEMPT_NOT_FOUND",
  "RECHECKOUT_REQUIRED",
  "STALE_CONFIGURATION",
  "SESSION_NOT_READY",
  "RECOVERY_IN_PROGRESS",
  "STALE_CLAIM",
  "CONFIGURATION_ERROR",
]);
export const paymentRuntimeFailureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.literal("FAILURE"),
  code: paymentRuntimeFailureCodeSchema,
});
export const paymentRuntimeRecoverySchema = z.enum([
  "NONE",
  "CREATE_PENDING",
  "RECONCILE_REQUIRED",
  "EVIDENCE_PENDING",
]);
export const paymentRuntimeAttemptViewSchema = z
  .strictObject({
    ...session,
    id: paymentAttemptIdSchema,
    version: checkoutVersionSchema,
    environment: paymentEnvironmentSchema,
    status: paymentAttemptStatusSchema,
    requestedLocale: supportedLocaleSchema,
    providerLocale: z.string().min(1).max(35),
    providerLocaleFallbackUsed: z.boolean(),
    recovery: paymentRuntimeRecoverySchema,
    canRetry: z.boolean(),
    action: paymentActionSchema.optional(),
    actionExpiresAt: contentTimestampSchema.optional(),
    actionExpired: z.boolean(),
    updatedAt: contentTimestampSchema,
  })
  .superRefine((value, context) => {
    const terminalFailure = ["FAILED", "CANCELED", "EXPIRED"].includes(
      value.status,
    );
    const interactive =
      value.action !== undefined && value.action.type !== "WAIT";
    if (
      (value.canRetry && (!terminalFailure || value.recovery !== "NONE")) ||
      (value.status === "UNKNOWN" &&
        value.recovery !== "RECONCILE_REQUIRED" &&
        value.recovery !== "EVIDENCE_PENDING") ||
      (value.status === "CREATED" && value.recovery !== "CREATE_PENDING") ||
      (value.status === "SUCCEEDED" && value.recovery !== "NONE") ||
      (value.action !== undefined &&
        (value.actionExpired || value.recovery === "EVIDENCE_PENDING")) ||
      (interactive &&
        (value.status !== "REQUIRES_ACTION" ||
          value.actionExpiresAt === undefined)) ||
      (value.action?.type === "WAIT" && value.status !== "PROCESSING") ||
      (value.actionExpiresAt !== undefined && !interactive) ||
      (value.actionExpired && value.status !== "REQUIRES_ACTION")
    )
      context.addIssue({
        code: "custom",
        message:
          "An attempt view must not offer payment or retry from an uncertain, expired or completed state",
      });
  });
/** Display strings come from the immutable reviewed payment publication, not arbitrary provider output. */
export const paymentRuntimeCapabilityViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: paymentCapabilityIdSchema,
  paymentMethod: paymentMethodSchema,
  displayName: checkoutText(80),
  customerHint: checkoutText(280),
  environment: paymentEnvironmentSchema,
  configVersion: checkoutVersionSchema,
  ruleVersion: checkoutVersionSchema,
  supportedActionTypes: paymentRuntimeSupportedActionsSchema,
});
export const paymentRuntimeCapabilitiesViewSchema = z
  .strictObject({
    ...session,
    presentationLocale: supportedLocaleSchema,
    market: marketSchema,
    currency: currencySchema,
    amountMinor: minorAmountSchema,
    countries: z
      .array(countrySchema)
      .max(300)
      .refine((values) => new Set(values).size === values.length),
    country: countrySchema.nullable(),
    capabilities: z.array(paymentRuntimeCapabilityViewSchema).max(200),
  })
  .refine(
    (value) =>
      (value.country === null
        ? value.capabilities.length === 0
        : value.countries.includes(value.country)) &&
      new Set(value.capabilities.map((entry) => entry.id.toLowerCase()))
        .size === value.capabilities.length,
  );
export const paymentRuntimeResponseSchema = z.union([
  paymentRuntimeFailureSchema,
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    action: z.literal("CAPABILITIES"),
    capabilities: paymentRuntimeCapabilitiesViewSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    action: z.enum(["CREATED", "REPLAYED", "READ", "RECOVERED"]),
    attempt: paymentRuntimeAttemptViewSchema,
  }),
  z
    .strictObject({
      schemaVersion: z.literal(1),
      outcome: z.literal("SUCCESS"),
      action: z.literal("CURRENT"),
      checkout: checkoutSessionViewSchema,
      attempt: paymentRuntimeAttemptViewSchema.nullable(),
    })
    .refine(
      (value) =>
        value.attempt === null ||
        value.attempt.checkoutSessionId.toLowerCase() ===
          value.checkout.id.toLowerCase(),
    ),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    action: z.literal("EMPTY"),
  }),
]);

export type PaymentRuntimeCapabilitiesCommand = z.infer<
  typeof paymentRuntimeCapabilitiesCommandSchema
>;
export type PaymentRuntimeCreateCommand = z.infer<
  typeof paymentRuntimeCreateCommandSchema
>;
export type PaymentRuntimeReadCommand = z.infer<
  typeof paymentRuntimeReadCommandSchema
>;
export type PaymentRuntimeRecoverCommand = z.infer<
  typeof paymentRuntimeRecoverCommandSchema
>;
export type PaymentRuntimeCurrentCommand = z.infer<
  typeof paymentRuntimeCurrentCommandSchema
>;
export type PaymentRuntimeCommand = z.infer<typeof paymentRuntimeCommandSchema>;
export type PaymentRuntimeFailureCode = z.infer<
  typeof paymentRuntimeFailureCodeSchema
>;
export type PaymentRuntimeFailure = z.infer<typeof paymentRuntimeFailureSchema>;
export type PaymentRuntimeAttemptView = z.infer<
  typeof paymentRuntimeAttemptViewSchema
>;
export type PaymentRuntimeCapabilityView = z.infer<
  typeof paymentRuntimeCapabilityViewSchema
>;
export type PaymentRuntimeCapabilitiesView = z.infer<
  typeof paymentRuntimeCapabilitiesViewSchema
>;
export type PaymentRuntimeResponse = z.infer<
  typeof paymentRuntimeResponseSchema
>;
