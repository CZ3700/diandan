import { z } from "zod";
import {
  countrySchema,
  currencySchema,
  marketSchema,
  minorAmountSchema,
} from "./commerce.js";
import { providerAccountIdSchema } from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  paymentActionTypeSchema,
  paymentEnvironmentSchema,
} from "./payment.js";
import { paymentPortErrorCodeSchema } from "./payment-port-contracts.js";
import { portTimestampSchema } from "./port-common.js";

const version = z.number().int().min(1).max(2147483647);
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const identity = {
  providerAccountId: providerAccountIdSchema,
  environment: paymentEnvironmentSchema,
};
const healthStatus = z.enum(["HEALTHY", "UNAVAILABLE"]);
const sameAccount = (
  a: { providerAccountId: string; environment: string },
  b: { providerAccountId: string; environment: string },
) =>
  a.providerAccountId.toLowerCase() === b.providerAccountId.toLowerCase() &&
  a.environment === b.environment;

export const paymentHealthClassificationSchema = z.enum([
  "SUCCESS",
  "TECHNICAL_FAILURE",
  "BUSINESS_OUTCOME",
  "CONFIGURATION_ERROR",
]);
export const paymentHealthOperationSchema = z.enum([
  "GET_CAPABILITIES",
  "CREATE_PAYMENT",
  "GET_PAYMENT",
  "CANCEL_PAYMENT",
  "REFUND_PAYMENT",
  "RECONCILE_PAYMENT",
  "RECONCILE_REFUND",
]);
export const PAYMENT_HEALTH_TECHNICAL_CODES = [
  "RATE_LIMITED",
  "TEMPORARY_UNAVAILABLE",
  "TIMEOUT_OUTCOME_UNKNOWN",
  "MALFORMED_PROVIDER_RESPONSE",
  "UNEXPECTED_ADAPTER_FAILURE",
] as const;
export const PAYMENT_HEALTH_BUSINESS_CODES = [
  "CAPABILITY_UNAVAILABLE",
  "PAYMENT_NOT_FOUND",
  "REFUND_NOT_FOUND",
  "PROVIDER_DECLINED",
] as const;
const outcome = {
  classification: paymentHealthClassificationSchema,
  code: paymentPortErrorCodeSchema.nullable(),
};
function validOutcome(value: { classification: string; code: string | null }) {
  if (value.classification === "SUCCESS") return value.code === null;
  if (value.classification === "TECHNICAL_FAILURE")
    return PAYMENT_HEALTH_TECHNICAL_CODES.some((code) => code === value.code);
  if (value.classification === "BUSINESS_OUTCOME")
    return (
      value.code === null ||
      PAYMENT_HEALTH_BUSINESS_CODES.some((code) => code === value.code)
    );
  return (
    value.code !== null &&
    !PAYMENT_HEALTH_TECHNICAL_CODES.some((code) => code === value.code) &&
    !PAYMENT_HEALTH_BUSINESS_CODES.some((code) => code === value.code)
  );
}
export const paymentHealthPolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...identity,
  version,
  failureThreshold: z.number().int().min(1).max(100),
  failureWindowMs: z.number().int().min(1000).max(3600000),
  openDurationMs: z.number().int().min(1000).max(86400000),
  probeLeaseMs: z.number().int().min(1000).max(120000),
  probeRetryMs: z.number().int().min(1000).max(86400000),
});
/** Independent internal root; existing PaymentPortCommand and public schemas stay byte-compatible. */
export const paymentHealthCapabilitiesCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal("GET_CAPABILITIES"),
  ...identity,
  market: marketSchema,
  country: countrySchema,
  currency: currencySchema,
  amountMinor: minorAmountSchema,
  requestedLocale: supportedLocaleSchema,
  supportedActionTypes: z
    .array(paymentActionTypeSchema)
    .min(1)
    .max(5)
    .refine((v) => new Set(v).size === v.length),
});
export const paymentHealthProbeContextSchema = z.strictObject({
  schemaVersion: z.literal(1),
  routeId: z.uuid(),
  configVersion: version,
  ruleVersion: version,
  command: paymentHealthCapabilitiesCommandSchema,
});
export const paymentHealthObservationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    observationId: z.uuid(),
    ...identity,
    operation: paymentHealthOperationSchema,
    ...outcome,
    probeContext: paymentHealthProbeContextSchema.nullable(),
  })
  .refine(validOutcome, {
    message: "health classification must match its bounded code",
  })
  .refine(
    (value) =>
      value.probeContext === null ||
      (value.operation === "GET_CAPABILITIES" &&
        sameAccount(value, value.probeContext.command)),
    { message: "probe context must be a correlated capability query" },
  );
