import { expect, test } from "vitest";
import { giftBrowsePaths } from "./gift-browse-openapi.js";
import { contractArtifactRegistry } from "./artifact-registry.js";

test("documents a separate public read with no commerce selection and explicit privacy/revalidation", () => {
  const route = giftBrowsePaths()["/api/v1/gift-browse"] as {
    get: {
      parameters: { name: string; required: boolean }[];
      responses: Record<string, unknown>;
      security: unknown[];
    };
  };
  expect(route.get.security).toEqual([]);
  expect(route.get.parameters.map((parameter) => parameter.name)).toEqual([
    "locale",
    "page",
    "pageSize",
    "category",
    "idol",
    "If-None-Match",
  ]);
  expect(
    route.get.parameters.find((parameter) => parameter.name === "locale")
      ?.required,
  ).toBe(true);
  expect(route.get.responses["304"]).not.toHaveProperty("content");
  for (const name of [
    "GiftBrowseQuery",
    "GiftBrowseResponse",
    "GiftBrowseReadCommand",
    "GiftBrowseSnapshot",
  ])
    expect(contractArtifactRegistry.some((entry) => entry.name === name)).toBe(
      true,
    );
});
