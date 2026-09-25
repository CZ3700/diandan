import { timingSafeEqual } from "node:crypto";
import {
  managementCenterAuthorizationSchema,
  managementCenterClaimSchema,
  managementCenterOperationSchema,
  type ManagementCenterFailure,
  type ManagementCenterOperation,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export const managementFailure = (
  code: ManagementCenterFailure["code"],
): ManagementCenterFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export const managementOperationSql = `SELECT o.*,${utcTimestampSql("o.updated_at")} AS updated_at,${utcTimestampSql("o.authorized_until")} AS authorized_until,${utcTimestampSql("o.lease_expires_at")} AS lease_expires_at FROM public.management_operations o`;
export function mapManagementOperation(
  row: DraftRow,
): ManagementCenterOperation {
  const intent = row["intent"] as Record<string, unknown>;
  return managementCenterOperationSchema.parse({
    operationId: row["id"],
    version: Number(row["version"]),
    kind: intent["kind"],
    sourceLocale: intent["sourceLocale"],
    status:
      row["status"] === "SUCCEEDED"
        ? "PUBLISHED"
        : row["status"] === "FAILED"
          ? "FAILED"
          : "PROCESSING",
    targetId: row["target_id"],
    updatedAt: row["updated_at"],
    result: row["result"],
    failure:
      row["status"] === "FAILED"
        ? { code: row["failure_code"], retryable: row["failure_retryable"] }
        : null,
  });
}
export const managementOperationResponse = (row: DraftRow) => ({
  schemaVersion: 1 as const,
  outcome: "SUCCESS" as const,
  kind: "OPERATION" as const,
  operation: mapManagementOperation(row),
});
export function mapManagementClaim(row: DraftRow) {
  const hex = (value: unknown) =>
    Buffer.isBuffer(value) ? value.toString("hex") : value;
  return managementCenterClaimSchema.parse({
    schemaVersion: 1,
    operation: mapManagementOperation(row),
    actorId: row["actor_id"],
    sessionId: row["session_id"],
    requestId: row["request_id"],
    intent: row["intent"],
    intentHash: hex(row["intent_hash"]),
    authorizedUntil: row["authorized_until"],
    leaseTokenDigest: hex(row["lease_token_digest"]),
    leaseExpiresAt: row["lease_expires_at"],
    checkpoint: row["checkpoint"],
  });
}
export async function authorizeManagementSession(
  client: TransactionClient,
  input: {
    sessionTokenDigest: string;
    csrfTokenDigest: string;
    sourceLocale?: string;
  },
) {
  if (
    ![input.sessionTokenDigest, input.csrfTokenDigest].every((digest) =>
      /^[a-f0-9]{64}$/u.test(digest),
    )
  )
    return managementFailure("INVALID_COMMAND");
  const [session] = await draftRows(
    client,
    `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
    SELECT i.id actor_id,s.id session_id,s.csrf_token_digest,${utcTimestampSql("s.expires_at")} AS expires_at,${utcTimestampSql("instant.now")} AS now
    FROM public.admin_sessions s JOIN public.admin_identities i ON i.id=s.admin_identity_id CROSS JOIN instant
    WHERE s.session_token_digest=$1 AND s.revoked_at IS NULL AND s.created_at<=instant.now AND s.expires_at>instant.now AND s.authenticated_with_mfa AND i.status='ACTIVE' FOR SHARE OF s,i`,
    [Buffer.from(input.sessionTokenDigest, "hex")],
  );
  if (!session) return managementFailure("UNAUTHENTICATED");
  const csrf = session["csrf_token_digest"];
  if (
    !Buffer.isBuffer(csrf) ||
    csrf.length !== 32 ||
    !timingSafeEqual(csrf, Buffer.from(input.csrfTokenDigest, "hex"))
  )
    return managementFailure("CSRF_INVALID");
  if (
    !(await currentManagementPermission(
      client,
      String(session["actor_id"]),
      input.sourceLocale,
    ))
  )
    return managementFailure("FORBIDDEN");
  return managementCenterAuthorizationSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    principal: {
      schemaVersion: 1,
      actorId: session["actor_id"],
      sessionId: session["session_id"],
      authorizedAt: session["now"],
      expiresAt: session["expires_at"],
    },
  });
}
async function currentManagementPermission(
  client: TransactionClient,
  actorId: string,
  sourceLocale?: string,
): Promise<boolean> {
  const grants = await draftRows(
    client,
    `SELECT ar.role_id FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=$1 AND p.permission_key='management.direct' AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp() FOR SHARE OF ar,r,rp,p`,
    [actorId],
  );
  if (grants.length === 0) return false;
  if (sourceLocale !== undefined) {
    const locales = await draftRows(
      client,
      `SELECT locale FROM public.admin_content_locale_grants WHERE admin_identity_id=$1 AND locale=$2 AND revoked_at IS NULL AND granted_at<=clock_timestamp() FOR SHARE`,
      [actorId, sourceLocale],
    );
    if (locales.length !== 1) return false;
  }
  return true;
}
export async function currentManagementDelegation(
  client: TransactionClient,
  row: DraftRow,
): Promise<boolean> {
  const [session] = await draftRows(
    client,
    `SELECT s.id FROM public.admin_sessions s JOIN public.admin_identities i ON i.id=s.admin_identity_id WHERE s.id=$1 AND s.admin_identity_id=$2 AND s.revoked_at IS NULL AND s.authenticated_with_mfa AND s.created_at<=clock_timestamp() AND s.expires_at>clock_timestamp() AND $3::timestamptz>clock_timestamp() AND $3::timestamptz<=s.expires_at AND i.status='ACTIVE' FOR SHARE OF s,i`,
    [row["session_id"], row["actor_id"], row["authorized_until"]],
  );
  return (
    session !== undefined &&
    (await currentManagementPermission(
      client,
      String(row["actor_id"]),
      String((row["intent"] as Record<string, unknown>)["sourceLocale"]),
    ))
  );
}
