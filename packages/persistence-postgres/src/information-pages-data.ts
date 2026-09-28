import { createHash } from "node:crypto";
import {
  informationPageFieldsSchema,
  informationPageStructureSchema,
  informationPagePublicationSchema,
  informationPageSelectedSchema,
  type InformationPageFields,
  type InformationPageStructure,
  type InformationPageKey,
  type InformationPagePublication,
  type InformationPageSelected,
} from "@fan-support/contracts";
import {
  draftRows,
  draftTimestamp,
  type DraftRow,
} from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export function informationPageHash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export const fieldsFromRow = (row: DraftRow): InformationPageFields =>
  informationPageFieldsSchema.parse({
    title: row["title"],
    summary: row["summary"],
    sections: row["sections"],
  });
export function informationPagePublication(
  row: DraftRow,
): InformationPagePublication {
  return informationPagePublicationSchema.parse({
    publicationId: row["id"],
    pageKey: row["page_key"],
    revisionId: row["revision_id"],
    version: Number(row["version"]),
    action: row["action"],
    restoredFromPublicationId: row["restored_from_publication_id"],
    publishedAt: draftTimestamp(row["created_at"]),
  });
}
export type InformationRevision = {
  row: DraftRow;
  id: string;
  pageKey: InformationPageKey;
  structure: InformationPageStructure;
  sourceHash: string;
  translations: DraftRow[];
};
export async function loadInformationRevision(
  client: TransactionClient,
  id: string,
): Promise<InformationRevision> {
  const [row] = await draftRows(
    client,
    "SELECT * FROM public.information_page_revisions WHERE id=$1",
    [id],
  );
  if (!row) throw new Error("Information revision unavailable");
  const translations = await draftRows(
    client,
    `SELECT t.*,v.status review_status,v.sequence review_sequence,v.actor_id review_actor_id,v.created_at review_created_at,v.content_hash reviewed_content_hash,v.source_hash reviewed_source_hash FROM public.information_page_revision_translations t LEFT JOIN LATERAL public.information_page_effective_review(t.id) v ON true WHERE t.revision_id=$1 ORDER BY t.locale`,
    [id],
  );
  return {
    row,
    id: String(row["id"]),
    pageKey: row["page_key"] as InformationPageKey,
    structure: informationPageStructureSchema.parse(row["structure"]),
    sourceHash: String(row["source_hash"]),
    translations,
  };
}
export function selectedInformationTranslation(
  row: DraftRow,
): InformationPageSelected {
  return informationPageSelectedSchema.parse({
    translationId: row["id"],
    fields: fieldsFromRow(row),
    contentHash: row["content_hash"],
    translatedFromSourceHash: row["translated_from_source_hash"],
    editorId: row["editor_id"],
    editedAt: draftTimestamp(row["edited_at"]),
    review: {
      status: row["review_status"],
      sequence: Number(row["review_sequence"]),
      reviewerId:
        row["review_status"] === "APPROVED" ? row["review_actor_id"] : null,
      reviewedAt:
        row["review_status"] === "APPROVED"
          ? draftTimestamp(row["review_created_at"])
          : null,
    },
  });
}
