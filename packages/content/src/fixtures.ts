import {
  giftPublicationCandidateSchema,
  giftVariantIdSchema,
  SUPPORTED_LOCALES,
  translationApprovalEvidenceSchema,
} from "@fan-support/contracts";
import type { SupportedLocale } from "@fan-support/contracts";

import {
  computeGiftTranslationContentHash,
  computeMediaTranslationContentHash,
} from "./hashing.js";

const EDITOR_ID = "34d657b6-93b2-470f-a777-4ce1f98914e0";
const REVIEWER_ID = "c64367a8-350a-4fa5-b866-17ceeea511e0";
const GIFT_ID = "22f3ae89-e965-40aa-8c5a-e876f486264d";
const GIFT_REVISION_ID = "1045cb31-735a-4c90-81bf-7af2b2dc8ee7";
const VARIANT_ID = giftVariantIdSchema.parse(
  "3f15ce90-171b-4c76-8238-118212242295",
);
const IDOL_ID = "b74152dc-e245-44d5-97f5-ff84ef60e138";
const IDOL_REVISION_ID = "ea191a79-df54-410d-a32e-f966451976fb";
const PRICE_BOOK_ID = "31d3e54a-51f6-4686-82a2-80b331a599ca";
const MEDIA_ASSET_ID = "8dcfc61a-3931-4165-a3dd-23404f8635c1";
const MEDIA_METADATA_REVISION_ID = "2299f403-2dd5-4ca0-a803-6177f66f8c56";
const INVENTORY_ITEM_ID = "0b91add0-e78b-4898-8b3d-3ab50c50a9dc";
const INVENTORY_LOCATION_ID = "88aab92a-fd64-43f1-8f59-15a4e4cb6dce";

function fixtureUuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

function fixtureHash(sequence: number): string {
  return sequence.toString(16).padStart(2, "0").repeat(32);
}

function giftCopy(locale: SupportedLocale): Readonly<{
  title: string;
  shortDescription: string;
  description: string;
  fulfillmentDescription: string;
  variantLabels: readonly Readonly<{
    giftVariantId: typeof VARIANT_ID;
    label: string;
  }>[];
  seoTitle: string;
  seoDescription: string;
}> {
  switch (locale) {
    case "en":
      return {
        title: "Aurora Keepsake",
        shortDescription: "A fictional keepsake for contract testing.",
        description: "A fictional keepsake prepared by the test platform.",
        fulfillmentDescription:
          "The platform procures, prepares, and delivers this fictional gift.",
        variantLabels: [{ giftVariantId: VARIANT_ID, label: "Standard" }],
        seoTitle: "Aurora Keepsake",
        seoDescription: "A fictional gift page used for contract testing.",
      };
    case "zh-CN":
      return {
        title: "极光纪念礼物",
        shortDescription: "仅用于契约测试的虚构礼物。",
        description: "由测试平台准备的虚构纪念礼物。",
        fulfillmentDescription: "平台采购、准备并配送这份虚构礼物。",
        variantLabels: [{ giftVariantId: VARIANT_ID, label: "标准款" }],
        seoTitle: "极光纪念礼物",
        seoDescription: "用于契约测试的虚构礼物页面。",
      };
    case "th":
      return {
        title: "ของที่ระลึกแสงออโรรา",
        shortDescription: "ของขวัญสมมติสำหรับทดสอบสัญญา",
        description: "ของที่ระลึกสมมติที่จัดเตรียมโดยแพลตฟอร์มทดสอบ",
        fulfillmentDescription: "แพลตฟอร์มจัดหา เตรียม และส่งของขวัญสมมตินี้",
        variantLabels: [{ giftVariantId: VARIANT_ID, label: "มาตรฐาน" }],
        seoTitle: "ของที่ระลึกแสงออโรรา",
        seoDescription: "หน้าของขวัญสมมติสำหรับทดสอบสัญญา",
      };
    case "vi":
      return {
        title: "Kỷ vật cực quang",
        shortDescription: "Món quà hư cấu dùng để kiểm thử hợp đồng.",
        description: "Kỷ vật hư cấu do nền tảng thử nghiệm chuẩn bị.",
        fulfillmentDescription:
          "Nền tảng thu mua, chuẩn bị và giao món quà hư cấu này.",
        variantLabels: [{ giftVariantId: VARIANT_ID, label: "Tiêu chuẩn" }],
        seoTitle: "Kỷ vật cực quang",
        seoDescription: "Trang quà tặng hư cấu dùng để kiểm thử hợp đồng.",
      };
    case "ja":
      return {
        title: "オーロラ記念ギフト",
        shortDescription: "契約テスト専用の架空ギフトです。",
        description: "テスト用プラットフォームが準備する架空の記念品です。",
        fulfillmentDescription:
          "プラットフォームがこの架空ギフトを調達、準備、配送します。",
        variantLabels: [{ giftVariantId: VARIANT_ID, label: "スタンダード" }],
        seoTitle: "オーロラ記念ギフト",
        seoDescription: "契約テスト用の架空ギフトページです。",
      };
    case "es":
      return {
        title: "Recuerdo Aurora",
        shortDescription: "Un regalo ficticio para probar contratos.",
        description:
          "Un recuerdo ficticio preparado por la plataforma de prueba.",
        fulfillmentDescription:
          "La plataforma compra, prepara y entrega este regalo ficticio.",
        variantLabels: [{ giftVariantId: VARIANT_ID, label: "Estándar" }],
        seoTitle: "Recuerdo Aurora",
        seoDescription: "Página ficticia de regalo para probar contratos.",
      };
    case "pt":
      return {
        title: "Lembrança Aurora",
        shortDescription: "Um presente fictício para testes de contrato.",
        description:
          "Uma lembrança fictícia preparada pela plataforma de teste.",
        fulfillmentDescription:
          "A plataforma compra, prepara e entrega este presente fictício.",
        variantLabels: [{ giftVariantId: VARIANT_ID, label: "Padrão" }],
        seoTitle: "Lembrança Aurora",
        seoDescription: "Página fictícia de presente para testes de contrato.",
      };
  }
}

