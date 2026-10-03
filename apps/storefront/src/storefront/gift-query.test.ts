import {
  giftDiscoveryQuerySchema,
  minorAmountSchema,
} from "@fan-support/contracts";
import { expect, test } from "vitest";

const fixture = giftDiscoveryQuerySchema.parse({
  schemaVersion: 1,
  locale: "en",
  market: "TEST",
  currency: "USD",
  idolId: "10000000-0000-4000-8000-000000000001",
  page: 4,
  sort: "PRICE_ASC",
  category: "FLOWERS",
  priceMinMinor: 100,
});

const model = () => import("./gift-query");

test("entering a gift clears another gift's variant without losing browse or commerce context", async () => {
  const { giftDetailHref } = await model();
  const context = `market=TEST&currency=USD&idol=${fixture.idolId}&variant=old-one&cart=one&cart=two&page=4&category=FLOWERS&variant=old-two&priceMinMinor=100&sort=PRICE_ASC`;
  expect(giftDetailHref("ja", "another-gift", context)).toBe(
    `/ja/gifts/another-gift?market=TEST&currency=USD&idol=${fixture.idolId}&cart=one&cart=two&page=4&category=FLOWERS&priceMinMinor=100&sort=PRICE_ASC`,
  );
  expect(giftDetailHref("en", "another-gift", "")).toBe(
    "/en/gifts/another-gift",
  );
  expect(() => giftDetailHref("en", "../private", context)).toThrow();
});

test("prepares canonical defaults and only public API fields while preserving link context", async () => {
  const { prepareGiftQuery } = await model();
  const result = prepareGiftQuery("ja", {
    market: "TEST",
    currency: "USD",
    idol: fixture.idolId,
    cart: ["first", "second"],
    paymentAttempt: "preserve",
  });
  expect(result.valid).toBe(true);
  if (!result.valid) return;
  expect(result.query).toMatchObject({ locale: "ja", page: 1, pageSize: 12 });
  expect(new URLSearchParams(result.apiQuery).get("idol")).toBe(fixture.idolId);
  expect(new URLSearchParams(result.apiQuery).has("cart")).toBe(false);
  expect(new URLSearchParams(result.contextQuery).getAll("cart")).toEqual([
    "first",
    "second",
  ]);
});

test("missing commerce context is distinct from malformed or duplicated context", async () => {
  const { prepareGiftQuery } = await model();
  expect(prepareGiftQuery("en", {})).toMatchObject({
    valid: false,
    reason: "CONTEXT_REQUIRED",
  });
  for (const values of [
    { market: "", currency: "USD" },
    { market: ["TEST", "TEST"], currency: "USD" },
    { market: "TEST", currency: ["USD", "JPY"] },
    { market: "TEST", currency: "usd" },
  ]) {
    expect(prepareGiftQuery("en", values)).toMatchObject({
      valid: false,
      reason: "INVALID_QUERY",
    });
  }
});

test("rejects noncanonical numeric parameters and contradictory filters without silently clamping", async () => {
  const { prepareGiftQuery } = await model();
  for (const changes of [
    { page: "0" },
    { page: "1001" },
    { page: "01" },
    { page: "1e2" },
    { page: " 2" },
    { page: ["1", "2"] },
    { pageSize: "49" },
    { priceMinMinor: "1.2" },
    { priceMinMinor: "9007199254740992" },
    { priceMinMinor: "200", priceMaxMinor: "100" },
    { category: "VIRTUAL" },
    { availability: "IN_STOCK" },
    { idol: "not-a-uuid" },
  ]) {
    expect(
      prepareGiftQuery("en", { market: "TEST", currency: "USD", ...changes }),
    ).toMatchObject({ valid: false, reason: "INVALID_QUERY" });
  }
  expect(
    prepareGiftQuery("en", {
      market: "TEST",
      currency: "USD",
      page: "1000",
      priceMaxMinor: String(Number.MAX_SAFE_INTEGER),
    }),
  ).toMatchObject({ valid: true, query: { page: 1000 } });
});

test("page and filter links preserve context, reset only filter navigation, and support artist embedding", async () => {
  const { giftPageHref, giftFilterHref, giftResetHref } = await model();
  const context = `market=TEST&currency=USD&idol=${fixture.idolId}&cart=one&cart=two&page=4&category=FLOWERS&priceMinMinor=100&sort=PRICE_ASC`;
  const page = new URL(
    giftPageHref(fixture, "/idols/fictional-artist", context, 5),
    "https://fixture.invalid",
  );
  expect(page.pathname).toBe("/en/idols/fictional-artist");
  expect(page.searchParams.get("page")).toBe("5");
  expect(page.searchParams.getAll("cart")).toEqual(["one", "two"]);
  expect(page.searchParams.get("priceMinMinor")).toBe("100");
  const filters = new URL(
    giftFilterHref(fixture, "/gifts", context, {
      sort: "PRICE_DESC",
      availability: "ALL",
      priceMaxMinor: minorAmountSchema.parse(1234),
    }),
    "https://fixture.invalid",
  );
  expect(filters.searchParams.get("page")).toBe("1");
  expect(filters.searchParams.has("category")).toBe(false);
  expect(filters.searchParams.has("priceMinMinor")).toBe(false);
  expect(filters.searchParams.get("priceMaxMinor")).toBe("1234");
  expect(filters.searchParams.get("idol")).toBe(fixture.idolId);
  const reset = new URL(
    giftResetHref(fixture, "/gifts", context),
    "https://fixture.invalid",
  );
  expect(reset.searchParams.get("page")).toBe("1");
  expect(reset.searchParams.has("category")).toBe(false);
  expect(reset.searchParams.getAll("cart")).toEqual(["one", "two"]);
  expect(() =>
    giftPageHref(fixture, "//elsewhere.invalid", context, 2),
  ).toThrow();
  expect(() => giftPageHref(fixture, "/gifts", context, 1001)).toThrow();
});

test("an empty kind or category left by an older filter form means no choice, so the list is still priced", async () => {
  const { prepareGiftQuery } = await model();
  const prepared = prepareGiftQuery("zh-CN", {
    market: "TEST",
    currency: "USD",
    kind: "VIRTUAL",
    category: "",
    page: "1",
    pageSize: "12",
  });
  expect(prepared).toMatchObject({ valid: true, query: { kind: "VIRTUAL" } });
  if (!prepared.valid) return;
  expect(prepared.query).not.toHaveProperty("category");
  expect(new URLSearchParams(prepared.apiQuery).has("category")).toBe(false);
  const neither = prepareGiftQuery("en", {
    market: "TEST",
    currency: "USD",
    kind: "",
    category: "",
  });
  expect(neither.valid).toBe(true);
  if (neither.valid) expect(neither.query).not.toHaveProperty("kind");
  // Other empty fields remain malformed rather than silently ignored.
  for (const name of ["sort", "availability", "page", "idol"])
    expect(
      prepareGiftQuery("en", { market: "TEST", currency: "USD", [name]: "" }),
    ).toMatchObject({ valid: false, reason: "INVALID_QUERY" });
});
