import { z } from "zod";
import { schemaVersionSchema } from "./versioning.js";
import { supportedLocaleSchema } from "./locale.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { adminOpaqueTokenSchema } from "./admin-content.js";
import { adminSessionPermissionSchema } from "./admin-session.js";
import { adminOrdersPermissionSchema } from "./admin-orders.js";
import { giftCommercePermissionSchema } from "./gift-commerce.js";

// ADR-021 / L3-10: built-in admin accounts. Design: docs/plan/2026-09-29-l3-10-built-in-admin-login.md

/** Issuer of every built-in identity in admin_identities; OIDC identities keep their IdP issuer. */
export const ADMIN_LOCAL_ISSUER = "urn:fan-support:local";

/** Every permission a role can hold. Migration 0052 lists the keys up to `staff.manage`; later keys are registered by their own migrations. */
export const adminPermissionKeySchema = z.enum([
  ...new Set([
    ...adminSessionPermissionSchema.options,
    ...adminOrdersPermissionSchema.options,
    ...giftCommercePermissionSchema.options,
    "management.direct",
    "finance.manage",
    "payments.read",
    "payments.configure",
    "payments.review",
    "payments.publish",
    "exceptions.read",
    "exceptions.replay",
    "staff.manage",
    // ADR-022: artist assignment, the artist ledger and private artist notes.
    "idols.assign",
    "idols.private",
    "management.assigned",
    "ledger.read",
    "ledger.assigned",
    "ledger.messages",
  ] as const),
] as [string, ...string[]]);

const version = schemaVersionSchema;
const envelope = { schemaVersion: version, requestId: z.uuid() };
const success = { schemaVersion: version, outcome: z.literal("SUCCESS") };
export const adminLoginNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/u);
export const adminDisplayNameSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => value === value.trim() && !/\p{Cc}/u.test(value));
export const adminRoleKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9.:-]{1,127}$/u);
/** The three standard roles (ADR-021, ADR-022): the only ones the staff page lists and grants. */
export const ADMIN_STAFF_ROLE_KEYS = [
  "studio:owner",
  "studio:operator",
  "studio:broker",
] as const;
export type AdminStaffRoleKey = (typeof ADMIN_STAFF_ROLE_KEYS)[number];
/** Keys that narrow an account to the artists assigned to it; the two studio roles never hold them. */
const BROKER_SCOPED_KEYS = [
  "management.assigned",
  "ledger.assigned",
  "ledger.messages",
];
/** L3-10 design §6 and ADR-022: daily operations have none of these. */
const OPERATOR_EXCLUDED_KEYS = [
  "orders.manage",
  "finance.manage",
  "payments.configure",
  "payments.review",
  "payments.publish",
  "exceptions.replay",
  "staff.manage",
  "idols.assign",
  "idols.private",
];
/** A broker publishes photos of their own artists through the same media pipeline as everyone else. */
const BROKER_KEYS = [
  ...BROKER_SCOPED_KEYS,
  "content.media.upload",
  "content.media.read",
  "content.media.process",
  "content.media.rights",
];
/** What each standard role holds; the server command grants exactly these. */
export function adminStandardRolePermissions(
  role: AdminStaffRoleKey,
): readonly string[] {
  const catalog = adminPermissionKeySchema.options;
  if (role === "studio:broker")
    return catalog.filter((key) => BROKER_KEYS.includes(key));
  const excluded =
    role === "studio:owner"
      ? BROKER_SCOPED_KEYS
      : [...BROKER_SCOPED_KEYS, ...OPERATOR_EXCLUDED_KEYS];
  return catalog.filter((key) => !excluded.includes(key));
}
/** Raw input; length and login-name rules are checked where the account is known. */
const passwordInputSchema = z.string().min(1).max(512);
const totpCodeSchema = z.string().regex(/^\d{6}$/u);
const recoveryCodeInputSchema = z.string().min(12).max(32);
export const adminRecoveryCodeSchema = z
  .string()
  .regex(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/u);
export const adminTemporaryPasswordSchema = z
  .string()
  .regex(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/u);
export const adminPasswordProblemSchema = z.enum([
  "TOO_SHORT",
  "TOO_LONG",
  "SAME_AS_LOGIN",
  "SAME_AS_CURRENT",
]);

// ---------- Sign-in (before a session exists) ----------

