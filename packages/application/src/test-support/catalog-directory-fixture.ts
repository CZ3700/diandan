import {
  legacyIdolDirectoryRecordSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import {
  computeIdolTranslationContentHash,
  computeMediaTranslationContentHash,
} from "@fan-support/content";

// Fictional publication evidence. This is a unit fixture, not seed or approved site content.
const idolId = "a0000000-0000-4000-8000-000000000001";
const revisionId = "a0000000-0000-4000-8000-000000000002";
const publicationId = "a0000000-0000-4000-8000-000000000003";
const editorId = "a0000000-0000-4000-8000-000000000004";
const reviewerId = "a0000000-0000-4000-8000-000000000005";
const at = "2026-09-03T03:00:00Z";
const lifecycle = { status: "PUBLISHED", validatedAt: at, publishedAt: at };
const id = (sequence: number) =>
  `b0000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;

function audit(locale: string, hash: string) {
  return {
    locale,
    sourceHash: hash,
    translatedFromSourceHash: hash,
    origin: "HUMAN",
    editorId,
    editedAt: at,
    review: {
      status: "APPROVED",
      reviewerId,
      reviewedAt: at,
      reviewedSourceHash: hash,
      reviewedContentHash: hash,
    },
  };
}

function manifest(
  row: { id: string; locale: string; sourceHash: string },
  sequence: number,
) {
  return {
    schemaVersion: 1,
    publicationId,
    approvalId: id(sequence),
    translationRevisionId: row.id,
    locale: row.locale,
    approvedSourceHash: row.sourceHash,
    approvedContentHash: row.sourceHash,
    origin: "HUMAN",
  };
}

export function createFictionalIdolDirectoryRecord() {
  const fields = {
    displayName: "Fictional Luma",
    shortBio: "A fictional performer.",
    fullBio: "A fictional performer for isolated application tests.",
    seoTitle: "Fictional Luma",
    seoDescription: "Fictional application testing content.",
  };
  const hash = computeIdolTranslationContentHash(fields);
  const translations = SUPPORTED_LOCALES.map((locale, index) => ({
    schemaVersion: 1,
    id: id(100 + index),
    idolRevisionId: revisionId,
    ...audit(locale, hash),
    ...fields,
  }));
  const roles = [
    { role: "PORTRAIT", width: 1600, height: 2000 },
    { role: "HERO_DESKTOP", width: 2400, height: 1350 },
    { role: "HERO_MOBILE", width: 1080, height: 1350 },
  ];
  const media = roles.map((role, index) => {
    const mediaAssetId = id(200 + index);
    const mediaMetadataRevisionId = id(300 + index);
    const alt = `Fictional performer ${role.role.toLowerCase()}`;
    const mediaHash = computeMediaTranslationContentHash({ alt });
    const rows = SUPPORTED_LOCALES.map((locale, localeIndex) => ({
      schemaVersion: 1,
      id: id(400 + index * 10 + localeIndex),
      mediaMetadataRevisionId,
      ...audit(locale, mediaHash),
      alt,
    }));
    return {
      source: {
        schemaVersion: 1,
        mediaAssetId,
        mediaMetadataRevisionId,
        asset: {
          schemaVersion: 1,
          id: mediaAssetId,
          checksumSha256: "a".repeat(64),
          mimeType: "image/webp",
          width: role.width,
          height: role.height,
          byteSize: 1000,
          objectKey: `fixture/source-${index}.webp`,
          processingStatus: "READY",
          rightsStatus: "APPROVED",
          rightsReference: "Fictional test evidence",
          createdAt: at,
        },
        variant: {
          schemaVersion: 1,
          id: id(500 + index),
          mediaAssetId,
          format: "WEBP",
          width: role.width,
          height: role.height,
          byteSize: 1000,
          checksumSha256: "b".repeat(64),
          objectKey: `fixture/derivative-${index}.webp`,
          status: "READY",
        },
        metadataRevision: {
          schemaVersion: 1,
          id: mediaMetadataRevisionId,
          mediaAssetId,
          revision: 1,
          lifecycle,
          presentationKind: "INFORMATIVE",
          focalPoint: { x: 0.5, y: 0.5 },
          createdBy: editorId,
          createdAt: at,
        },
        translation: rows[0],
        url: `https://media.example.invalid/fixture/derivative-${index}.webp`,
      },
      reference: {
        schemaVersion: 1,
        idolRevisionId: revisionId,
        role: role.role,
        mediaAssetId,
        mediaMetadataRevisionId,
        sortOrder: 0,
      },
      manifests: rows.map((row, localeIndex) => ({
        ...manifest(row, 700 + index * 10 + localeIndex),
        objectKind: "MEDIA_METADATA",
        mediaMetadataRevisionId,
      })),
    };
  });
  const mainManifests = translations.map((row, index) => ({
    ...manifest(row, 600 + index),
    objectKind: "IDOL",
    idolRevisionId: revisionId,
  }));
  const mediaManifests = media.flatMap((entry) => entry.manifests);
  return legacyIdolDirectoryRecordSchema.parse({
    schemaVersion: 1,
    selection: {
      schemaVersion: 1,
      objectKind: "IDOL",
      idolId,
      operationalStatus: "active",
      acceptingGifts: true,
      publishedRevisionId: revisionId,
      selectedRevisionId: revisionId,
      selectedRevisionLifecycle: "PUBLISHED",
      selectedTranslation: mainManifests[0],
      selectedMediaTranslations: mediaManifests.filter(
        (entry) => entry.locale === "en",
      ),
      currentPublication: {
        schemaVersion: 1,
        id: publicationId,
        action: "PUBLISH",
        replacesPublicationId: null,
        objectKind: "IDOL",
        idolId,
        idolRevisionId: revisionId,
        mediaMetadataRevisionIds: media.map(
          (entry) => entry.source.mediaMetadataRevisionId,
        ),
        translationManifest: [...mainManifests, ...mediaManifests],
        publishedBy: reviewerId,
        publishedAt: at,
      },
    },
    source: {
      schemaVersion: 1,
      objectKind: "IDOL",
      localeContext: {
        schemaVersion: 1,
        requestedLocale: "en",
        resolvedLocale: "en",
        fallbackUsed: false,
        translationRevision: translations[0]?.id,
      },
      base: {
        schemaVersion: 1,
        id: idolId,
        handle: "fictional-luma",
        status: "active",
        acceptingGifts: true,
        draftRevisionId: null,
        publishedRevisionId: revisionId,
        version: 1,
      },
      revision: {
        schemaVersion: 1,
        id: revisionId,
        idolId,
        revision: 1,
        lifecycle,
        themeAccent: "#8A603B",
        heroTextTone: "light",
        displayOrder: 0,
        createdBy: editorId,
        createdAt: at,
      },
      translation: translations[0],
      mediaReferences: media.map((entry) => entry.reference),
      media: media.map((entry) => entry.source),
    },
  });
}
