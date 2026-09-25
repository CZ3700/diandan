import { randomUUID } from "node:crypto";
import {
  appendContentReviewCommandSchema,
  contentReviewTargetSchema,
} from "@fan-support/contracts";
import type { ContentReviewRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  loadContentReviewContext,
  reviewFailure,
  reviewTimestamp,
} from "./content-review-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";
export function createContentReviewRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): ContentReviewRepository {
  function run<Result>(work: () => Promise<Result>): Promise<Result> {
    return scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  }
  return {
    loadTarget: (input) =>
      run(async () => {
        if (
          !input ||
          input.schemaVersion !== 1 ||
          Object.keys(input).some(
            (key) => key !== "schemaVersion" && key !== "target",
          )
        )
          return reviewFailure("INVALID_COMMAND");
        const parsed = contentReviewTargetSchema.safeParse(input.target);
        if (!parsed.success) return reviewFailure("INVALID_COMMAND");
        return loadContentReviewContext(client, parsed.data);
      }),
    append: (input) =>
      run(async () => {
        const parsed = appendContentReviewCommandSchema.safeParse(input);
        if (!parsed.success) return reviewFailure("INVALID_COMMAND");
        const command = parsed.data;
        const [actor] = await draftRows(
          client,
          "SELECT id FROM public.admin_identities WHERE id = $1 AND status = 'ACTIVE' FOR SHARE",
          [command.actorId],
        );
        if (!actor) return reviewFailure("FORBIDDEN");
        const loaded = await loadContentReviewContext(client, command.target);
        if (loaded.outcome === "FAILURE") return loaded;
        const context = loaded.context;
        if (command.expectedVersion !== context.sequence)
          return reviewFailure("STALE_VERSION");
        if (
          command.expectedContentHash !== context.contentHash ||
          command.expectedSourceHash !== context.sourceHash
        )
          return reviewFailure("STALE_CONTENT");
        const sameActor = (id: string) =>
          id.toLowerCase() === command.actorId.toLowerCase();
        if (command.action === "SUBMIT") {
          if (context.status !== "DRAFT")
            return reviewFailure("INVALID_REVIEW_STATE");
          if (!sameActor(context.editorId)) return reviewFailure("FORBIDDEN");
        } else {
          if (context.status !== "IN_REVIEW")
            return reviewFailure("INVALID_REVIEW_STATE");
          if (
            sameActor(context.editorId) ||
            sameActor(context.structureEditorId)
          )
            return reviewFailure("SELF_REVIEW");
        }
        const now = await reviewTimestamp(
          client,
          context.target,
          context.subjectId,
        );
        const id = randomUUID(),
          auditId = randomUUID();
        const alias = command.target.kind === "IDOL_ALIASES";
        const approved = command.action === "APPROVE";
        await client.query(
          `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)
        VALUES($1,'ADMIN',$2,$3,$4,$5,$6,$7,$7,'SUCCEEDED',$8)`,
          [
            auditId,
            command.actorId,
            `${alias ? "IDOL_ALIAS" : "GIFT_DETAIL"}_${command.action}`,
            alias ? "IDOL_ALIAS_REVIEW" : "GIFT_DETAIL_TRANSLATION_REVIEW",
            id,
            command.reasonCode,
            command.requestId,
            now,
          ],
        );
        const table = alias
          ? "idol_revision_alias_reviews"
          : "gift_detail_translation_reviews";
        const owner = alias ? "alias_set_id" : "gift_detail_translation_id";
        const columns = [
          "id",
          owner,
          "sequence",
          "status",
          "submitted_at",
          "reviewer_id",
          "reviewed_at",
          "reviewed_content_hash",
          "audit_log_id",
          "created_at",
        ];
        const values: unknown[] = [
          id,
          context.subjectId,
          context.sequence + 1,
          approved ? "APPROVED" : "IN_REVIEW",
          approved ? null : now,
          approved ? command.actorId : null,
          approved ? now : null,
          approved ? context.contentHash : null,
          auditId,
          now,
        ];
        if (!alias) {
          columns.push("reviewed_source_hash");
          values.push(approved ? context.sourceHash : null);
        }
        await client.query(
          `INSERT INTO public.${table}(${columns.join(",")}) VALUES(${values.map((_, index) => `$${index + 1}`).join(",")})`,
          values,
        );
        return {
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MUTATION",
          resultId: id,
          replayed: false,
        };
      }),
  };
}
