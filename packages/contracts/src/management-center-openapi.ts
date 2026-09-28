import { z } from "zod";
import { managementCenterCommandSchema } from "./management-center.js";

type JsonObject = Record<string, unknown>;
const paths = [
  ["context", "CONTEXT"],
  ["images/read", "READ_IMAGE_SOURCE"],
  ["list", "LIST"],
  ["uploads/prepare", "PREPARE_UPLOAD"],
  ["submit", "SUBMIT"],
  ["operations/read", "READ_OPERATION"],
  ["operations/retry", "RETRY_OPERATION"],
] as const;
export function managementCenterPaths(): JsonObject {
  return Object.fromEntries(
    paths.map(([path, action]) => {
      const command = managementCenterCommandSchema.options.find(
        (candidate) => candidate.shape.action.value === action,
      )!;
      const body = z.toJSONSchema(command, {
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
        `/api/v1/admin/management/${path}`,
        {
          post: {
            operationId: `managementCenter${action
              .toLowerCase()
              .split("_")
              .map((word) => word[0]!.toUpperCase() + word.slice(1))
              .join("")}`,
            summary: action.toLowerCase().replaceAll("_", " "),
            description:
              "Current MFA session, exact Origin, CSRF and management.direct capability are required. The server injects action and credentials. Submission stores one target-bound durable operation; the browser uploads original bytes and polls its safe operation result. Actual sourceLocale is original copy, not an approved translation. Media processing and direct publication recheck current authority; only a committed content and price head is PUBLISHED. Unknown fields, query parameters and caller-supplied authority are rejected. No policies, checkout or payments are modified.",
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
              "x-fan-support-max-body-bytes": 64 * 1024,
              content: { "application/json": { schema: body } },
            },
            responses: Object.fromEntries(
              ["200", "400", "401", "403", "404", "409", "413", "503"].map(
                (status) => [
                  status,
                  {
                    description:
                      status === "200"
                        ? "Strict current authorized management result; PROCESSING is not publication success."
                        : "Safe typed rejection without storage keys, worker leases or credentials.",
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
                          $ref: "#/components/schemas/ManagementCenterResponse",
                        },
                      },
                    },
                  },
                ],
              ),
            ),
          },
        },
      ];
    }),
  );
}
