import { z } from "zod";
import { schemaVersionSchema } from "./versioning.js";
import { supportedLocaleSchema } from "./locale.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { encryptedValueSchema, keyVersionSchema } from "./commerce.js";
import {
  adminAccountFailureSchema,
  adminAccountViewSchema,
  adminDisplayNameSchema,
  adminLocalAccessFailureSchema,
  adminLoginNameSchema,
  adminRoleKeySchema,
  adminStaffFailureSchema,
  adminStaffMemberSchema,
  adminStaffRoleSchema,
} from "./admin-local-access.js";

// L3-10 ③: commands between the built-in account use cases and PostgreSQL. Passwords are hashed and
// TOTP codes checked before these commands exist; repositories only compare-and-set the verified values.

const version = schemaVersionSchema;
const success = { schemaVersion: version, outcome: z.literal("SUCCESS") };
const envelope = { schemaVersion: version, requestId: z.uuid() };
const credentials = {
  sessionTokenDigest: sourceHashSchema,
  csrfTokenDigest: sourceHashSchema,
};
export const adminPasswordHashSchema = z
  .string()
  .regex(
    /^scrypt\$1\$[0-9]{1,10}\$[0-9]{1,3}\$[0-9]{1,3}\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/u,
  );
export const adminEncryptedSecretSchema = z.strictObject({
  ciphertext: encryptedValueSchema,
  encryptedDataKey: encryptedValueSchema,
  keyVersion: keyVersionSchema,
});
const totpStepSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const activeTotpSchema = adminEncryptedSecretSchema.extend({
  lastStep: totpStepSchema.nullable(),
});
const recoveryDigestsSchema = z
  .array(sourceHashSchema)
  .length(10)
  .refine((digests) => new Set(digests).size === digests.length);
/** Issued only when the account policy is met; unused material is discarded by the caller. */
const sessionMaterial = {
  sessionId: z.uuid(),
  sessionTokenDigest: sourceHashSchema,
  csrfTokenDigest: sourceHashSchema,
  sessionTtlSeconds: z.number().int().min(60).max(28_800),
};
const failureRecordedSchema = z.strictObject({
  ...success,
  kind: z.literal("FAILURE_RECORDED"),
  locked: z.boolean(),
});
export const adminLocalLoginStepKindSchema = z.enum([
  "SECOND_FACTOR",
  "NEW_PASSWORD",
]);

// ---------- Sign-in ----------

export const adminLocalLoginReadCommandSchema = z.strictObject({
  schemaVersion: version,
  loginName: adminLoginNameSchema,
});
export const adminLocalLoginReadResponseSchema = z.union([
  z.strictObject({ ...success, kind: z.literal("NO_ACCOUNT") }),
  z.strictObject({
    ...success,
    kind: z.literal("LOGIN_ACCOUNT"),
    accountId: z.uuid(),
    passwordHash: adminPasswordHashSchema,
    active: z.boolean(),
    locked: z.boolean(),
  }),
  adminLocalAccessFailureSchema,
]);
export const adminLocalLoginFailureCommandSchema = z.strictObject({
  ...envelope,
  accountId: z.uuid(),
});
export const adminLocalFailureRecordedSchema = failureRecordedSchema;
export const adminLocalLoginFailureResponseSchema = z.union([
  failureRecordedSchema,
  adminLocalAccessFailureSchema,
]);
export const adminLocalLoginStartCommandSchema = z.strictObject({
  ...envelope,
  loginId: z.uuid(),
  accountId: z.uuid(),
  verifiedPasswordHash: adminPasswordHashSchema,
  locale: supportedLocaleSchema,
  challengeDigest: sourceHashSchema,
  ...sessionMaterial,
});
export const adminLocalLoginProgressSchema = z.union([
  z.strictObject({
    ...success,
    kind: z.literal("SESSION_SAVED"),
    expiresAt: contentTimestampSchema,
    locale: supportedLocaleSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.literal("STEP_SAVED"),
    step: adminLocalLoginStepKindSchema,
    expiresAt: contentTimestampSchema,
  }),
  adminLocalAccessFailureSchema,
]);
export const adminLocalStepReadCommandSchema = z.strictObject({
  schemaVersion: version,
  challengeDigest: sourceHashSchema,
});
export const adminLocalStepReadResponseSchema = z.union([
  z.strictObject({
    ...success,
    kind: z.literal("LOGIN_STEP"),
    loginId: z.uuid(),
    accountId: z.uuid(),
    loginName: adminLoginNameSchema,
    /** NONE only when a concurrent change left nothing the login can still satisfy. */
    step: z.enum(["SECOND_FACTOR", "NEW_PASSWORD", "NONE"]),
    expired: z.boolean(),
    passwordHash: adminPasswordHashSchema,
    totp: activeTotpSchema.nullable(),
  }),
  adminLocalAccessFailureSchema,
]);
export const adminLocalStepOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("TOTP"),
    ciphertext: encryptedValueSchema,
    step: totpStepSchema,
  }),
  z.strictObject({
    kind: z.literal("RECOVERY_CODE"),
    codeDigest: sourceHashSchema,
  }),
  z.strictObject({
    kind: z.literal("NEW_PASSWORD"),
    previousPasswordHash: adminPasswordHashSchema,
    newPasswordHash: adminPasswordHashSchema,
  }),
  z.strictObject({ kind: z.literal("CODE_REJECTED") }),
  z.strictObject({ kind: z.literal("EXPIRED") }),
  z.strictObject({ kind: z.literal("RESTART") }),
]);
export const adminLocalStepCompleteCommandSchema = z.strictObject({
  ...envelope,
  challengeDigest: sourceHashSchema,
  loginId: z.uuid(),
  outcome: adminLocalStepOutcomeSchema,
  ...sessionMaterial,
});

