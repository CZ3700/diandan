import { z } from "zod";
import {
  adminContentCommandSchema,
  contentPreviewRequestSchema,
} from "./admin-content.js";
type JsonObject = Record<string, unknown>;
const routes = [
  ["/reviews/read", "READ_REVIEW", "content.read"],
  ["/drafts/read", "READ_DRAFT", "content.read"],
  ["/drafts/aliases", "CREATE_IDOL_ALIASES", "content.edit"],
  ["/drafts/gift-details", "CREATE_GIFT_DETAILS", "content.edit"],
  ["/reviews/submit", "SUBMIT_REVIEW", "content.edit"],
  ["/reviews/approve", "APPROVE_REVIEW", "content.translation.review"],
  ["/preview/issue", "ISSUE_PREVIEW", "content.preview"],
  ["/preview/revoke", "REVOKE_PREVIEW", "content.preview"],
] as const;
function schema(value: z.ZodType): JsonObject {
  const body = z.toJSONSchema(value, {
    target: "draft-2020-12",
    io: "input",
  }) as JsonObject;
  delete body["$schema"];
  return body;
}
function responses(response: string): JsonObject {
  return Object.fromEntries(
    ["200", "400", "401", "403", "404", "409", "413", "415", "503"].map(
      (status) => [
        status,
        {
          description:
            status === "200"
              ? "Authorized result. Preview tokens are returned once only."
              : "Safe rejection; no operation-specific or provider details are exposed.",
          headers: {
            "Cache-Control": {
              schema: { type: "string", const: "private, no-store" },
            },
            "X-Robots-Tag": {
              schema: { type: "string", const: "noindex, nofollow" },
            },
            "Referrer-Policy": {
              schema: { type: "string", const: "no-referrer" },
            },
          },
          content: {
            "application/json": {
              schema: {
                $ref: `#/components/schemas/${status === "200" ? response : "AdminContentFailure"}`,
              },
            },
          },
        },
      ],
    ),
  );
}
export function adminContentPaths(): JsonObject {
  const paths: JsonObject = {};
  for (const [path, action, permission] of routes) {
    const source = adminContentCommandSchema.options.find(
      (option) => option.shape.action.value === action,
    )!;
    const rendered = schema(source);
    const properties = rendered["properties"] as JsonObject;
    const required = rendered["required"] as string[];
    const idempotent = "idempotencyKey" in properties;
    const idempotencySchema = properties["idempotencyKey"];
    delete properties["action"];
    delete properties["idempotencyKey"];
    rendered["required"] = required.filter(
      (key) => key !== "action" && key !== "idempotencyKey",
    );
    paths["/api/v1/admin/content" + path] = {
      post: {
        operationId: action.toLowerCase(),
        summary: `${action.toLowerCase().replaceAll("_", " ")} for content extensions`,
        description:
          "Explicitly composed admin API. Requires canonical platform session, MFA, current permissions and assigned locales in the same transaction. Production OIDC login is not enabled by this surface. Unknown properties and query strings are rejected.",
        security: [{ AdminSession: [], AdminCsrf: [] }],
        "x-fan-support-rbac": permission,
        "x-fan-support-concurrency": action.startsWith("CREATE_")
          ? "expectedVersion=1 means no extension exists"
          : action === "SUBMIT_REVIEW" || action === "APPROVE_REVIEW"
            ? "expectedVersion is the canonical review sequence; hashes must still match"
            : "not-applicable",
        "x-fan-support-audit-reason":
          action === "READ_DRAFT" || action === "READ_REVIEW"
            ? "not-applicable"
            : action.startsWith("CREATE_")
              ? "draft.reasonCode"
              : "reasonCode",
        "x-fan-support-idempotency": idempotent
          ? "same actor/operation/key/body returns the original safe result reference"
          : action === "ISSUE_PREVIEW"
            ? "preview issue creates a new credential on each request; lost raw tokens cannot be recovered"
            : "not-applicable",
        parameters: [
          {
            name: "Origin",
            in: "header",
            required: true,
            schema: { type: "string", format: "uri" },
          },
          ...(idempotent
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
          "x-fan-support-max-body-bytes": 16 * 1024 * 1024,
          content: { "application/json": { schema: rendered } },
        },
        responses: responses("AdminContentResponse"),
      },
    };
  }
  paths["/api/v1/content-preview/read"] = {
    post: {
      operationId: "readContentPreview",
      summary:
        "Read the exact locale and revision covered by a preview credential",
      description:
        "Bearer preview credential appears only in JSON body; no cookie, URL credential, shared cache, fallback or write capability. Issuer session, MFA, permission and locale assignment must remain valid.",
      security: [],
      parameters: [
        {
          name: "Origin",
          in: "header",
          required: true,
          schema: { type: "string", format: "uri" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: schema(contentPreviewRequestSchema) },
        },
      },
      responses: responses("ContentPreviewResponse"),
    },
  };
  return paths;
}
