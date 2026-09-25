import {
  publicNotModifiedResponse,
  publicRevalidationHeaders,
  publicRevalidationParameter,
} from "./public-revalidation-openapi.js";
export function storefrontSeoPaths() {
  const response = (description: string, success = false) => ({
    description,
    headers: publicRevalidationHeaders(success ? 200 : "FAILURE"),
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/StorefrontSeoResponse" },
      },
    },
  });
  const responses = {
    200: response("Current proven SEO representation.", true),
    304: publicNotModifiedResponse(),
    400: response("Invalid query or canonical cursor."),
    404: response("Entity has no current publication."),
    409: response(
      "Catalogue changed; restart enumeration from a fresh version.",
    ),
    503: response(
      "Publication proof or infrastructure unavailable; never an empty successful catalogue.",
    ),
  };
  const validator = publicRevalidationParameter();
  const cursor = {
    name: "cursor",
    in: "query",
    required: false,
    schema: {
      type: "string",
      minLength: 1,
      maxLength: 768,
      pattern: "^[A-Za-z0-9_-]+$",
    },
  };
  return {
    "/api/v1/storefront-seo/entity": {
      get: {
        operationId: "readStorefrontSeoEntity",
        summary: "Read proven indexable locales for one current publication",
        description:
          "Send kind and only its locator field: HOMEPAGE has none, IDOL/GIFT require handle, POLICY requires policyKey. Every locale belongs to the same publication with publication time as lastModified. Unknown/duplicate query fields are rejected. Locale does not infer market. Private requests are never shared or conditionally served.",
        security: [],
        parameters: [
          {
            name: "kind",
            in: "query",
            required: true,
            schema: {
              type: "string",
              enum: ["HOMEPAGE", "IDOL", "GIFT", "POLICY"],
            },
          },
          {
            name: "handle",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
          {
            name: "policyKey",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
          validator,
        ],
        responses,
      },
    },
    "/api/v1/storefront-seo/index": {
      get: {
        operationId: "readStorefrontSeoIndex",
        summary: "Read one bounded publication-verified sitemap window",
        description:
          "At most 20 stable owner keys are hydrated within one PostgreSQL snapshot. The cursor binds catalogue version and keyset position. Continue endCursor while hasNextPage; no directory-window or market filtering is applied. A failed proof fails the request without returning a partial successful window.",
        security: [],
        parameters: [cursor, validator],
        responses,
      },
    },
    "/api/v1/storefront-seo/catalog": {
      get: {
        operationId: "readStorefrontSeoCatalog",
        summary: "Read bounded lightweight sitemap shard descriptors",
        description:
          "At most 50 descriptors are returned without content hydration; each descriptor cursor reads an INDEX window of at most 20 entities, including the version-bound first window. Read every page until hasNextPage is false; never claim a truncated root sitemap is complete. A descriptor describes current candidates, while INDEX performs full publication validation.",
        security: [],
        parameters: [cursor, validator],
        responses,
      },
    },
  };
}
