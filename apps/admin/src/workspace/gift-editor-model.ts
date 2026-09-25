import type {
  ContentAuthoringContent,
  GiftDetailBlock,
  GiftDetailTranslationFields,
  GiftVariantDefinition,
  SupportedLocale,
} from "@fan-support/contracts";

export type GiftContent = Extract<ContentAuthoringContent, { kind: "GIFT" }>;
export type GiftDetails = NonNullable<GiftContent["details"]>;
export function orderGiftMedia(
  media: GiftContent["media"],
): GiftContent["media"] {
  let galleryIndex = 0;
  return media.map((row) => ({
    ...row,
    sortOrder: row.role === "PRIMARY" ? 0 : galleryIndex++,
  }));
}
export function replaceDetailTranslation(
  details: GiftDetails,
  locale: SupportedLocale,
  blocks: GiftDetailTranslationFields["blocks"],
): GiftDetails {
  return {
    ...details,
    translations: [
      ...(locale === "en"
        ? []
        : details.translations.filter((row) => row.locale !== locale)),
      { locale, origin: "HUMAN", blocks },
    ],
  };
}
export function newGiftContent(
  variants: readonly Pick<GiftVariantDefinition, "id">[],
): GiftContent {
  return {
    kind: "GIFT",
    structure: {
      category: "OTHER",
      contents: [{ componentCode: "ITEM", quantity: 1, unit: "ITEM" }],
      deliveryEstimate: { minimum: 1, maximum: 7, unit: "DAY" },
      requiresSafetyNotice: false,
      shippingMode: "internal_to_idol",
    },
    media: [],
    translations: [
      {
        locale: "en",
        origin: "HUMAN",
        fields: {
          title: "",
          subtitle: "",
          shortDescription: "",
          description: "",
          fulfillmentDescription: "",
          safetyNotice: "",
          variantLabels: variants.map(({ id }) => ({
            giftVariantId: id,
            label: "",
          })),
          seoTitle: "",
          seoDescription: "",
        },
      },
    ],
  };
}

/** Reconcile only identities and shape. New copy stays empty and cannot pass a save schema. */
export function alignDetailBlocks(
  blocks: readonly GiftDetailBlock[],
  translated: GiftDetailTranslationFields["blocks"] = [],
): GiftDetailTranslationFields["blocks"] {
  return blocks.map((block) => {
    const previous = translated.find(
      (row) => row.blockId === block.id && row.kind === block.kind,
    );
    const identity = { blockId: block.id };
    switch (block.kind) {
      case "HEADING":
      case "PARAGRAPH":
        return {
          ...identity,
          kind: block.kind,
          text: previous && "text" in previous ? previous.text : "",
        };
      case "LIST":
        return {
          ...identity,
          kind: "LIST",
          items: block.itemIds.map((itemId) => ({
            itemId,
            text:
              previous?.kind === "LIST"
                ? (previous.items.find((item) => item.itemId === itemId)
                    ?.text ?? "")
                : "",
          })),
        };
      case "SPECIFICATIONS":
        return {
          ...identity,
          kind: "SPECIFICATIONS",
          items: block.itemIds.map((itemId) => ({
            itemId,
            label:
              previous?.kind === "SPECIFICATIONS"
                ? (previous.items.find((item) => item.itemId === itemId)
                    ?.label ?? "")
                : "",
            value:
              previous?.kind === "SPECIFICATIONS"
                ? (previous.items.find((item) => item.itemId === itemId)
                    ?.value ?? "")
                : "",
          })),
        };
      case "MEDIA":
        return {
          ...identity,
          kind: "MEDIA",
          mediaMetadataRevisionId: block.mediaMetadataRevisionId,
          ...(block.captionEnabled
            ? {
                caption:
                  previous?.kind === "MEDIA" &&
                  previous.mediaMetadataRevisionId ===
                    block.mediaMetadataRevisionId
                    ? (previous.caption ?? "")
                    : "",
              }
            : {}),
        };
    }
  });
}

export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}
export function parseAmountMinor(value: string, currency: string): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value.trim());
  const digits = currencyDigits(currency);
  if (!match || (match[2]?.length ?? 0) > digits)
    throw new Error("INVALID_AMOUNT");
  const minor =
    BigInt(match[1]!) * 10n ** BigInt(digits) +
    BigInt((match[2] ?? "").padEnd(digits, "0") || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("INVALID_AMOUNT");
  return Number(minor);
}