export const adminLocalLoginRequestSchema = z.strictObject({
  ...envelope,
  locale: supportedLocaleSchema,
  loginName: z.string().min(1).max(128),
  password: passwordInputSchema,
});
export const adminLocalStepSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("TOTP"), code: totpCodeSchema }),
  z.strictObject({
    kind: z.literal("RECOVERY_CODE"),
    code: recoveryCodeInputSchema,
  }),
  z.strictObject({
    kind: z.literal("NEW_PASSWORD"),
    newPassword: passwordInputSchema,
  }),
]);
export const adminLocalStepRequestSchema = z.strictObject({
  ...envelope,
  challengeToken: adminOpaqueTokenSchema,
  step: adminLocalStepSchema,
});
export const adminLocalAccessFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "INVALID_CREDENTIALS",
    "ACCOUNT_LOCKED",
    "INVALID_CODE",
    "PASSWORD_REJECTED",
    "LOGIN_RESTART_REQUIRED",
    "ACCESS_UNAVAILABLE",
  ]),
  passwordProblem: adminPasswordProblemSchema.optional(),
});
const loginStepSchema = z.enum(["SECOND_FACTOR", "NEW_PASSWORD"]);
/** Private BFF/API only. Tokens never enter HTML, logs or analytics. */
export const adminLocalAccessResponseSchema = z.union([
  z.strictObject({
    ...success,
    kind: z.literal("SESSION_CREATED"),
    sessionToken: adminOpaqueTokenSchema,
    csrfToken: adminOpaqueTokenSchema,
    expiresAt: contentTimestampSchema,
    locale: supportedLocaleSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.literal("STEP_REQUIRED"),
    step: loginStepSchema,
    challengeToken: adminOpaqueTokenSchema,
    expiresAt: contentTimestampSchema,
  }),
  adminLocalAccessFailureSchema,
]);
/** Same-origin browser requests; the BFF adds the request id and the HttpOnly challenge. */
export const adminLocalLoginBrowserRequestSchema = z.strictObject({
  schemaVersion: version,
  locale: supportedLocaleSchema,
  loginName: z.string().min(1).max(128),
  password: passwordInputSchema,
});
export const adminLocalStepBrowserRequestSchema = z.strictObject({
  schemaVersion: version,
  step: adminLocalStepSchema,
});
export const adminLocalAccessBrowserResponseSchema = z.union([
  z.strictObject({
    ...success,
    kind: z.literal("SIGNED_IN"),
    locale: supportedLocaleSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.literal("STEP_REQUIRED"),
    step: loginStepSchema,
  }),
  adminLocalAccessFailureSchema,
]);

// ---------- Own account settings (current session) ----------

export const adminAccountCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("READ") }),
  z.strictObject({
    action: z.literal("CHANGE_PASSWORD"),
    currentPassword: passwordInputSchema,
    newPassword: passwordInputSchema,
  }),
  z.strictObject({
    action: z.literal("BEGIN_TOTP"),
    currentPassword: passwordInputSchema,
  }),
  z.strictObject({ action: z.literal("CONFIRM_TOTP"), code: totpCodeSchema }),
  z.strictObject({
    action: z.literal("DISABLE_TOTP"),
    currentPassword: passwordInputSchema,
    code: totpCodeSchema,
  }),
  z.strictObject({
    action: z.literal("REGENERATE_RECOVERY_CODES"),
    currentPassword: passwordInputSchema,
    code: totpCodeSchema,
  }),
]);
export const adminAccountRequestSchema = z.strictObject({
  ...envelope,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: adminAccountCommandSchema,
});
export const adminAccountViewSchema = z.strictObject({
  loginName: adminLoginNameSchema,
  displayName: adminDisplayNameSchema,
  twoFactorEnabled: z.boolean(),
  recoveryCodesRemaining: z.number().int().min(0).max(10),
  passwordChangedAt: contentTimestampSchema,
});
const recoveryCodesSchema = z
  .array(adminRecoveryCodeSchema)
  .length(10)
  .refine((codes) => new Set(codes).size === codes.length);
export const adminAccountFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "UNAUTHENTICATED",
    "CSRF_INVALID",
    "INVALID_PASSWORD",
    "ACCOUNT_LOCKED",
    "PASSWORD_REJECTED",
    "INVALID_CODE",
    "ENROLLMENT_EXPIRED",
    "TOTP_ALREADY_ENABLED",
    "TOTP_NOT_ENABLED",
    "ACCESS_UNAVAILABLE",
  ]),
  passwordProblem: adminPasswordProblemSchema.optional(),
});
export const adminAccountResponseSchema = z.union([
  z.strictObject({ ...success, kind: z.literal("NOT_LOCAL") }),
  z.strictObject({
    ...success,
    kind: z.enum(["ACCOUNT", "PASSWORD_CHANGED", "TOTP_DISABLED"]),
    account: adminAccountViewSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.literal("TOTP_ENROLLMENT"),
    otpauthUri: z.string().startsWith("otpauth://totp/").max(512),
    secret: z.string().regex(/^[A-Z2-7]{32}$/u),
    expiresAt: contentTimestampSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.enum(["TOTP_ENABLED", "RECOVERY_CODES"]),
    account: adminAccountViewSchema,
    recoveryCodes: recoveryCodesSchema,
  }),
  adminAccountFailureSchema,
]);

// ---------- Staff accounts (staff.manage) ----------

const expected = {
  accountId: z.uuid(),
  expectedVersion: z.number().int().positive(),
};
const roleKeysSchema = z
  .array(adminRoleKeySchema)
  .min(1)
  .max(8)
  .refine((keys) => new Set(keys).size === keys.length);
