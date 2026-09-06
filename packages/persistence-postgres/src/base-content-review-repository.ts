import {
  appendBaseContentReviewCommandSchema,
  baseContentReviewReadCommandSchema,
  type BaseContentReviewResponse,
} from "@fan-support/contracts";
import {
  projectBaseContentReview,
  validateBaseContentReviewAction,
} from "@fan-support/content";
import type { BaseContentReviewRepository } from "@fan-support/persistence-port";
import { AUTHORING_TABLES } from "./content-authoring-model.js";
import { draftRows } from "./content-draft-data.js";
import {
  baseContentFailure,
  baseContentRun,
  baseReviewTime,
  loadBaseContentSnapshot,
} from "./base-content-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

const RECEIPT_COLUMNS = {
  IDOL: "idol_review_id",
  GIFT: "gift_review_id",
  HOMEPAGE: "homepage_review_id",
  POLICY: "policy_review_id",
  MEDIA_METADATA: "media_metadata_review_id",
} as const;

export function createBaseContentReviewRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): BaseContentReviewRepository {
  return {
    read: (input) =>
      baseContentRun(scope, async (): Promise<BaseContentReviewResponse> => {
        const parsed = baseContentReviewReadCommandSchema.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const snapshot = await loadBaseContentSnapshot(
          client,
          parsed.data.target,
        );
        return snapshot
          ? projectBaseContentReview(snapshot, parsed.data.target)
          : baseContentFailure("NOT_FOUND");
      }),
    append: (input) =>
      baseContentRun(scope, async () => {
        const parsed = appendBaseContentReviewCommandSchema.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const command = parsed.data;
        const [actor] = await draftRows(
          client,
          "SELECT id FROM public.admin_identities WHERE id=$1 AND status='ACTIVE' FOR SHARE",
          [command.actorId],
        );
        if (!actor) return baseContentFailure("FORBIDDEN");
        const snapshot = await loadBaseContentSnapshot(client, command.target);
        if (!snapshot) return baseContentFailure("NOT_FOUND");
        const projected = projectBaseContentReview(snapshot, command.target);
        if (projected.outcome === "FAILURE") return projected;
        const table = AUTHORING_TABLES[command.target.owner.kind];
        const [receipt] = await draftRows(
          client,
          `SELECT id FROM public.content_authoring_receipts WHERE ${table.parent}=$1`,
          [snapshot.revisionId],
        );
        if (!receipt) return baseContentFailure("INVALID_REVIEW_STATE");
        const invalid = validateBaseContentReviewAction(
          command,
          projected.context,
          projected,
        );
        if (invalid) return invalid;
        const { audit } = projected.context;
        const time = await baseReviewTime(client, command.target, audit.id);
        const approved = command.action === "APPROVE";
        await client.query(
          `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
        VALUES($1,'ADMIN',$2,$3,'BASE_CONTENT_TRANSLATION_REVIEW',$4,$5,$6,$6,'SUCCEEDED','CONTENT_TRANSLATION',$7)`,
          [
            time.auditId,
            command.actorId,
            `BASE_CONTENT_REVIEW_${command.action}`,
            time.reviewId,
            command.reasonCode,
            command.requestId,
            time.at,
          ],
        );
        await client.query(
          `INSERT INTO public.${table.reviews}(id,${table.translation},sequence,status,submitted_at,reviewer_id,reviewed_at,reviewed_source_hash,reviewed_content_hash,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            time.reviewId,
            audit.id,
            audit.reviewSequence + 1,
            approved ? "APPROVED" : "IN_REVIEW",
            approved ? null : time.at,
            approved ? command.actorId : null,
            approved ? time.at : null,
            approved ? projected.context.currentEnglishSourceHash : null,
            approved ? audit.sourceHash : null,
            time.at,
          ],
        );
        await client.query(
          `INSERT INTO public.base_content_review_receipts(${RECEIPT_COLUMNS[command.target.owner.kind]},audit_log_id,created_at,field_paths)
        VALUES($1,$2,$3,$4)`,
          [
            time.reviewId,
            time.auditId,
            time.at,
            [`translations.${audit.locale}.review`],
          ],
        );
        return {
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MUTATION",
          resultId: time.reviewId,
          replayed: false,
        };
      }),
  };
}
