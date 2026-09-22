import { z } from "zod";
import { adminOpaqueTokenSchema } from "./admin-content.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { checkoutVersionSchema } from "./checkout-preflight.js";
import {
  countrySchema,
  currencySchema,
  marketSchema,
  minorAmountSchema,
} from "./commerce.js";
import {
  idempotencyKeySchema,
  providerAccountIdSchema as baseProviderAccountIdSchema,
} from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { paymentEnvironmentSchema, paymentMethodSchema } from "./payment.js";
import { paymentDeviceCapabilitySchema } from "./domain-rules.js";
import { paymentHealthPolicySchema } from "./payment-health.js";
const providerAccountIdSchema = baseProviderAccountIdSchema.toLowerCase();
const uuid = z.uuid().toLowerCase(),
  version = z.literal(1),
  basisPoints = z.number().int().min(0).max(10000);
const integer = z.number().int().min(-2147483648).max(2147483647);
const code = z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u);
const unique = <T>(values: T[], key: (value: T) => string) =>
  new Set(values.map(key)).size === values.length;
export const paymentConfigurationHealthSettingsSchema =
  paymentHealthPolicySchema.omit({
    schemaVersion: true,
    providerAccountId: true,
    environment: true,
    version: true,
  });
export const paymentConfigurationTranslationSchema = z.strictObject({
  locale: supportedLocaleSchema,
  displayName: z.string().trim().min(1).max(80),
  customerHint: z.string().trim().min(1).max(280),
  /** A lineage hint only. Independent server-side review must bind the actual current English source. */
  translatedFromSourceHash: sourceHashSchema.nullable(),
});
export const paymentConfigurationChannelSchema = z.strictObject({
  providerAccountId: providerAccountIdSchema,
  enabled: z.boolean(),
  displayOrder: integer.min(0),
  rolloutBasisPoints: basisPoints,
  healthPolicy: paymentConfigurationHealthSettingsSchema,
  translations: z
    .array(paymentConfigurationTranslationSchema)
    .max(7)
    .refine((v) => unique(v, (x) => x.locale)),
});
export const paymentConfigurationRouteSchema = z.strictObject({
  ruleKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  providerAccountId: providerAccountIdSchema,
  paymentMethod: paymentMethodSchema,
  enabled: z.boolean(),
  countries: z
    .array(countrySchema)
    .max(250)
    .refine((v) => unique(v, String)),
  markets: z
    .array(marketSchema)
    .max(100)
    .refine((v) => unique(v, String)),
  currencies: z
    .array(currencySchema)
    .max(100)
    .refine((v) => unique(v, String)),
  minimumAmountMinor: minorAmountSchema,
  maximumAmountMinor: minorAmountSchema,
  requiredDeviceCapabilities: z
    .array(paymentDeviceCapabilitySchema)
    .max(4)
    .refine((v) => unique(v, String)),
  priority: integer,
  rolloutBasisPoints: basisPoints,
});
/** Incomplete drafts are allowed; strict publish validation owns commercial and translation readiness. */
export const paymentConfigurationDocumentSchema = z.strictObject({
  schemaVersion: version,
  channels: z
    .array(paymentConfigurationChannelSchema)
    .max(100)
    .refine((v) => unique(v, (x) => x.providerAccountId.toLowerCase())),
  routes: z
    .array(paymentConfigurationRouteSchema)
    .max(200)
    .refine((v) => unique(v, (x) => x.ruleKey)),
});
const target = { revisionId: uuid },
  head = { expectedPublicationId: uuid.nullable() },
  mutation = { idempotencyKey: idempotencyKeySchema };
