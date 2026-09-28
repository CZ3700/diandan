import { z } from "zod";
import { storefrontThemeCommandSchema } from "./storefront-theme.js";
type JsonObject = Record<string, unknown>;
function response(name: string, privacy: string) {
  return {
    description:
      "Versioned theme result. No unpublished content or commerce state is included.",
    headers: {
      "Cache-Control": { schema: { type: "string", const: privacy } },
    },
    content: {
      "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
    },
  };
}
export function storefrontThemePaths(): JsonObject {
  const entries = [
    ["read", "READ"],
    ["draft", "SAVE_DRAFT"],
    ["publish", "PUBLISH"],
    ["restore", "RESTORE"],
    ["history", "HISTORY"],
  ] as const;
  return {
    ...Object.fromEntries(
      entries.map(([path, action]) => {
        const schema = storefrontThemeCommandSchema.options.find(
          (candidate) => candidate.shape.action.value === action,
        )!;
        const body = z.toJSONSchema(schema, {
          target: "draft-2020-12",
          io: "input",
        }) as JsonObject;
        delete body["$schema"];
        const properties = body["properties"] as JsonObject,
          key = properties["idempotencyKey"];
        delete properties["action"];
        delete properties["idempotencyKey"];
        body["required"] = (body["required"] as string[]).filter(
          (name) => name !== "action" && name !== "idempotencyKey",
        );
        return [
          `/api/v1/admin/storefront-theme/${path}`,
          {
            post: {
              operationId: `storefrontTheme${path[0]!.toUpperCase()}${path.slice(1)}`,
              summary: `${action.toLowerCase().replaceAll("_", " ")} storefront theme`,
              description:
                "Exact Origin, CSRF and current MFA session required. Theme is non-linguistic metadata and requires the action permission without translation grants. Replays return the original committed state; read again for the latest state. Publications and restores are immutable audited events in the same PostgreSQL transaction. Content, media and commerce revisions are unaffected.",
              "x-fan-support-rbac":
                action === "READ" || action === "HISTORY"
                  ? "content.read"
                  : action === "SAVE_DRAFT"
                    ? "content.edit"
                    : "content.publish",
              security: [{ AdminSession: [], AdminCsrf: [] }],
              parameters: [
                {
                  name: "Origin",
                  in: "header",
                  required: true,
                  schema: { type: "string", format: "uri" },
                },
                ...(key
                  ? [
                      {
                        name: "Idempotency-Key",
                        in: "header",
                        required: true,
                        schema: key,
                      },
                    ]
                  : []),
              ],
              requestBody: {
                required: true,
                "x-fan-support-max-body-bytes": 8192,
                content: { "application/json": { schema: body } },
              },
              responses: Object.fromEntries(
                ["200", "400", "401", "403", "404", "409", "413", "503"].map(
                  (status) => [
                    status,
                    response("StorefrontThemeResponse", "private, no-store"),
                  ],
                ),
              ),
            },
          },
        ];
      }),
    ),
    "/api/v1/storefront/storefront-theme": {
      get: {
        operationId: "readPublicStorefrontTheme",
        summary: "Read the current published storefront theme",
        security: [],
        responses: Object.fromEntries(
          ["200", "400", "503"].map((status) => [
            status,
            response("PublicStorefrontThemeResponse", "no-store"),
          ]),
        ),
      },
    },
  };
}
