import { z } from "zod";
import { contentAuthoringCommandSchema } from "./content-authoring.js";

type JsonObject = Record<string, unknown>;
const routes = [
  ["read", "READ"],
  ["create", "CREATE"],
  ["copy", "COPY"],
] as const;

function responses(): JsonObject {
  return Object.fromEntries(
    ["200", "400", "401", "403", "404", "409", "413", "503"].map((status) => [
      status,
      {
        description:
          status === "200"
            ? "Authorized immutable revision or mutation result reference."
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
              $ref: `#/components/schemas/${status === "200" ? "ContentAuthoringResponse" : "AdminContentFailure"}`,
            },
          },
        },
      },
    ]),
  );
}

export function contentAuthoringPaths(): JsonObject {
  const paths: JsonObject = {};
  for (const [path, action] of routes) {
    const source = contentAuthoringCommandSchema.options.find(
      (option) => option.shape.action.value === action,
    )!;
    const body = z.toJSONSchema(source, {
      target: "draft-2020-12",
      io: "input",
    }) as JsonObject;
    delete body["$schema"];
    const properties = body["properties"] as JsonObject;
    const required = body["required"] as string[];
    const idempotencySchema = properties["idempotencyKey"];
    delete properties["action"];
    delete properties["idempotencyKey"];
    body["required"] = required.filter(
      (key) => key !== "action" && key !== "idempotencyKey",
    );
    const mutation = action !== "READ";
    paths["/api/v1/admin/content-authoring/" + path] = {
      post: {
        operationId: `${path}ContentAuthoringRevision`,
        summary: `${path} a content authoring revision`,
        description:
          "Explicit admin composition requires canonical session, MFA, current permission and every affected locale. CREATE and COPY append an immutable draft; COPY is the editing operation. This surface does not publish content or issue login sessions. Unknown body properties and all query strings are rejected.",
        security: [{ AdminSession: [], AdminCsrf: [] }],
        "x-fan-support-rbac": mutation ? "content.edit" : "content.read",
        "x-fan-support-concurrency": mutation
          ? "expectedVersion is the current maximum revision number for this owner; 0 means no revision exists. COPY also binds the immutable source by expectedSourceHash."
          : "not-applicable",
        "x-fan-support-audit-reason": mutation
          ? "reasonCode"
          : "not-applicable",
        "x-fan-support-idempotency": mutation
          ? "same actor/operation/key/body returns the original safe result reference"
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
          "x-fan-support-max-body-bytes": 16 * 1024 * 1024,
          content: { "application/json": { schema: body } },
        },
        responses: responses(),
      },
    };
  }
  return paths;
}
