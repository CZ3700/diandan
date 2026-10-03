import {
  assertPublicGetCaching,
  verifyPublicGetConditional,
} from "./public-get-revalidation.mjs";
import {
  SUPPORTED_LOCALES,
  giftDirectoryResponseSchema,
  publishedGiftCommerceResponseSchema,
  publishedContentResponseSchema,
} from "@fan-support/contracts";

/** Independent expectations come from the authored TEST scenario, never from the response being checked. */
function expectedDirectory(fixtures, scope, query) {
  const marketIndex = fixtures.markets.findIndex(
    (item) => item.market === scope.market && item.currency === scope.currency,
  );
  const eligibleArtists = new Set(
    fixtures.artists
      .filter((artist) => artist.acceptingGifts)
      .map((artist) => artist.id),
  );
  // SPEC 6.3.0: the fixture binds no wish, so its WISH gifts list without an offer and
  // no artist filter includes them.
  const unboundWish = (gift) => gift.giftKind === "WISH";
  const items = fixtures.gifts
    .filter((gift) => ["active", "paused"].includes(gift.status))
    .filter(
      (gift) =>
        !query.idol ||
        (!unboundWish(gift) &&
          gift.variants.some((variant) =>
            variant.eligible.includes(query.idol),
          )),
    )
    .map((gift) => {
      const prices =
        gift.status !== "active" || unboundWish(gift)
          ? []
          : gift.variants
              .filter(
                (variant) =>
                  (variant.policy !== "TRACKED" || variant.quantity > 0) &&
                  variant.eligible.some(
                    (id) =>
                      eligibleArtists.has(id) &&
                      (!query.idol || id === query.idol),
                  ),
              )
              .map((variant) => variant.amounts[marketIndex]);
      return { gift, price: prices.length ? Math.min(...prices) : null };
    })
    .filter(
      ({ gift, price }) =>
        (!query.category || gift.category === query.category) &&
        (query.priceMinMinor === undefined ||
          (price !== null && price >= Number(query.priceMinMinor))) &&
        (query.priceMaxMinor === undefined ||
          (price !== null && price <= Number(query.priceMaxMinor))) &&
        (query.availability !== "PURCHASABLE" || price !== null) &&
        (query.availability !== "UNAVAILABLE" || price === null),
    );
  if (query.sort === "PRICE_ASC" || query.sort === "PRICE_DESC")
    items.sort((left, right) => {
      if (left.price === null && right.price !== null) return 1;
      if (right.price === null && left.price !== null) return -1;
      const amount = (left.price ?? 0) - (right.price ?? 0);
      return (
        (query.sort === "PRICE_DESC" ? -amount : amount) ||
        left.gift.id.localeCompare(right.gift.id)
      );
    });
  return items;
}

