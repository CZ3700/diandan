import { z } from "zod";
import {
  publicRevalidationHeaders,
  publicRevalidationParameter,
} from "./public-revalidation-openapi.js";
import {
  giftDiscoveryQuerySchema,
  idolDiscoveryQuerySchema,
} from "./catalog-discovery.js";

type JsonObject = Record<string, unknown>;
/** HTTP inputs omit the envelope version, which the transport supplies. */
export function catalogDirectoryPaths(): JsonObject {
  return Object.fromEntries(
    [
      [
        "/api/v1/idols",
        "discoverIdols",
        idolDiscoveryQuerySchema,
        "IdolDirectoryResponse",
      ],
      [
        "/api/v1/gifts",
        "discoverGifts",
        giftDiscoveryQuerySchema,
        "GiftDirectoryResponse",
      ],
    ].map(([path, operationId, schema, response]) => {
      const rendered = z.toJSONSchema(schema as z.ZodType, {
        target: "draft-2020-12",
        io: "input",
      }) as JsonObject;
      const required = rendered["required"] as string[];
      const properties = rendered["properties"] as JsonObject;
      const parameters = Object.entries(properties)
        .filter(([name]) => name !== "schemaVersion")
        .map(([name, value]) => ({
          name: name === "idolId" ? "idol" : name,
          in: "query",
          required: required.includes(name),
          schema: value,
        }));
      const responses = Object.fromEntries(
        [
          ["200", "Published directory from one database snapshot."],
          [
            "304",
            "Unchanged anonymous directory after fresh validation; no response body.",
          ],
          [
            "400",
            "Invalid query or cursor. Correct the request before retrying.",
          ],
          ["404", "The artist anchor is not visible in this query."],
          [
            "409",
            "The directory changed. Restart browsing without the old cursor.",
          ],
          [
            "503",
            "The directory is temporarily unavailable. Retry the same query later.",
          ],
        ]
          .filter(
            ([status]) =>
              path === "/api/v1/idols" ||
              (status !== "404" && status !== "409"),
          )
          .map(([status, description]) => [
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
                        schema: { $ref: `#/components/schemas/${response}` },
                      },
                    },
                  }),
            },
          ]),
      );
      return [
        path,
        {
          get: {
            operationId,
            summary:
              path === "/api/v1/idols"
                ? "Search or browse published artists"
                : "Browse published gifts in an explicit market and currency",
            security: [],
            parameters: [...parameters, publicRevalidationParameter()],
            responses,
            description:
              "Parameters must occur once. Unknown keys and noncanonical numeric values are rejected. Language never selects market or currency; prices are discovery hints and must be revalidated during checkout.",
          },
        },
      ];
    }),
  );
}
