import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createDefaultStorefrontNavigation,
  type StorefrontNavigation,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { NavigationProvider } from "./navigation-provider";
import { SiteNavigation } from "./site-navigation";
import { SiteFooter } from "./site-footer";
import { storefrontHref } from "./navigation";

test("published order is semantic and footer visibility cannot replace authoritative policy/region nodes", async () => {
  const copy = await loadStorefrontCopy("en");
  const navigation: StorefrontNavigation = {
    ...createDefaultStorefrontNavigation(),
    header: ["GIFTS", "ARTISTS", "HOME"],
    footer: [
      { id: "POLICIES", visible: true },
      { id: "GIFTS", visible: true },
      { id: "ARTISTS", visible: false },
      { id: "DESCRIPTION", visible: true },
      { id: "REGION", visible: true },
    ],
  };
  const html = renderToStaticMarkup(
    <NavigationProvider
      result={{
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_NAVIGATION",
        source: "PUBLISHED",
        navigation,
        version: 2,
        publicationId: "00000000-0000-4000-8000-000000000007",
      }}
    >
      <SiteNavigation
        locale="en"
        copy={copy}
        contextQuery="token=private"
        active="gifts"
        includeOrders
      />
      <SiteFooter
        locale="en"
        copy={copy}
        name="Studio"
        contextQuery="token=private"
        region={<></>}
        policyLinks={
          <a href={storefrontHref("en", "/policies/test-policy")}>Policy</a>
        }
      />
    </NavigationProvider>,
  );
  expect(html.indexOf('data-navigation-target="GIFTS"')).toBeLessThan(
    html.indexOf('data-navigation-target="ARTISTS"'),
  );
  expect(html).toContain('href="/en/gifts" aria-current="page"');
  expect(html).toContain('href="/en/orders/lookup"');
  expect(html).not.toContain("private");
  const footer = html.slice(html.indexOf("<footer"));
  expect(footer.indexOf("/en/policies/test-policy")).toBeLessThan(
    footer.indexOf('data-footer-section="GIFTS"'),
  );
  expect(footer).not.toContain('data-footer-section="DESCRIPTION"');
  expect(footer).not.toContain(copy.giftHandover);
  expect(footer).not.toContain('data-footer-section="ARTISTS"');
  expect(footer).not.toContain("/region");
});

test("unavailable configuration retains essential links with explicit fallback provenance", async () => {
  const copy = await loadStorefrontCopy("en");
  const html = renderToStaticMarkup(
    <NavigationProvider
      result={{
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      }}
    >
      <SiteFooter locale="en" copy={copy} name="Studio" contextQuery="" />
      <SiteNavigation
        locale="en"
        copy={copy}
        contextQuery=""
        active="home"
        includeOrders
      />
    </NavigationProvider>,
  );
  expect(html).toContain('data-navigation-source="FALLBACK"');
  expect(html).not.toContain("data-navigation-version");
  for (const path of ["/en", "/en/idols", "/en/gifts", "/en/orders/lookup"])
    expect(html).toContain(`href="${path}"`);
});
