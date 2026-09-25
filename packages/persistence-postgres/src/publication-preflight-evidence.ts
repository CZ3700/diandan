import {
  baseContentTextSchema,
  publicationPreflightCopyProofSchema,
  publicationPreflightExtensionApprovalSchema,
  type ContentAuthoringSnapshot,
} from "@fan-support/contracts";
import { AUTHORING_TABLES } from "./content-authoring-model.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { preflightSnapshot } from "./publication-preflight-data.js";
import { preflightApprovals } from "./publication-preflight-mapping.js";
import type { TransactionClient } from "./transaction-runner.js";
import type { ContentSnapshotLockMode } from "./content-authoring-data.js";

export async function loadPreflightCopies(
  client: TransactionClient,
  snapshots: readonly ContentAuthoringSnapshot[],
  lockMode: ContentSnapshotLockMode = "UPDATE",
) {
  const proofs = [];
  for (const snapshot of snapshots) {
    const table = AUTHORING_TABLES[snapshot.target.kind];
    const rows = await draftRows(
      client,
      `SELECT to_jsonb(e.*) AS evidence,s.${table.parent} AS source_revision_id,receipt.id AS receipt_id
      FROM public.${table.evidence} e
      JOIN public.${table.translations} t ON t.id=e.target_translation_id
      JOIN public.${table.translations} s ON s.id=e.source_translation_id
      JOIN public.content_authoring_receipts receipt ON receipt.${table.parent}=t.${table.parent} AND receipt.audit_log_id=e.audit_log_id
      WHERE t.${table.parent}=$1 ORDER BY t.locale`,
      [snapshot.revisionId],
    );
    const sourceCache = new Map<string, ContentAuthoringSnapshot>();
    for (const row of rows) {
      const evidence = row["evidence"] as DraftRow,
        sourceId = String(row["source_revision_id"]);
      let source = sourceCache.get(sourceId);
      if (!source) {
        source = await preflightSnapshot(
          client,
          snapshot.target,
          sourceId,
          lockMode,
        );
        if (!source) throw new Error("Missing canonical copy source");
        sourceCache.set(sourceId, source);
      }
      const targetAudit = snapshot.translationAudits.find(
        (audit) => audit.id === evidence["target_translation_id"],
      );
      const sourceAudit = source.translationAudits.find(
        (audit) =>
          audit.id === evidence["source_translation_id"] &&
          audit.reviewId === evidence["source_approval_review_id"],
      );
      const sourceApproval = preflightApprovals(source).find(
        (approval) =>
          approval.approvalId === evidence["source_approval_review_id"],
      );
      if (!targetAudit || !sourceAudit || !sourceApproval)
        throw new Error("Incomplete exact copy approval edge");
      const text = source.content.translations.find(
        (translation) => translation.locale === sourceAudit.locale,
      )!;
      proofs.push(
        publicationPreflightCopyProofSchema.parse({
          target: {
            owner: snapshot.target,
            revisionId: snapshot.revisionId,
            locale: targetAudit.locale,
          },
          targetTranslationId: targetAudit.id,
          targetReviewId: targetAudit.reviewId,
          authoringReceiptId: row["receipt_id"],
          source: {
            target: {
              owner: source.target,
              revisionId: source.revisionId,
              locale: sourceAudit.locale,
            },
            text: baseContentTextSchema.parse({
              kind: source.target.kind,
              fields: text.fields,
            }),
            audit: sourceAudit,
          },
          sourceApproval,
        }),
      );
    }
  }
  return proofs;
}

export async function loadPreflightExtensionApprovals(
  client: TransactionClient,
  snapshot: ContentAuthoringSnapshot,
) {
  const result = [];
  if (snapshot.extensions.aliases) {
    const rows = await draftRows(
      client,
      `SELECT to_jsonb(r.*) AS review FROM public.idol_revision_alias_reviews r WHERE r.alias_set_id=$1 AND r.status='APPROVED'`,
      [snapshot.extensions.aliases.id],
    );
    for (const row of rows) {
      const review = row["review"] as DraftRow,
        alias = snapshot.extensions.aliases;
      result.push(
        publicationPreflightExtensionApprovalSchema.parse({
          kind: "IDOL_ALIASES",
          revisionId: snapshot.revisionId,
          subjectId: alias.id,
          reviewId: review["id"],
          sequence: Number(review["sequence"]),
          auditLogId: review["audit_log_id"],
          editorId: alias.editorId,
          structureEditorId: alias.editorId,
          reviewerId: review["reviewer_id"],
          editedAt: alias.editedAt,
          reviewedAt: review["reviewed_at"],
          contentHash: review["reviewed_content_hash"],
          sourceHash: null,
        }),
      );
    }
  }
  if (snapshot.extensions.details) {
    const rows = await draftRows(
      client,
      `SELECT to_jsonb(r.*) AS review,to_jsonb(t.*) AS translation,d.editor_id AS structure_editor_id
      FROM public.gift_detail_documents d JOIN public.gift_detail_translations t ON t.document_id=d.id
      JOIN public.gift_detail_translation_reviews r ON r.gift_detail_translation_id=t.id AND r.status='APPROVED'
      WHERE d.id=$1 ORDER BY t.locale`,
      [snapshot.extensions.details.document.id],
    );
    for (const row of rows) {
      const review = row["review"] as DraftRow,
        translation = row["translation"] as DraftRow;
      result.push(
        publicationPreflightExtensionApprovalSchema.parse({
          kind: "GIFT_DETAILS",
          revisionId: snapshot.revisionId,
          subjectId: translation["id"],
          locale: translation["locale"],
          reviewId: review["id"],
          sequence: Number(review["sequence"]),
          auditLogId: review["audit_log_id"],
          editorId: translation["editor_id"],
          structureEditorId: row["structure_editor_id"],
          reviewerId: review["reviewer_id"],
          editedAt: translation["edited_at"],
          reviewedAt: review["reviewed_at"],
          contentHash: review["reviewed_content_hash"],
          sourceHash: review["reviewed_source_hash"],
        }),
      );
    }
  }
  return result;
}
