import { z } from "zod";
import { schemaVersionSchema } from "./versioning.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { publicHttpsUrlSchema } from "./presentation.js";
import { adminOpaqueTokenSchema } from "./admin-content.js";
import { identityPortCommandSchema } from "./identity-port-contracts.js";

const version = schemaVersionSchema;
const envelope = { schemaVersion: version, requestId: z.uuid() };
const exchange = identityPortCommandSchema.options[1].shape;
export const adminAccessSettingsSchema = z.strictObject({
  schemaVersion: version,
  issuer: exchange.issuer,
  clientId: exchange.clientId,
  redirectUri: exchange.redirectUri,
  policyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u),
  loginTtlSeconds: z.number().int().min(30).max(600),
  sessionTtlSeconds: z.number().int().min(60).max(28_800),
  maxAuthenticationAgeSeconds: z.number().int().min(30).max(600),
});
export const adminAccessFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "LOGIN_RESTART_REQUIRED",
    "ACCESS_DENIED",
    "MFA_REQUIRED",
    "UNAUTHENTICATED",
    "CSRF_INVALID",
    "ACCESS_UNAVAILABLE",
  ]),
});
export const adminAccessBeginRequestSchema = z.strictObject({
  ...envelope,
  locale: supportedLocaleSchema,
});
export const adminAccessCallbackRequestSchema = z.strictObject({
  ...envelope,
  browserToken: adminOpaqueTokenSchema,
  state: exchange.state,
  code: exchange.code,
});
export const adminAccessLogoutRequestSchema = z.strictObject({
  ...envelope,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  revokeAll: z.boolean(),
});
const success = { schemaVersion: version, outcome: z.literal("SUCCESS") };
/** Same-origin login bootstrap. Binding credentials remain in HttpOnly cookies. */
export const adminAccessBeginBrowserResponseSchema = z.union([
  z.strictObject({
    ...success,
    kind: z.literal("LOGIN_REDIRECT"),
    authorizationUrl: publicHttpsUrlSchema,
  }),
  adminAccessFailureSchema,
]);
export type AdminAccessBeginBrowserResponse = z.infer<
  typeof adminAccessBeginBrowserResponseSchema
