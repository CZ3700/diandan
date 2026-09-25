import {
  contentTimestampSchema,
  issueBaseContentPreviewCommandSchema,
  readBaseContentPreviewCommandSchema,
  revokeBaseContentPreviewCommandSchema,
  type BaseContentPreviewResponse,
} from "@fan-support/contracts";
import { projectBaseContentPreview } from "@fan-support/content";
import type { BaseContentPreviewRepository } from "@fan-support/persistence-port";
import { AUTHORING_TABLES } from "./content-authoring-model.js";
import { draftRows } from "./content-draft-data.js";
import { authorizeBasePreviewIssuer } from "./base-content-authorization.js";
import {
  baseContentFailure,
  baseContentRun,
  loadBaseContentSnapshot,
} from "./base-content-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

export function createBaseContentPreviewRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): BaseContentPreviewRepository {
  async function audit(entry: {
    auditId: string;
    actorId: string;
    grantId: string;
    action: "BASE_CONTENT_PREVIEW_ISSUE" | "BASE_CONTENT_PREVIEW_REVOKE";
    reasonCode: string;
    requestId: string;
    at: string;
  }) {
    await client.query(
      `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
      VALUES($1,'ADMIN',$2,$3,'BASE_CONTENT_PREVIEW_GRANT',$4,$5,$6,$6,'SUCCEEDED','CONTENT_TRANSLATION',$7)`,
      [
        entry.auditId,
        entry.actorId,
        entry.action,
        entry.grantId,
        entry.reasonCode,
        entry.requestId,
        entry.at,
      ],
    );
  }
  return {
    issue: (input) =>
      baseContentRun(scope, async () => {
        const parsed = issueBaseContentPreviewCommandSchema.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const command = parsed.data;
        if (
          !(await authorizeBasePreviewIssuer(
            client,
            scope,
            command.sessionId,
            command.actorId,
            [command.target.locale],
          ))
        )
          return baseContentFailure("FORBIDDEN");
        const snapshot = await loadBaseContentSnapshot(client, command.target);
        if (!snapshot || snapshot.lifecycle.status !== "DRAFT")
          return baseContentFailure("PREVIEW_UNAVAILABLE");
        const content = projectBaseContentPreview(snapshot, command.target);
        if (content.outcome === "FAILURE")
          return baseContentFailure("PREVIEW_UNAVAILABLE");
        const [clock] = await draftRows(
          client,
          `WITH preview_clock AS MATERIALIZED(SELECT clock_timestamp() AS now), issuance AS (
          SELECT GREATEST(transaction_timestamp(),s.created_at) AS created_at,
            LEAST(transaction_timestamp()+$2*interval '1 second',preview_clock.now+$2*interval '1 second',s.expires_at) AS expires_at
          FROM public.admin_sessions s CROSS JOIN preview_clock WHERE s.id=$1)
        SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
          to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at,
          gen_random_uuid() AS grant_id,gen_random_uuid() AS audit_id FROM issuance`,
          [command.sessionId, command.ttlSeconds],
        );
        const createdAt = contentTimestampSchema.parse(clock?.["created_at"]);
        const expiresAt = contentTimestampSchema.parse(clock?.["expires_at"]);
        if (Date.parse(expiresAt) <= Date.parse(createdAt))
          return baseContentFailure("PREVIEW_UNAVAILABLE");
        const grantId = String(clock?.["grant_id"]),
          auditId = String(clock?.["audit_id"]);
        await audit({
          auditId,
          actorId: command.actorId,
          grantId,
          action: "BASE_CONTENT_PREVIEW_ISSUE",
          reasonCode: command.reasonCode,
          requestId: command.requestId,
          at: createdAt,
        });
        const table = AUTHORING_TABLES[command.target.owner.kind];
        await client.query(
          `INSERT INTO public.base_content_preview_grants(id,token_digest,${table.parent},locale,actor_id,session_id,audit_log_id,created_at,expires_at)
        VALUES($1,decode($2,'hex'),$3,$4,$5,$6,$7,$8,$9)`,
          [
            grantId,
            command.tokenDigest,
            snapshot.revisionId,
            command.target.locale,
            command.actorId,
            command.sessionId,
            auditId,
            createdAt,
            expiresAt,
          ],
        );
        return {
          schemaVersion: 1,
          outcome: "SUCCESS",
          grantId,
          createdAt,
          expiresAt,
        };
      }),
    read: (input) =>
      baseContentRun(scope, async (): Promise<BaseContentPreviewResponse> => {
        const parsed = readBaseContentPreviewCommandSchema.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const command = parsed.data,
          table = AUTHORING_TABLES[command.target.owner.kind];
        const [grant] = await draftRows(
          client,
          `SELECT id,actor_id,session_id FROM public.base_content_preview_grants
          WHERE token_digest=decode($1,'hex') AND locale=$2 AND ${table.parent}=$3
          AND revoked_at IS NULL AND expires_at>clock_timestamp()`,
          [
            command.tokenDigest,
            command.target.locale,
            command.target.revisionId,
          ],
        );
        if (
          !grant ||
          !(await authorizeBasePreviewIssuer(
            client,
            scope,
            String(grant["session_id"]),
            String(grant["actor_id"]),
            [command.target.locale],
          ))
        )
          return baseContentFailure("PREVIEW_UNAVAILABLE");
        const [current] = await draftRows(
          client,
          "SELECT id FROM public.base_content_preview_grants WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE",
          [grant["id"]],
        );
        if (!current) return baseContentFailure("PREVIEW_UNAVAILABLE");
        const snapshot = await loadBaseContentSnapshot(client, command.target);
        if (!snapshot) return baseContentFailure("PREVIEW_UNAVAILABLE");
        const projected = projectBaseContentPreview(snapshot, command.target);
        return projected.outcome === "SUCCESS"
          ? projected
          : baseContentFailure("PREVIEW_UNAVAILABLE");
      }),
    revoke: (input) =>
      baseContentRun(scope, async () => {
        const parsed = revokeBaseContentPreviewCommandSchema.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const command = parsed.data;
        const [actor] = await draftRows(
          client,
          "SELECT id FROM public.admin_identities WHERE id=$1 AND status='ACTIVE' FOR SHARE",
          [command.actorId],
        );
        if (!actor) return baseContentFailure("FORBIDDEN");
        const [grant] = await draftRows(
          client,
          `SELECT id,revoked_at,to_char(GREATEST(transaction_timestamp(),created_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now,
          gen_random_uuid() AS audit_id FROM public.base_content_preview_grants WHERE id=$1 AND actor_id=$2 FOR UPDATE`,
          [command.grantId, command.actorId],
        );
        if (!grant) return baseContentFailure("NOT_FOUND");
        if (grant["revoked_at"] !== null)
          return {
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "MUTATION",
            resultId: String(grant["id"]),
            replayed: true,
          };
        const at = contentTimestampSchema.parse(grant["now"]),
          auditId = String(grant["audit_id"]);
        await audit({
          auditId,
          actorId: command.actorId,
          grantId: String(grant["id"]),
          action: "BASE_CONTENT_PREVIEW_REVOKE",
          reasonCode: command.reasonCode,
          requestId: command.requestId,
          at,
        });
        await client.query(
          "UPDATE public.base_content_preview_grants SET revoked_at=$2,revoked_audit_log_id=$3 WHERE id=$1",
          [grant["id"], at, auditId],
        );
        return {
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MUTATION",
          resultId: String(grant["id"]),
          replayed: false,
        };
      }),
  };
}
