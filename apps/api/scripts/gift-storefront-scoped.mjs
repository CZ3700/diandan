import {
  assertPublicGetCaching,
  verifyPublicGetConditional,
} from "./public-get-revalidation.mjs";
import { randomUUID } from "node:crypto";
import {
  SUPPORTED_LOCALES,
  storefrontContextResponseSchema,
  storefrontGiftResponseSchema,
} from "@fan-support/contracts";

/** Expected cases describe authored operations, independently of the response projector. */
export async function verifyGiftStorefrontScoped({
  base,
  fixtures,
  gateway,
  check,
}) {
  const cases = [];
  const verifiedCacheScopes = new Set();
  const previousTags = new Map();
  async function get(route, schema, status = 200) {
    const response = await globalThis.fetch(base + route, {
      ...(status !== 200 && previousTags.has(route)
        ? { headers: { "if-none-match": previousTags.get(route) } }
        : {}),
      redirect: "manual",
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    const raw = await response.json();
    const value = schema.safeParse(raw);
    if (response.status !== status || !value.success)
      console.error(
        `Gift scoped response ${JSON.stringify({ path: route.split("?")[0], status: response.status, expected: status, code: value.success && value.data.outcome === "FAILURE" ? value.data.code : null, issues: value.success ? [] : value.error.issues.map(({ code, path }) => ({ code, path })) })}`,
      );
    check(
      response.status === status && value.success,
      "scoped HTTP result has exact status and schema",
    );
    assertPublicGetCaching(response, value.data, check);
    if (response.status === 200 && value.data.outcome === "SUCCESS") {
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
    check(
      !/(sourceObjectKey|rightsReference|sessionToken|csrfToken|signedUrl|reviewedBy|fanMessage|fulfillmentAddress)/u.test(
        JSON.stringify(value.data),
      ),
      "scoped public DTO contains no private proof or credentials",
    );
    return value.data;
  }
  const context = await get(
    "/api/v1/storefront-context",
    storefrontContextResponseSchema,
  );
  check(
    context.outcome === "SUCCESS",
    "actual enabled commerce context is readable",
  );
  check(
    context.markets.length === 2 &&
      fixtures.markets.every((scope) =>
        context.markets.some(
          (item) =>
            item.market === scope.market &&
            item.currencies.length === 1 &&
            item.currencies[0] === scope.currency,
        ),
      ),
    "actual context lists only two configured TEST market/currency pairs",
  );
  check(
    context.policies.length === 4 &&
      fixtures.policies.every((policy) =>
        context.policies.some(
          (item) =>
            item.policyKey === policy.policyKey && item.kind === policy.kind,
        ),
      ),
    "actual context lists four real effective and published policy keys",
  );
  await get(
    "/api/v1/storefront-context?locale=en",
    storefrontContextResponseSchema,
    400,
  );
  cases.push({ name: "actual-context-two-markets-four-policies", pass: true });
  function inspect(value, locale) {
    let localeCount = 0,
      mediaCount = 0;
    function visit(item) {
      if (!item || typeof item !== "object") return;
      for (const [key, field] of Object.entries(item)) {
        if (key === "localeContext") {
          localeCount++;
          check(
            field.requestedLocale === locale &&
              field.resolvedLocale === locale &&
              !field.fallbackUsed,
            "every gift, recipient and media object uses actual approved requested locale",
          );
        }
        if (key === "url" && typeof field === "string") {
          mediaCount++;
          check(
            new globalThis.URL(field).origin === gateway.origin &&
              Boolean(gateway.publishedMetadata(field)),
            "every scoped media URL belongs to a real registered READY derivative",
          );
        }
        visit(field);
      }
    }
    visit(value);
    check(
      localeCount > 0 && mediaCount > 0,
      "scoped locale and media assertions are nonvacuous",
    );
  }
  const read = (index, locale, scope, idol, status = 200) =>
    get(
      `/api/v1/storefront-gifts/${fixtures.gifts[index].handle}?${new globalThis.URLSearchParams({ locale, ...scope, ...(idol ? { idol } : {}) })}`,
      storefrontGiftResponseSchema,
      status,
    );
  const scenarios = [
    {
      index: 0,
      reasons: [
        [null, null, null],
        [null, null, null],
        [null, "NOT_ELIGIBLE", null],
        [
          "RECIPIENT_UNAVAILABLE",
          "RECIPIENT_UNAVAILABLE",
          "RECIPIENT_UNAVAILABLE",
        ],
      ],
    },
    { index: 1, reasons: [[null], [null], [null], ["RECIPIENT_UNAVAILABLE"]] },
    {
      index: 2,
      reasons: [
        ["OUT_OF_STOCK"],
        ["OUT_OF_STOCK"],
        ["OUT_OF_STOCK"],
        ["RECIPIENT_UNAVAILABLE"],
      ],
    },
    { index: 3, reasons: [[null], [null], [null], ["RECIPIENT_UNAVAILABLE"]] },
    {
      index: 4,
      reasons: [[null], [null], ["NOT_ELIGIBLE"], ["RECIPIENT_UNAVAILABLE"]],
    },
    {
      index: 5,
      reasons: [[null], ["NOT_ELIGIBLE"], [null], ["RECIPIENT_UNAVAILABLE"]],
    },
    {
      index: 7,
      reasons: [
        ["NO_ELIGIBLE_RECIPIENT"],
        ["NOT_ELIGIBLE"],
        ["NOT_ELIGIBLE"],
        ["RECIPIENT_UNAVAILABLE"],
      ],
    },
    {
      index: 24,
      reasons: [
        ["GIFT_PAUSED"],
        ["GIFT_PAUSED"],
        ["GIFT_PAUSED"],
        ["GIFT_PAUSED"],
      ],
    },
  ];
  for (const locale of SUPPORTED_LOCALES) {
    for (const [marketIndex, scope] of fixtures.markets.entries())
      for (const scenario of scenarios) {
        const gift = fixtures.gifts[scenario.index];
        for (const [recipientIndex, idol] of [
          undefined,
          ...fixtures.artists.map((artist) => artist.id),
        ].entries()) {
          const response = await read(scenario.index, locale, scope, idol);
          check(
            response.outcome === "SUCCESS" &&
              response.content.view.id === gift.id &&
              response.publication.revisionId === gift.revisionId,
            "scoped gift retains its exact normal published content and classification",
          );
          inspect(response, locale);
          check(
            response.market === scope.market &&
              response.currency === scope.currency,
            "language does not mutate market or currency",
          );
          check(
            recipientIndex === 0
              ? response.recipient.kind === "NONE"
              : response.recipient.kind === "PUBLISHED" &&
                  response.recipient.idol.id === idol &&
                  response.recipient.idol.acceptingGifts ===
                    (recipientIndex !== 3),
            "selected and unselected recipients reflect actual public artist state including paused",
          );
          check(
            response.offers.length === gift.variants.length,
            "every visible variant has one bound offer",
          );
          for (const offer of response.offers) {
            const variantIndex = gift.variants.findIndex(
              (variant) => variant.id === offer.giftVariantId,
            );
            check(
              variantIndex >= 0,
              "scoped offer belongs to an actual authored gift variant",
            );
            const variant = gift.variants[variantIndex],
              reason = scenario.reasons[recipientIndex][variantIndex];
            check(
              offer.price !== null &&
                offer.price.priceRevision === 1 &&
                offer.price.unitAmountMinor === variant.amounts[marketIndex],
              "current scoped canonical price remains precise even when selection is unavailable",
            );
            check(
              offer.reason === reason &&
                offer.requiresRecipient === (recipientIndex === 0),
              "availability reason matches independently authored paused, eligibility and stock scenario",
            );
            check(
              offer.availability ===
                (reason !== null
                  ? "UNAVAILABLE"
                  : variant.policy === "PREORDER"
                    ? "PREORDER"
                    : "AVAILABLE"),
              "preorder is explicit and procurement never masquerades as tracked inventory",
            );
            check(
              offer.stock.kind === variant.policy &&
                (variant.policy !== "TRACKED" ||
                  offer.stock.availableQuantity === variant.quantity),
              "tracked available quantity uses actual maximum per location, not their sum",
            );
            check(
              offer.maxQuantity ===
                (reason !== null
                  ? 0
                  : variant.policy === "TRACKED"
                    ? variant.quantity
                    : Number.MAX_SAFE_INTEGER),
              "quantity bounds distinguish finite stock and safe non-stock purchase input",
            );
          }
        }
      }
    cases.push({
      name: `scoped-offers-recipients-prices-stock-${locale}`,
      pass: true,
    });
  }
  const missingId = randomUUID();
  const unavailable = await read(0, "en", fixtures.markets[0], missingId);
  check(
    unavailable.outcome === "SUCCESS" &&
      unavailable.recipient.kind === "UNAVAILABLE" &&
      unavailable.recipient.idolId === missingId &&
      unavailable.offers.every(
        (offer) =>
          offer.reason === "RECIPIENT_UNAVAILABLE" && offer.maxQuantity === 0,
      ),
    "unknown recipient preserves explicit unavailable selection instead of choosing a different artist",
  );
  const unknownMarket = await read(
    0,
    "en",
    { market: "UNCONFIGURED", currency: "USD" },
    undefined,
    409,
  );
  check(
    unknownMarket.outcome === "FAILURE" &&
      unknownMarket.code === "MARKET_UNAVAILABLE",
    "unconfigured market never invents a price or default scope",
  );
  // Deleted (archived) and never-published gifts both have no public page (1717eda0).
  await read(25, "en", fixtures.markets[0], undefined, 404);
  await read(26, "en", fixtures.markets[0], undefined, 404);
  for (const query of [
    "locale=en&locale=ja&market=GLOBAL&currency=USD",
    "locale=en&market=GLOBAL",
    "locale=en&market=GLOBAL&currency=USD&idol=bad",
    "locale=en&market=GLOBAL&currency=USD&variant=unrequested",
  ])
    await get(
      `/api/v1/storefront-gifts/${fixtures.gifts[0].handle}?${query}`,
      storefrontGiftResponseSchema,
      400,
    );
  cases.push({
    name: "missing-recipient-market-invalid-query-archived-draft",
    pass: true,
  });
  return { schemaVersion: 1, cases };
}