function mediaAlt(locale: SupportedLocale): string {
  switch (locale) {
    case "en":
      return "Fictional silver keepsake with an aurora motif";
    case "zh-CN":
      return "带有极光图案的虚构银色纪念品";
    case "th":
      return "ของที่ระลึกสีเงินสมมติพร้อมลวดลายแสงออโรรา";
    case "vi":
      return "Kỷ vật bạc hư cấu với họa tiết cực quang";
    case "ja":
      return "オーロラ模様の架空の銀色記念品";
    case "es":
      return "Recuerdo plateado ficticio con motivo de aurora";
    case "pt":
      return "Lembrança prateada fictícia com motivo de aurora";
  }
}

const GIFT_SOURCE_HASH = computeGiftTranslationContentHash(giftCopy("en"));
const MEDIA_SOURCE_HASH = computeMediaTranslationContentHash({
  alt: mediaAlt("en"),
});

const giftTranslations = SUPPORTED_LOCALES.map((locale, index) => {
  const localizedContent = giftCopy(locale);
  const sourceHash = computeGiftTranslationContentHash(localizedContent);
  return {
    schemaVersion: 1,
    id: fixtureUuid(100 + index),
    giftRevisionId: GIFT_REVISION_ID,
    locale,
    sourceHash,
    translatedFromSourceHash: GIFT_SOURCE_HASH,
    origin: "HUMAN",
    editorId: EDITOR_ID,
    editedAt: "2026-09-03T01:00:00Z",
    review: {
      status: "APPROVED",
      reviewerId: REVIEWER_ID,
      reviewedAt: "2026-09-03T02:00:00Z",
      reviewedSourceHash: GIFT_SOURCE_HASH,
      reviewedContentHash: sourceHash,
    },
    ...localizedContent,
  };
});

