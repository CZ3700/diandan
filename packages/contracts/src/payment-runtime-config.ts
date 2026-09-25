import { z } from "zod";
import { providerAccountIdSchema } from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { paymentEnvironmentSchema } from "./payment.js";
import { publicHttpsUrlSchema } from "./presentation.js";
import { paymentRuntimeFailureSchema } from "./payment-runtime.js";

export const paymentRuntimeOriginSchema = publicHttpsUrlSchema.refine(
  (value) => new URL(value).origin === value,
  "A payment runtime origin contains no path, query or fragment",
);
export const paymentRuntimeProviderLocaleSchema = z.strictObject({
  providerLocale: z
    .string()
    .min(1)
    .max(35)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u),
  fallbackUsed: z.boolean(),
});
/** Deployed adapter metadata: alias mapping and fallback are explicit, never inferred from route country. */
export const paymentRuntimeProviderBindingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  providerAccountId: providerAccountIdSchema,
  providerCode: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/u),
  environment: paymentEnvironmentSchema,
  localeMapping: z.record(
    supportedLocaleSchema,
    paymentRuntimeProviderLocaleSchema,
  ),
  allowedActionOrigins: z
    .array(paymentRuntimeOriginSchema)
    .max(20)
    .refine((values) => new Set(values).size === values.length),
});
const duration = z.number().int().min(1000).max(86_400_000);
export const paymentRuntimeConfigurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  publicStorefrontOrigin: paymentRuntimeOriginSchema,
  leaseMs: duration.max(300_000),
  recoveryDelayMs: duration,
  actionTtlMs: duration,
  returnStateTtlMs: duration,
  recoveryBatchSize: z.number().int().min(1).max(100),
});
export type PaymentRuntimeProviderLocale = z.infer<
  typeof paymentRuntimeProviderLocaleSchema
>;
export type PaymentRuntimeProviderBinding = z.infer<
  typeof paymentRuntimeProviderBindingSchema
>;
export type PaymentRuntimeConfiguration = z.infer<
  typeof paymentRuntimeConfigurationSchema
>;
export const paymentRuntimeRecoveryRunResponseSchema = z.union([
  paymentRuntimeFailureSchema,
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    processed: z.boolean(),
  }),
]);
export type PaymentRuntimeRecoveryRunResponse = z.infer<
  typeof paymentRuntimeRecoveryRunResponseSchema
>;
