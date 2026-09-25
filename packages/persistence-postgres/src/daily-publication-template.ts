import { randomUUID } from "node:crypto";
import {
  dailyMediaMetadataDocumentSchema,
  dailyPublicationDocumentSchema,
  homepageSlotSchema,
  homepageTranslationFieldsSchema,
  supportedLocaleSchema,
  type ManagementCenterClaim,
} from "@fan-support/contracts";
import { computeDailySourceHash } from "@fan-support/content";
import { draftRows } from "./content-draft-data.js";
import { insertDailyDocument } from "./daily-publication-data.js";
import { pickFields } from "./content-authoring-model.js";
import type { TransactionClient } from "./transaction-runner.js";

/** Copying a real immutable alt creates a new original provenance record, without manufacturing review rows. */
export async function copyDailyMetadata(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  assetId: string,
  previousMetadataId: string,
) {
  const [existing] = await draftRows(
    client,
    `SELECT revision_id FROM public.daily_publication_revisions WHERE operation_id=$1 AND object_kind='MEDIA_METADATA' AND object_id=$2 AND copied_from_metadata_revision_id=$3`,
    [claim.operation.operationId, assetId, previousMetadataId],
  );
  if (existing) return String(existing["revision_id"]);
  const [parent] = await draftRows(
    client,
    `SELECT r.id,d.document FROM public.media_metadata_revisions r LEFT JOIN public.daily_publication_revisions d ON d.revision_id=r.id WHERE r.id=$1 AND r.media_asset_id=$2 AND r.lifecycle IN('PUBLISHED','SUPERSEDED') AND EXISTS(SELECT 1 FROM public.content_publications p WHERE p.media_metadata_revision_id=r.id AND p.media_asset_id=r.media_asset_id AND p.proof_version IN(2,3)) FOR SHARE OF r`,
    [previousMetadataId, assetId],
  );
  if (!parent) throw new Error("Published original media metadata unavailable");
  let alt: string,
    locale = claim.intent.sourceLocale;
  if (parent["document"]) {
    const document = dailyMediaMetadataDocumentSchema.parse(parent["document"]);
    alt = document.source.fields.alt;
    locale = document.source.locale;
  } else {
    const [translation] = await draftRows(
      client,
      `SELECT t.locale,t.alt FROM public.media_metadata_revision_translations t JOIN public.media_metadata_translation_reviews r ON r.media_metadata_translation_id=t.id AND r.status='APPROVED' AND r.sequence=3 WHERE t.media_metadata_revision_id=$1 AND t.locale=$2 FOR SHARE OF t,r`,
      [previousMetadataId, locale],
    );
    if (!translation) throw new Error("Published actual alt unavailable");
    alt = String(translation["alt"]);
    locale = supportedLocaleSchema.parse(translation["locale"]);
  }
  await client.query(
    "SELECT id FROM public.media_assets WHERE id=$1 FOR UPDATE",
    [assetId],
  );
  const [clock] = await draftRows(
    client,
    `SELECT coalesce(max(revision),0)+1 revision,public.publication_utc(GREATEST(clock_timestamp(),coalesce(max(created_at),clock_timestamp()))) at FROM public.media_metadata_revisions WHERE media_asset_id=$1`,
    [assetId],
  );
  if (!clock) throw new Error("Metadata copy clock unavailable");
  const revisionId = randomUUID(),
    fields = { alt },
    at = String(clock["at"]);
  const document = dailyMediaMetadataDocumentSchema.parse({
    schemaVersion: 3,
    kind: "MEDIA_METADATA",
    ownerId: assetId,
    revisionId,
    revisionNumber: Number(clock["revision"]),
    createdBy: claim.actorId,
    createdAt: at,
    source: {
      id: randomUUID(),
      locale,
      sourceHash: computeDailySourceHash("MEDIA_METADATA", locale, fields),
      editorId: claim.actorId,
      editedAt: at,
      fields,
    },
    structure: {
      presentationKind: "INFORMATIVE",
      focalPoint: { x: 0.5, y: 0.5 },
    },
  });
  await insertDailyDocument(client, claim, document, null, previousMetadataId);
  await client.query(
    `INSERT INTO public.media_metadata_revisions(id,media_asset_id,revision,lifecycle,presentation_kind,focal_x,focal_y,created_by,created_at) VALUES($1,$2,$3,'DRAFT','INFORMATIVE',0.5,0.5,$4,$5)`,
    [revisionId, assetId, document.revisionNumber, claim.actorId, at],
  );
  return revisionId;
}
export async function loadDailyHomepageTemplate(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  revisionId: string,
) {
  const [revision] = await draftRows(
    client,
    `SELECT r.id,d.document FROM public.homepage_revisions r LEFT JOIN public.daily_publication_revisions d ON d.revision_id=r.id WHERE r.id=$1 AND r.lifecycle IN('PUBLISHED','SUPERSEDED') AND EXISTS(SELECT 1 FROM public.content_publications p WHERE p.homepage_revision_id=r.id AND p.proof_version IN(2,3)) FOR SHARE OF r`,
    [revisionId],
  );
  if (!revision) throw new Error("Historical homepage publication unavailable");
  if (revision["document"]) {
    const document = dailyPublicationDocumentSchema.parse(revision["document"]);
    if (document.kind !== "HOMEPAGE")
      throw new Error("Homepage source kind mismatch");
    return {
      locale: document.source.locale,
      fields: document.source.fields,
      slots: document.slots,
    };
  }
  const [translation] = await draftRows(
    client,
    `SELECT to_jsonb(t.*) value FROM public.homepage_revision_translations t JOIN public.homepage_translation_reviews r ON r.homepage_translation_id=t.id AND r.status='APPROVED' AND r.sequence=3 WHERE t.homepage_revision_id=$1 AND t.locale=$2 FOR SHARE OF t,r`,
    [revisionId, claim.intent.sourceLocale],
  );
  if (!translation) throw new Error("Historical homepage original unavailable");
  const row = translation["value"] as Record<string, unknown>;
  const labels = await draftRows(
    client,
    `SELECT slot_key,label FROM public.homepage_slot_translations WHERE homepage_translation_id=$1 ORDER BY slot_key`,
    [row["id"]],
  );
  const slots = await draftRows(
    client,
    `SELECT to_jsonb(s.*) value FROM public.homepage_slots s WHERE homepage_revision_id=$1 ORDER BY sort_order FOR SHARE`,
    [revisionId],
  );
  return {
    locale: claim.intent.sourceLocale,
    fields: homepageTranslationFieldsSchema.parse({
      ...pickFields(row, [
        "heroTitle",
        "heroSubtitle",
        "ctaLabel",
        "announcement",
        "seoTitle",
        "seoDescription",
      ]),
      slotLabels: labels.map((label) => ({
        slotKey: label["slot_key"],
        label: label["label"],
      })),
    }),
    slots: slots.map((entry) =>
      homepageSlotSchema.parse({
        schemaVersion: 1,
        ...pickFields(entry["value"] as Record<string, unknown>, [
          "homepageRevisionId",
          "slotKey",
          "kind",
          "idolId",
          "giftId",
          "policyKey",
          "desktopMediaAssetId",
          "desktopMediaMetadataRevisionId",
          "mobileMediaAssetId",
          "mobileMediaMetadataRevisionId",
          "sortOrder",
        ]),
      }),
    ),
  };
}
