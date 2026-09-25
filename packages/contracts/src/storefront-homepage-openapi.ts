import {
  publicNotModifiedResponse,
  publicRevalidationHeaders,
  publicRevalidationParameter,
} from "./public-revalidation-openapi.js";
export function storefrontHomepagePaths() {
  const response = (description: string, success = false) => ({
    description,
    headers: publicRevalidationHeaders(success ? 200 : "FAILURE"),
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/CurrentStorefrontHomepageResponse",
        },
      },
    },
  });
  return {
    "/api/v1/storefront-homepage": {
      get: {
        operationId: "readStorefrontHomepage",
        summary:
          "Read the current published homepage and its bounded artist and gift references",
        description:
          "One PostgreSQL snapshot verifies every returned publication. A missing hero fails closed; unavailable featured slots retain their published identities. No prices or market are inferred from locale. Unknown or duplicate query parameters are rejected.",
        security: [],
        parameters: [
          publicRevalidationParameter(),
          {
            name: "locale",
            in: "query",
            required: true,
            schema: { $ref: "#/components/schemas/SupportedLocale" },
          },
        ],
        responses: {
          200: response(
            "Published homepage and referenced public views.",
            true,
          ),
          304: publicNotModifiedResponse(),
          400: response("Invalid query; send one canonical locale."),
          404: response("No current published homepage."),
          503: response("Homepage or required hero temporarily unavailable."),
        },
      },
    },
  };
}