const mediaTranslations = SUPPORTED_LOCALES.map((locale, index) => {
  const alt = mediaAlt(locale);
  const sourceHash = computeMediaTranslationContentHash({ alt });
  return {
    schemaVersion: 1,
    id: fixtureUuid(200 + index),
    mediaMetadataRevisionId: MEDIA_METADATA_REVISION_ID,
    locale,
    sourceHash,
    translatedFromSourceHash: MEDIA_SOURCE_HASH,
    origin: "HUMAN",
    editorId: EDITOR_ID,
    editedAt: "2026-09-03T01:00:00Z",
    review: {
      status: "APPROVED",
      reviewerId: REVIEWER_ID,
      reviewedAt: "2026-09-03T02:00:00Z",
      reviewedSourceHash: MEDIA_SOURCE_HASH,
      reviewedContentHash: sourceHash,
    },
    alt,
  };
});

export const fictionalGiftPublicationCandidate =
  giftPublicationCandidateSchema.parse({
    schemaVersion: 1,
    objectKind: "GIFT",
    action: "PUBLISH",
    currentPublication: null,
    evaluatedAt: "2026-09-03T03:00:00Z",
    targetOperationalStatus: "active",
    base: {
      schemaVersion: 1,
      id: GIFT_ID,
      handle: "aurora-keepsake",
      status: "draft",
      draftRevisionId: GIFT_REVISION_ID,
      publishedRevisionId: null,
      version: 1,
    },
    revision: {
      schemaVersion: 1,
      id: GIFT_REVISION_ID,
      giftId: GIFT_ID,
      revision: 1,
      lifecycle: {
        status: "VALIDATED",
        validatedAt: "2026-09-03T02:30:00Z",
      },
      category: "ACCESSORY",
      contents: [
        {
          componentCode: "FICTIONAL_KEEPSAKE",
          quantity: 1,
          unit: "ITEM",
        },
      ],
      deliveryEstimate: { minimum: 3, maximum: 5, unit: "DAY" },
      requiresSafetyNotice: false,
      shippingMode: "internal_to_idol",
      createdBy: EDITOR_ID,
      createdAt: "2026-09-03T00:00:00Z",
    },
    translations: giftTranslations,
    variants: [
      {
        schemaVersion: 1,
        id: VARIANT_ID,
        giftId: GIFT_ID,
        sku: "AURORA-KEEPSAKE-01",
        status: "active",
        inventoryPolicy: "TRACKED",
      },
    ],
    eligibleIdols: [
      {
        schemaVersion: 1,
        id: IDOL_ID,
        handle: "luma-vale",
        status: "active",
        acceptingGifts: true,
        draftRevisionId: null,
        publishedRevisionId: IDOL_REVISION_ID,
        version: 1,
      },
    ],
    eligibility: [
      {
        schemaVersion: 1,
        giftVariantId: VARIANT_ID,
        idolId: IDOL_ID,
        eligible: true,
      },
    ],
    priceBooks: [
      {
        schemaVersion: 1,
        id: PRICE_BOOK_ID,
        revision: 1,
        market: "US",
        currency: "USD",
        status: "PUBLISHED",
        validFrom: "2026-09-01T00:00:00Z",
        validUntil: "2026-10-01T00:00:00Z",
      },
    ],
    prices: [
      {
        schemaVersion: 1,
        id: "13dc5880-5ca4-4f2f-b951-acd695a77fb1",
        revision: 1,
        priceBookId: PRICE_BOOK_ID,
        priceBookRevision: 1,
        giftVariantId: VARIANT_ID,
        unitAmountMinor: 4_800,
        validFrom: "2026-09-01T00:00:00Z",
        validUntil: "2026-10-01T00:00:00Z",
      },
    ],
    mediaReferences: [
      {
        schemaVersion: 1,
        giftRevisionId: GIFT_REVISION_ID,
        role: "PRIMARY",
        mediaAssetId: MEDIA_ASSET_ID,
        mediaMetadataRevisionId: MEDIA_METADATA_REVISION_ID,
        sortOrder: 0,
      },
    ],
    mediaAssets: [
      {
        schemaVersion: 1,
        id: MEDIA_ASSET_ID,
        checksumSha256: "e".repeat(64),
        mimeType: "image/jpeg",
        width: 1800,
        height: 1800,
        byteSize: 450_000,
        objectKey: "fixtures/media/aurora-keepsake.jpg",
        processingStatus: "READY",
        rightsStatus: "APPROVED",
        rightsReference: "fixture-license-001",
        createdAt: "2026-09-03T00:00:00Z",
      },
    ],
    mediaVariants: ["AVIF", "WEBP", "JPEG"].map((format, index) => ({
      schemaVersion: 1,
      id: fixtureUuid(300 + index),
      mediaAssetId: MEDIA_ASSET_ID,
      format,
      width: 1200,
      height: 1200,
      byteSize: 120_000 + index,
      checksumSha256: fixtureHash(index + 32),
      objectKey: `fixtures/media/aurora-keepsake-${format.toLowerCase()}.${format.toLowerCase()}`,
      status: "READY",
    })),
    mediaMetadataRevisions: [
      {
        schemaVersion: 1,
        id: MEDIA_METADATA_REVISION_ID,
        mediaAssetId: MEDIA_ASSET_ID,
        revision: 1,
        lifecycle: {
          status: "PUBLISHED",
          validatedAt: "2026-09-03T01:30:00Z",
          publishedAt: "2026-09-03T02:00:00Z",
        },
        presentationKind: "INFORMATIVE",
        focalPoint: { x: 0.5, y: 0.5 },
        createdBy: EDITOR_ID,
        createdAt: "2026-09-03T00:00:00Z",
      },
    ],
    mediaTranslations,
    inventoryItems: [
      {
        schemaVersion: 1,
        id: INVENTORY_ITEM_ID,
        giftVariantId: VARIANT_ID,
        sku: "AURORA-KEEPSAKE-01",
        policy: "TRACKED",
        status: "ACTIVE",
      },
    ],
    inventoryBalances: [
      {
        schemaVersion: 1,
        inventoryItemId: INVENTORY_ITEM_ID,
        inventoryLocationId: INVENTORY_LOCATION_ID,
        onHand: 8,
        reserved: 2,
        version: 1,
      },
    ],
  });

