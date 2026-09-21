import { z } from "zod";
import { adminFinanceCommandSchema } from "./admin-finance.js";

type JsonObject = Record<string, unknown>;
const paths = [
  ["list", "LIST"],
  ["detail", "DETAIL"],
  ["refund", "REFUND"],
  ["cancel", "CANCEL"],
  ["reconcile", "RECONCILE"],
] as const;
export function adminFinancePaths(): JsonObject {
  return Object.fromEntries(
    paths.map(([path, action]) => {
      const command = adminFinanceCommandSchema.options.find(
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
        `/api/v1/admin/finance/${path}`,
        {
          post: {
            operationId: `adminFinance${action
              .toLowerCase()
              .split("_")
              .map((word) => word[0]!.toUpperCase() + word.slice(1))
              .join("")}`,
            summary: action.toLowerCase().replaceAll("_", " "),
            description:
              "Requires a current MFA session, exact Origin and CSRF. Reads require orders.read. REFUND, CANCEL and RECONCILE require the platform Manager finance.manage permission, Idempotency-Key, expectedOrderVersion, reasonCode and confirmed=true. Refund allocations must be unique, sum exactly to the requested original-currency amount and fit both captured and per-item remaining capacity including UNKNOWN refunds. A mutation receipt only confirms durable acceptance; trusted provider evidence determines the financial result. No caller-supplied provider identity, dispute outcome, credentials or private fan content is accepted.",
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
                      ? "Authorized financial summary or durable acceptance receipt without provider credentials or fan private content."
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
                        $ref: "#/components/schemas/AdminFinanceResponse",
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
