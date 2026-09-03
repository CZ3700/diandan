import { expect, test } from "vitest";

type SchemaParseResult =
  Readonly<{ success: true; data: unknown }> | Readonly<{ success: false }>;

type Schema = Readonly<{
  safeParse: (value: unknown) => SchemaParseResult;
}>;

const EDITOR_ID = "34d657b6-93b2-470f-a777-4ce1f98914e0";
const REVIEWER_ID = "c64367a8-350a-4fa5-b866-17ceeea511e0";
const GIFT_ID = "22f3ae89-e965-40aa-8c5a-e876f486264d";
const GIFT_REVISION_ID = "1045cb31-735a-4c90-81bf-7af2b2dc8ee7";
const VARIANT_ID = "3f15ce90-171b-4c76-8238-118212242295";
const IDOL_ID = "b74152dc-e245-44d5-97f5-ff84ef60e138";
const SOURCE_HASH = "a".repeat(64);
const TRANSLATION_HASH = "b".repeat(64);
const PUBLIC_MEDIA_GEOMETRY = {
  width: 1_600,
  height: 900,
  focalPoint: { x: 0.5, y: 0.5 },
} as const;

function approvedGiftTranslation(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "9c0b2754-92ce-49c2-b909-27a0dd0af735",
    giftRevisionId: GIFT_REVISION_ID,
    locale: "es",
    sourceHash: TRANSLATION_HASH,
    translatedFromSourceHash: SOURCE_HASH,
    origin: "HUMAN",
    editorId: EDITOR_ID,
    editedAt: "2026-09-03T01:00:00Z",
    review: {
      status: "APPROVED",
      reviewerId: REVIEWER_ID,
      reviewedAt: "2026-09-03T02:00:00Z",
      reviewedSourceHash: SOURCE_HASH,
      reviewedContentHash: TRANSLATION_HASH,
    },
    title: "Ramo de celebración",
    shortDescription: "Un regalo ficticio para pruebas.",
    description: "Preparado y entregado por la plataforma de prueba.",
    fulfillmentDescription: "La plataforma prepara y entrega este regalo.",
    variantLabels: [
      {
        giftVariantId: VARIANT_ID,
        label: "Estándar",
      },
    ],
    seoTitle: "Ramo de celebración",
    seoDescription: "Página ficticia de un regalo de celebración.",
    ...overrides,
  };
}

