import { expect, test } from "vitest";
test("SEO documents three bounded read operations and conditional responses without a 304 body", async () => {
  const module = await import("./storefront-seo-openapi.js").catch(
    () => undefined,
  );
  expect(module, "SEO OpenAPI paths must exist").toBeDefined();
  if (!module) return;
  const paths = module.storefrontSeoPaths();
  expect(Object.keys(paths)).toEqual([
    "/api/v1/storefront-seo/entity",
    "/api/v1/storefront-seo/index",
    "/api/v1/storefront-seo/catalog",
  ]);
  for (const path of Object.values(paths)) {
    expect(path.get.security).toEqual([]);
    expect(
      path.get.responses[200].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/StorefrontSeoResponse");
    expect(path.get.responses[304]).not.toHaveProperty("content");
    expect(path.get.responses[304].headers["Cache-Control"].schema).toEqual({
      type: "string",
      const: "public, max-age=0, s-maxage=0, must-revalidate",
    });
    expect(path.get.responses[503].headers["Cache-Control"]!.schema).toEqual({
      type: "string",
      enum: ["no-store", "private, no-store"],
    });
    expect(path.get.responses[409].description).toContain("changed");
    expect(path.get.parameters.map((row) => row.name)).not.toContain("locale");
    expect(path.get.parameters.map((row) => row.name)).not.toContain("market");
  }
  expect(paths["/api/v1/storefront-seo/catalog"].get.description).toContain(
    "every",
  );
});
