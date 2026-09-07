import * as homepageModule from "./storefront-homepage-openapi.js";
import { expect, test } from "vitest";

test("homepage operation documents only locale and the safe public response", async () => {
  const paths = homepageModule.storefrontHomepagePaths();
  const operation = paths["/api/v1/storefront-homepage"].get;
  expect(
    operation.parameters.filter((parameter) => parameter.in === "query"),
  ).toEqual([
    {
      name: "locale",
      in: "query",
      required: true,
      schema: { $ref: "#/components/schemas/SupportedLocale" },
    },
  ]);
  expect(operation.responses[200].content["application/json"].schema).toEqual({
    $ref: "#/components/schemas/StorefrontHomepageResponse",
  });
  expect(operation.security).toEqual([]);
});
