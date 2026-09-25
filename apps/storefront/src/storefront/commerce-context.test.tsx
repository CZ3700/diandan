import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { storefrontContextResponseSchema } from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";
import {
  isMarketAvailable,
  MarketChoices,
  PolicyLinks,
} from "./commerce-context";

const context = storefrontContextResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "STOREFRONT_CONTEXT",
  markets: [
    { market: "TEST_A", currencies: ["USD", "JPY"] },
    { market: "TEST_B", currencies: ["EUR"] },
  ],
  policies: [
    { policyKey: "studio-terms-v2", kind: "TERMS" },
    { policyKey: "studio-refunds-v2", kind: "REFUND" },
  ],
});
const empty = storefrontContextResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "STOREFRONT_CONTEXT",
  markets: [],
  policies: [],
});
const failure = storefrontContextResponseSchema.parse({
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "COMMERCE_UNAVAILABLE",
});

function links(html: string) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+)"/gu)].map(
    (match) =>
      new URL(
        match[1]!.replaceAll("&amp;", "&"),
        "https://storefront.example.test",
      ),
  );
}

describe("canonical commerce context presentation", () => {
  it("names in-content policy navigation from its section heading", () => {
    const html = renderToStaticMarkup(
      <PolicyLinks
        locale="en"
        copy={copy}
        context={context}
        contextQuery=""
        labelledBy="gift-delivery-title"
      />,
    );
    expect(html).toContain('aria-labelledby="gift-delivery-title"');
    expect(html).not.toContain("aria-label=");
  });
  it("renders only configured market/currency pairs and never guesses a locale-derived currency", () => {
    const html = renderToStaticMarkup(
      <MarketChoices
        locale="ja"
        copy={copy}
        context={context}
        contextQuery="market=TEST_A&currency=USD"
        headingLevel={1}
      />,
    );
    expect(html).toContain("<h1");
    expect(
      links(html).map((link) => [
        link.searchParams.get("market"),
        link.searchParams.get("currency"),
      ]),
    ).toEqual([
      ["TEST_A", "USD"],
      ["TEST_A", "JPY"],
      ["TEST_B", "EUR"],
    ]);
    expect(html.match(/aria-current="true"/gu)).toHaveLength(1);
    expect(isMarketAvailable(context, "TEST_A", "USD")).toBe(true);
    expect(isMarketAvailable(context, "TEST_A", "EUR")).toBe(false);
    expect(isMarketAvailable(context, "TEST_B", "JPY")).toBe(false);
  });

  it("changing market keeps the current gift and artist while clearing price filters and the old variant", () => {
    const idol = "30000000-0000-4000-8000-000000000001";
    const html = renderToStaticMarkup(
      <MarketChoices
        locale="pt"
        copy={copy}
        context={context}
        path="/gifts/fictional-gift"
        contextQuery={`market=OLD&currency=USD&idol=${idol}&variant=old&page=3&priceMinMinor=100&priceMaxMinor=800&category=FLOWERS&cart=one&cart=two`}
      />,
    );
    for (const link of links(html)) {
      expect(link.pathname).toBe("/pt/gifts/fictional-gift");
      expect(link.searchParams.get("idol")).toBe(idol);
      expect(link.searchParams.getAll("cart")).toEqual(["one", "two"]);
      expect(link.searchParams.get("category")).toBe("FLOWERS");
      for (const key of ["variant", "page", "priceMinMinor", "priceMaxMinor"])
        expect(link.searchParams.has(key)).toBe(false);
    }
  });

  it.each([
    [empty, copy.marketUnavailable],
    [failure, copy.contentErrorBody],
  ] as const)(
    "empty or failed configuration offers no invented destination",
    (value, message) => {
      const html = renderToStaticMarkup(
        <MarketChoices
          locale="en"
          copy={copy}
          context={value}
          contextQuery=""
        />,
      );
      expect(html).toContain(message);
      expect(links(html)).toEqual([]);
      expect(html).not.toContain("COMMERCE_UNAVAILABLE");
      expect(isMarketAvailable(value, "TEST_A", "USD")).toBe(false);
    },
  );

  it("policy navigation uses actual published keys, localized labels, and escaped context", () => {
    const labels = {
      ...copy,
      policyTerms: "Terms <script>test</script> & conditions",
    };
    const html = renderToStaticMarkup(
      <PolicyLinks
        locale="en"
        copy={labels}
        context={context}
        contextQuery="market=TEST_A&currency=USD&note=%22%3E%3Cscript%3Etest%3C%2Fscript%3E"
      />,
    );
    expect(links(html).map((link) => link.pathname)).toEqual([
      "/en/policies/studio-terms-v2",
      "/en/policies/studio-refunds-v2",
    ]);
    expect(html).toContain(
      "Terms &lt;script&gt;test&lt;/script&gt; &amp; conditions",
    );
    expect(html).toContain(copy.policyRefund);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("/policies/privacy");
    expect(
      links(html).every((link) => link.searchParams.get("market") === "TEST_A"),
    ).toBe(true);
  });

  it.each([empty, failure])(
    "omits policy links when no published keys are available",
    (value) => {
      expect(
        renderToStaticMarkup(
          <PolicyLinks
            locale="en"
            copy={copy}
            context={value}
            contextQuery=""
          />,
        ),
      ).toBe("");
    },
  );
});
