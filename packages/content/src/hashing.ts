import { createHash } from "node:crypto";

import type {
  GiftTranslationFields,
  HomepageTranslationFields,
  IdolTranslationFields,
  MediaMetadataRevisionTranslation,
  PolicyTranslationFields,
} from "@fan-support/contracts";

type CanonicalPrimitive = null | boolean | number | string;
type CanonicalValue =
  CanonicalPrimitive | readonly CanonicalValue[] | CanonicalObject;

interface CanonicalObject {
  readonly [key: string]: CanonicalValue | undefined;
}

type DeepReadonly<Value> = Value extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value;

function canonicalize(value: CanonicalValue): unknown {
  if (typeof value === "string") {
    return value.normalize("NFC");
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry) => entry[1] !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child as CanonicalValue)]),
    );
  }
  return value;
}

function computeTranslationContentHash(
  contentKind: string,
  localizedContent: Readonly<Record<string, CanonicalValue | undefined>>,
): string {
  const canonical = JSON.stringify(
    canonicalize({
      contentKind,
      schemaVersion: 1,
      localizedContent,
    }),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type GiftTranslationContent = DeepReadonly<GiftTranslationFields>;

export function computeGiftTranslationContentHash(
  content: GiftTranslationContent,
): string {
  return computeTranslationContentHash("gift-translation-v1", {
    title: content.title,
    subtitle: content.subtitle,
    shortDescription: content.shortDescription,
    description: content.description,
    fulfillmentDescription: content.fulfillmentDescription,
    variantLabels: content.variantLabels
      .map((entry) => ({
        ...entry,
        giftVariantId: String(entry.giftVariantId).toLowerCase(),
      }))
      .toSorted((left, right) =>
        compareAscii(left.giftVariantId, right.giftVariantId),
      ),
    safetyNotice: content.safetyNotice,
    seoTitle: content.seoTitle,
    seoDescription: content.seoDescription,
  });
}

export type MediaTranslationContent = DeepReadonly<
  Pick<MediaMetadataRevisionTranslation, "alt" | "title" | "caption">
>;

export function computeMediaTranslationContentHash(
  content: MediaTranslationContent,
): string {
  return computeTranslationContentHash("media-translation-v1", {
    alt: content.alt,
    title: content.title,
    caption: content.caption,
  });
}

export type IdolTranslationContent = DeepReadonly<IdolTranslationFields>;

export function computeIdolTranslationContentHash(
  content: IdolTranslationContent,
): string {
  return computeTranslationContentHash("idol-translation-v1", {
    displayName: content.displayName,
    shortBio: content.shortBio,
    fullBio: content.fullBio,
    seoTitle: content.seoTitle,
    seoDescription: content.seoDescription,
  });
}

export type HomepageTranslationContent =
  DeepReadonly<HomepageTranslationFields>;

export function computeHomepageTranslationContentHash(
  content: HomepageTranslationContent,
): string {
  return computeTranslationContentHash("homepage-translation-v1", {
    heroTitle: content.heroTitle,
    heroSubtitle: content.heroSubtitle,
    ctaLabel: content.ctaLabel,
    announcement: content.announcement,
    slotLabels: [...content.slotLabels].toSorted((left, right) =>
      compareAscii(left.slotKey, right.slotKey),
    ),
    seoTitle: content.seoTitle,
    seoDescription: content.seoDescription,
  });
}

export type PolicyTranslationContent = DeepReadonly<PolicyTranslationFields>;

export function computePolicyTranslationContentHash(
  content: PolicyTranslationContent,
): string {
  return computeTranslationContentHash("policy-translation-v1", {
    title: content.title,
    summary: content.summary,
    body: content.body,
  });
}
