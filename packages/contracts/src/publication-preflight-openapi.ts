import { z } from "zod";
import { publicationPreflightCommandSchema } from "./publication-preflight.js";

type JsonObject = Record<string, unknown>;
export function publicationPreflightPaths(): JsonObject {
  const body = z.toJSONSchema(publicationPreflightCommandSchema, {
    target: "draft-2020-12",
    io: "input",
  }) as JsonObject;
  delete body["$schema"];
  return {
    "/api/v1/admin/content/publication/preflight": {
      post: {
        operationId: "readPublicationPreflight",
        summary: "Check current canonical publication readiness",
        description:
          "Requires a current session, MFA, content.read and all seven locales. This read-only observation does not publish, validate a stored lifecycle, change current heads, or enqueue cache purges. Publication must repeat the check in its own transaction. Unknown fields and query strings are rejected. PUBLISH and ROLLBACK select the action being checked.",
        security: [{ AdminSession: [], AdminCsrf: [] }],
        "x-fan-support-rbac": "content.read",
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
          content: { "application/json": { schema: body } },
        },
        responses: Object.fromEntries(
          ["200", "400", "401", "403", "404", "409", "413", "503"].map(
            (status) => [
              status,
              {
                description:
                  status === "200"
                    ? "Current readiness and field-specific blockers; no publishing capability is granted."
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
                      $ref: `#/components/schemas/${status === "200" ? "PublicationPreflightResponse" : "AdminContentFailure"}`,
                    },
                  },
                },
              },
            ],
          ),
        ),
      },
    },
  };
}
