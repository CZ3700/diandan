import { z } from "zod";
import {
  baseContentCommandSchema,
  baseContentPreviewRequestSchema,
} from "./base-content.js";

type JsonObject = Record<string, unknown>;
const routes = [
  ["read", "READ_REVIEW", "content.read", "readBaseContentReview"],
  ["submit", "SUBMIT_REVIEW", "content.edit", "submitBaseContentReview"],
  [
    "approve",
    "APPROVE_REVIEW",
    "content.translation.review",
    "approveBaseContentReview",
  ],
  [
    "preview/issue",
    "ISSUE_PREVIEW",
    "content.preview",
    "issueBaseContentPreview",
  ],
  [
    "preview/revoke",
    "REVOKE_PREVIEW",
    "content.preview",
    "revokeBaseContentPreview",
  ],
] as const;
function schema(value: z.ZodType): JsonObject {
  const body = z.toJSONSchema(value, {
    target: "draft-2020-12",
    io: "input",
  }) as JsonObject;
  delete body["$schema"];
  return body;
}
function responses(success: string): JsonObject {
  return Object.fromEntries(
    ["200", "400", "401", "403", "404", "409", "413", "503"].map((status) => [
      status,
      {
        description:
          status === "200"
            ? "Authorized locale-scoped result. Preview credentials are returned once only."
            : "Safe rejection without internal details.",
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
              $ref: `#/components/schemas/${status === "200" ? success : "AdminContentFailure"}`,
            },
          },
        },
      },
    ]),
  );
}
const origin = {
  name: "Origin",
  in: "header",
  required: true,
  schema: { type: "string", format: "uri" },
};
export function baseContentPaths(): JsonObject {
  const paths: JsonObject = {};
  for (const [path, action, permission, operationId] of routes) {
    const source = baseContentCommandSchema.options.find(
      (option) => option.shape.action.value === action,
    )!;
    const body = schema(source);
    const properties = body["properties"] as JsonObject;
    const idempotency = properties["idempotencyKey"];
    delete properties["action"];
    delete properties["idempotencyKey"];
    body["required"] = (body["required"] as string[]).filter(
      (key) => key !== "action" && key !== "idempotencyKey",
    );
    paths["/api/v1/admin/content-review/" + path] = {
      post: {
        operationId,
        summary: `${action.toLowerCase().replaceAll("_", " ")} for base content`,
        description:
          action === "REVOKE_PREVIEW"
            ? "Requires a current canonical session, MFA and basic content.preview permission. Only the issuer may revoke their own grant, including when its locale assignment has been withdrawn. No target locale permission is required to remove this access. Unknown properties and query strings are rejected."
            : "Explicit admin composition requires canonical session, MFA, current permission and target locale. Review reads expose only the selected translation and actual English source. Stale reads remain available; new submissions and approvals require current source evidence and an immutable authored revision. Copies retain independent historical review evidence. This surface does not publish or issue login sessions. Unknown properties and query strings are rejected.",
        security: [{ AdminSession: [], AdminCsrf: [] }],
        "x-fan-support-rbac": permission,
        "x-fan-support-concurrency":
          action === "SUBMIT_REVIEW" || action === "APPROVE_REVIEW"
            ? "expectedVersion is the selected translation review sequence; content and current English source hashes must match."
            : "not-applicable",
        "x-fan-support-audit-reason":
          action === "READ_REVIEW" ? "not-applicable" : "reasonCode",
        "x-fan-support-idempotency": idempotency
          ? "same authorized actor/operation/key/body returns original safe result reference"
          : "not-applicable",
        parameters: [
          origin,
          ...(idempotency
            ? [
                {
                  name: "Idempotency-Key",
                  in: "header",
                  required: true,
                  schema: idempotency,
                },
              ]
            : []),
        ],
        requestBody: {
          required: true,
          "x-fan-support-max-body-bytes": 64 * 1024,
          content: { "application/json": { schema: body } },
        },
        responses: responses("BaseContentResponse"),
      },
    };
  }
  paths["/api/v1/content-review-preview/read"] = {
    post: {
      operationId: "readBaseContentPreview",
      summary: "Read a private preview for one object, revision and locale",
      description:
        "Preview bearer credential appears only in JSON body, never URLs. No cookie or write capability. Issuer session, MFA, permission and assigned locale must still be valid. No fallback, English source, audit identity, storage object key or linked draft expansion. References are data only and do not authorize fetching other resources.",
      security: [],
      parameters: [origin],
      requestBody: {
        required: true,
        "x-fan-support-max-body-bytes": 64 * 1024,
        content: {
          "application/json": {
            schema: schema(baseContentPreviewRequestSchema),
          },
        },
      },
      responses: responses("BaseContentPreviewResponse"),
    },
  };
  return paths;
}
