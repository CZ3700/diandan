import { z } from "zod";
import { paymentMethodSchema } from "./payment.js";
import {
  paymentRuntimeOriginSchema,
  paymentRuntimeProviderBindingSchema,
} from "./payment-runtime-config.js";
import { paymentWebhookEndpointIdSchema } from "./identifiers.js";
import { verificationKeyReferenceHashSchema } from "./reliable-events.js";
import { paymentStablecoinConfigSchema } from "./payment-stablecoin.js";

const key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/u);
const version = z
  .string()
  .max(64)
  .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/u);
const label = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/u);
// Same format as PostgreSQL secret_reference. v1 versions the reference format, not the secret.
const secretReference = z
  .string()
  .max(512)
  .regex(/^secret-ref:v1:[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._/@-]*$/u);
const operation = z.enum([
  "GET_CAPABILITIES",
  "CREATE_PAYMENT",
  "GET_PAYMENT",
  "CANCEL_PAYMENT",
  "REFUND_PAYMENT",
  "RECONCILE_PAYMENT",
  "RECONCILE_REFUND",
]);
const instrumentKind = z.enum(["CARD", "STABLECOIN", "LOCAL_PAYMENT"]);
const instrument = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("CARD"),
    paymentMethod: paymentMethodSchema,
    brands: z
      .array(z.enum(["VISA", "MASTERCARD"]))
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length),
    authentication: z.literal("PSP_MANAGED_3DS"),
    capture: z.literal("AUTOMATIC"),
  }),
  z.strictObject({
    kind: z.literal("STABLECOIN"),
    paymentMethod: paymentMethodSchema,
    ...paymentStablecoinConfigSchema.omit({ schemaVersion: true }).shape,
    exceptionPolicy: z.literal("MANUAL_REVIEW"),
  }),
  z.strictObject({
    kind: z.literal("LOCAL_PAYMENT"),
    paymentMethod: paymentMethodSchema,
  }),
]);

/** A descriptor belongs to deployed code. It cannot grant an account business eligibility. */
export const deployedPaymentAdapterSchema = z.strictObject({
  schemaVersion: z.literal(1),
  adapterKey: key,
  adapterVersion: version,
  protocol: key,
  supportedOperations: z
    .array(operation)
    .min(1)
    .max(7)
    .refine((v) => new Set(v).size === v.length),
  supportedInstrumentKinds: z
    .array(instrumentKind)
    .min(1)
    .max(3)
    .refine((v) => new Set(v).size === v.length),
  idempotency: z
    .strictObject({
      retention: z.enum(["DURABLE", "BOUNDED", "UNSUPPORTED"]),
      minimumRetentionSeconds: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER),
      referenceLookup: z.boolean(),
    })
    .refine((value) =>
      value.retention === "BOUNDED"
        ? value.minimumRetentionSeconds > 0
        : value.minimumRetentionSeconds === 0,
    ),
});

/** Immutable per account. A different merchant/protocol/origin requires a new account binding. */
export const paymentAccountConnectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  binding: paymentRuntimeProviderBindingSchema,
  adapterVersion: version,
  protocol: key,
  apiOrigin: paymentRuntimeOriginSchema,
  returnOrigin: paymentRuntimeOriginSchema,
  merchantAccount: label,
  credentialRef: secretReference,
  timeoutMs: z.number().int().min(100).max(60000),
  instruments: z
    .array(instrument)
    .min(1)
    .max(50)
    .refine((v) => new Set(v.map((i) => i.paymentMethod)).size === v.length),
});
/** Trusted published configuration projection; rollback is a new, monotonic revision. */
export const paymentConnectorSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  connections: z
    .array(paymentAccountConnectionSchema)
    .max(100)
    .refine(
      (v) =>
        new Set(v.map((c) => c.binding.providerAccountId.toLowerCase()))
          .size === v.length,
    ),
});
/** Reference-selected key set rotation is owned by the secret store, never browser input. */
export const paymentGatewayWebhookConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  binding: paymentRuntimeProviderBindingSchema,
  endpointId: paymentWebhookEndpointIdSchema,
  verificationKeyReferenceHash: verificationKeyReferenceHashSchema,
  secretRef: secretReference,
  toleranceSeconds: z.number().int().min(1).max(300),
  maxBodyBytes: z.number().int().min(1024).max(1048576),
});
export type DeployedPaymentAdapter = z.infer<
  typeof deployedPaymentAdapterSchema
>;
export type PaymentAccountConnection = z.infer<
  typeof paymentAccountConnectionSchema
>;
export type PaymentConnectorSnapshot = z.infer<
  typeof paymentConnectorSnapshotSchema
>;
export type PaymentGatewayWebhookConfig = z.infer<
  typeof paymentGatewayWebhookConfigSchema
>;
