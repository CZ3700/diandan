import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { storefrontLogoViewSchema } from "@fan-support/contracts";
import type * as Brand from "./site-brand";
import type * as Provider from "./branding-provider";

const logo = storefrontLogoViewSchema.parse({
  assetId: "9623c137-83d3-46de-9c8c-5c3b56a62ab3",
  url: `https://media.example.invalid/processed/v1/9623c137-83d3-46de-9c8c-5c3b56a62ab3/${"a".repeat(64)}.webp`,
  width: 900,
  height: 240,
});

async function implementation() {
  let brand: typeof Brand | undefined;
  let provider: typeof Provider | undefined;
  try {
    brand = await import("./site-brand");
    provider = await import("./branding-provider");
  } catch {
    // The first red case precedes the branding implementation.
  }
  expect(brand?.SiteBrand).toBeTypeOf("function");
  expect(provider?.BrandingProvider).toBeTypeOf("function");
  return {
    SiteBrand: brand!.SiteBrand,
    BrandingProvider: provider!.BrandingProvider,
  };
}

test("published logos retain independent light and dark slots with an accessible site name", async () => {
  const { SiteBrand, BrandingProvider } = await implementation();
  const html = renderToStaticMarkup(
    <BrandingProvider
      result={{
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_BRAND",
        source: "PUBLISHED",
        version: 2,
        publicationId: "a9394969-50f7-4ba1-a02e-82ba8b1f04bf",
        brand: { schemaVersion: 1, lightLogo: logo, darkLogo: null },
      }}
    >
      <SiteBrand name="Kiki Studio" />
    </BrandingProvider>,
  );
  expect(html).toContain('role="img" aria-label="Kiki Studio"');
  expect(html).toContain('data-brand-source="PUBLISHED"');
  expect(html).toContain('data-brand-version="2"');
  expect(html.match(/<img /gu)).toHaveLength(1);
  expect(html).toContain("/_next/image?url=");
  expect(html).not.toContain(`src="${logo.url}"`);
  expect(html).toContain('data-brand-scheme="LIGHT"');
  expect(html).toContain('data-brand-scheme="DARK"');
  expect(html).toContain('width="900" height="240"');
  const darkSlot = html.slice(html.indexOf('data-brand-scheme="DARK"'));
  expect(darkSlot).toContain("Kiki Studio");
  expect(darkSlot).not.toContain("<img");
});

test("unavailable branding and consumers without a provider retain text without claiming publication", async () => {
  const { SiteBrand, BrandingProvider } = await implementation();
  const html = renderToStaticMarkup(
    <BrandingProvider
      result={{
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      }}
    >
      <SiteBrand name="Long Studio" />
    </BrandingProvider>,
  );
  expect(html).toContain('data-brand-source="FALLBACK"');
  expect(html).not.toContain("data-brand-version");
  expect(html).not.toContain("<img");
  expect(html).toContain("Long Studio");
  const standalone = renderToStaticMarkup(
    <SiteBrand name="Unconfigured Studio" />,
  );
  expect(standalone).toContain("Unconfigured Studio");
  expect(standalone).not.toContain("<img");
});
