import { beforeEach, expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  dailyPublicationContextSchema,
  publishedContentResponseSchema,
  publishedGiftCommerceContextResponseSchema,
  publishedGiftCommerceResponseSchema,
  storefrontGiftContextResponseSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import type * as Content from "@fan-support/content";
const projections = vi.hoisted(() => ({ gift: vi.fn(), idol: vi.fn() }));
vi.mock("@fan-support/content", async (importOriginal) => ({
  ...(await importOriginal<typeof Content>()),
  projectPublishedGiftCommerce: projections.gift,
  projectPublishedContent: projections.idol,
}));
import { createPublishedGiftCommerceUseCases } from "./published-gift-commerce.js";
import { createStorefrontCommerceUseCases } from "./storefront-commerce.js";

const id = (n: number) =>
  `d4000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-08T00:00:00Z";
beforeEach(() => vi.resetAllMocks());

// Schema-valid boundary fixtures; domain projection is explicitly mocked here.
// Full current media/hash verification is covered in the content package and actual PG/browser runs.
function fixture(kind: "IDOL" | "GIFT", locale: SupportedLocale) {
  const ownerId = id(kind === "IDOL" ? 1 : 2);
  const localeContext = {
    schemaVersion: 2,
    publicationMode: "DIRECT_OPERATOR_V1",
    sourceLocale: "zh-CN",
    requestedLocale: locale,
    resolvedLocale: "zh-CN",
    fallbackUsed: locale !== "zh-CN",
    translationRevision: id(3),
  };
  const fields =
    kind === "IDOL"
      ? {
          displayName: "真实艺人",
          shortBio: "原文",
          fullBio: "原文",
          seoTitle: "艺人",
          seoDescription: "艺人原文",
        }
      : {
          title: "真实礼物",
          shortDescription: "原文",
          description: "原文",
          variantLabels: [{ giftVariantId: id(9), label: "礼物" }],
          seoTitle: "礼物",
          seoDescription: "礼物原文",
        };
  const structure =
    kind === "IDOL"
      ? { themeAccent: "#aabbcc", heroTextTone: "light", displayOrder: 0 }
      : {
          category: "OTHER",
          requiresSafetyNotice: false,
          shippingMode: "internal_to_idol",
          contents: [],
        };
  const variants = [
    {
      schemaVersion: 1,
      id: id(9),
      giftId: ownerId,
      sku: "TEST-GIFT",
      status: "active",
      inventoryPolicy: "PROCURE_ON_DEMAND",
    },
  ];
  const document = {
    schemaVersion: 3,
    kind,
    ownerId,
    revisionId: id(4),
    revisionNumber: 1,
    createdBy: id(5),
    createdAt: at,
    source: {
      id: id(3),
      locale: "zh-CN",
      sourceHash: "a".repeat(64),
      editorId: id(5),
      editedAt: at,
      fields,
    },
    structure,
    media: [],
    ...(kind === "GIFT" ? { giftKind: "WISH", variants } : {}),
  };
  const context = dailyPublicationContextSchema.parse({
    schemaVersion: 3,
    publicationMode: "DIRECT_OPERATOR_V1",
    locale,
    publication: {
      publicationId: id(6),
      revisionId: id(4),
      headVersion: 1,
      publishedAt: at,
      manifestHash: "a".repeat(64),
    },
    manifest: {
      schemaVersion: 3,
      publicationMode: "DIRECT_OPERATOR_V1",
      operationId: id(7),
      actorId: id(5),
      document,
      media: [],
    },
    current: {
      publicationId: id(6),
      revisionId: id(4),
      headVersion: 1,
      evaluatedAt: at,
      lifecycle: "PUBLISHED",
      status: "active",
      handle: kind === "IDOL" ? "actual-artist" : "actual-gift",
      acceptingGifts: kind === "IDOL",
      document,
      media: [],
      prices: [],
      priceBooks: [],
      variants: kind === "GIFT" ? variants : [],
    },
  });
  const media = {
    schemaVersion: 2,
    kind: "INFORMATIVE",
    localeContext,
    url: "https://media.example.invalid/processed.webp",
    alt: "原文图片",
    width: 1200,
    height: 1500,
    focalPoint: { x: 0.5, y: 0.5 },
  };
  const common = {
    schemaVersion: 1,
    id: ownerId,
    handle: context.current.handle,
    status: "active",
    localeContext,
  };
  const view =
    kind === "IDOL"
      ? {
          ...common,
          ...fields,
          acceptingGifts: true,
          themeAccent: "#aabbcc",
          heroTextTone: "light",
          portrait: media,
          heroDesktop: media,
          heroMobile: media,
          gallery: [],
        }
      : {
          ...common,
          title: "真实礼物",
          shortDescription: "原文",
          description: "原文",
          seoTitle: "礼物",
          seoDescription: "礼物原文",
          category: "OTHER",
          shippingMode: "internal_to_idol",
          contents: [],
          primaryMedia: media,
          gallery: [],
          variants: [
            {
              schemaVersion: 1,
              id: id(9),
              label: "礼物",
              status: "active",
              inventoryPolicy: "PROCURE_ON_DEMAND",
            },
          ],
        };
  const result = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: kind === "IDOL" ? "PUBLISHED_CONTENT" : "PUBLISHED_GIFT_COMMERCE",
    publication: {
      id: id(6),
      revisionId: id(4),
      manifestHash: "a".repeat(64),
      publishedAt: at,
    },
    content: {
      kind,
      view,
      ...(kind === "IDOL"
        ? { aliases: [] }
        : { details: { format: "LEGACY_TEXT", text: "原文" } }),
    },
    ...(kind === "GIFT"
      ? {
          classification: {
            kind: "CLASSIFIED",
            giftKind: "WISH",
            profileHash: "a".repeat(64),
          },
        }
      : {}),
  };
  return {
    context,
    response:
      kind === "IDOL"
        ? publishedContentResponseSchema.parse(result)
        : publishedGiftCommerceResponseSchema.parse(result),
  };
}

function setup(locale: SupportedLocale) {
  const gift = fixture("GIFT", locale),
    idol = fixture("IDOL", locale);
  projections.gift.mockReturnValue(gift.response);
  projections.idol.mockReturnValue(idol.response);
  const loaded = publishedGiftCommerceContextResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    context: gift.context,
    profileVersion: 3,
    profile: null,
  });
  const query = {
    schemaVersion: 1,
    handle: "actual-gift",
    locale,
    market: "TEST",
    currency: "USD",
    idolId: id(1),
  };
  const scoped = storefrontGiftContextResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    command: query,
    gift: loaded,
    recipient: { kind: "PUBLISHED", context: idol.context },
    variants: [
      {
        giftVariantId: id(9),
        price: null,
        hasEligibleRecipient: true,
        eligibleForSelectedRecipient: true,
        inventoryItem: null,
        maximumLocationAvailableQuantity: 0,
      },
    ],
  });
  const published = createPublishedGiftCommerceUseCases({
    transactions: {
      runInPublishedGiftCommerceTransaction: async (work) =>
        work({ publishedGiftCommerce: { load: async () => loaded } }),
    },
  });
  const storefront = createStorefrontCommerceUseCases({
    transactions: {
      runInStorefrontCommerceTransaction: async (work) =>
        work({
          storefrontCommerce: {
            loadGift: async () => scoped,
            readContext: async () => ({
              schemaVersion: 1,
              outcome: "FAILURE",
              code: "COMMERCE_UNAVAILABLE",
            }),
          },
        }),
    },
  });
  return {
    gift,
    idol,
    query,
    published: () =>
      published.execute({
        schemaVersion: 1,
        locator: { kind: "GIFT", handle: "actual-gift" },
        locale,
      }),
    storefront: () => storefront.readGift(query),
  };
}

test.each(SUPPORTED_LOCALES)(
  "daily original gift and selected artist retain source provenance on %s",
  async (locale) => {
    const h = setup(locale);
    expect.soft(await h.published()).toMatchObject({
      outcome: "SUCCESS",
      content: {
        view: {
          localeContext: { requestedLocale: locale, resolvedLocale: "zh-CN" },
        },
      },
    });
    expect.soft(await h.storefront()).toMatchObject({
      outcome: "SUCCESS",
      recipient: {
        kind: "PUBLISHED",
        idol: {
          localeContext: { requestedLocale: locale, resolvedLocale: "zh-CN" },
        },
      },
    });
  },
);

test.each(["requested", "resolved", "fallback", "legacy-fallback"])(
  "daily locale adapter still rejects %s mismatches for gift and recipient",
  async (change) => {
    const h = setup("en");
    const mutate = (response: unknown) => {
      const value = structuredClone(response) as {
        content: { view: { localeContext: Record<string, unknown> } };
      };
      const locale = value.content.view.localeContext;
      if (change === "requested") locale["requestedLocale"] = "ja";
      if (change === "resolved") locale["resolvedLocale"] = "ja";
      if (change === "fallback") locale["fallbackUsed"] = false;
      if (change === "legacy-fallback") {
        value.content.view.localeContext = {
          schemaVersion: 1,
          requestedLocale: "en",
          resolvedLocale: "zh-CN",
          fallbackUsed: true,
          translationRevision: id(3),
        };
      }
      return value;
    };
    projections.gift.mockReturnValue(mutate(h.gift.response));
    expect(await h.published()).toMatchObject({
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
    projections.gift.mockReturnValue(h.gift.response);
    projections.idol.mockReturnValue(mutate(h.idol.response));
    expect(await h.storefront()).toMatchObject({
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
  },
);