// ---------- Own account ----------

export const adminLocalAccountReadCommandSchema = z.strictObject({
  schemaVersion: version,
  ...credentials,
});
export const adminLocalAccountStateSchema = z.strictObject({
  ...success,
  kind: z.literal("ACCOUNT_STATE"),
  accountId: z.uuid(),
  account: adminAccountViewSchema,
  passwordHash: adminPasswordHashSchema,
  locked: z.boolean(),
  totp: activeTotpSchema.nullable(),
  pending: adminEncryptedSecretSchema
    .extend({ expired: z.boolean() })
    .nullable(),
});
export const adminLocalAccountReadResponseSchema = z.union([
  z.strictObject({ ...success, kind: z.literal("NOT_LOCAL") }),
  adminLocalAccountStateSchema,
  adminAccountFailureSchema,
]);
export const adminLocalAccountFailureCommandSchema = z.strictObject({
  ...envelope,
  ...credentials,
  accountId: z.uuid(),
});
export const adminLocalAccountChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("CHANGE_PASSWORD"),
    previousPasswordHash: adminPasswordHashSchema,
    newPasswordHash: adminPasswordHashSchema,
  }),
  z.strictObject({
    kind: z.literal("BEGIN_TOTP"),
    previousPasswordHash: adminPasswordHashSchema,
    pending: adminEncryptedSecretSchema,
  }),
  z.strictObject({
    kind: z.literal("CONFIRM_TOTP"),
    pendingCiphertext: encryptedValueSchema,
    step: totpStepSchema,
    batchId: z.uuid(),
    recoveryCodeDigests: recoveryDigestsSchema,
  }),
  z.strictObject({
    kind: z.literal("DISABLE_TOTP"),
    previousPasswordHash: adminPasswordHashSchema,
    ciphertext: encryptedValueSchema,
    step: totpStepSchema,
  }),
  z.strictObject({
    kind: z.literal("REGENERATE_RECOVERY_CODES"),
    previousPasswordHash: adminPasswordHashSchema,
    ciphertext: encryptedValueSchema,
    step: totpStepSchema,
    batchId: z.uuid(),
    recoveryCodeDigests: recoveryDigestsSchema,
  }),
]);
export const adminLocalAccountUpdateCommandSchema = z.strictObject({
  ...envelope,
  ...credentials,
  accountId: z.uuid(),
  change: adminLocalAccountChangeSchema,
});
export const adminLocalAccountUpdateResponseSchema = z.union([
  z.strictObject({
    ...success,
    kind: z.literal("ACCOUNT_UPDATED"),
    account: adminAccountViewSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.literal("ENROLLMENT_SAVED"),
    expiresAt: contentTimestampSchema,
  }),
  adminAccountFailureSchema,
]);
export const adminLocalAccountFailureResponseSchema = z.union([
  failureRecordedSchema,
  adminAccountFailureSchema,
]);

// ---------- Staff accounts ----------

const expected = {
  accountId: z.uuid(),
  expectedVersion: z.number().int().positive(),
};
const roleKeysSchema = z
  .array(adminRoleKeySchema)
  .min(1)
  .max(8)
  .refine((keys) => new Set(keys).size === keys.length);
