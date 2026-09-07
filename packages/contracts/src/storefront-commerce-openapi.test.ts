import { expect, test } from "vitest";
test("storefront commerce documents only read routes with explicit scope and stable public references", async () => {
  const { storefrontCommercePaths } =
    await import("./storefront-commerce-openapi.js");
  const paths = storefrontCommercePaths();
  expect(Object.keys(paths)).toEqual([
    "/api/v1/storefront-context",
    "/api/v1/storefront-gifts/{handle}",
  ]);
  expect(
    paths["/api/v1/storefront-context"].get.parameters.filter(
      (parameter) => parameter.in === "query",
    ),
  ).toEqual([]);
  expect(
    paths["/api/v1/storefront-gifts/{handle}"].get.parameters
      .filter((parameter) => parameter.in !== "header")
      .map((row) => [row.name, row.required]),
  ).toEqual([
    ["handle", true],
    ["locale", true],
    ["market", true],
    ["currency", true],
    ["idol", false],
  ]);
  expect(
    paths["/api/v1/storefront-gifts/{handle}"].get.responses[409].content[
      "application/json"
    ].schema.$ref,
  ).toBe("#/components/schemas/StorefrontGiftResponse");
});