export const fictionalGiftApprovalEvidence = translationApprovalEvidenceSchema
  .array()
  .parse([
    ...fictionalGiftPublicationCandidate.translations.map(
      (translation, index) => {
        if (translation.review.status !== "APPROVED") {
          throw new Error("fixture gift translation must be approved");
        }
        return {
          schemaVersion: 1,
          approvalId: fixtureUuid(700 + index),
          objectKind: "GIFT",
          translationRevisionId: translation.id,
          giftRevisionId: fictionalGiftPublicationCandidate.revision.id,
          locale: translation.locale,
          approvedSourceHash: translation.translatedFromSourceHash,
          approvedContentHash: translation.sourceHash,
          origin: translation.origin,
          importBatchId: translation.importBatchId,
          editorId: translation.editorId,
          reviewerId: translation.review.reviewerId,
          reviewedFieldPaths: [
            "title",
            "subtitle",
            "shortDescription",
            "description",
            "fulfillmentDescription",
            "variantLabels",
            "safetyNotice",
            "seoTitle",
            "seoDescription",
          ],
          reviewedAt: translation.review.reviewedAt,
        };
      },
    ),
    ...fictionalGiftPublicationCandidate.mediaTranslations.map(
      (translation, index) => {
        if (translation.review.status !== "APPROVED") {
          throw new Error("fixture media translation must be approved");
        }
        return {
          schemaVersion: 1,
          approvalId: fixtureUuid(800 + index),
          objectKind: "MEDIA_METADATA",
          translationRevisionId: translation.id,
          mediaMetadataRevisionId: translation.mediaMetadataRevisionId,
          locale: translation.locale,
          approvedSourceHash: translation.translatedFromSourceHash,
          approvedContentHash: translation.sourceHash,
          origin: translation.origin,
          importBatchId: translation.importBatchId,
          editorId: translation.editorId,
          reviewerId: translation.review.reviewerId,
          reviewedFieldPaths: ["alt", "title", "caption"],
          reviewedAt: translation.review.reviewedAt,
        };
      },
    ),
  ]);