const review = {
  ...target,
  providerAccountId: providerAccountIdSchema,
  locale: supportedLocaleSchema,
  ...mutation,
};
const publication = {
  ...target,
  ...head,
  ...mutation,
  validationHash: sourceHashSchema,
  reasonCode: code,
  confirmed: z.literal(true),
};
export const adminPaymentConfigurationCommandSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      schemaVersion: version,
      action: z.literal("READ"),
      revisionId: uuid.nullable(),
    }),
    z.strictObject({
      schemaVersion: version,
      action: z.literal("SAVE"),
      sourceRevisionId: uuid.nullable(),
      ...head,
      ...mutation,
      configuration: paymentConfigurationDocumentSchema,
    }),
    z.strictObject({
      schemaVersion: version,
      action: z.literal("SUBMIT"),
      ...review,
    }),
    z.strictObject({
      schemaVersion: version,
      action: z.literal("APPROVE"),
      ...review,
    }),
    z.strictObject({
      schemaVersion: version,
      action: z.literal("VALIDATE"),
      ...target,
      ...head,
      mode: z.enum(["PUBLISH", "ROLLBACK"]),
    }),
    z.strictObject({
      schemaVersion: version,
      action: z.literal("PUBLISH"),
      ...publication,
    }),
    z.strictObject({
      schemaVersion: version,
      action: z.literal("ROLLBACK"),
      ...publication,
    }),
  ],
);
export const adminPaymentConfigurationRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: adminPaymentConfigurationCommandSchema,
});
export const adminPaymentConfigurationFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "UNAUTHENTICATED",
    "CSRF_INVALID",
    "FORBIDDEN",
    "NOT_FOUND",
    "STALE_VERSION",
    "IDEMPOTENCY_CONFLICT",
    "CONFLICT",
    "SELF_REVIEW",
    "TRANSLATION_STALE",
    "VALIDATION_REQUIRED",
    "VALIDATION_FAILED",
    "ADAPTER_UNAVAILABLE",
    "RATE_LIMITED",
    "TEMPORARY_UNAVAILABLE",
  ]),
});
/** Safe deployment facts; no merchant reference, endpoint, credentials or secret references. */
export const paymentConfigurationAccountSchema = z.strictObject({
  healthPolicy: paymentConfigurationHealthSettingsSchema.nullable(),
  providerAccountId: providerAccountIdSchema,
  environment: paymentEnvironmentSchema,
  displayLabel: z.string().min(1).max(160),
  adapterKey: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/u),
  adapterVersion: z
    .string()
    .max(64)
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/u),
  paymentMethods: z
    .array(paymentMethodSchema)
    .max(50)
    .refine((v) => unique(v, String)),
  deployed: z.boolean(),
  accountStatus: z.enum([
    "DISABLED",
    "INTERNAL",
    "ACTIVE",
    "SUSPENDED",
    "ARCHIVED",
  ]),
  merchantStatus: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]),
  healthStatus: z.enum(["HEALTHY", "UNAVAILABLE"]),
});
export const paymentConfigurationReviewSchema = z.strictObject({
  providerAccountId: providerAccountIdSchema,
  locale: supportedLocaleSchema,
  status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED", "STALE"]),
  sourceHash: sourceHashSchema,
  editorId: uuid,
  reviewerId: uuid.nullable(),
  canApprove: z.boolean(),
});
export const paymentConfigurationRevisionSchema = z.strictObject({
  revisionId: uuid,
  version: checkoutVersionSchema,
  lifecycle: z.enum([
    "DRAFT",
    "VALIDATED",
    "PUBLISHED",
    "SUPERSEDED",
    "ARCHIVED",
  ]),
  createdAt: contentTimestampSchema,
  createdBy: uuid,
  configuration: paymentConfigurationDocumentSchema,
  reviews: z.array(paymentConfigurationReviewSchema).max(700),
});
export const paymentConfigurationHistorySchema = z.strictObject({
  revisionId: uuid,
  version: checkoutVersionSchema,
  lifecycle: z.enum([
    "DRAFT",
    "VALIDATED",
    "PUBLISHED",
    "SUPERSEDED",
    "ARCHIVED",
  ]),
  createdAt: contentTimestampSchema,
  wasPublished: z.boolean(),
});
export const paymentConfigurationIssueSchema = z.strictObject({
  code: z.enum([
    "EMPTY_ROUTES",
    "ACCOUNT_UNAVAILABLE",
    "ADAPTER_UNAVAILABLE",
    "UNSUPPORTED_METHOD",
    "INVALID_ROUTE",
    "TRANSLATION_MISSING",
    "TRANSLATION_UNAPPROVED",
    "TRANSLATION_STALE",
    "HEALTH_POLICY_INVALID",
    "NOT_PREVIOUSLY_PUBLISHED",
  ]),
  providerAccountId: providerAccountIdSchema.nullable(),
  ruleKey: z.string().max(128).nullable(),
  locale: supportedLocaleSchema.nullable(),
});
const configurationDiffFieldSchema = z.enum([
  "enabled",
  "displayOrder",
  "rolloutBasisPoints",
  "healthPolicy",
  "translations",
  "providerAccountId",
  "paymentMethod",
  "countries",
  "markets",
  "currencies",
  "minimumAmountMinor",
  "maximumAmountMinor",
  "requiredDeviceCapabilities",
  "priority",
]);
export const paymentConfigurationDiffValueSchema = z.union([
  z.boolean(),
  z.number().int().min(-2147483648).max(Number.MAX_SAFE_INTEGER),
  z.string().max(128),
  z.array(z.string().max(128)).max(250),
  paymentConfigurationHealthSettingsSchema,
  z.array(paymentConfigurationTranslationSchema).max(7),
  z.null(),
]);
export const paymentConfigurationDiffSchema = z.strictObject({
  kind: z.enum(["CHANNEL", "ROUTE"]),
  key: z.string().max(128),
  change: z.enum(["ADDED", "REMOVED", "CHANGED"]),
  fields: z.array(configurationDiffFieldSchema).max(15),
  values: z
    .array(
      z.strictObject({
        field: configurationDiffFieldSchema,
        before: paymentConfigurationDiffValueSchema,
        after: paymentConfigurationDiffValueSchema,
      }),
    )
    .max(15)
    .optional(),
});
export const adminPaymentConfigurationResponseSchema = z.union([
  adminPaymentConfigurationFailureSchema,
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("WORKSPACE"),
    actorId: uuid,
    canEdit: z.boolean(),
    canPublish: z.boolean(),
    reviewLocales: z.array(supportedLocaleSchema).max(7),
    currentPublicationId: uuid.nullable(),
    currentRevisionId: uuid.nullable(),
    generation: z.number().int().min(0).max(2147483647),
    accounts: z.array(paymentConfigurationAccountSchema).max(100),
    selected: paymentConfigurationRevisionSchema.nullable(),
    history: z.array(paymentConfigurationHistorySchema).max(100),
  }),
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("VALIDATION"),
    revisionId: uuid,
    expectedPublicationId: uuid.nullable(),
    mode: z.enum(["PUBLISH", "ROLLBACK"]),
    valid: z.boolean(),
    validationHash: sourceHashSchema.nullable(),
    issues: z.array(paymentConfigurationIssueSchema).max(2000),
    diff: z.array(paymentConfigurationDiffSchema).max(600),
  }),
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("MUTATION"),
    action: z.enum(["SAVE", "SUBMIT", "APPROVE", "PUBLISH", "ROLLBACK"]),
    revisionId: uuid,
    publicationId: uuid.nullable(),
    generation: z.number().int().min(0).max(2147483647),
    replayed: z.boolean(),
  }),
]);
export type PaymentConfigurationHealthSettings = z.infer<
  typeof paymentConfigurationHealthSettingsSchema
