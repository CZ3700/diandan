import {
  contentPublicationSchema,
  giftBaseSchema,
  giftDirectoryRecordSchema,
  giftRevisionMediaSchema,
  giftRevisionSchema,
  giftRevisionTranslationSchema,
  giftVariantDefinitionSchema,
  idolBaseSchema,
  idolDirectoryRecordSchema,
  idolRevisionMediaSchema,
  idolRevisionSchema,
  idolRevisionTranslationSchema,
  mediaAssetSchema,
  mediaMetadataRevisionSchema,
  mediaMetadataRevisionTranslationSchema,
  mediaVariantSchema,
  publicMediaProjectionSourceSchema,
  translationPublicationManifestEntrySchema,
  type GiftDirectoryRecord,
  type IdolDirectoryRecord,
  type SupportedLocale,
  type TranslationPublicationManifestEntry,
} from "@fan-support/contracts";

export type CatalogDatabaseRow = Readonly<Record<string, unknown>>;
export type CatalogObjectKind = "IDOL" | "GIFT";

export function catalogRecord(input: unknown): CatalogDatabaseRow {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("CATALOG_PUBLICATION_INVALID");
  }
  return input as CatalogDatabaseRow;
}
export function catalogRows(input: unknown): CatalogDatabaseRow[] {
  if (!Array.isArray(input)) throw new Error("CATALOG_PUBLICATION_INVALID");
  return input.map(catalogRecord);
}
function fields(row: CatalogDatabaseRow, names: readonly string[]) {
  return Object.fromEntries(
    names.map((name) => [
      name,
      row[name.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)],
    ]),
  );
}
function optionalFields(row: CatalogDatabaseRow, names: readonly string[]) {
  return Object.fromEntries(
    Object.entries(fields(row, names)).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
}
function lifecycle(row: CatalogDatabaseRow) {
  return {
    status: row["lifecycle"],
    ...optionalFields(row, [
      "validatedAt",
      "publishedAt",
      "supersededAt",
      "archivedAt",
    ]),
  };
}
function audit(row: CatalogDatabaseRow) {
  const review = catalogRecord(row["review"]);
  return {
    ...fields(row, [
      "locale",
      "sourceHash",
      "translatedFromSourceHash",
      "origin",
      "editorId",
      "editedAt",
    ]),
    ...optionalFields(row, ["importBatchId"]),
    review: {
      status: review["status"],
      ...optionalFields(review, [
        "reviewerId",
        "reviewedAt",
        "reviewedSourceHash",
        "reviewedContentHash",
      ]),
    },
  };
}
function translation(
  row: CatalogDatabaseRow,
  kind: CatalogObjectKind | "MEDIA_METADATA",
) {
  const common = { ...fields(row, ["schemaVersion", "id"]), ...audit(row) };
  if (kind === "IDOL")
    return idolRevisionTranslationSchema.parse({
      ...common,
      ...fields(row, [
        "idolRevisionId",
        "displayName",
        "shortBio",
        "fullBio",
        "seoTitle",
        "seoDescription",
      ]),
    });
  if (kind === "GIFT")
    return giftRevisionTranslationSchema.parse({
      ...common,
      ...fields(row, [
        "giftRevisionId",
        "title",
        "shortDescription",
        "description",
        "fulfillmentDescription",
        "seoTitle",
        "seoDescription",
      ]),
      ...optionalFields(row, ["subtitle", "safetyNotice"]),
      variantLabels: catalogRows(row["variant_labels"]).map((label) =>
        fields(label, ["giftVariantId", "label"]),
      ),
    });
  return mediaMetadataRevisionTranslationSchema.parse({
    ...common,
    ...fields(row, ["mediaMetadataRevisionId", "alt"]),
    ...optionalFields(row, ["title", "caption"]),
  });
}
function manifest(
  rows: readonly CatalogDatabaseRow[],
  kind: CatalogObjectKind | "MEDIA_METADATA",
  publicationId: unknown,
): TranslationPublicationManifestEntry[] {
  return rows.map((row) => {
    const value = translation(row, kind),
      review = catalogRecord(row["review"]);
    return translationPublicationManifestEntrySchema.parse({
      schemaVersion: 1,
      publicationId,
      objectKind: kind,
      approvalId: review["id"],
      translationRevisionId: value.id,
      locale: value.locale,
      approvedSourceHash: review["reviewed_source_hash"],
      approvedContentHash: review["reviewed_content_hash"],
      origin: value.origin,
      ...(value.importBatchId === undefined
        ? {}
        : { importBatchId: value.importBatchId }),
      ...fields(row, [
        kind === "IDOL"
          ? "idolRevisionId"
          : kind === "GIFT"
            ? "giftRevisionId"
            : "mediaMetadataRevisionId",
      ]),
    });
  });
}
function localizedRow(
  rows: readonly CatalogDatabaseRow[],
  locale: SupportedLocale,
): CatalogDatabaseRow {
  const matches = rows.filter((row) => row["locale"] === locale);
  if (matches.length !== 1) throw new Error("CATALOG_PUBLICATION_INVALID");
  return matches[0]!;
}
function mediaSource(
  row: CatalogDatabaseRow,
  locale: SupportedLocale,
  baseUrl: string,
) {
  const assetRow = catalogRecord(row["asset"]),
    metadataRow = catalogRecord(row["metadata"]),
    variantRow = catalogRecord(row["variant"]);
  const asset = mediaAssetSchema.parse({
    ...fields(assetRow, [
      "schemaVersion",
      "id",
      "checksumSha256",
      "mimeType",
      "width",
      "height",
      "byteSize",
      "objectKey",
      "processingStatus",
      "rightsStatus",
      "rightsReference",
      "createdAt",
    ]),
    ...optionalFields(assetRow, ["processingErrorCode"]),
  });
  const variant = mediaVariantSchema.parse(
    fields(variantRow, [
      "schemaVersion",
      "id",
      "mediaAssetId",
      "format",
      "width",
      "height",
      "byteSize",
      "checksumSha256",
      "objectKey",
      "status",
    ]),
  );
  const metadataRevision = mediaMetadataRevisionSchema.parse({
    ...fields(metadataRow, [
      "schemaVersion",
      "id",
      "mediaAssetId",
      "revision",
      "presentationKind",
      "createdBy",
      "createdAt",
    ]),
    lifecycle: lifecycle(metadataRow),
    focalPoint: { x: metadataRow["focal_x"], y: metadataRow["focal_y"] },
  });
  const reference = catalogRecord(row["reference"]);
  return publicMediaProjectionSourceSchema.parse({
    schemaVersion: 1,
    ...fields(reference, ["mediaAssetId", "mediaMetadataRevisionId"]),
    asset,
    variant,
    metadataRevision,
    translation: translation(
      localizedRow(catalogRows(row["translations"]), locale),
      "MEDIA_METADATA",
    ),
    url: new URL(
      variant.objectKey.split("/").map(encodeURIComponent).join("/"),
      baseUrl,
    ).href,
  });
}

/** Rebuilds the approval manifest from immutable revision rows and terminal approvals. */
export function mapCatalogPublication(
  row: CatalogDatabaseRow,
  mediaRows: readonly CatalogDatabaseRow[],
  kind: CatalogObjectKind,
  locale: SupportedLocale,
  baseUrl: string,
): IdolDirectoryRecord | GiftDirectoryRecord {
  const baseRow = catalogRecord(row["base"]),
    revisionRow = catalogRecord(row["revision"]),
    publicationRow = catalogRecord(row["publication"]);
  const parentField = kind === "IDOL" ? "idolRevisionId" : "giftRevisionId";
  const references = mediaRows.map((entry) => ({
    schemaVersion: 1,
    ...fields(catalogRecord(entry["reference"]), [
      parentField,
      "role",
      "mediaAssetId",
      "mediaMetadataRevisionId",
      "sortOrder",
    ]),
  }));
  const rows = catalogRows(row["translations"]);
  const manifests = [
    ...manifest(rows, kind, publicationRow["id"]),
    ...mediaRows.flatMap((entry) =>
      manifest(
        catalogRows(entry["translations"]),
        "MEDIA_METADATA",
        publicationRow["id"],
      ),
    ),
  ];
  const currentPublication = contentPublicationSchema.parse({
    ...fields(publicationRow, [
      "schemaVersion",
      "id",
      "action",
      "replacesPublicationId",
      "publishedBy",
      "publishedAt",
    ]),
    objectKind: publicationRow["content_type"],
    ...fields(publicationRow, [
      kind === "IDOL" ? "idolId" : "giftId",
      parentField,
    ]),
    translationManifest: manifests,
    mediaMetadataRevisionIds: mediaRows.map(
      (entry) =>
        catalogRecord(entry["reference"])["media_metadata_revision_id"],
    ),
  });
  const selected = manifests.find(
    (entry) => entry.objectKind === kind && entry.locale === locale,
  );
  const selectedMediaTranslations = manifests.filter(
    (entry) => entry.objectKind === "MEDIA_METADATA" && entry.locale === locale,
  );
  const localized = translation(localizedRow(rows, locale), kind);
  const sourceCommon = {
    schemaVersion: 1,
    objectKind: kind,
    localeContext: {
      schemaVersion: 1,
      requestedLocale: locale,
      resolvedLocale: locale,
      fallbackUsed: false,
      translationRevision: localized.id,
    },
    translation: localized,
    media: mediaRows.map((entry) => mediaSource(entry, locale, baseUrl)),
  };
  const selectionCommon = {
    schemaVersion: 1,
    objectKind: kind,
    operationalStatus: baseRow["status"],
    publishedRevisionId: baseRow["published_revision_id"],
    selectedRevisionId: revisionRow["id"],
    selectedRevisionLifecycle: revisionRow["lifecycle"],
    selectedTranslation: selected,
    selectedMediaTranslations,
    currentPublication,
  };
  const baseCommon = fields(baseRow, [
    "schemaVersion",
    "id",
    "handle",
    "status",
    "draftRevisionId",
    "publishedRevisionId",
    "version",
  ]);
  const revisionCommon = {
    ...fields(revisionRow, [
      "schemaVersion",
      "id",
      "revision",
      "createdBy",
      "createdAt",
    ]),
    lifecycle: lifecycle(revisionRow),
  };
  if (kind === "IDOL")
    return idolDirectoryRecordSchema.parse({
      schemaVersion: 1,
      selection: {
        ...selectionCommon,
        idolId: baseRow["id"],
        acceptingGifts: baseRow["accepting_gifts"],
      },
      source: {
        ...sourceCommon,
        base: idolBaseSchema.parse({
          ...baseCommon,
          acceptingGifts: baseRow["accepting_gifts"],
        }),
        revision: idolRevisionSchema.parse({
          ...revisionCommon,
          ...fields(revisionRow, [
            "idolId",
            "themeAccent",
            "heroTextTone",
            "displayOrder",
          ]),
        }),
        mediaReferences: references.map((ref) =>
          idolRevisionMediaSchema.parse(ref),
        ),
      },
    });
  return giftDirectoryRecordSchema.parse({
    schemaVersion: 1,
    selection: { ...selectionCommon, giftId: baseRow["id"] },
    source: {
      ...sourceCommon,
      base: giftBaseSchema.parse(baseCommon),
      revision: giftRevisionSchema.parse({
        ...revisionCommon,
        ...fields(revisionRow, [
          "giftId",
          "category",
          "requiresSafetyNotice",
          "shippingMode",
        ]),
        contents: catalogRows(row["contents"]).map((component) =>
          fields(component, ["componentCode", "quantity", "unit"]),
        ),
        deliveryEstimate: {
          minimum: revisionRow["delivery_minimum"],
          maximum: revisionRow["delivery_maximum"],
          unit: revisionRow["delivery_unit"],
        },
      }),
      mediaReferences: references.map((ref) =>
        giftRevisionMediaSchema.parse(ref),
      ),
      variants: catalogRows(row["variants"]).map((variant) =>
        giftVariantDefinitionSchema.parse(
          fields(variant, [
            "schemaVersion",
            "id",
            "giftId",
            "sku",
            "status",
            "inventoryPolicy",
          ]),
        ),
      ),
    },
  });
}
