import { z } from "zod";
import { adminResourceCommandSchema } from "./resource-management.js";
type JsonObject = Record<string, unknown>;
const routes = [
  ["policies/read", "READ_POLICY", "content.policy.manage"],
  ["policies/register", "REGISTER_POLICY", "content.policy.manage"],
  ["uploads/begin", "BEGIN_UPLOAD", "content.media.upload"],
  ["uploads/read", "READ_UPLOAD", "content.media.upload"],
  ["uploads/complete", "COMPLETE_UPLOAD", "content.media.upload"],
  ["media/read", "READ_MEDIA", "content.media.read"],
  ["media/rights", "SET_MEDIA_RIGHTS", "content.media.rights"],
  ["processing/enqueue", "ENQUEUE_MEDIA", "content.media.process"],
  ["processing/read", "READ_MEDIA_JOB", "content.media.read"],
  ["processing/retry", "RETRY_MEDIA_JOB", "content.media.process"],
] as const;
export function resourceManagementPaths(): JsonObject {
  const paths: JsonObject = {};
  for (const [path, action, permission] of routes) {
    const command = adminResourceCommandSchema.options.find(
      (v) => v.shape.action.value === action,
    )!;
    const body = z.toJSONSchema(command, {
      target: "draft-2020-12",
      io: "input",
    }) as JsonObject;
    delete body["$schema"];
    const properties = body["properties"] as JsonObject;
    const idempotency = properties["idempotencyKey"];
    delete properties["action"];
    delete properties["idempotencyKey"];
    body["required"] = (body["required"] as string[]).filter(
      (v) => v !== "action" && v !== "idempotencyKey",
    );
    paths["/api/v1/admin/resources/" + path] = {
      post: {
        operationId: action
          .toLowerCase()
          .replace(/_([a-z])/gu, (_, char: string) => char.toUpperCase()),
        summary: action.toLowerCase().replaceAll("_", " "),
        description:
          "Requires current canonical session, MFA and resource permission. Same-origin POST only; unknown properties and query strings are rejected. No locale grant changes. Upload signing and full source inspection occur outside transactions; final registration reauthorizes. Only BEGIN_UPLOAD returns a short-lived private PUT grant, never persisted in idempotency. Signed grants remain usable until expiry; permission revocation blocks registration. Rights and processing remain independent from translation review and publication.",
        security: [{ AdminSession: [], AdminCsrf: [] }],
        "x-fan-support-rbac": permission,
        "x-fan-support-idempotency": idempotency
          ? action === "BEGIN_UPLOAD"
            ? "current authorization precedes replay; a pending owned reservation reissues a bounded upload grant; expired or registered reservations return STALE_VERSION; persistence stores only the upload reference"
            : "current authorization precedes replay; same actor/operation/key/exact command returns safe result reference"
          : "not-applicable",
        "x-fan-support-audit-reason": idempotency
          ? "reasonCode"
          : "not-applicable",
        "x-fan-support-concurrency":
          action === "COMPLETE_UPLOAD"
            ? "expectedVersion 1; immutable pending ticket becomes registered version 2"
            : action === "SET_MEDIA_RIGHTS"
              ? "expectedVersion is the current rights event sequence, initially 0"
              : action === "RETRY_MEDIA_JOB"
                ? "expectedVersion is failed predecessor attemptCount; one immutable successor only"
                : idempotency
                  ? "expectedVersion 0 for new owner, upload or root recipe"
                  : "not-applicable",
        parameters: [
          {
            name: "Origin",
            in: "header",
            required: true,
            schema: { type: "string", format: "uri" },
          },
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
          "x-fan-support-max-body-bytes": 65536,
          content: { "application/json": { schema: body } },
        },
        responses: Object.fromEntries(
          ["200", "400", "401", "403", "404", "409", "413", "503"].map(
            (status) => [
              status,
              {
                description:
                  status === "200"
                    ? "Authorized minimal resource result."
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
                      $ref:
                        "#/components/schemas/" +
                        (status === "200"
                          ? "AdminResourceResponse"
                          : "AdminContentFailure"),
                    },
                  },
                },
              },
            ],
          ),
        ),
      },
    };
  }
  return paths;
}
