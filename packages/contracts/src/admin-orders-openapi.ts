import { z } from "zod";
import { adminOrdersCommandSchema } from "./admin-orders.js";

type JsonObject = Record<string, unknown>;
const paths = [
  ["context", "CONTEXT"],
  ["list", "LIST"],
  ["detail", "DETAIL"],
  ["message/read", "READ_MESSAGE"],
  ["message/review", "REVIEW_MESSAGE"],
  ["prepare", "PREPARE"],
  ["deliver", "DELIVER"],
  ["hold", "HOLD"],
  ["resume", "RESUME"],
  ["note/add", "ADD_NOTE"],
  ["notes/read", "READ_NOTES"],
  ["notification/resend", "RESEND_NOTIFICATION"],
] as const;
export function adminOrdersPaths(): JsonObject {
  return Object.fromEntries(
    paths.map(([path, action]) => {
      const command = adminOrdersCommandSchema.options.find(
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
        `/api/v1/admin/orders/${path}`,
        {
          post: {
            operationId: `adminOrders${action
              .toLowerCase()
              .split("_")
              .map((word) => word[0]!.toUpperCase() + word.slice(1))
              .join("")}`,
            summary: action.toLowerCase().replaceAll("_", " "),
            description:
              "Requires current MFA session, exact Origin, CSRF and action-specific orders permissions. Message access additionally requires a dedicated review-language grant; unknown or mismatched languages need triage permission. Mutations require Idempotency-Key, expected versions and reasonCode. HOLD/RESUME additionally require Manager permission and explicit confirmation; payment holds cannot be resumed here. Private reads commit an audit before decryption and recheck authority before returning plaintext. Resend creates an independent durable dispatch without rewriting prior delivery history. Unknown fields, query parameters and caller-supplied authority are rejected.",
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
              [
                "200",
                "400",
                "401",
                "403",
                "404",
                "409",
                "413",
                "429",
                "503",
              ].map((status) => [
                status,
                {
                  description:
                    status === "200"
                      ? "Strict authorized order operation result; private plaintext is confined to explicit read endpoints."
                      : "Safe typed rejection without private plaintext, encrypted payloads or credentials.",
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
                          action === "READ_MESSAGE" || action === "READ_NOTES"
                            ? "#/components/schemas/AdminOrdersPrivateResponse"
                            : "#/components/schemas/AdminOrdersResponse",
                      },
                    },
                  },
                },
              ]),
            ),
          },
        },
      ];
    }),
  );
}
