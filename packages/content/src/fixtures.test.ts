import { expect, test } from "vitest";

import {
  homepageRevisionSchema,
  homepageRevisionTranslationSchema,
  homepageSlotSchema,
  idolBaseSchema,
  idolRevisionMediaSchema,
  idolRevisionSchema,
  idolRevisionTranslationSchema,
  inventoryLedgerEntrySchema,
  inventoryLocationSchema,
  mediaAssetSchema,
  mediaMetadataRevisionSchema,
  mediaMetadataRevisionTranslationSchema,
  mediaVariantSchema,
  policyRevisionSchema,
  policyRevisionTranslationSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";

import { validateIdolMediaQualification } from "./media-qualification.js";
import { fictionalContentModelFixture } from "./model-fixtures.js";

function localeSet(rows: readonly Readonly<{ locale: string }>[]): Set<string> {
  return new Set(rows.map((row) => row.locale));
}

test("provides a complete fictional seven-locale model fixture", () => {
  const fixture = fictionalContentModelFixture;

  expect(idolBaseSchema.safeParse(fixture.idol.base).success).toBe(true);
  expect(idolRevisionSchema.safeParse(fixture.idol.revision).success).toBe(
    true,
  );
  expect(
    fixture.idol.translations.every(
      (row) => idolRevisionTranslationSchema.safeParse(row).success,
    ),
  ).toBe(true);
  expect(
    fixture.idol.references.every(
      (reference) => idolRevisionMediaSchema.safeParse(reference).success,
    ),
  ).toBe(true);
  expect(
    fixture.idol.assets.every(
      (asset) => mediaAssetSchema.safeParse(asset).success,
    ),
  ).toBe(true);
  expect(
    fixture.idol.variants.every(
      (variant) => mediaVariantSchema.safeParse(variant).success,
    ),
  ).toBe(true);
  expect(
    fixture.idol.metadataRevisions.every(
      (revision) => mediaMetadataRevisionSchema.safeParse(revision).success,
    ),
  ).toBe(true);
  expect(
    fixture.idol.mediaTranslations.every(
      (translation) =>
        mediaMetadataRevisionTranslationSchema.safeParse(translation).success,
    ),
  ).toBe(true);

  expect(
    homepageRevisionSchema.safeParse(fixture.homepage.revision).success,
  ).toBe(true);
  expect(
    fixture.homepage.translations.every(
      (row) => homepageRevisionTranslationSchema.safeParse(row).success,
    ),
  ).toBe(true);
  expect(
    fixture.homepage.slots.every(
      (slot) => homepageSlotSchema.safeParse(slot).success,
    ),
  ).toBe(true);

  expect(policyRevisionSchema.safeParse(fixture.policy.revision).success).toBe(
    true,
  );
  expect(
    fixture.policy.translations.every(
      (row) => policyRevisionTranslationSchema.safeParse(row).success,
    ),
  ).toBe(true);
  expect(
    inventoryLocationSchema.safeParse(fixture.inventory.location).success,
  ).toBe(true);
  expect(
    inventoryLedgerEntrySchema.safeParse(fixture.inventory.ledgerEntry).success,
  ).toBe(true);

  for (const rows of [
    fixture.idol.translations,
    fixture.homepage.translations,
    fixture.policy.translations,
  ]) {
    expect(localeSet(rows)).toEqual(new Set(SUPPORTED_LOCALES));
    expect(rows).toHaveLength(SUPPORTED_LOCALES.length);
  }

  const idolAssetIds = fixture.idol.assets.map((asset) => asset.id);
  const idolMetadataRevisionIds = fixture.idol.metadataRevisions.map(
    (revision) => revision.id,
  );
  expect(new Set(idolAssetIds).size).toBe(3);
  expect(new Set(idolMetadataRevisionIds).size).toBe(3);
  const giftAssetIds = new Set(
    fixture.giftPublication.mediaAssets.map((asset) => asset.id),
  );
  expect(idolAssetIds.some((assetId) => giftAssetIds.has(assetId))).toBe(false);
  expect(fixture.idol.references).toHaveLength(3);
  expect(fixture.idol.variants).toHaveLength(9);
  expect(fixture.idol.mediaTranslations).toHaveLength(
    3 * SUPPORTED_LOCALES.length,
  );

  for (const metadataRevisionId of idolMetadataRevisionIds) {
    const translations = fixture.idol.mediaTranslations.filter(
      (translation) =>
        translation.mediaMetadataRevisionId === metadataRevisionId,
    );
    expect(localeSet(translations)).toEqual(new Set(SUPPORTED_LOCALES));
    expect(translations).toHaveLength(SUPPORTED_LOCALES.length);
  }

  expect(
    validateIdolMediaQualification({
      revisionId: fixture.idol.revision.id,
      references: fixture.idol.references,
      assets: fixture.idol.assets,
      variants: fixture.idol.variants,
      metadataRevisions: fixture.idol.metadataRevisions,
    }),
  ).toEqual([]);

  expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
});

test("keeps fixtures synthetic and free of fan or fulfillment private data", () => {
  const serialized = JSON.stringify(fictionalContentModelFixture);

  for (const forbidden of [
    "fanMessage",
    "displayNameCiphertext",
    "fulfillmentAddress",
    "customerEmail",
    "X-Amz-Credential",
    "X-Amz-Signature",
    "X-Amz-Security-Token",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(serialized).not.toMatch(/https?:\/\/[^"/]*\.(?:com|net|org)\b/u);
});
