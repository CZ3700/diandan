import { randomUUID } from "node:crypto";
import {
  adminAuthorizationCommandSchema,
  issueContentPreviewCommandSchema,
  readContentPreviewCommandSchema,
  revokeContentPreviewCommandSchema,
  contentPreviewResponseSchema,
  contentTimestampSchema,
  type AdminContentFailure,
  type ContentPreviewTarget,
} from "@fan-support/contracts";
import type { ContentPreviewRepository } from "@fan-support/persistence-port";
import {
  draftRows,
  loadIdolAliasDraft,
  loadGiftDetailDraft,
} from "./content-draft-data.js";
import { createAdminAuthorizationRepository } from "./admin-authorization-repository.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

const failure = (code: AdminContentFailure["code"]): AdminContentFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
export function createContentPreviewRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): ContentPreviewRepository {
  function run<T>(work: () => Promise<T>): Promise<T> {
    return scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  }
  async function authorizeIssuer(
    sessionId: string,
    actorId: string,
    locales: ContentPreviewTarget["locale"][],
  ) {
    const [session] = await draftRows(
      client,
      `SELECT encode(session_token_digest,'hex') AS session_digest,encode(csrf_token_digest,'hex') AS csrf_digest FROM admin_sessions WHERE id=$1 AND admin_identity_id=$2`,
      [sessionId, actorId],
    );
    if (!session) return false;
    const result = await createAdminAuthorizationRepository(
      client,
      scope,
    ).authorize(
      adminAuthorizationCommandSchema.parse({
        schemaVersion: 1,
        sessionTokenDigest: String(session["session_digest"]),
        csrfTokenDigest: String(session["csrf_digest"]),
        permission: "content.preview",
        locales,
      }),
    );
    return (
      result.outcome === "SUCCESS" &&
      result.principal.sessionId === sessionId &&
      result.principal.actorId === actorId
    );
  }
  async function loadContent(target: ContentPreviewTarget) {
    if (target.kind === "IDOL_ALIASES") {
      const draft = await loadIdolAliasDraft(client, target.revisionId);
      if (draft.outcome === "FAILURE") return failure("PREVIEW_UNAVAILABLE");
      return contentPreviewResponseSchema.parse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        target,
        content: {
          kind: "IDOL_ALIASES",
          aliases: draft.aliasSet.aliases.filter(
            (alias) => alias.locale === null || alias.locale === target.locale,
          ),
        },
      });
    }
    const draft = await loadGiftDetailDraft(client, target.revisionId);
    if (draft.outcome === "FAILURE") return failure("PREVIEW_UNAVAILABLE");
    const translation = draft.translations.find(
      (row) => row.locale === target.locale,
    );
    if (!translation) return failure("PREVIEW_UNAVAILABLE");
    return contentPreviewResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      target,
      content: {
        kind: "GIFT_DETAILS",
        document: draft.document,
        translation: { blocks: translation.blocks },
      },
    });
  }
  async function audit(
    id: string,
    actorId: string,
    grantId: string,
    action: string,
    reasonCode: string,
    requestId: string,
    at: string,
  ) {
    await client.query(
      `INSERT INTO audit_logs (id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at) VALUES ($1,'ADMIN',$2,$3,'CONTENT_PREVIEW_GRANT',$4,$5,$6,$6,'SUCCEEDED',$7)`,
      [id, actorId, action, grantId, reasonCode, requestId, at],
    );
  }
  return {
    issue: (input) =>
      run(async () => {
        const parsed = issueContentPreviewCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const command = parsed.data;
        if (
          !(await authorizeIssuer(command.sessionId, command.actorId, [
            command.target.locale,
          ]))
        )
          return failure("FORBIDDEN");
        const parentTable =
          command.target.kind === "IDOL_ALIASES"
            ? "idol_revisions"
            : "gift_revisions";
        const table =
          command.target.kind === "IDOL_ALIASES"
            ? "idol_revision_alias_sets"
            : "gift_detail_documents";
        const column =
          command.target.kind === "IDOL_ALIASES"
            ? "idol_revision_id"
            : "gift_revision_id";
        const [parent] = await draftRows(
          client,
          `SELECT id FROM ${parentTable} WHERE id=$1 AND lifecycle='DRAFT' FOR SHARE`,
          [command.target.revisionId],
        );
        if (!parent) return failure("PREVIEW_UNAVAILABLE");
        const [header] = await draftRows(
          client,
          `SELECT id FROM ${table} WHERE ${column}=$1 FOR SHARE`,
          [command.target.revisionId],
        );
        if (!header) return failure("PREVIEW_UNAVAILABLE");
        if ((await loadContent(command.target)).outcome === "FAILURE")
          return failure("PREVIEW_UNAVAILABLE");
        const [clock] = await draftRows(
          client,
          // Use a stable transaction time for the event, with its session as the
          // causal lower bound. A backward wall-clock step can only shorten TTL.
          `WITH preview_clock AS MATERIALIZED (SELECT clock_timestamp() AS now), issuance AS (
            SELECT GREATEST(transaction_timestamp(),s.created_at) AS created_at,
              LEAST(transaction_timestamp() + $2 * interval '1 second',preview_clock.now + $2 * interval '1 second',s.expires_at) AS expires_at
            FROM admin_sessions s CROSS JOIN preview_clock WHERE s.id=$1
          ) SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now,
            to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at FROM issuance`,
          [command.sessionId, command.ttlSeconds],
        );
        const createdAt = contentTimestampSchema.parse(clock?.["now"]);
        const expiresAt = contentTimestampSchema.parse(clock?.["expires_at"]);
        if (Date.parse(expiresAt) <= Date.parse(createdAt))
          return failure("PREVIEW_UNAVAILABLE");
        const grantId = randomUUID();
        const auditId = randomUUID();
        await audit(
          auditId,
          command.actorId,
          grantId,
          "CONTENT_PREVIEW_ISSUE",
          command.reasonCode,
          command.requestId,
          createdAt,
        );
        await client.query(
          `INSERT INTO content_preview_grants (id,token_digest,alias_set_id,gift_detail_document_id,locale,actor_id,session_id,audit_log_id,created_at,expires_at) VALUES ($1,decode($2,'hex'),$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            grantId,
            command.tokenDigest,
            command.target.kind === "IDOL_ALIASES" ? header["id"] : null,
            command.target.kind === "GIFT_DETAILS" ? header["id"] : null,
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
      run(async () => {
        const parsed = readContentPreviewCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const command = parsed.data;
        const [grant] = await draftRows(
          client,
          `SELECT g.id,g.actor_id,g.session_id FROM content_preview_grants g LEFT JOIN idol_revision_alias_sets a ON a.id=g.alias_set_id LEFT JOIN gift_detail_documents d ON d.id=g.gift_detail_document_id WHERE g.token_digest=decode($1,'hex') AND g.locale=$2 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND (($3='IDOL_ALIASES' AND a.idol_revision_id=$4) OR ($3='GIFT_DETAILS' AND d.gift_revision_id=$4))`,
          [
            command.tokenDigest,
            command.target.locale,
            command.target.kind,
            command.target.revisionId,
          ],
        );
        if (!grant) return failure("PREVIEW_UNAVAILABLE");
        if (
          !(await authorizeIssuer(
            String(grant["session_id"]),
            String(grant["actor_id"]),
            [command.target.locale],
          ))
        )
          return failure("PREVIEW_UNAVAILABLE");
        const [current] = await draftRows(
          client,
          `SELECT id FROM content_preview_grants WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
          [grant["id"]],
        );
        if (!current) return failure("PREVIEW_UNAVAILABLE");
        return loadContent(command.target);
      }),
    revoke: (input) =>
      run(async () => {
        const parsed = revokeContentPreviewCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const command = parsed.data;
        const [grant] = await draftRows(
          client,
          `SELECT id,revoked_at FROM content_preview_grants WHERE id=$1 AND actor_id=$2 FOR UPDATE`,
          [command.grantId, command.actorId],
        );
        if (!grant) return failure("NOT_FOUND");
        if (grant["revoked_at"] !== null)
          return {
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "MUTATION",
            resultId: command.grantId,
            replayed: true,
          };
        const [clock] = await draftRows(
          client,
          // Keep the persisted causal lower bound even if the wall clock steps back.
          // UTC text retains PostgreSQL microseconds for the matching audit write.
          `SELECT to_char(GREATEST(transaction_timestamp(),created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now FROM content_preview_grants WHERE id=$1`,
          [command.grantId],
        );
        const at = contentTimestampSchema.parse(clock?.["now"]);
        const auditId = randomUUID();
        await audit(
          auditId,
          command.actorId,
          command.grantId,
          "CONTENT_PREVIEW_REVOKE",
          command.reasonCode,
          command.requestId,
          at,
        );
        await client.query(
          `UPDATE content_preview_grants SET revoked_at=$2,revoked_audit_log_id=$3 WHERE id=$1`,
          [command.grantId, at, auditId],
        );
        return {
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MUTATION",
          resultId: command.grantId,
          replayed: false,
        };
      }),
  };
}