test("splits base operational state, immutable revision lifecycle, and public views", async () => {
  const content = await import("./content.js").catch(() => undefined);
  const catalog = await import("./catalog.js");

  expect(content, "content contract module must exist").toBeDefined();
  for (const schemaName of [
    "idolBaseSchema",
    "idolRevisionSchema",
    "giftBaseSchema",
    "giftRevisionSchema",
    "publishedIdolViewSchema",
    "publishedGiftViewSchema",
  ] as const) {
    expect(
      content?.[schemaName],
      `${schemaName} must be exported`,
    ).toBeDefined();
  }
  expect(content?.publishedIdolViewSchema).not.toBe(catalog.idolSchema);
  expect(content?.publishedGiftViewSchema).not.toBe(catalog.giftSchema);

  const base = {
    schemaVersion: 1,
    id: GIFT_ID,
    handle: "aurora-keepsake",
    status: "draft",
    draftRevisionId: GIFT_REVISION_ID,
    publishedRevisionId: null,
    version: 1,
  };
  expect((content?.giftBaseSchema as Schema).safeParse(base).success).toBe(
    true,
  );
  expect(
    (content?.giftBaseSchema as Schema).safeParse({
      ...base,
      title: "localized fields do not belong on base rows",
    }).success,
  ).toBe(false);

  const publicIdol = {
    schemaVersion: 1,
    id: IDOL_ID,
    handle: "luma-vale",
    status: "active",
    acceptingGifts: true,
    localeContext: {
      schemaVersion: 1,
      requestedLocale: "en",
      resolvedLocale: "en",
      fallbackUsed: false,
      translationRevision: "9c0b2754-92ce-49c2-b909-27a0dd0af735",
    },
    displayName: "Luma Vale",
    shortBio: "A fictional performer used only for contract tests.",
    fullBio:
      "<p>Luma Vale is a fictional performer created only for contract tests.</p>",
    seoTitle: "Send a gift to Luma Vale",
    seoDescription:
      "Browse fictional gifts prepared for the fictional performer Luma Vale.",
    themeAccent: "#A36F5A",
    heroTextTone: "light",
    portrait: {
      schemaVersion: 1,
      kind: "INFORMATIVE",
      url: "https://media.example.invalid/luma-portrait.webp",
      alt: "Portrait of the fictional performer Luma Vale",
      ...PUBLIC_MEDIA_GEOMETRY,
    },
    heroDesktop: {
      schemaVersion: 1,
      kind: "INFORMATIVE",
      url: "https://media.example.invalid/luma-hero-desktop.webp",
      alt: "Luma Vale in a fictional desktop hero scene",
      ...PUBLIC_MEDIA_GEOMETRY,
    },
    heroMobile: {
      schemaVersion: 1,
      kind: "INFORMATIVE",
      url: "https://media.example.invalid/luma-hero-mobile.webp",
      alt: "Luma Vale in a fictional mobile hero scene",
      ...PUBLIC_MEDIA_GEOMETRY,
    },
    gallery: [
      {
        schemaVersion: 1,
        kind: "INFORMATIVE",
        url: "https://media.example.invalid/luma-gallery-01.webp",
        alt: "Luma Vale in a fictional gallery scene",
        ...PUBLIC_MEDIA_GEOMETRY,
      },
    ],
  };
  expect(
    (content?.publishedIdolViewSchema as Schema).safeParse(publicIdol).success,
  ).toBe(true);
  for (const forbiddenStatus of ["draft", "archived"] as const) {
    expect(
      (content?.publishedIdolViewSchema as Schema).safeParse({
        ...publicIdol,
        status: forbiddenStatus,
      }).success,
    ).toBe(false);
  }
  expect(
    (content?.publishedIdolViewSchema as Schema).safeParse({
      ...publicIdol,
      status: "paused",
      acceptingGifts: true,
    }).success,
  ).toBe(false);
  expect(
    (content?.publishedIdolViewSchema as Schema).safeParse({
      ...publicIdol,
      status: "paused",
      acceptingGifts: false,
    }).success,
  ).toBe(true);
  expect(
    (content?.publishedIdolViewSchema as Schema).safeParse({
      ...publicIdol,
      draftRevisionId: GIFT_REVISION_ID,
    }).success,
  ).toBe(false);
  expect(
    (content?.publishedIdolViewSchema as Schema).safeParse({
      ...publicIdol,
      portrait: {
        ...publicIdol.portrait,
        objectKey: "private/luma-portrait.webp",
      },
    }).success,
  ).toBe(false);
  expect(
    (content?.publishedIdolViewSchema as Schema).safeParse({
      ...publicIdol,
      gallery: Array.from({ length: 13 }, (_, index) => ({
        schemaVersion: 1,
        kind: "INFORMATIVE",
        url: `https://media.example.invalid/luma-gallery-${index}.webp`,
        alt: `Luma Vale fictional gallery scene ${index}`,
        ...PUBLIC_MEDIA_GEOMETRY,
      })),
    }).success,
  ).toBe(false);
  for (const requiredField of [
    "fullBio",
    "seoTitle",
    "seoDescription",
    "themeAccent",
    "heroTextTone",
    "heroDesktop",
    "heroMobile",
    "gallery",
  ] as const) {
    const incompleteIdol: Record<string, unknown> = { ...publicIdol };
    delete incompleteIdol[requiredField];
    expect(
      (content?.publishedIdolViewSchema as Schema).safeParse(incompleteIdol)
        .success,
      `published idol must require ${requiredField}`,
    ).toBe(false);
  }

  const publicGift = {
    schemaVersion: 1,
    id: GIFT_ID,
    handle: "aurora-keepsake",
    status: "active",
    localeContext: publicIdol.localeContext,
    title: "Aurora Keepsake",
    subtitle: "A fictional celebration gift",
    shortDescription: "A fictional keepsake.",
    description: "A fictional keepsake prepared by the test platform.",
    fulfillmentDescription: "The platform prepares and delivers it.",
    category: "OTHER",
    contents: [{ componentCode: "KEEPSAKE", quantity: 1, unit: "ITEM" }],
    deliveryEstimate: {
      minimum: 2,
      maximum: 5,
      unit: "DAY",
    },
    shippingMode: "internal_to_idol",
    primaryMedia: {
      schemaVersion: 1,
      kind: "INFORMATIVE",
      url: "https://media.example.invalid/aurora-keepsake.webp",
      alt: "A fictional Aurora Keepsake gift",
      ...PUBLIC_MEDIA_GEOMETRY,
    },
    gallery: [
      {
        schemaVersion: 1,
        kind: "INFORMATIVE",
        url: "https://media.example.invalid/aurora-keepsake-detail.webp",
        alt: "A fictional detail view of the Aurora Keepsake",
        ...PUBLIC_MEDIA_GEOMETRY,
      },
    ],
    variants: [
      {
        schemaVersion: 1,
        id: VARIANT_ID,
        label: "Standard",
        status: "active",
        inventoryPolicy: "TRACKED",
      },
    ],
    safetyNotice: "This is a fictional non-consumable test gift.",
    seoTitle: "Aurora Keepsake gift",
    seoDescription: "A fictional Aurora Keepsake gift used in contract tests.",
  };
  const parsedGift = (content?.publishedGiftViewSchema as Schema).safeParse(
    publicGift,
  );
  expect(parsedGift.success).toBe(true);
  if (parsedGift.success) {
    const parsedVariants = (
      parsedGift.data as Readonly<{
        variants: readonly Readonly<{ id: string; label: string }>[];
      }>
    ).variants;
    expect(
      parsedVariants.map(({ id, label }) => ({ giftVariantId: id, label })),
    ).toEqual([{ giftVariantId: VARIANT_ID, label: "Standard" }]);
  }
  expect(
    (content?.publishedGiftViewSchema as Schema).safeParse({
      ...publicGift,
      variants: publicGift.variants.map((variant) => ({
        ...variant,
        status: "paused",
      })),
    }).success,
  ).toBe(false);
  for (const forbidden of [
    { status: "draft" },
    { status: "archived" },
    { objectKey: "private/source.jpg" },
    { reviewerId: REVIEWER_ID },
    { sourceHash: SOURCE_HASH },
  ]) {
    expect(
      (content?.publishedGiftViewSchema as Schema).safeParse({
        ...publicGift,
        ...forbidden,
      }).success,
    ).toBe(false);
  }
  expect(
    (content?.publishedGiftViewSchema as Schema).safeParse({
      ...publicGift,
      primaryMedia: {
        ...publicGift.primaryMedia,
        objectKey: "private/aurora-keepsake.webp",
      },
    }).success,
  ).toBe(false);
  expect(
    (content?.publishedGiftViewSchema as Schema).safeParse({
      ...publicGift,
      variants: [
        {
          ...publicGift.variants[0],
          sku: "INTERNAL-SKU",
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    (content?.publishedGiftViewSchema as Schema).safeParse({
      ...publicGift,
      gallery: Array.from({ length: 13 }, (_, index) => ({
        schemaVersion: 1,
        kind: "INFORMATIVE",
        url: `https://media.example.invalid/aurora-gallery-${index}.webp`,
        alt: `Aurora Keepsake fictional gallery image ${index}`,
        ...PUBLIC_MEDIA_GEOMETRY,
      })),
    }).success,
  ).toBe(false);
  for (const requiredField of [
    "category",
    "contents",
    "deliveryEstimate",
    "primaryMedia",
    "gallery",
    "seoTitle",
    "seoDescription",
  ] as const) {
    const incompleteGift: Record<string, unknown> = { ...publicGift };
    delete incompleteGift[requiredField];
    expect(
      (content?.publishedGiftViewSchema as Schema).safeParse(incompleteGift)
        .success,
      `published gift must require ${requiredField}`,
    ).toBe(false);
  }

  const legacyIdol = {
    schemaVersion: 1,
    id: publicIdol.id,
    handle: publicIdol.handle,
    status: publicIdol.status,
    acceptingGifts: publicIdol.acceptingGifts,
    localeContext: publicIdol.localeContext,
    displayName: publicIdol.displayName,
    shortBio: publicIdol.shortBio,
    portrait: {
      url: publicIdol.portrait.url,
      alt: publicIdol.portrait.alt,
    },
  };
  const legacyGift = {
    schemaVersion: 1,
    id: publicGift.id,
    handle: publicGift.handle,
    status: publicGift.status,
    localeContext: publicGift.localeContext,
    title: publicGift.title,
    subtitle: publicGift.subtitle,
    description: publicGift.description,
    fulfillmentDescription: publicGift.fulfillmentDescription,
    shippingMode: publicGift.shippingMode,
    variants: publicGift.variants,
  };
  expect(catalog.idolSchema.safeParse(legacyIdol).success).toBe(true);
  expect(catalog.giftSchema.safeParse(legacyGift).success).toBe(true);
});

test("models explicit translation rows and binds approval evidence to content and source hashes", async () => {
  const content = await import("./content.js").catch(() => undefined);
  const schema = content?.giftRevisionTranslationSchema as Schema;

  expect(schema).toBeDefined();
  expect(schema.safeParse(approvedGiftTranslation()).success).toBe(true);
  expect(
    schema.safeParse(
      approvedGiftTranslation({
        editorId: REVIEWER_ID,
      }),
    ).success,
  ).toBe(false);
  expect(
    schema.safeParse(
      approvedGiftTranslation({
        review: {
          status: "APPROVED",
          reviewerId: EDITOR_ID.toUpperCase(),
          reviewedAt: "2026-09-03T02:00:00Z",
          reviewedSourceHash: SOURCE_HASH,
          reviewedContentHash: TRANSLATION_HASH,
        },
      }),
    ).success,
  ).toBe(false);
  expect(
    schema.safeParse(
      approvedGiftTranslation({
        sourceHash: "c".repeat(64),
      }),
    ).success,
  ).toBe(false);
  expect(
    schema.safeParse(
      approvedGiftTranslation({
        editedAt: "2026-09-03T03:00:00Z",
      }),
    ).success,
  ).toBe(false);
  expect(
    schema.safeParse(
      approvedGiftTranslation({
        review: { status: "STALE" },
      }),
    ).success,
  ).toBe(false);
  expect(
    schema.safeParse(approvedGiftTranslation({ market: "US", currency: "USD" }))
      .success,
  ).toBe(false);

  const english = approvedGiftTranslation({
    locale: "en",
    sourceHash: SOURCE_HASH,
    translatedFromSourceHash: SOURCE_HASH,
    review: {
      status: "APPROVED",
      reviewerId: REVIEWER_ID,
      reviewedAt: "2026-09-03T02:00:00Z",
      reviewedSourceHash: SOURCE_HASH,
      reviewedContentHash: SOURCE_HASH,
    },
  });
  expect(schema.safeParse(english).success).toBe(true);
  expect(
    schema.safeParse({
      ...english,
      translatedFromSourceHash: "d".repeat(64),
    }).success,
  ).toBe(false);
});

test("defines strict content, media, policy, price, and inventory records", async () => {
  const content = await import("./content.js").catch(() => undefined);

  for (const schemaName of [
    "idolRevisionTranslationSchema",
    "giftVariantDefinitionSchema",
    "giftVariantIdolEligibilitySchema",
    "homepageRevisionSchema",
    "homepageRevisionTranslationSchema",
    "policyRevisionSchema",
    "policyRevisionTranslationSchema",
    "mediaAssetSchema",
    "mediaVariantSchema",
    "mediaMetadataRevisionSchema",
    "mediaMetadataRevisionTranslationSchema",
    "priceSchema",
    "inventoryLocationSchema",
    "inventoryItemSchema",
    "inventoryBalanceSchema",
    "inventoryLedgerEntrySchema",
  ] as const) {
    expect(
      content?.[schemaName],
      `${schemaName} must be exported`,
    ).toBeDefined();
  }

  const variant = {
    schemaVersion: 1,
    id: VARIANT_ID,
    giftId: GIFT_ID,
    sku: "AURORA-KEEPSAKE-01",
    status: "active",
    inventoryPolicy: "TRACKED",
  };
  expect(
    (content?.giftVariantDefinitionSchema as Schema).safeParse(variant).success,
  ).toBe(true);
  expect(
    (content?.giftVariantIdolEligibilitySchema as Schema).safeParse({
      schemaVersion: 1,
      giftVariantId: VARIANT_ID,
      idolId: IDOL_ID,
      eligible: true,
    }).success,
  ).toBe(true);

  const price = {
    schemaVersion: 1,
    id: "13dc5880-5ca4-4f2f-b951-acd695a77fb1",
    revision: 1,
    priceBookId: "31d3e54a-51f6-4686-82a2-80b331a599ca",
    priceBookRevision: 1,
    giftVariantId: VARIANT_ID,
    unitAmountMinor: 4_800,
    validFrom: "2026-09-03T00:00:00Z",
    validUntil: "2026-10-03T00:00:00Z",
  };
  expect((content?.priceSchema as Schema).safeParse(price).success).toBe(true);
  expect(
    (content?.priceSchema as Schema).safeParse({
      ...price,
      revision: 0,
    }).success,
  ).toBe(false);
  expect(
    (content?.priceSchema as Schema).safeParse({
      ...price,
      validUntil: price.validFrom,
    }).success,
  ).toBe(false);

  const priceBookRevision = {
    schemaVersion: 1,
    id: price.priceBookId,
    revision: price.priceBookRevision,
    market: "US",
    currency: "USD",
    status: "PUBLISHED",
    validFrom: "2026-09-03T00:00:00Z",
    validUntil: "2026-10-03T00:00:00Z",
  };
  expect(
    (content?.priceBookRevisionSchema as Schema).safeParse(priceBookRevision)
      .success,
  ).toBe(true);
  expect(
    (content?.priceBookRevisionSchema as Schema).safeParse({
      ...priceBookRevision,
      validUntil: priceBookRevision.validFrom,
    }).success,
  ).toBe(false);

  const balance = {
    schemaVersion: 1,
    inventoryItemId: "0b91add0-e78b-4898-8b3d-3ab50c50a9dc",
    inventoryLocationId: "88aab92a-fd64-43f1-8f59-15a4e4cb6dce",
    onHand: 8,
    reserved: 2,
    version: 1,
  };
  expect(
    (content?.inventoryBalanceSchema as Schema).safeParse(balance).success,
  ).toBe(true);
  expect(
    (content?.inventoryBalanceSchema as Schema).safeParse({
      ...balance,
      reserved: 9,
    }).success,
  ).toBe(false);

  const asset = {
    schemaVersion: 1,
    id: "8dcfc61a-3931-4165-a3dd-23404f8635c1",
    checksumSha256: "e".repeat(64),
    mimeType: "image/jpeg",
    width: 1600,
    height: 2000,
    byteSize: 450_000,
    objectKey: "fixtures/media/luma-portrait.jpg",
    processingStatus: "READY",
    rightsStatus: "APPROVED",
    rightsReference: "fixture-license-001",
    createdAt: "2026-09-03T00:00:00Z",
  };
  expect((content?.mediaAssetSchema as Schema).safeParse(asset).success).toBe(
    true,
  );
  expect(
    (content?.mediaAssetSchema as Schema).safeParse({
      ...asset,
      checksumSha256: "not-a-checksum",
    }).success,
  ).toBe(false);
  expect(
    (content?.mediaAssetSchema as Schema).safeParse({
      ...asset,
      rightsReference: " \t\n",
    }).success,
  ).toBe(false);

  expect(
    (content?.publishedMediaViewSchema as Schema).safeParse({
      schemaVersion: 1,
      kind: "DECORATIVE",
      url: "https://media.example.invalid/decorative.webp",
      alt: "",
      ...PUBLIC_MEDIA_GEOMETRY,
    }).success,
  ).toBe(true);
  expect(
    (content?.publishedMediaViewSchema as Schema).safeParse({
      schemaVersion: 1,
      kind: "INFORMATIVE",
      url: "https://media.example.invalid/informative.webp",
      alt: "",
      ...PUBLIC_MEDIA_GEOMETRY,
    }).success,
  ).toBe(false);
});

test("treats Unicode default-ignorable characters and their numeric entities as invisible", async () => {
  const content = await import("./content.js").catch(() => undefined);
  const hasVisibleText = content?.hasVisibleText as
    ((value: string) => boolean) | undefined;

  expect(hasVisibleText).toBeTypeOf("function");
  for (const invisible of [
    "\u200E",
    "\u2060",
    "\u034F",
    "\u180E",
    "\u2800",
    "<p>&#x2060;</p>",
    "<p>&#8288;</p>",
    "<p>&#8203;</p>",
    "<p>&#x0000200B;</p>",
    "<p>&shy;</p>",
    "<p>&NegativeThinSpace;</p>",
    "<p>&ThinSpace;</p>",
    "<p>&Tab;</p>",
    "<p>&nbsp</p>",
    "\u0000",
    "\u0001",
    "\u0007",
    "<p>&#1;</p>",
  ]) {
    expect(hasVisibleText?.(invisible), JSON.stringify(invisible)).toBe(false);
  }
  for (const visible of ["A", "\u0E01", "\u4E2D", "👩‍🚀"]) {
    expect(hasVisibleText?.(visible), JSON.stringify(visible)).toBe(true);
  }
});

test("keeps published policy title and summary on the required-text contract", async () => {
  const content = await import("./content.js").catch(() => undefined);
  const schema = content?.publishedPolicyViewSchema as Schema;
  const policy = {
    schemaVersion: 1,
    policyKey: "fixture-refund-policy",
    kind: "REFUND",
    localeContext: {
      schemaVersion: 1,
      requestedLocale: "en",
      resolvedLocale: "en",
      fallbackUsed: false,
      translationRevision: "9c0b2754-92ce-49c2-b909-27a0dd0af735",
    },
    title: "Refund policy",
    summary: "A fictional policy for contract tests.",
    body: "<p>Refund terms.</p>",
    effectiveAt: "2026-09-03T00:00:00Z",
  };

  expect(schema.safeParse(policy).success).toBe(true);
  expect(schema.safeParse({ ...policy, title: "\u2060" }).success).toBe(false);
  expect(schema.safeParse({ ...policy, summary: " \t" }).success).toBe(false);
});

test("rejects whitespace-only required and present optional localized copy", async () => {
  const content = await import("./content.js").catch(() => undefined);

  const whitespaceCases: readonly Readonly<{
    schemaName:
      | "idolTranslationFieldsSchema"
      | "giftTranslationFieldsSchema"
      | "homepageTranslationFieldsSchema"
      | "policyTranslationFieldsSchema";
    value: Record<string, unknown>;
  }>[] = [
    {
      schemaName: "idolTranslationFieldsSchema",
      value: {
        displayName: "   ",
        shortBio: "Short bio",
        fullBio: "<p>Full biography</p>",
        seoTitle: "SEO title",
        seoDescription: "SEO description",
      },
    },
    {
      schemaName: "idolTranslationFieldsSchema",
      value: {
        displayName: "Luma Vale",
        shortBio: "Short bio",
        fullBio: "<p> &nbsp; </p>",
        seoTitle: "SEO title",
        seoDescription: "SEO description",
      },
    },
    {
      schemaName: "giftTranslationFieldsSchema",
      value: {
        title: "Gift",
        subtitle: "\t\n",
        shortDescription: "Short description",
        description: "Description",
        fulfillmentDescription: "Fulfillment description",
        variantLabels: [{ giftVariantId: VARIANT_ID, label: "Standard" }],
        seoTitle: "SEO title",
        seoDescription: "SEO description",
      },
    },
    {
      schemaName: "homepageTranslationFieldsSchema",
      value: {
        heroTitle: "Hero",
        heroSubtitle: "Subtitle",
        ctaLabel: "Open",
        announcement: "   ",
        slotLabels: [{ slotKey: "hero", label: "Featured" }],
        seoTitle: "SEO title",
        seoDescription: "SEO description",
      },
    },
    {
      schemaName: "policyTranslationFieldsSchema",
      value: {
        title: "Policy",
        summary: "Summary",
        body: "<p><strong> </strong></p>",
      },
    },
  ];

  for (const candidate of whitespaceCases) {
    expect(
      (content?.[candidate.schemaName] as Schema).safeParse(candidate.value)
        .success,
      `${candidate.schemaName} must reject blank localized copy`,
    ).toBe(false);
  }
});