export async function verifyGiftStorefrontProtocol({
  base,
  fixtures,
  gateway,
  check,
}) {
  const cases = [],
    media = new Set();
  const same = (actual, expected, label) =>
    check(JSON.stringify(actual) === JSON.stringify(expected), label);
  function inspect(value, locale) {
    let locales = 0;
    function visit(item) {
      if (!item || typeof item !== "object") return;
      for (const [key, field] of Object.entries(item)) {
        if (key === "localeContext") {
          locales++;
          check(
            field.requestedLocale === locale &&
              field.resolvedLocale === locale &&
              !field.fallbackUsed,
            "every public object and media binds its actual requested approved locale",
          );
        } else if (key === "url" && typeof field === "string") {
          check(
            new globalThis.URL(field).origin === gateway.origin &&
              Boolean(gateway.publishedMetadata(field)),
            "every public media URL is an actual registered READY derivative at the configured origin",
          );
          media.add(field);
        }
        visit(field);
      }
    }
    visit(value);
    check(locales > 0, "locale verification is not vacuous");
    check(
      !/(sourceObjectKey|rightsReference|sessionToken|csrfToken|signedUrl|reviewedBy|fanMessage|fulfillmentAddress)/u.test(
        JSON.stringify(value),
      ),
      "public gift browsing excludes internal proof, credentials and private fan or artist details",
    );
  }
  const verifiedCacheScopes = new Set();
  const previousTags = new Map();
  async function get(route, schema, status = 200) {
    const response = await globalThis.fetch(base + route, {
      ...(status !== 200 && previousTags.has(route)
        ? { headers: { "if-none-match": previousTags.get(route) } }
        : {}),
      signal: globalThis.AbortSignal.timeout(30000),
      redirect: "manual",
    });
    const parsed = schema.parse(await response.json());
    if (response.status !== status)
      console.error(
        `Gift storefront public status ${JSON.stringify({ path: route.split("?")[0], expected: status, actual: response.status, code: parsed.outcome === "FAILURE" ? parsed.code : null })}`,
      );
    check(
      response.status === status,
      `actual ${route.split("?")[0]} status matches contract`,
    );
    assertPublicGetCaching(response, parsed, check);
    if (response.status === 200 && parsed.outcome === "SUCCESS") {
      previousTags.set(route, response.headers.get("etag"));
      const resource = route.split("?")[0].split("/").slice(0, 4).join("/");
      if (!verifiedCacheScopes.has(resource)) {
        await verifyPublicGetConditional({
          base,
          route,
          response,
          schema,
          check,
        });
        verifiedCacheScopes.add(resource);
      }
    }
    return parsed;
  }
  const directory = (scope, query = {}, status = 200) =>
    get(
      `/api/v1/gifts?${new globalThis.URLSearchParams({ locale: "en", ...scope, page: "1", pageSize: "12", ...query })}`,
      giftDirectoryResponseSchema,
      status,
    );
  for (const locale of SUPPORTED_LOCALES) {
    for (const scope of fixtures.markets) {
      const page = await directory(scope, { locale });
      check(
        page.outcome === "SUCCESS" &&
          page.items.length === 12 &&
          page.pageInfo.totalItems === 25,
        "both actual market scopes have the same 25 visible gifts and default page size 12",
      );
      const expected = expectedDirectory(fixtures, scope, {});
      for (const item of page.items) {
        inspect(item.gift, locale);
        const expectedPrice = expected.find(
          (entry) => entry.gift.id === item.gift.id,
        )?.price;
        check(
          item.offer.market === scope.market &&
            item.offer.currency === scope.currency &&
            item.offer.priceMinor === expectedPrice &&
            item.offer.purchasable === (expectedPrice !== null),
          "directory prices and eligibility use this scope's actual canonical data",
        );
      }
    }
    for (const gift of [
      fixtures.gifts[0],
      fixtures.gifts[1],
      fixtures.gifts[24],
    ]) {
      const response = await get(
        `/api/v1/gift-content/${gift.handle}?locale=${locale}`,
        publishedGiftCommerceResponseSchema,
      );
      check(
        response.outcome === "SUCCESS" &&
          response.classification.kind === "CLASSIFIED" &&
          response.classification.giftKind === gift.giftKind &&
          response.publication.revisionId === gift.revisionId,
        "classification belongs to the exact actually published gift revision",
      );
      inspect(response, locale);
    }
    for (const policy of fixtures.policies) {
      const response = await get(
        `/api/v1/policies/${policy.policyKey}?locale=${locale}`,
        publishedContentResponseSchema,
      );
      check(
        response.outcome === "SUCCESS" &&
          response.content.kind === "POLICY" &&
          response.publication.revisionId === policy.revisionId,
        "all four effective policies use real published revisions",
      );
      inspect(response, locale);
    }
    cases.push({
      name: `published-content-prices-policies-${locale}`,
      pass: true,
    });
  }
  for (const scope of fixtures.markets)
    for (const query of [
      { sort: "PRICE_ASC" },
      { sort: "PRICE_DESC" },
      { sort: "PRICE_ASC", idol: fixtures.artists[0].id },
      { sort: "PRICE_ASC", idol: fixtures.artists[1].id },
      { sort: "PRICE_ASC", idol: fixtures.artists[2].id },
      { sort: "PRICE_ASC", category: "FLOWERS" },
      { sort: "PRICE_DESC", priceMinMinor: "1000", priceMaxMinor: "2000" },
      { sort: "PRICE_ASC", availability: "PURCHASABLE" },
      { sort: "PRICE_DESC", availability: "UNAVAILABLE" },
    ]) {
      const expected = expectedDirectory(fixtures, scope, query),
        actual = [];
      const totalPages = Math.max(1, Math.ceil(expected.length / 12));
      for (let page = 1; page <= totalPages; page++) {
        const result = await directory(scope, { ...query, page: String(page) });
        check(
          result.outcome === "SUCCESS" &&
            result.pageInfo.totalItems === expected.length,
          "filter count matches the independent authored dataset",
        );
        actual.push(
          ...result.items.map((item) => ({
            id: item.gift.id,
            price: item.offer.priceMinor,
          })),
        );
      }
      same(
        actual,
        expected.map(({ gift, price }) => ({ id: gift.id, price })),
        "all actual pages preserve exact scoped price order, stable ID ties and nulls last without duplicates",
      );
    }
  for (const page of ["4", "1000"]) {
    const result = await directory(fixtures.markets[0], { page });
    check(
      result.outcome === "SUCCESS" &&
        result.items.length === 0 &&
        result.pageInfo.page === Number(page),
      "out-of-range positive page stays empty at its requested page",
    );
  }
  for (const query of [
    { page: "0" },
    { page: "1001" },
    { page: "1.5" },
    { pageSize: "49" },
    { priceMinMinor: "1.5" },
    { priceMinMinor: "2000", priceMaxMinor: "1000" },
  ]) {
    const result = await directory(fixtures.markets[0], query, 400);
    check(
      result.outcome === "FAILURE" && result.code === "INVALID_QUERY",
      "invalid numeric pagination and money never silently normalize",
    );
  }
  await get(
    `/api/v1/gifts?locale=en&locale=ja&market=GLOBAL&currency=USD`,
    giftDirectoryResponseSchema,
    400,
  );
  // A deleted (archived) gift is gone, not temporarily unavailable (1717eda0), and an
  // unpublished draft has no public head: both answer NOT_FOUND.
  for (const gift of fixtures.gifts.slice(25)) {
    const unavailable = await get(
      `/api/v1/gift-content/${gift.handle}?locale=en`,
      publishedGiftCommerceResponseSchema,
      404,
    );
    check(
      unavailable.outcome === "FAILURE" && unavailable.code === "NOT_FOUND",
      "deleted published gift and unpublished draft both have no public content",
    );
  }
  check(
    media.size >= 3,
    "actual public media collection contains all three distinct gift artwork sources",
  );
  for (const url of media)
    check(
      (await gateway.probe(new globalThis.URL(url).pathname)).status === 200,
      "actual TLS S3 bytes satisfy the registered PostgreSQL checksum",
    );
  cases.push({
    name: "actual-scope-pagination-sorts-prices-stock-eligibility-and-public-media",
    pass: true,
    downloadedPublishedMedia: media.size,
  });
  return { schemaVersion: 1, cases };
}