export const paymentHealthSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...identity,
  policyVersion: version,
  healthStatus,
  failureCount: z.number().int().min(0).max(100),
  generation: counter,
  probeDueAt: portTimestampSchema.nullable(),
});
export const paymentHealthRecordResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recorded: z.boolean(),
  healthStatus,
});
export const paymentHealthClaimProbeCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  accounts: z
    .array(z.strictObject(identity))
    .min(1)
    .max(100)
    .refine(
      (accounts) =>
        new Set(
          accounts.map(
            (a) => `${a.environment}:${a.providerAccountId.toLowerCase()}`,
          ),
        ).size === accounts.length,
    ),
});
export const paymentHealthProbeLeaseSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    probeId: z.uuid(),
    ...identity,
    generation: counter,
    expiresAt: portTimestampSchema,
    context: paymentHealthProbeContextSchema,
  })
  .refine((v) => sameAccount(v, v.context.command), {
    message: "probe lease and context identity must match",
  });
export const paymentHealthCompleteProbeCommandSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    lease: paymentHealthProbeLeaseSchema,
    ...outcome,
  })
  .refine(validOutcome, {
    message: "health classification must match its bounded code",
  });
export const paymentHealthProbeResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  applied: z.boolean(),
  healthStatus,
});
export const paymentHealthWindowInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  now: portTimestampSchema,
  windowStartedAt: portTimestampSchema.nullable(),
  failureCount: z.number().int().min(0).max(100),
  classification: paymentHealthClassificationSchema,
  policy: paymentHealthPolicySchema,
});
export const paymentHealthWindowResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  windowStartedAt: portTimestampSchema.nullable(),
  failureCount: z.number().int().min(0).max(100),
  thresholdReached: z.boolean(),
});
export type PaymentHealthPolicy = z.infer<typeof paymentHealthPolicySchema>;
export type PaymentHealthCapabilitiesCommand = z.infer<
  typeof paymentHealthCapabilitiesCommandSchema
>;
export type PaymentHealthClassification = z.infer<
  typeof paymentHealthClassificationSchema
>;
export type PaymentHealthOperation = z.infer<
  typeof paymentHealthOperationSchema
>;
export type PaymentHealthProbeContext = z.infer<
  typeof paymentHealthProbeContextSchema
>;
export type PaymentHealthObservation = z.infer<
  typeof paymentHealthObservationSchema
>;
export type PaymentHealthSnapshot = z.infer<typeof paymentHealthSnapshotSchema>;
export type PaymentHealthRecordResult = z.infer<
  typeof paymentHealthRecordResultSchema
>;
export type PaymentHealthClaimProbeCommand = z.infer<
  typeof paymentHealthClaimProbeCommandSchema
>;
export type PaymentHealthProbeLease = z.infer<
  typeof paymentHealthProbeLeaseSchema
>;
export type PaymentHealthCompleteProbeCommand = z.infer<
  typeof paymentHealthCompleteProbeCommandSchema
>;
export type PaymentHealthProbeResult = z.infer<
  typeof paymentHealthProbeResultSchema
>;
export type PaymentHealthWindowInput = z.infer<
  typeof paymentHealthWindowInputSchema
>;
export type PaymentHealthWindowResult = z.infer<
  typeof paymentHealthWindowResultSchema
>;
