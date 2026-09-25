import {
  SUPPORTED_LOCALES,
  contentReviewContextResponseSchema,
  type AdminContentFailure,
  type ContentReviewContextResponse,
  type ContentReviewTarget,
} from "@fan-support/contracts";
import {
  draftRows,
  draftTimestamp,
  loadGiftDetailDraft,
  loadIdolAliasDraft,
} from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export const reviewFailure = (
  code: AdminContentFailure["code"],
): AdminContentFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });

/** Consistent parent-first locking serializes authoring, review, and future publication. */
export async function loadContentReviewContext(
  client: TransactionClient,
  target: ContentReviewTarget,
): Promise<ContentReviewContextResponse> {
  const parentTable =
    target.kind === "IDOL_ALIASES" ? "idol_revisions" : "gift_revisions";
  const [parent] = await draftRows(
    client,
    `SELECT lifecycle FROM public.${parentTable} WHERE id = $1 FOR UPDATE`,
    [target.revisionId],
  );
  if (!parent) return reviewFailure("NOT_FOUND");
  if (parent["lifecycle"] !== "DRAFT")
    return reviewFailure("REVISION_NOT_DRAFT");
  let context: unknown;
  if (target.kind === "IDOL_ALIASES") {
    const [header] = await draftRows(
      client,
      "SELECT id FROM public.idol_revision_alias_sets WHERE idol_revision_id = $1 FOR UPDATE",
      [target.revisionId],
    );
    if (!header) return reviewFailure("NOT_FOUND");
    const snapshot = await loadIdolAliasDraft(client, target.revisionId);
    if (snapshot.outcome === "FAILURE")
      return reviewFailure(
        snapshot.code === "NOT_FOUND" ? "NOT_FOUND" : "CONTENT_UNAVAILABLE",
      );
    const [latest] = await draftRows(
      client,
      "SELECT sequence,status FROM public.idol_revision_alias_reviews WHERE alias_set_id = $1 ORDER BY sequence DESC LIMIT 1",
      [header["id"]],
    );
    if (!latest) return reviewFailure("CONTENT_UNAVAILABLE");
    const alias = snapshot.aliasSet;
    const allLocales =
      alias.aliases.length === 0 ||
      alias.aliases.some((item) => item.locale === null);
    context = {
      schemaVersion: 1,
      target,
      subjectId: alias.id,
      sequence: Number(latest["sequence"]),
      status: latest["status"],
      editorId: alias.editorId,
      structureEditorId: alias.editorId,
      editedAt: alias.editedAt,
      contentHash: alias.contentHash,
      sourceHash: null,
      locales: allLocales
        ? [...SUPPORTED_LOCALES]
        : SUPPORTED_LOCALES.filter((locale) =>
            alias.aliases.some((item) => item.locale === locale),
          ),
    };
  } else {
    const [document] = await draftRows(
      client,
      "SELECT id,editor_id FROM public.gift_detail_documents WHERE gift_revision_id = $1 FOR UPDATE",
      [target.revisionId],
    );
    if (!document) return reviewFailure("NOT_FOUND");
    const [translation] = await draftRows(
      client,
      "SELECT id FROM public.gift_detail_translations WHERE document_id = $1 AND locale = $2 FOR UPDATE",
      [document["id"], target.locale],
    );
    if (!translation) return reviewFailure("NOT_FOUND");
    const snapshot = await loadGiftDetailDraft(client, target.revisionId);
    if (snapshot.outcome === "FAILURE")
      return reviewFailure("CONTENT_UNAVAILABLE");
    const canonical = snapshot.translations.find(
      (item) => item.locale === target.locale,
    );
    const english = snapshot.translations.find((item) => item.locale === "en");
    const [latest] = await draftRows(
      client,
      "SELECT sequence,status FROM public.gift_detail_translation_reviews WHERE gift_detail_translation_id = $1 ORDER BY sequence DESC LIMIT 1",
      [translation["id"]],
    );
    if (!canonical || !english || !latest)
      return reviewFailure("CONTENT_UNAVAILABLE");
    context = {
      schemaVersion: 1,
      target,
      subjectId: canonical.id,
      sequence: Number(latest["sequence"]),
      status: latest["status"],
      editorId: canonical.editorId,
      structureEditorId: document["editor_id"],
      editedAt: canonical.editedAt,
      contentHash: canonical.sourceHash,
      sourceHash: english.sourceHash,
      locales: [target.locale],
    };
  }
  const parsed = contentReviewContextResponseSchema.safeParse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    context,
  });
  return parsed.success ? parsed.data : reviewFailure("CONTENT_UNAVAILABLE");
}

export async function reviewTimestamp(
  client: TransactionClient,
  target: ContentReviewTarget,
  subjectId: string,
): Promise<string> {
  const alias = target.kind === "IDOL_ALIASES";
  const ownerTable = alias
    ? "idol_revision_alias_sets"
    : "gift_detail_translations";
  const reviewTable = alias
    ? "idol_revision_alias_reviews"
    : "gift_detail_translation_reviews";
  const ownerColumn = alias ? "alias_set_id" : "gift_detail_translation_id";
  const [row] = await draftRows(
    client,
    `WITH causal_time AS MATERIALIZED (
      SELECT GREATEST(clock_timestamp(),o.edited_at,r.created_at,r.submitted_at,r.reviewed_at) AS event_time
      FROM public.${ownerTable} o
      LEFT JOIN LATERAL (SELECT created_at,submitted_at,reviewed_at FROM public.${reviewTable}
        WHERE ${ownerColumn}=o.id ORDER BY sequence DESC LIMIT 1) r ON true WHERE o.id=$1
    ), rounded_time AS (
      SELECT date_trunc('milliseconds',event_time)+CASE
        WHEN event_time>date_trunc('milliseconds',event_time) THEN interval '1 millisecond'
        ELSE interval '0 milliseconds' END AS event_time FROM causal_time
    ) SELECT to_char(event_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now FROM rounded_time`,
    [subjectId],
  );
  return draftTimestamp(row?.["now"]);
}