export const adminStaffCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("CONTEXT") }),
  z.strictObject({ action: z.literal("LIST") }),
  z.strictObject({
    action: z.literal("CREATE"),
    loginName: adminLoginNameSchema,
    displayName: adminDisplayNameSchema,
    roleKeys: roleKeysSchema,
  }),
  z.strictObject({
    action: z.literal("UPDATE_ROLES"),
    ...expected,
    roleKeys: roleKeysSchema,
  }),
  z.strictObject({ action: z.literal("RESET_PASSWORD"), ...expected }),
  z.strictObject({ action: z.literal("CLEAR_TOTP"), ...expected }),
  z.strictObject({
    action: z.literal("SET_STATUS"),
    ...expected,
    status: z.enum(["ACTIVE", "SUSPENDED"]),
  }),
  /** L3-14: permanent; the login name typed by the administrator must match the account. */
  z.strictObject({
    action: z.literal("DELETE"),
    ...expected,
    loginName: adminLoginNameSchema,
  }),
]);
export const adminStaffRequestSchema = z.strictObject({
  ...envelope,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: adminStaffCommandSchema,
});
export const adminStaffMemberSchema = z.strictObject({
  accountId: z.uuid(),
  version: z.number().int().positive(),
  loginName: adminLoginNameSchema,
  displayName: adminDisplayNameSchema,
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  twoFactorEnabled: z.boolean(),
  mustChangePassword: z.boolean(),
  roleKeys: z.array(adminRoleKeySchema).max(32),
  lastLoginAt: contentTimestampSchema.nullable(),
  self: z.boolean(),
  /** L3-14: current artists assigned to this account, which a deletion hands back to the studio. */
  assignedArtists: z.number().int().min(0).max(1_000_000),
});
export const adminStaffRoleSchema = z.strictObject({
  roleKey: adminRoleKeySchema,
  description: z.string().min(1).max(512),
  permissions: z.array(adminPermissionKeySchema).max(64),
});
export const adminStaffFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "UNAUTHENTICATED",
    "CSRF_INVALID",
    "FORBIDDEN",
    "NOT_FOUND",
    "LOGIN_NAME_TAKEN",
    "UNKNOWN_ROLE",
    "STALE_VERSION",
    "SELF_LOCKOUT",
    "ACCESS_UNAVAILABLE",
  ]),
});
export const adminStaffResponseSchema = z.union([
  z.strictObject({ ...success, kind: z.literal("STAFF_CONTEXT") }),
  z.strictObject({
    ...success,
    kind: z.literal("STAFF"),
    members: z.array(adminStaffMemberSchema).max(500),
    roles: z.array(adminStaffRoleSchema).max(64),
  }),
  z.strictObject({
    ...success,
    kind: z.enum(["STAFF_UPDATED"]),
    member: adminStaffMemberSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.enum(["STAFF_CREATED", "PASSWORD_RESET"]),
    member: adminStaffMemberSchema,
    temporaryPassword: adminTemporaryPasswordSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.literal("STAFF_DELETED"),
    accountId: z.uuid(),
    /** Current artists that went back to the studio (archived ones go back too, uncounted, as in the list). */
    transferredArtists: z.number().int().min(0).max(1_000_000),
  }),
  adminStaffFailureSchema,
]);

export type AdminPermissionKey = z.infer<typeof adminPermissionKeySchema>;
export type AdminLocalLoginRequest = z.infer<
  typeof adminLocalLoginRequestSchema
>;
export type AdminLocalStepRequest = z.infer<typeof adminLocalStepRequestSchema>;
export type AdminLocalAccessFailure = z.infer<
  typeof adminLocalAccessFailureSchema
>;
export type AdminLocalAccessResponse = z.infer<
  typeof adminLocalAccessResponseSchema
>;
export type AdminLocalAccessBrowserResponse = z.infer<
  typeof adminLocalAccessBrowserResponseSchema
>;
export type AdminAccountCommand = z.infer<typeof adminAccountCommandSchema>;
export type AdminAccountRequest = z.infer<typeof adminAccountRequestSchema>;
export type AdminAccountView = z.infer<typeof adminAccountViewSchema>;
export type AdminAccountFailure = z.infer<typeof adminAccountFailureSchema>;
export type AdminAccountResponse = z.infer<typeof adminAccountResponseSchema>;
export type AdminStaffCommand = z.infer<typeof adminStaffCommandSchema>;
export type AdminStaffRequest = z.infer<typeof adminStaffRequestSchema>;
export type AdminStaffMember = z.infer<typeof adminStaffMemberSchema>;
export type AdminStaffRole = z.infer<typeof adminStaffRoleSchema>;
export type AdminStaffFailure = z.infer<typeof adminStaffFailureSchema>;
export type AdminStaffResponse = z.infer<typeof adminStaffResponseSchema>;