>;
/** Private BFF/API only. Credential-bearing results never enter HTML, logs or analytics. */
export const adminAccessBeginResponseSchema = z.union([
  z.strictObject({
    ...success,
    kind: z.literal("LOGIN_REDIRECT"),
    authorizationUrl: publicHttpsUrlSchema,
    browserToken: adminOpaqueTokenSchema,
    expiresAt: contentTimestampSchema,
  }),
  adminAccessFailureSchema,
]);
export const adminAccessCallbackResponseSchema = z.union([
  z.strictObject({
    ...success,
    kind: z.literal("SESSION_CREATED"),
    sessionToken: adminOpaqueTokenSchema,
    csrfToken: adminOpaqueTokenSchema,
    expiresAt: contentTimestampSchema,
    locale: supportedLocaleSchema,
  }),
  adminAccessFailureSchema,
]);
export const adminAccessLogoutResponseSchema = z.union([
  z.strictObject({ ...success, kind: z.literal("LOGGED_OUT") }),
  adminAccessFailureSchema,
]);
export const adminAccessCreateCommandSchema = z.strictObject({
  ...envelope,
  challengeId: z.uuid(),
  stateDigest: sourceHashSchema,
  bindingDigest: sourceHashSchema,
  configurationDigest: sourceHashSchema,
  locale: supportedLocaleSchema,
  ttlSeconds: z.number().int().min(30).max(600),
});
export const adminAccessCreateResponseSchema = z.union([
  z.strictObject({
    ...success,
    kind: z.literal("LOGIN_CREATED"),
    expiresAt: contentTimestampSchema,
  }),
  adminAccessFailureSchema,
]);
export const adminAccessClaimCommandSchema = z.strictObject({
  ...envelope,
  stateDigest: sourceHashSchema,
  bindingDigest: sourceHashSchema,
  configurationDigest: sourceHashSchema,
  claimDigest: sourceHashSchema,
});
export const adminAccessClaimResponseSchema = z.union([
  z.strictObject({
    ...success,
    kind: z.literal("LOGIN_CLAIMED"),
    challengeId: z.uuid(),
  }),
  adminAccessFailureSchema,
]);
export const adminAccessCompleteCommandSchema = z.strictObject({
  ...envelope,
  challengeId: z.uuid(),
  claimDigest: sourceHashSchema,
  issuer: exchange.issuer,
  subjectDigest: sourceHashSchema,
  authenticatedAt: contentTimestampSchema,
  mfa: z.literal(true),
  sessionId: z.uuid(),
  sessionTokenDigest: sourceHashSchema,
  csrfTokenDigest: sourceHashSchema,
  sessionTtlSeconds: z.number().int().min(60).max(28_800),
  maxAuthenticationAgeSeconds: z.number().int().min(30).max(600),
});
export const adminAccessCompleteResponseSchema = z.union([
  z.strictObject({
    ...success,
    kind: z.literal("SESSION_SAVED"),
    expiresAt: contentTimestampSchema,
    locale: supportedLocaleSchema,
  }),
  adminAccessFailureSchema,
]);
export const adminAccessRevokeCommandSchema = z.strictObject({
  ...envelope,
  sessionTokenDigest: sourceHashSchema,
  csrfTokenDigest: sourceHashSchema,
  revokeAll: z.boolean(),
});
export type AdminAccessSettings = z.infer<typeof adminAccessSettingsSchema>;
export type AdminAccessFailure = z.infer<typeof adminAccessFailureSchema>;
export type AdminAccessBeginRequest = z.infer<
  typeof adminAccessBeginRequestSchema
>;
export type AdminAccessCallbackRequest = z.infer<
  typeof adminAccessCallbackRequestSchema
>;
export type AdminAccessLogoutRequest = z.infer<
  typeof adminAccessLogoutRequestSchema
>;
export type AdminAccessBeginResponse = z.infer<
  typeof adminAccessBeginResponseSchema
>;
export type AdminAccessCallbackResponse = z.infer<
  typeof adminAccessCallbackResponseSchema
>;
export type AdminAccessLogoutResponse = z.infer<
  typeof adminAccessLogoutResponseSchema
>;
export type AdminAccessCreateCommand = z.infer<
  typeof adminAccessCreateCommandSchema
>;
export type AdminAccessCreateResponse = z.infer<
  typeof adminAccessCreateResponseSchema
>;
export type AdminAccessClaimCommand = z.infer<
  typeof adminAccessClaimCommandSchema
>;
export type AdminAccessClaimResponse = z.infer<
  typeof adminAccessClaimResponseSchema
>;
export type AdminAccessCompleteCommand = z.infer<
  typeof adminAccessCompleteCommandSchema
>;
export type AdminAccessCompleteResponse = z.infer<
  typeof adminAccessCompleteResponseSchema
>;
export type AdminAccessRevokeCommand = z.infer<
  typeof adminAccessRevokeCommandSchema
>;
export const adminAccessRejectCommandSchema = z.strictObject({
  ...envelope,
  challengeId: z.uuid(),
  claimDigest: sourceHashSchema,
  reasonCode: z.enum([
    "IDENTITY_REJECTED",
    "MFA_REQUIRED",
    "AUTHENTICATION_EXPIRED",
  ]),
});
export const adminAccessRejectResponseSchema = z.union([
  z.strictObject({ ...success, kind: z.literal("LOGIN_REJECTED") }),
  adminAccessFailureSchema,
]);
export type AdminAccessRejectCommand = z.infer<
  typeof adminAccessRejectCommandSchema
>;
export type AdminAccessRejectResponse = z.infer<
  typeof adminAccessRejectResponseSchema
>;
