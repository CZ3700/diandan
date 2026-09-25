import { expect, test, vi } from "vitest";
import {
  giftDiscoveryQuerySchema,
  storefrontGiftResponseSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
vi.mock("server-only", () => ({}));

const query = new URLSearchParams({
  locale: "en",
  market: "TEST",
  currency: "USD",
});
const emptyPage = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  catalogVersion: "a".repeat(64),
  items: [],
  pageInfo: {
    schemaVersion: 1,
    page: 1,
    pageSize: 12,
    totalItems: 0,
    totalPages: 0,
    hasPreviousPage: false,
    hasNextPage: false,
    paginationLimited: false,
  },
};
function publishedGift(locale: SupportedLocale = "en") {
  const id = "abcdefab-0000-4000-8000-000000000001";
  const result = storefrontGiftResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_GIFT",
    market: "TEST",
    currency: "USD",
    recipient: { kind: "NONE" },
    publication: {
      id,
      revisionId: id,
      manifestHash: "a".repeat(64),
      publishedAt: "2026-09-06T00:00:00Z",
    },
    classification: { kind: "LEGACY" },
    content: {
      kind: "GIFT",
      details: { format: "LEGACY_TEXT", text: "Fictional description" },
      view: {
        schemaVersion: 1,
        id,
        handle: "fictional-gift",
        status: "active",
        localeContext: {
          schemaVersion: 1,
          requestedLocale: locale,
          resolvedLocale: locale,
          fallbackUsed: false,
        },
        title: "Fictional gift",
        subtitle: "Prepared for an artist",
        shortDescription: "A fictional gift",
        description: "Fictional description",
        fulfillmentDescription: "Studio prepares and delivers to the artist.",
        category: "OTHER",
        contents: [{ componentCode: "GIFT", quantity: 1, unit: "ITEM" }],
        deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
        shippingMode: "internal_to_idol",
        primaryMedia: {
          schemaVersion: 1,
          kind: "INFORMATIVE",
          url: "https://media.example.test/fictional.webp",
          alt: "Fictional photograph",
          width: 1000,
          height: 1000,
          focalPoint: { x: 0.5, y: 0.5 },
        },
        gallery: [],
        variants: [
          {
            schemaVersion: 1,
            id,
            label: "Gift",
            status: "active",
            inventoryPolicy: "TRACKED",
          },
        ],
        safetyNotice: "Fictional test gift",
        seoTitle: "Fictional gift",
        seoDescription: "Fictional gift for tests",
      },
    },
    offers: [
      {
        giftVariantId: id,
        price: { priceId: id, priceRevision: 1, unitAmountMinor: 1200 },
        availability: "AVAILABLE",
        reason: null,
        requiresRecipient: true,
        stock: { kind: "TRACKED", availableQuantity: 2 },
        maxQuantity: 2,
      },
    ],
  });
  if (result.outcome !== "SUCCESS")
    throw new Error("Invalid fictional test data");
  return result;
}
test("commerce reads use fixed endpoints and omit credentials, cache and redirects", async () => {
  const { fetchStorefrontContext } = await import("./public-commerce.js");
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "STOREFRONT_CONTEXT",
      markets: [],
      policies: [],
    }),
  );
  expect(
    (await fetchStorefrontContext("http://localhost:3002", fetcher)).outcome,
  ).toBe("SUCCESS");
  expect(String(fetcher.mock.calls[0]?.[0])).toBe(
    "http://localhost:3002/api/v1/storefront-context",
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  fetcher.mockResolvedValueOnce(
    Response.json({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "STOREFRONT_CONTEXT",
      markets: [],
      policies: [],
      privateSku: "secret",
    }),
  );
  expect(
    await fetchStorefrontContext("http://localhost:3002", fetcher),
  ).toMatchObject({ code: "COMMERCE_UNAVAILABLE" });
});
test("directory rejects duplicate, unknown and noncanonical query values before HTTP", async () => {
  const { fetchStorefrontGiftDirectory } = await import("./public-commerce.js");
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(emptyPage));
  for (const suffix of [
    "&page=01",
    "&locale=ja",
    "&inventory=private",
    "&market=OTHER",
    "&pageSize=49",
    "&priceMinMinor=1e2",
  ])
    expect(
      await fetchStorefrontGiftDirectory(
        "http://localhost:3002",
        new URLSearchParams(query.toString() + suffix),
        fetcher,
      ),
    ).toMatchObject({ code: "INVALID_QUERY" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (
      await fetchStorefrontGiftDirectory(
        "http://localhost:3002",
        query,
        fetcher,
      )
    ).outcome,
  ).toBe("SUCCESS");
  expect(
    giftDiscoveryQuerySchema.parse({
      schemaVersion: 1,
      ...Object.fromEntries(query),
    }).page,
  ).toBe(1);
});
test("mismatched status or page window fails closed; valid upstream errors are preserved without retry", async () => {
  const { fetchStorefrontGiftDirectory, fetchStorefrontGift } =
    await import("./public-commerce.js");
  for (const [body, status] of [
    [emptyPage, 201],
    [{ ...emptyPage, pageInfo: { ...emptyPage.pageInfo, pageSize: 10 } }, 200],
    [{ schemaVersion: 1, outcome: "FAILURE", code: "CATALOG_CHANGED" }, 503],
  ] as const) {
    expect(
      await fetchStorefrontGiftDirectory(
        "http://localhost:3002",
        query,
        async () => Response.json(body, { status }),
      ),
    ).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
  }
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(
      { schemaVersion: 1, outcome: "FAILURE", code: "CONTENT_UNAVAILABLE" },
      { status: 503 },
    ),
  );
  expect(
    await fetchStorefrontGift(
      "http://localhost:3002",
      {
        handle: "fictional-gift",
        locale: "ja",
        market: "TEST",
        currency: "USD",
      },
      fetcher,
    ),
  ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0]?.[0])).toContain("locale=ja");
});
test("bad handles cannot alter the request path, and scope is required without guessing", async () => {
  const { fetchStorefrontGift, fetchPublishedGiftCommerce } =
    await import("./public-commerce.js");
  const fetcher = vi.fn<typeof fetch>();
  for (const handle of [
    "../private",
    "gift?x=y",
    "https://other.test",
    "gift#fragment",
  ])
    expect(
      await fetchPublishedGiftCommerce(
        "http://localhost:3002",
        "en",
        handle,
        fetcher,
      ),
    ).toMatchObject({ code: "INVALID_QUERY" });
  expect(
    await fetchStorefrontGift(
      "http://localhost:3002",
      { handle: "gift", locale: "en" },
      fetcher,
    ),
  ).toMatchObject({ code: "INVALID_QUERY" });
  expect(fetcher).not.toHaveBeenCalled();
});
test("directory cardinality must equal the real first, last and out-of-range page window", async () => {
  const { fetchStorefrontGiftDirectory } = await import("./public-commerce.js");
  for (const page of [1, 3]) {
    const body = {
      ...emptyPage,
      pageInfo: {
        ...emptyPage.pageInfo,
        page,
        totalItems: 25,
        totalPages: 3,
        hasPreviousPage: page > 1,
        hasNextPage: page < 3,
      },
    };
    expect(
      await fetchStorefrontGiftDirectory(
        "http://localhost:3002",
        new URLSearchParams({
          ...Object.fromEntries(query),
          page: String(page),
        }),
        async () => Response.json(body),
      ),
    ).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
  }
  const beyond = {
    ...emptyPage,
    pageInfo: {
      ...emptyPage.pageInfo,
      page: 4,
      totalItems: 25,
      totalPages: 3,
      hasPreviousPage: true,
    },
  };
  expect(
    (
      await fetchStorefrontGiftDirectory(
        "http://localhost:3002",
        new URLSearchParams({ ...Object.fromEntries(query), page: "4" }),
        async () => Response.json(beyond),
      )
    ).outcome,
  ).toBe("SUCCESS");
  const gift = publishedGift().content.view;
  const item = {
    schemaVersion: 1,
    gift,
    offer: {
      schemaVersion: 1,
      market: "TEST",
      currency: "USD",
      priceMinor: 1200,
      purchasable: true,
    },
  };
  expect(
    await fetchStorefrontGiftDirectory(
      "http://localhost:3002",
      new URLSearchParams({ ...Object.fromEntries(query), page: "4" }),
      async () => Response.json({ ...beyond, items: [item] }),
    ),
  ).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
  const last = {
    ...beyond,
    pageInfo: { ...beyond.pageInfo, page: 3 },
    items: [item],
  };
  expect(
    (
      await fetchStorefrontGiftDirectory(
        "http://localhost:3002",
        new URLSearchParams({ ...Object.fromEntries(query), page: "3" }),
        async () => Response.json(last),
      )
    ).outcome,
  ).toBe("SUCCESS");
  const extraItem = structuredClone(item);
  Object.assign(extraItem.gift, { id: "abcdefab-0000-4000-8000-000000000002" });
  expect(
    await fetchStorefrontGiftDirectory(
      "http://localhost:3002",
      new URLSearchParams({ ...Object.fromEntries(query), page: "3" }),
      async () => Response.json({ ...last, items: [item, extraItem] }),
    ),
  ).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
});
test("gift success binds handle, scope, chosen artist and locale; fallback needs exact provenance", async () => {
  const { fetchStorefrontGift } = await import("./public-commerce.js");
  const command = {
    handle: "fictional-gift",
    locale: "ja",
    market: "TEST",
    currency: "USD",
  };
  const correct = publishedGift("ja");
  const read = (value: unknown, selected = false) =>
    fetchStorefrontGift(
      "http://localhost:3002",
      { ...command, ...(selected ? { idolId: correct.content.view.id } : {}) },
      async () => Response.json(value),
    );
  expect((await read(correct)).outcome).toBe("SUCCESS");
  expect(await read(correct, true)).toMatchObject({
    code: "CONTENT_UNAVAILABLE",
  });
  for (const value of [
    { ...correct, market: "OTHER" },
    { ...correct, currency: "JPY" },
    publishedGift("en"),
    {
      ...correct,
      content: {
        ...correct.content,
        view: { ...correct.content.view, handle: "other-gift" },
      },
    },
  ])
    expect(await read(value)).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  const fallback = structuredClone(correct);
  Object.assign(fallback.content.view.localeContext, {
    resolvedLocale: "en",
    fallbackUsed: true,
  });
  expect(await read(fallback)).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  Object.assign(fallback.content.view.localeContext, {
    translationRevision: "approved-english-revision",
  });
  expect((await read(fallback)).outcome).toBe("SUCCESS");
  const selected = structuredClone(correct);
  Object.assign(selected, {
    recipient: { kind: "UNAVAILABLE", idolId: correct.content.view.id },
  });
  selected.offers.forEach((offer) =>
    Object.assign(offer, {
      availability: "UNAVAILABLE",
      reason: "RECIPIENT_UNAVAILABLE",
      maxQuantity: 0,
      requiresRecipient: false,
    }),
  );
  expect((await read(selected, true)).outcome).toBe("SUCCESS");
  Object.assign(selected, {
    recipient: {
      kind: "UNAVAILABLE",
      idolId: "abcdefab-0000-4000-8000-000000000002",
    },
  });
  expect(await read(selected, true)).toMatchObject({
    code: "CONTENT_UNAVAILABLE",
  });
});
test("every directory item must preserve requested locale and actual scope without fallback", async () => {
  const { fetchStorefrontGiftDirectory } = await import("./public-commerce.js");
  const item = {
    schemaVersion: 1,
    gift: publishedGift().content.view,
    offer: {
      schemaVersion: 1,
      market: "TEST",
      currency: "USD",
      priceMinor: 1200,
      purchasable: true,
    },
  };
  const body = {
    ...emptyPage,
    items: [item],
    pageInfo: { ...emptyPage.pageInfo, totalItems: 1, totalPages: 1 },
  };
  const read = () =>
    fetchStorefrontGiftDirectory("http://localhost:3002", query, async () =>
      Response.json(body),
    );
  expect((await read()).outcome).toBe("SUCCESS");
  item.offer.currency = "JPY";
  expect(await read()).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
  item.offer.currency = "USD";
  Object.assign(item.gift.localeContext, {
    requestedLocale: "ja",
    resolvedLocale: "ja",
  });
  expect(await read()).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
  Object.assign(item.gift.localeContext, {
    requestedLocale: "en",
    resolvedLocale: "en",
    fallbackUsed: true,
    translationRevision: "approved-en",
  });
  expect(await read()).toMatchObject({ code: "CATALOG_UNAVAILABLE" });
});