export const adminLocalStaffChangeSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("CONTEXT") }),
  z.strictObject({ action: z.literal("LIST") }),
  z.strictObject({
    action: z.literal("CREATE"),
    loginName: adminLoginNameSchema,
    displayName: adminDisplayNameSchema,
    roleKeys: roleKeysSchema,
    accountId: z.uuid(),
    identityId: z.uuid(),
    subjectDigest: sourceHashSchema,
    passwordHash: adminPasswordHashSchema,
  }),
  z.strictObject({
    action: z.literal("UPDATE_ROLES"),
    ...expected,
    roleKeys: roleKeysSchema,
  }),
  z.strictObject({
    action: z.literal("RESET_PASSWORD"),
    ...expected,
    passwordHash: adminPasswordHashSchema,
  }),
  z.strictObject({ action: z.literal("CLEAR_TOTP"), ...expected }),
  z.strictObject({
    action: z.literal("SET_STATUS"),
    ...expected,
    status: z.enum(["ACTIVE", "SUSPENDED"]),
  }),
  z.strictObject({
    action: z.literal("DELETE"),
    ...expected,
    loginName: adminLoginNameSchema,
  }),
]);
export const adminLocalStaffCommandSchema = z.strictObject({
  ...envelope,
  ...credentials,
  change: adminLocalStaffChangeSchema,
});
export const adminLocalStaffResultSchema = z.union([
  z.strictObject({ ...success, kind: z.literal("STAFF_CONTEXT") }),
  z.strictObject({
    ...success,
    kind: z.literal("STAFF"),
    members: z.array(adminStaffMemberSchema).max(500),
    roles: z.array(adminStaffRoleSchema).max(64),
  }),
  z.strictObject({
    ...success,
    kind: z.literal("STAFF_SAVED"),
    member: adminStaffMemberSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.literal("STAFF_DELETED"),
    accountId: z.uuid(),
    transferredArtists: z.number().int().min(0).max(1_000_000),
  }),
  adminStaffFailureSchema,
]);

export type AdminLocalLoginReadCommand = z.infer<
  typeof adminLocalLoginReadCommandSchema
>;
export type AdminLocalLoginReadResponse = z.infer<
  typeof adminLocalLoginReadResponseSchema
>;
export type AdminLocalLoginFailureCommand = z.infer<
  typeof adminLocalLoginFailureCommandSchema
>;
export type AdminLocalFailureRecorded = z.infer<
  typeof adminLocalFailureRecordedSchema
>;
export type AdminLocalLoginFailureResponse = z.infer<
  typeof adminLocalLoginFailureResponseSchema
>;
export type AdminLocalLoginStartCommand = z.infer<
  typeof adminLocalLoginStartCommandSchema
>;
export type AdminLocalLoginProgress = z.infer<
  typeof adminLocalLoginProgressSchema
>;
export type AdminLocalStepReadCommand = z.infer<
  typeof adminLocalStepReadCommandSchema
>;
export type AdminLocalStepReadResponse = z.infer<
  typeof adminLocalStepReadResponseSchema
>;
export type AdminLocalStepOutcome = z.infer<typeof adminLocalStepOutcomeSchema>;
export type AdminLocalStepCompleteCommand = z.infer<
  typeof adminLocalStepCompleteCommandSchema
>;
export type AdminLocalAccountReadCommand = z.infer<
  typeof adminLocalAccountReadCommandSchema
>;
export type AdminLocalAccountState = z.infer<
  typeof adminLocalAccountStateSchema
>;
export type AdminLocalAccountReadResponse = z.infer<
  typeof adminLocalAccountReadResponseSchema
>;
export type AdminLocalAccountFailureCommand = z.infer<
  typeof adminLocalAccountFailureCommandSchema
>;
export type AdminLocalAccountFailureResponse = z.infer<
  typeof adminLocalAccountFailureResponseSchema
>;
export type AdminLocalAccountChange = z.infer<
  typeof adminLocalAccountChangeSchema
>;
export type AdminLocalAccountUpdateCommand = z.infer<
  typeof adminLocalAccountUpdateCommandSchema
>;
export type AdminLocalAccountUpdateResponse = z.infer<
  typeof adminLocalAccountUpdateResponseSchema
>;
export type AdminLocalStaffChange = z.infer<typeof adminLocalStaffChangeSchema>;
export type AdminLocalStaffCommand = z.infer<
  typeof adminLocalStaffCommandSchema
>;
export type AdminLocalStaffResult = z.infer<typeof adminLocalStaffResultSchema>;
