import { z } from "zod";
import { giftBrowseQuerySchema } from "./gift-browse.js";
import {
  publicRevalidationHeaders,
  publicRevalidationParameter,
} from "./public-revalidation-openapi.js";

/** Discovery content has no transaction context or offer semantics. */
export function giftBrowsePaths(): Record<string, unknown> {
  const schema = z.toJSONSchema(giftBrowseQuerySchema, {
    target: "draft-2020-12",
    io: "input",
  });
  const parameters = Object.entries(schema.properties ?? {})
    .filter(([name]) => name !== "schemaVersion")
    .map(([name, value]) => ({
      name: name === "idolId" ? "idol" : name,
      in: "query",
      required: schema.required?.includes(name) ?? false,
      schema: value,
    }));
  return {
    "/api/v1/gift-browse": {
      get: {
        operationId: "browsePublishedGifts",
        summary:
          "Browse published gift content before choosing a market or currency",
        security: [],
        description:
          "Parameters must occur once. Unknown keys and noncanonical numbers are rejected. Published content is paginated from one database snapshot. No prices, offers or shopping context are inferred or changed.",
        parameters: [...parameters, publicRevalidationParameter()],
        responses: Object.fromEntries(
          [
            ["200", "Published gift content from one database snapshot."],
            [
              "304",
              "Unchanged anonymous content after fresh validation; no response body.",
            ],
            ["400", "Invalid query. Correct the request before retrying."],
            ["404", "The requested catalog anchor is unavailable."],
            ["409", "The catalog changed. Restart browsing."],
            [
              "503",
              "Published content is temporarily unavailable. Retry the same query later.",
            ],
          ].map(([status, description]) => [
            status,
            {
              description,
              headers: publicRevalidationHeaders(
                status === "200" ? 200 : status === "304" ? 304 : "FAILURE",
              ),
              ...(status === "304"
                ? {}
                : {
                    content: {
                      "application/json": {
                        schema: {
                          $ref: "#/components/schemas/GiftBrowseResponse",
                        },
                      },
                    },
                  }),
            },
          ]),
        ),
      },
    },
  };
}
