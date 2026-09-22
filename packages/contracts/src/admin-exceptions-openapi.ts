import { z } from "zod";
import { adminExceptionsCommandSchema } from "./admin-exceptions.js";

type JsonObject = Record<string, unknown>;
export function adminExceptionsPaths(): JsonObject {
  return Object.fromEntries(
    adminExceptionsCommandSchema.options.map((command) => {
      const action = command.shape.action.value;
      const body = z.toJSONSchema(command, {
        target: "draft-2020-12",
        io: "input",
      }) as JsonObject;
      delete body["$schema"];
      const properties = body["properties"] as JsonObject;
      const key = properties["idempotencyKey"];
      delete properties["action"];
      delete properties["idempotencyKey"];
      body["required"] = (body["required"] as string[]).filter(
        (name) => name !== "action" && name !== "idempotencyKey",
      );
      return [
        `/api/v1/admin/exceptions/${action.toLowerCase().replaceAll("_", "-")}`,
        {
          post: {
            operationId: `adminExceptions${action
              .toLowerCase()
              .split("_")
              .map((word) => word[0]!.toUpperCase() + word.slice(1))
              .join("")}`,
            summary: action.toLowerCase().replaceAll("_", " "),
            description:
              "Current administrator session, MFA, Origin, CSRF and source-specific permissions are required. Recovery binds a server-issued source snapshot, a fixed reason, confirmation and permanent idempotency receipt. Webhooks use already verified normalized events; queue recovery retains original business effects and consumer keys. Payment reconciliation uses the original provider account. Notification recovery cannot bypass uncertain delivery protection. Responses contain safe metadata only.",
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
              "x-fan-support-max-body-bytes": 16 * 1024,
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
                      ? "Safe authorized work queue, detail or permanent recovery receipt."
                      : "Typed rejection without provider payload, private content or credentials.",
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
                        $ref: "#/components/schemas/AdminExceptionsResponse",
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
