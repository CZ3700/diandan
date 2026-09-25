import { expect, test } from "vitest";
import { publicationRuntimePaths } from "./publication-runtime-openapi.js";
import { giftCommercePaths } from "./gift-commerce-openapi.js";
import { storefrontHomepagePaths } from "./storefront-homepage-openapi.js";
import { storefrontCommercePaths } from "./storefront-commerce-openapi.js";
import { catalogDirectoryPaths } from "./catalog-directory-openapi.js";
import { giftBrowsePaths } from "./gift-browse-openapi.js";

type Response = {
  headers: Record<string, { schema: { const?: string; enum?: string[] } }>;
  content?: { "application/json": { schema: { $ref: string } } };
};
type Path = {
  get?: {
    parameters: { name: string; in: string; required: boolean }[];
    responses: Record<string, Response>;
    security: unknown;
  };
  post?: { responses: Record<string, Response> };
};
const cache = "public, max-age=0, s-maxage=0, must-revalidate";
test("all twelve public reads document zero-TTL revalidation, credential privacy and no-body 304", () => {
  const paths = {
    ...publicationRuntimePaths(),
    ...giftCommercePaths(),
    ...storefrontHomepagePaths(),
    ...storefrontCommercePaths(),
    ...catalogDirectoryPaths(),
    ...giftBrowsePaths(),
  } as Record<string, Path>;
  const publicPaths = Object.entries(paths).filter(([, value]) => value.get);
  expect(publicPaths).toHaveLength(12);
  for (const [path, { get }] of publicPaths) {
    expect(get!.security).toEqual([]);
    expect(get!.parameters).toContainEqual(
      expect.objectContaining({
        name: "If-None-Match",
        in: "header",
        required: false,
      }),
    );
    expect(get!.responses["200"]!.headers["Cache-Control"]!.schema).toEqual({
      type: "string",
      enum: [cache, "private, no-store"],
    });
    expect(get!.responses["200"]!.headers).toHaveProperty("ETag");
    expect(
      get!.responses["200"]!.content!["application/json"].schema.$ref,
      path,
    ).toMatch(/^#\/components\/schemas\/[A-Za-z]+Response$/u);
    expect(get!.responses["304"], path).toBeDefined();
    expect(get!.responses["304"]).not.toHaveProperty("content");
    expect(get!.responses["304"]!.headers["Cache-Control"]!.schema).toEqual({
      type: "string",
      const: cache,
    });
    for (const [status, response] of Object.entries(get!.responses)) {
      if (["200", "304"].includes(status)) continue;
      expect(response.headers["Cache-Control"]!.schema, path + status).toEqual({
        type: "string",
        enum: ["no-store", "private, no-store"],
      });
      expect(response.headers).not.toHaveProperty("ETag");
      expect(response.content).toEqual(get!.responses["200"]!.content);
    }
  }
  for (const { post } of Object.values(paths)) {
    if (!post) continue;
    expect(post.responses).not.toHaveProperty("304");
    for (const response of Object.values(post.responses)) {
      expect(response.headers["Cache-Control"]!.schema).toEqual({
        type: "string",
        const: "private, no-store",
      });
      expect(response.headers).not.toHaveProperty("ETag");
    }
  }
});
