import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { createDefaultStorefrontBrandView } from "@fan-support/contracts";
import { BrandingProvider, useStorefrontBrand } from "./branding-provider";

function Probe() {
  const { brand, source, version } = useStorefrontBrand();
  return <output>{JSON.stringify({ brand, source, version })}</output>;
}

test("without a brand read every page renders the contract default brand", () => {
  const html = renderToStaticMarkup(
    <BrandingProvider result={null}>
      <Probe />
    </BrandingProvider>,
  );
  const rendered = JSON.parse(
    html.replace(/^<output>|<\/output>$/gu, "").replaceAll("&quot;", '"'),
  );
  expect(rendered).toEqual({
    brand: createDefaultStorefrontBrandView(),
    source: "DEFAULT",
    version: 0,
  });
});

test("the root-layout provider takes only types from the contracts barrel", async () => {
  // A runtime import pulls the contracts' Zod schemas into every page's JavaScript.
  const source = await readFile(
    new URL("./branding-provider.tsx", import.meta.url),
    "utf8",
  );
  const imports = [
    ...source.matchAll(
      /import\s+(type\s+)?[^;]*?from\s+"@fan-support\/contracts"/gu,
    ),
  ];
  expect(imports.length).toBeGreaterThan(0);
  expect(imports.every((match) => match[1] !== undefined)).toBe(true);
});