>;
export type PaymentConfigurationTranslation = z.infer<
  typeof paymentConfigurationTranslationSchema
>;
export type PaymentConfigurationChannel = z.infer<
  typeof paymentConfigurationChannelSchema
>;
export type PaymentConfigurationRoute = z.infer<
  typeof paymentConfigurationRouteSchema
>;
export type PaymentConfigurationDocument = z.infer<
  typeof paymentConfigurationDocumentSchema
>;
export type PaymentConfigurationAccount = z.infer<
  typeof paymentConfigurationAccountSchema
>;
export type PaymentConfigurationReview = z.infer<
  typeof paymentConfigurationReviewSchema
>;
export type PaymentConfigurationRevision = z.infer<
  typeof paymentConfigurationRevisionSchema
>;
export type PaymentConfigurationIssue = z.infer<
  typeof paymentConfigurationIssueSchema
>;
export type PaymentConfigurationDiff = z.infer<
  typeof paymentConfigurationDiffSchema
>;
export type AdminPaymentConfigurationCommand = z.infer<
  typeof adminPaymentConfigurationCommandSchema
>;
export type AdminPaymentConfigurationRequest = z.infer<
  typeof adminPaymentConfigurationRequestSchema
>;
export type AdminPaymentConfigurationResponse = z.infer<
  typeof adminPaymentConfigurationResponseSchema
>;
export type AdminPaymentConfigurationFailure = z.infer<
  typeof adminPaymentConfigurationFailureSchema
>;
