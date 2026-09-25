import {
  publicRevalidationHeaders,
  publicRevalidationParameter,
} from "./public-revalidation-openapi.js";
import { z } from "zod";
import {
  publicationRevisionCommandSchema,
  publicationRetryCommandSchema,
  publicationStatusCommandSchema,
} from "./publication-runtime.js";
import { publishedContentLocatorSchema } from "./published-content.js";
import { supportedLocaleSchema } from "./locale.js";

type JsonObject = Record<string, unknown>;
const adminRoutes = [
  ["validate", "VALIDATE", publicationRevisionCommandSchema],
  ["publish", "PUBLISH", publicationRevisionCommandSchema],
  ["rollback", "ROLLBACK", publicationRevisionCommandSchema],
  ["status", "STATUS", publicationStatusCommandSchema],
  ["retry", "RETRY_PURGE", publicationRetryCommandSchema],
] as const;
const publicRoutes = [
  ["/idols/{handle}", "IDOL", "readPublishedIdol"],
  ["/gifts/{handle}", "GIFT", "readPublishedGift"],
  ["/homepage", "HOMEPAGE", "readPublishedHomepage"],
  ["/policies/{policyKey}", "POLICY", "readPublishedPolicy"],
  ["/media/{mediaAssetId}", "MEDIA_METADATA", "readPublishedMedia"],
] as const;
function jsonSchema(schema: z.ZodType): JsonObject {
  const result = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
  }) as JsonObject;
  delete result["$schema"];
  return result;
}
function responses(privateRoute: boolean): JsonObject {
  const statuses = privateRoute
    ? ["200", "400", "401", "403", "404", "409", "413", "503"]
    : ["200", "304", "400", "404", "503"];
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        description:
          status === "200"
            ? "Strict public content or authorized publication result."
            : status === "304"
              ? "Unchanged anonymous representation after fresh validation; no response body."
              : "Safe rejection without credentials, provider references or internal proof.",
        headers: {
          ...(privateRoute
            ? {
                "Cache-Control": {
                  schema: { type: "string", const: "private, no-store" },
                },
              }
            : publicRevalidationHeaders(
                status === "200" ? 200 : status === "304" ? 304 : "FAILURE",
              )),
          "X-Robots-Tag": {
            schema: { type: "string", const: "noindex, nofollow" },
          },
          "Referrer-Policy": {
            schema: { type: "string", const: "no-referrer" },
          },
        },
        ...(status === "304"
          ? {}
          : {
              content: {
                "application/json": {
                  schema: {
                    $ref: `#/components/schemas/${privateRoute ? "PublicationRuntimeResponse" : "CurrentPublishedContentResponse"}`,
                  },
                },
              },
            }),
      },
    ]),
  );
}
function concurrencyDescription(
  action: (typeof adminRoutes)[number][1],
): string {
  if (action === "STATUS") return "not-applicable";
  if (action === "RETRY_PURGE")
    return "expectedVersion is the selected purge job version.";
  return "expectedVersion is the current publication head version; 0 means no publication. expectedContentHash binds the canonical snapshot.";
}

export function publicationRuntimePaths(): JsonObject {
  const paths: JsonObject = {};
  for (const [path, action, schema] of adminRoutes) {
    const body = jsonSchema(schema);
    const properties = body["properties"] as JsonObject;
    const idempotencySchema = properties["idempotencyKey"];
    delete properties["action"];
    delete properties["idempotencyKey"];
    body["required"] = (body["required"] as string[]).filter(
      (key) => key !== "action" && key !== "idempotencyKey",
    );
    const mutation = action !== "STATUS";
    paths[`/api/v1/admin/content/publication/${path}`] = {
      post: {
        operationId: `${path}ContentPublication`,
        summary: `${path} content publication`,
        description:
          "Requires a current canonical session, MFA and all seven locale grants. VALIDATE stores VALIDATED state and returns its new contentHash; PUBLISH must use that hash. PUBLISH and ROLLBACK atomically commit the manifest, current head and seven durable locale purge jobs. STATUS separates publication commit from purge completion. RETRY creates a new generation for a failed purge job. All query strings and unknown body fields are rejected; this surface does not issue sessions.",
        security: [{ AdminSession: [], AdminCsrf: [] }],
        "x-fan-support-rbac": mutation ? "content.publish" : "content.read",
        "x-fan-support-concurrency": concurrencyDescription(action),
        "x-fan-support-audit-reason": mutation
          ? "reasonCode"
          : "not-applicable",
        "x-fan-support-idempotency": mutation
          ? "Same actor, operation, key and body returns the original safe result after current authorization."
          : "not-applicable",
        parameters: [
          {
            name: "Origin",
            in: "header",
            required: true,
            schema: { type: "string", format: "uri" },
          },
          ...(mutation
            ? [
                {
                  name: "Idempotency-Key",
                  in: "header",
                  required: true,
                  schema: idempotencySchema,
                },
              ]
            : []),
        ],
        requestBody: {
          required: true,
          "x-fan-support-max-body-bytes": 64 * 1024,
          content: { "application/json": { schema: body } },
        },
        responses: responses(true),
      },
    };
  }
  for (const [path, kind, operationId] of publicRoutes) {
    const locator = publishedContentLocatorSchema.options.find(
      (option) => option.shape.kind.value === kind,
    )!;
    const properties = jsonSchema(locator)["properties"] as JsonObject;
    paths[`/api/v1${path}`] = {
      get: {
        operationId,
        summary: "Read the current published content in one explicit locale",
        description:
          "Anonymous revalidated read from the current PostgreSQL publication head and manifest. Exactly one supported locale query is required; other query fields, duplicate locale and client revision selection are rejected. Accept-Language does not select or change content. Responses contain safe presentation fields only; aliases and gift details are resolved from the pinned manifest.",
        security: [],
        parameters: [
          publicRevalidationParameter(),
          ...Object.entries(properties)
            .filter(([name]) => name !== "kind")
            .map(([name, schema]) => ({
              name,
              in: "path",
              required: true,
              schema,
            })),
          {
            name: "locale",
            in: "query",
            required: true,
            schema: jsonSchema(supportedLocaleSchema),
          },
        ],
        responses: responses(false),
      },
    };
  }
  return paths;
}
