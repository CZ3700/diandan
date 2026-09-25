import {
  IDOL_TRANSLATION_REVIEWED_FIELD_PATHS,
  GIFT_TRANSLATION_REVIEWED_FIELD_PATHS,
  HOMEPAGE_TRANSLATION_REVIEWED_FIELD_PATHS,
  POLICY_TRANSLATION_REVIEWED_FIELD_PATHS,
  MEDIA_TRANSLATION_REVIEWED_FIELD_PATHS,
  translationApprovalEvidenceSchema,
  mediaAssetSchema,
  mediaVariantSchema,
  idolBaseSchema,
  giftBaseSchema,
  type ContentAuthoringSnapshot,
  type ContentAuthoringTarget,
} from "@fan-support/contracts";
import {
  pickFields,
  type AUTHORING_TABLES,
} from "./content-authoring-model.js";
import type { DraftRow } from "./content-draft-data.js";

export const PREFLIGHT_TABLES = {
  IDOL: {
    heads: "idol_publication_heads",
    parent: "idol_revision_id",
    owner: "idol_id",
    parentField: "idolRevisionId",
    ownerField: "idolId",
    paths: IDOL_TRANSLATION_REVIEWED_FIELD_PATHS,
  },
  GIFT: {
    heads: "gift_publication_heads",
    parent: "gift_revision_id",
    owner: "gift_id",
    parentField: "giftRevisionId",
    ownerField: "giftId",
    paths: GIFT_TRANSLATION_REVIEWED_FIELD_PATHS,
  },
  HOMEPAGE: {
    heads: "homepage_publication_heads",
    parent: "homepage_revision_id",
    owner: null,
    parentField: "homepageRevisionId",
    ownerField: null,
    paths: HOMEPAGE_TRANSLATION_REVIEWED_FIELD_PATHS,
  },
  POLICY: {
    heads: "policy_publication_heads",
    parent: "policy_revision_id",
    owner: "policy_key",
    parentField: "policyRevisionId",
    ownerField: "policyKey",
    paths: POLICY_TRANSLATION_REVIEWED_FIELD_PATHS,
  },
  MEDIA_METADATA: {
    heads: "media_metadata_publication_heads",
    parent: "media_metadata_revision_id",
    owner: "media_asset_id",
    parentField: "mediaMetadataRevisionId",
    ownerField: "mediaAssetId",
    paths: MEDIA_TRANSLATION_REVIEWED_FIELD_PATHS,
  },
} as const satisfies Record<keyof typeof AUTHORING_TABLES, unknown>;

export function preflightRevision(snapshot: ContentAuthoringSnapshot) {
  const owner = snapshot.target;
  return {
    schemaVersion: 1,
    id: snapshot.revisionId,
    revision: snapshot.revisionNumber,
    lifecycle: snapshot.lifecycle,
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt,
    ...("idolId" in owner ? { idolId: owner.idolId } : {}),
    ...("giftId" in owner ? { giftId: owner.giftId } : {}),
    ...("mediaAssetId" in owner ? { mediaAssetId: owner.mediaAssetId } : {}),
    ...("policyKey" in owner ? { policyKey: owner.policyKey } : {}),
    ...(snapshot.content.kind === "HOMEPAGE" ? {} : snapshot.content.structure),
  };
}

export function preflightTranslations(snapshot: ContentAuthoringSnapshot) {
  const parent = PREFLIGHT_TABLES[snapshot.target.kind].parentField;
  return snapshot.content.translations.map((translation) => {
    const audit = snapshot.translationAudits.find(
      (row) => row.locale === translation.locale,
    )!;
    return {
      schemaVersion: 1,
      id: audit.id,
      [parent]: snapshot.revisionId,
      locale: audit.locale,
      sourceHash: audit.sourceHash,
      translatedFromSourceHash: audit.translatedFromSourceHash,
      origin: audit.origin,
      ...(audit.importBatchId ? { importBatchId: audit.importBatchId } : {}),
      editorId: audit.editorId,
      editedAt: audit.editedAt,
      review: audit.review,
      ...translation.fields,
    };
  });
}

export function preflightApprovals(snapshot: ContentAuthoringSnapshot) {
  const table = PREFLIGHT_TABLES[snapshot.target.kind];
  return snapshot.translationAudits.flatMap((audit) =>
    audit.review.status !== "APPROVED"
      ? []
      : [
          translationApprovalEvidenceSchema.parse({
            schemaVersion: 1,
            objectKind: snapshot.target.kind,
            approvalId: audit.reviewId,
            translationRevisionId: audit.id,
            [table.parentField]: snapshot.revisionId,
            locale: audit.locale,
            approvedSourceHash: audit.review.reviewedSourceHash,
            approvedContentHash: audit.review.reviewedContentHash,
            origin: audit.origin,
            ...(audit.importBatchId
              ? { importBatchId: audit.importBatchId }
              : {}),
            editorId: audit.editorId,
            reviewerId: audit.review.reviewerId,
            reviewedAt: audit.review.reviewedAt,
            reviewedFieldPaths: table.paths,
          }),
        ],
  );
}

export function preflightAsset(row: DraftRow) {
  return mediaAssetSchema.parse({
    ...pickFields(row, [
      "schemaVersion",
      "id",
      "checksumSha256",
      "mimeType",
      "width",
      "height",
      "objectKey",
      "processingStatus",
      "processingErrorCode",
      "rightsStatus",
      "rightsReference",
      "createdAt",
    ]),
    byteSize: Number(row["byte_size"]),
  });
}
export function preflightVariant(row: DraftRow) {
  return mediaVariantSchema.parse({
    ...pickFields(row, [
      "schemaVersion",
      "id",
      "mediaAssetId",
      "format",
      "width",
      "height",
      "checksumSha256",
      "objectKey",
      "status",
    ]),
    byteSize: Number(row["byte_size"]),
  });
}
export function preflightBase(row: DraftRow, kind: "IDOL" | "GIFT") {
  const value = {
    ...pickFields(row, ["schemaVersion", "id", "handle", "status"]),
    draftRevisionId: row["draft_revision_id"],
    publishedRevisionId: row["published_revision_id"],
    version: Number(row["version"]),
    ...(kind === "IDOL" ? { acceptingGifts: row["accepting_gifts"] } : {}),
  };
  return kind === "IDOL"
    ? idolBaseSchema.parse(value)
    : giftBaseSchema.parse(value);
}
export function preflightCurrentPublication(
  target: ContentAuthoringTarget,
  head: DraftRow | undefined,
) {
  if (!head) return null;
  const table = PREFLIGHT_TABLES[target.kind];
  const owner =
    table.ownerField && table.owner
      ? { [table.ownerField]: head[table.owner] }
      : {};
  return {
    ...(target.kind === "MEDIA_METADATA"
      ? {}
      : { schemaVersion: 1, objectKind: target.kind }),
    id: head["publication_id"],
    action: head["action"],
    targetRevisionId: head[table.parent],
    ...owner,
  };
}
