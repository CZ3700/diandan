import {
  publicNotModifiedResponse,
  publicRevalidationHeaders,
  publicRevalidationParameter,
} from "./public-revalidation-openapi.js";
export function storefrontCommercePaths() {
  const response = (schema: string, description: string, success = false) => ({
    description,
    headers: publicRevalidationHeaders(success ? 200 : "FAILURE"),
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schema}` },
      },
    },
  });
  const context = (description: string, success = false) =>
    response("StorefrontContextResponse", description, success);
  const gift = (description: string, success = false) =>
    response("StorefrontGiftResponse", description, success);
  return {
    "/api/v1/storefront-context": {
      get: {
        operationId: "readStorefrontContext",
        summary:
          "Read currently active market and currency scopes and proven published policy links",
        description:
          "Only current effective PostgreSQL prices select scopes. Policy links require their actual current publication proof. No country, currency or market is inferred from locale. Unknown and duplicate query parameters are rejected.",
        security: [],
        parameters: [publicRevalidationParameter()],
        responses: {
          200: context(
            "Public scope and policy configuration; empty is valid.",
            true,
          ),
          304: publicNotModifiedResponse(),
          400: context("No query parameters are accepted."),
          503: context("Commerce configuration unavailable."),
        },
      },
    },
    "/api/v1/storefront-gifts/{handle}": {
      get: {
        operationId: "readStorefrontGift",
        summary:
          "Read a published gift with current variant prices, stock and recipient eligibility",
        description:
          "A SERIALIZABLE PostgreSQL snapshot binds immutable publication proof to current price, stock and operating state. Tracked stock is the maximum available quantity at one active location. Procurement and preorder do not claim physical stock. No selected recipient permits browsing only. This read never reserves stock or creates a cart or payment. Unknown or duplicate query parameters are rejected.",
        security: [],
        parameters: [
          publicRevalidationParameter(),
          {
            name: "handle",
            in: "path",
            required: true,
            schema: { $ref: "#/components/schemas/Slug" },
          },
          {
            name: "locale",
            in: "query",
            required: true,
            schema: { $ref: "#/components/schemas/SupportedLocale" },
          },
          {
            name: "market",
            in: "query",
            required: true,
            schema: { $ref: "#/components/schemas/Market" },
          },
          {
            name: "currency",
            in: "query",
            required: true,
            schema: { $ref: "#/components/schemas/Currency" },
          },
          {
            name: "idol",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/IdolId" },
          },
        ],
        responses: {
          200: gift("Published gift and current typed variant offers.", true),
          304: publicNotModifiedResponse(),
          400: gift("Invalid query; locale, market and currency are required."),
          404: gift("No current published gift."),
          409: gift(
            "The selected market and currency scope is not currently available.",
          ),
          503: gift(
            "Current content or required commerce evidence unavailable.",
          ),
        },
      },
    },
  };
}
