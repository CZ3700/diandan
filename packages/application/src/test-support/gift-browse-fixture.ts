import {
  giftVariantIdSchema,
  legacyGiftDirectoryRecordSchema,
} from "@fan-support/contracts";
import { computeGiftTranslationContentHash } from "@fan-support/content";
import { createFictionalIdolDirectoryRecord } from "./catalog-directory-fixture.js";

function without(value: object, fields: readonly string[]) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !fields.includes(key)),
  );
}

/** Reuse the complete fictional media approvals; construct a separate gift publication. */
export function createFictionalGiftBrowseRecord() {
  const original = createFictionalIdolDirectoryRecord();
  const { source, selection } = original;
  if (
    selection.objectKind !== "IDOL" ||
    selection.currentPublication.objectKind !== "IDOL" ||
    selection.selectedTranslation.objectKind !== "IDOL"
  )
    throw new Error("Expected fictional artist proof");
  const variantId = giftVariantIdSchema.parse(
    "b0000000-0000-4000-8000-000000009999",
  );
  const fields = {
    title: "Fictional gift",
    shortDescription: "A fictional gift.",
    description: "A fictional gift used in isolated tests.",
    fulfillmentDescription: "Prepared by the fictional studio.",
    variantLabels: [{ giftVariantId: variantId, label: "Standard" }],
    seoTitle: "Fictional gift",
    seoDescription: "Fictional gift publication.",
  };
  const hash = computeGiftTranslationContentHash(fields);
  const manifest = selection.currentPublication.translationManifest.map(
    (entry) => {
      if (entry.objectKind !== "IDOL") return entry;
      const { idolRevisionId, ...rest } = entry;
      return {
        ...rest,
        objectKind: "GIFT",
        giftRevisionId: idolRevisionId,
        approvedSourceHash: hash,
        approvedContentHash: hash,
      };
    },
  );
  const idolId = selection.idolId;
  const idolRevisionId = selection.currentPublication.idolRevisionId;
  const selectionBase = without(selection, [
    "idolId",
    "acceptingGifts",
    "currentPublication",
    "selectedTranslation",
  ]);
  const publicationBase = without(selection.currentPublication, [
    "idolId",
    "idolRevisionId",
  ]);
  const base = without(source.base, ["acceptingGifts"]);
  const revision = without(source.revision, [
    "idolId",
    "themeAccent",
    "heroTextTone",
    "displayOrder",
  ]);
  const translation = without(source.translation, [
    "idolRevisionId",
    "displayName",
    "shortBio",
    "fullBio",
  ]);
  return legacyGiftDirectoryRecordSchema.parse({
    schemaVersion: 1,
    selection: {
      ...selectionBase,
      objectKind: "GIFT",
      giftId: idolId,
      selectedTranslation: manifest.find(
        (entry) => entry.objectKind === "GIFT" && entry.locale === "en",
      ),
      currentPublication: {
        ...publicationBase,
        objectKind: "GIFT",
        giftId: idolId,
        giftRevisionId: idolRevisionId,
        translationManifest: manifest,
      },
    },
    source: {
      ...source,
      objectKind: "GIFT",
      base: { ...base, handle: "fictional-gift" },
      revision: {
        ...revision,
        giftId: idolId,
        category: "OTHER",
        contents: [{ componentCode: "GIFT", quantity: 1, unit: "ITEM" }],
        deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
        requiresSafetyNotice: false,
        shippingMode: "internal_to_idol",
      },
      translation: {
        ...translation,
        ...fields,
        giftRevisionId: source.revision.id,
        sourceHash: hash,
        translatedFromSourceHash: hash,
        review: {
          ...source.translation.review,
          reviewedSourceHash: hash,
          reviewedContentHash: hash,
        },
      },
      variants: [
        {
          schemaVersion: 1,
          id: variantId,
          giftId: idolId,
          sku: "TEST-GIFT",
          status: "active",
          inventoryPolicy: "PROCURE_ON_DEMAND",
        },
      ],
      media: source.media.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              asset: { ...entry.asset, height: entry.asset.width },
              variant: { ...entry.variant, height: entry.variant.width },
            }
          : entry,
      ),
      mediaReferences: source.mediaReferences.map(
        ({ idolRevisionId: parent, ...entry }, index) => ({
          ...entry,
          giftRevisionId: parent,
          role: index === 0 ? "PRIMARY" : "GALLERY",
          sortOrder: index,
        }),
      ),
    },
  });
}
