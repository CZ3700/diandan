import { describe, expect, test } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createSeoIdentity, seoAlternateUrls } from "./seo-identity";

describe("public SEO URL identity", () => {
  test.each(SUPPORTED_LOCALES)(
    "keeps %s and explicit price scope independent",
    (locale) => {
      const identity = createSeoIdentity(locale, "gift", "starlight", {
        market: "GLOBAL",
        currency: "USD",
        variant: "a1000000-0000-4000-8000-000000000001",
      });
      expect(identity.canonicalPath).toBe(
        `/${locale}/gifts/starlight?market=GLOBAL&currency=USD&variant=a1000000-0000-4000-8000-000000000001`,
      );
      expect(identity.noindex).toBe(false);
    },
  );
  test("unscoped published gift is a content URL, not an invented region", () => {
    expect(createSeoIdentity("th", "gift", "starlight", {})).toEqual({
      canonicalPath: "/th/gifts/starlight",
      noindex: false,
    });
    expect(
      createSeoIdentity("th", "gift", "starlight", { currency: "USD" }).noindex,
    ).toBe(true);
  });
  test("normalizes base pagination while keeping each later page self canonical", () => {
    const values = {
      market: "GLOBAL",
      currency: "USD",
      page: "1",
      sort: "RECOMMENDED",
      availability: "ALL",
    };
    expect(createSeoIdentity("en", "gifts", undefined, values)).toEqual({
      canonicalPath: "/en/gifts?market=GLOBAL&currency=USD",
      noindex: false,
    });
    expect(
      createSeoIdentity("en", "gifts", undefined, { ...values, page: "2" }),
    ).toEqual({
      canonicalPath: "/en/gifts?market=GLOBAL&currency=USD&page=2",
      noindex: false,
    });
  });
  test.each([
    { sort: "PRICE_DESC" },
    { category: "flowers" },
    { availability: "AVAILABLE" },
    { priceMinMinor: "1" },
    { pageSize: "48" },
  ])("filter projections stay noindex: %j", (filter) => {
    expect(
      createSeoIdentity("en", "gifts", undefined, {
        market: "GLOBAL",
        currency: "USD",
        ...filter,
      }).noindex,
    ).toBe(true);
  });
  test.each([
    { token: "private" },
    { cart: "private" },
    { paymentAttempt: "private" },
    { q: "private" },
    { unknown: "private" },
    { market: ["GLOBAL", "GLOBAL"] },
    { currency: "<script>" },
  ])("private, unknown or malformed context stays out of SEO: %j", (values) => {
    const identity = createSeoIdentity("en", "gift", "starlight", values);
    expect(identity.noindex).toBe(true);
    expect(identity.canonicalPath).not.toMatch(
      /private|script|token|cart|paymentAttempt|unknown/,
    );
  });
  test("artist anchor and recipient selection do not create indexable duplicates", () => {
    const id = "a1000000-0000-4000-8000-000000000001";
    expect(
      createSeoIdentity("ja", "artists", undefined, { anchorId: id }),
    ).toEqual({ canonicalPath: "/ja/idols", noindex: true });
    expect(
      createSeoIdentity("ja", "gift", "starlight", { idol: id }).noindex,
    ).toBe(true);
  });
  test("alternates are reciprocal and remove an unavailable locale throughout the cluster", () => {
    const live = SUPPORTED_LOCALES.filter((locale) => locale !== "th");
    const paths = live.map((locale) =>
      seoAlternateUrls(
        "https://store.test",
        createSeoIdentity(locale, "gift", "starlight", {
          market: "GLOBAL",
          currency: "USD",
        }),
        live,
      ),
    );
    expect(
      paths.every(
        (value) => JSON.stringify(value) === JSON.stringify(paths[0]),
      ),
    ).toBe(true);
    expect(paths[0]).not.toHaveProperty("th");
    expect(paths[0]?.["x-default"]).toBe(
      "https://store.test/en/gifts/starlight?market=GLOBAL&currency=USD",
    );
    expect(
      seoAlternateUrls(
        "https://store.test",
        createSeoIdentity("th", "gift", "starlight", {}),
        live,
      ),
    ).toEqual({});
  });
  test("noncanonical projections never advertise alternates", () => {
    expect(
      seoAlternateUrls(
        "https://store.test",
        createSeoIdentity("en", "artists", undefined, { token: "private" }),
        SUPPORTED_LOCALES,
      ),
    ).toEqual({});
  });
});
