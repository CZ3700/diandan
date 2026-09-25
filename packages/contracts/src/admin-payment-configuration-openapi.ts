import { z } from "zod";
import { adminPaymentConfigurationCommandSchema } from "./admin-payment-configuration.js";

type JsonObject = Record<string, unknown>;
const paths = [
  ["read", "READ"],
  ["save", "SAVE"],
  ["submit", "SUBMIT"],
  ["approve", "APPROVE"],
  ["validate", "VALIDATE"],
  ["publish", "PUBLISH"],
  ["rollback", "ROLLBACK"],
] as const;
export function adminPaymentConfigurationPaths(): JsonObject {
  return Object.fromEntries(
    paths.map(([path, action]) => {
      const command = adminPaymentConfigurationCommandSchema.options.find(
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
        `/api/v1/admin/payment-configuration/${path}`,
        {
          post: {
            operationId: `adminPaymentConfiguration${action
              .toLowerCase()
              .split("_")
              .map((word) => word[0]!.toUpperCase() + word.slice(1))
              .join("")}`,
            summary: action.toLowerCase().replaceAll("_", " "),
            description:
              "Current platform permissions, MFA, Origin and CSRF are required. Mutations use permanent idempotency receipts. Drafts never grant translation approval. Publication requires independently approved current seven-language copy, a validationHash bound to the exact revision and expectedPublicationId, a reason and second confirmation. The transaction revalidates the candidate and deployed adapter/account eligibility. Rollback creates a new publication generation; historical attempts retain their original account. No executable adapter, merchant credential or secret reference is accepted.",
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
              "x-fan-support-max-body-bytes": 512 * 1024,
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
                      ? "Authorized configuration workspace, validation or permanent mutation receipt without connection secrets."
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
                        $ref: "#/components/schemas/AdminPaymentConfigurationResponse",
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
