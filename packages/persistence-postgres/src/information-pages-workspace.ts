import {
  SUPPORTED_LOCALES,
  informationPageWorkspaceSchema,
  validInformationPageDocument,
  informationPagePreviewDocumentSchema,
  type InformationPageKey,
  type SupportedLocale,
  type InformationPageWorkspace,
  type AdminPrincipal,
} from "@fan-support/contracts";
import type { InformationPageAccess } from "@fan-support/persistence-port";
import {
  draftRows,
  draftTimestamp,
  type DraftRow,
} from "./content-draft-data.js";
import {
  fieldsFromRow,
  informationPageHash,
  informationPagePublication,
  loadInformationRevision,
  selectedInformationTranslation,
  type InformationRevision,
} from "./information-pages-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export function informationTranslationCurrent(
  revision: InformationRevision,
  row: DraftRow,
) {
  return (
    row["translated_from_source_hash"] === revision.sourceHash &&
    validInformationPageDocument({
      pageKey: revision.pageKey,
      structure: revision.structure,
      fields: fieldsFromRow(row),
    })
  );
}
export function informationTranslationApproved(
  revision: InformationRevision,
  row: DraftRow,
) {
  try {
    return (
      informationTranslationCurrent(revision, row) &&
      row["review_status"] === "APPROVED" &&
      row["reviewed_content_hash"] === row["content_hash"] &&
      row["reviewed_source_hash"] === revision.sourceHash &&
      row["content_hash"] === informationPageHash(fieldsFromRow(row))
    );
  } catch {
    return false;
  }
}
export async function informationWorkspace(
  client: TransactionClient,
  pageKey: InformationPageKey,
  locale: SupportedLocale,
  access: InformationPageAccess,
  principal: AdminPrincipal,
): Promise<InformationPageWorkspace> {
  const [head] = await draftRows(
    client,
    "SELECT * FROM public.information_page_heads WHERE page_key=$1 FOR SHARE",
    [pageKey],
  );
  if (!head) throw new Error("Missing information head");
  const revision = head["draft_revision_id"]
    ? await loadInformationRevision(client, String(head["draft_revision_id"]))
    : null;
  const [published] = head["published_publication_id"]
    ? await draftRows(
        client,
        "SELECT * FROM public.information_page_publications WHERE id=$1",
        [head["published_publication_id"]],
      )
    : [];
  const selected = revision?.translations.find((r) => r["locale"] === locale);
  const source = revision?.translations.find((r) => r["locale"] === "en");
  const status = (row: DraftRow | undefined) => {
    if (!row) return "MISSING";
    if (revision && !informationTranslationCurrent(revision, row))
      return "STALE";
    return String(row["review_status"]);
  };
  const cells = SUPPORTED_LOCALES.map((l) =>
    access.readLocales.includes(l)
      ? {
          locale: l,
          access: "READABLE" as const,
          status: status(revision?.translations.find((r) => r["locale"] === l)),
        }
      : { locale: l, access: "RESTRICTED" as const },
  );
  const blockers = cells.flatMap((cell) => {
    if (cell.access === "RESTRICTED")
      return [{ locale: cell.locale, code: "RESTRICTED" }];
    if (cell.status === "APPROVED") return [];
    return [{ locale: cell.locale, code: cell.status }];
  });
  const canSave =
    access.editLocales.includes(locale) &&
    (locale !== "en" ||
      access.editLocales.length === SUPPORTED_LOCALES.length) &&
    (locale === "en" || revision !== null);
  let previousSource = null;
  let previousStructure: unknown = null;
  if (
    revision &&
    selected &&
    selected["translated_from_source_hash"] !== revision.sourceHash
  ) {
    const [previous] = await draftRows(
      client,
      `SELECT t.title,t.summary,t.sections,r.structure FROM public.information_page_revisions r JOIN public.information_page_revision_translations t ON t.revision_id=r.id AND t.locale='en' WHERE r.page_key=$1 AND r.source_hash=$2 AND r.revision<$3 ORDER BY r.revision DESC LIMIT 1`,
      [
        pageKey,
        selected["translated_from_source_hash"],
        revision.row["revision"],
      ],
    );
    if (previous) {
      previousSource = fieldsFromRow(previous);
      previousStructure = previous["structure"];
    }
  }

  const sourceFields = source ? fieldsFromRow(source) : null;
  const changedPaths: string[] =
    sourceFields && previousSource
      ? (["title", "summary", "sections"] as const).filter(
          (k) =>
            informationPageHash(sourceFields[k]) !==
            informationPageHash(previousSource[k]),
        )
      : [];
  if (revision && previousStructure && typeof previousStructure === "object") {
    for (const key of ["contactEmail", "sectionIds"] as const)
      if (
        informationPageHash(
          (previousStructure as Record<string, unknown>)[key],
        ) !== informationPageHash(revision.structure[key])
      )
        changedPaths.push(`structure.${key}`);
  }
  const current =
    selected && revision
      ? informationTranslationCurrent(revision, selected)
      : false;
  const preview =
    access.canPreview && selected && revision && current
      ? informationPagePreviewDocumentSchema.parse({
          schemaVersion: 1,
          pageKey,
          locale,
          revisionId: revision.id,
          structure: revision.structure,
          fields: fieldsFromRow(selected),
          sourceStatus: "CURRENT",
        })
      : null;
  return informationPageWorkspaceSchema.parse({
    schemaVersion: 1,
    pageKey,
    locale,
    version: Number(head["version"]),
    draft: revision
      ? {
          revisionId: revision.id,
          createdAt: draftTimestamp(revision.row["created_at"]),
          structure: revision.structure,
          sourceHash: revision.sourceHash,
        }
      : null,
    published: published ? informationPagePublication(published) : null,
    cells,
    source: sourceFields,
    previousSource,
    changedPaths,
    selected: selected ? selectedInformationTranslation(selected) : null,
    capabilities: {
      canSave,
      canSubmit:
        !!selected &&
        current &&
        access.editLocales.includes(locale) &&
        selected["editor_id"] === principal.actorId &&
        selected["review_status"] === "DRAFT",
      canApprove:
        !!selected &&
        current &&
        access.reviewLocales.includes(locale) &&
        selected["editor_id"] !== principal.actorId &&
        source?.["editor_id"] !== principal.actorId &&
        selected["review_status"] === "IN_REVIEW",
      canPublish: access.canPublish && !!revision && blockers.length === 0,
      canUnpublish: access.canPublish && !!published,
      canRestore: access.canPublish,
    },
    blockers,
    preview,
  });
}
