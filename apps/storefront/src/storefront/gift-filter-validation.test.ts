import { expect, test } from "vitest";
import {
  giftDiscoveryQuerySchema,
  minorAmountSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { formatGiftPriceInput, giftFilterHref } from "./gift-query";
import { validateGiftFilterDraft } from "./gift-filter-validation";
import type { GiftFilterDraft } from "./gift-filter-types";

const query = giftDiscoveryQuerySchema.parse({
  schemaVersion: 1,
  locale: "en",
  market: "TEST",
  currency: "USD",
  page: 4,
});
const draft: GiftFilterDraft = {
  sort: "PRICE_DESC",
  category: "",
  availability: "PURCHASABLE",
  minimum: "",
  maximum: "",
};
const context =
  "cart=one&cart=two&market=TEST&currency=USD&page=4&category=FLOWERS&priceMinMinor=1";

test.each(SUPPORTED_LOCALES)(
  "%s deferred validation preserves the canonical price/query behavior",
  (locale) => {
    const localized = { ...query, locale };
    const minimum = minorAmountSchema.parse(1234);
    const maximum = minorAmountSchema.parse(5678);
    const result = validateGiftFilterDraft(
      {
        ...draft,
        minimum: formatGiftPriceInput(minimum, locale, query.currency),
        maximum: formatGiftPriceInput(maximum, locale, query.currency),
      },
      locale,
      localized,
      "/gifts",
      context,
    );
    expect(result).toEqual({
      kind: "VALID",
      href: giftFilterHref(localized, "/gifts", context, {
        sort: "PRICE_DESC",
        availability: "PURCHASABLE",
        priceMinMinor: minimum,
        priceMaxMinor: maximum,
      }),
    });
    if (result.kind !== "VALID") throw new Error("Expected validated query");
    const href = new URL(result.href, "https://example.invalid");
    expect(href.searchParams.getAll("cart")).toEqual(["one", "two"]);
    expect(href.searchParams.get("page")).toBe("1");
    expect(href.searchParams.has("category")).toBe(false);
  },
);

test.each(["-1", "1e3", "Infinity", "1.001", "9007199254740992"])(
  "deferred price validation rejects %s",
  (minimum) => {
    expect(
      validateGiftFilterDraft(
        { ...draft, minimum },
        "en",
        query,
        "/gifts",
        context,
      ),
    ).toEqual({ kind: "INVALID", minimum: true, maximum: false });
  },
);

test("reports range failure separately from malformed maximum", () => {
  expect(
    validateGiftFilterDraft(
      { ...draft, minimum: "9", maximum: "8" },
      "en",
      query,
      "/gifts",
      context,
    ),
  ).toEqual({ kind: "INVALID", minimum: false, maximum: "RANGE" });
  expect(
    validateGiftFilterDraft(
      { ...draft, maximum: "invalid" },
      "en",
      query,
      "/gifts",
      context,
    ),
  ).toEqual({ kind: "INVALID", minimum: false, maximum: "INVALID" });
});

test("final schema still rejects forged category and nonlocal destinations", () => {
  expect(() =>
    validateGiftFilterDraft(
      { ...draft, category: "FORGED" },
      "en",
      query,
      "/gifts",
      context,
    ),
  ).toThrow();
  expect(() =>
    validateGiftFilterDraft(draft, "en", query, "//foreign.invalid", context),
  ).toThrow();
});

test("empty prices remove prior bounds without inventing a market or changing currency", () => {
  const result = validateGiftFilterDraft(draft, "en", query, "/gifts", context);
  expect(result.kind).toBe("VALID");
  if (result.kind !== "VALID") throw new Error("Expected validated query");
  const href = new URL(result.href, "https://example.invalid");
  expect(href.searchParams.has("priceMinMinor")).toBe(false);
  expect(href.searchParams.has("priceMaxMinor")).toBe(false);
  expect(href.searchParams.get("market")).toBe(query.market);
  expect(href.searchParams.get("currency")).toBe(query.currency);
});
