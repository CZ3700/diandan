import type {
  ContentAuthoringTarget,
  AdminContentFailure,
} from "@fan-support/contracts";

export const AUTHORING_TABLES = {
  IDOL: {
    ownerTable: "idols",
    ownerColumn: "idol_id",
    ownerKey: "id",
    revisions: "idol_revisions",
    parent: "idol_revision_id",
    translations: "idol_revision_translations",
    reviews: "idol_translation_reviews",
    translation: "idol_translation_id",
    evidence: "idol_translation_copy_evidence",
    fields: [
      "displayName",
      "shortBio",
      "fullBio",
      "seoTitle",
      "seoDescription",
    ],
  },
  GIFT: {
    ownerTable: "gifts",
    ownerColumn: "gift_id",
    ownerKey: "id",
    revisions: "gift_revisions",
    parent: "gift_revision_id",
    translations: "gift_revision_translations",
    reviews: "gift_translation_reviews",
    translation: "gift_translation_id",
    evidence: "gift_translation_copy_evidence",
    fields: [
      "title",
      "subtitle",
      "shortDescription",
      "description",
      "fulfillmentDescription",
      "safetyNotice",
      "seoTitle",
      "seoDescription",
    ],
  },
  HOMEPAGE: {
    ownerTable: null,
    ownerColumn: null,
    ownerKey: null,
    revisions: "homepage_revisions",
    parent: "homepage_revision_id",
    translations: "homepage_revision_translations",
    reviews: "homepage_translation_reviews",
    translation: "homepage_translation_id",
    evidence: "homepage_translation_copy_evidence",
    fields: [
      "heroTitle",
      "heroSubtitle",
      "ctaLabel",
      "announcement",
      "seoTitle",
      "seoDescription",
    ],
  },
  POLICY: {
    ownerTable: "policies",
    ownerColumn: "policy_key",
    ownerKey: "policy_key",
    revisions: "policy_revisions",
    parent: "policy_revision_id",
    translations: "policy_revision_translations",
    reviews: "policy_translation_reviews",
    translation: "policy_translation_id",
    evidence: "policy_translation_copy_evidence",
    fields: ["title", "summary", "body"],
  },
  MEDIA_METADATA: {
    ownerTable: "media_assets",
    ownerColumn: "media_asset_id",
    ownerKey: "id",
    revisions: "media_metadata_revisions",
    parent: "media_metadata_revision_id",
    translations: "media_metadata_revision_translations",
    reviews: "media_metadata_translation_reviews",
    translation: "media_metadata_translation_id",
    evidence: "media_metadata_translation_copy_evidence",
    fields: ["alt", "title", "caption"],
  },
} as const;
export const authoringFailure = (
  code: AdminContentFailure["code"],
): AdminContentFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export function ownerValue(target: ContentAuthoringTarget): string | null {
  switch (target.kind) {
    case "IDOL":
      return target.idolId.toLowerCase();
    case "GIFT":
      return target.giftId.toLowerCase();
    case "POLICY":
      return target.policyKey;
    case "MEDIA_METADATA":
      return target.mediaAssetId.toLowerCase();
    case "HOMEPAGE":
      return null;
  }
}
export const snake = (name: string) =>
  name.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
export function pickFields(
  row: Readonly<Record<string, unknown>>,
  names: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    names
      .map((name) => [name, row[snake(name)]])
      .filter(([, value]) => value !== null && value !== undefined),
  );
}
