import { z } from "zod";
import { catalogDisplayOrderCommandSchema } from "./catalog-display-order.js";
type JsonObject = Record<string, unknown>;

/** L2-10: admin-only read and save of the operator's artist and gift order. */
export function catalogDisplayOrderPaths(): JsonObject {
  return Object.fromEntries(
    (
      [
        ["read", "READ"],
        ["save", "SAVE"],
      ] as const
    ).map(([path, action]) => {
      const schema = catalogDisplayOrderCommandSchema.options.find(
        (candidate) => candidate.shape.action.value === action,
      )!;
      const body = z.toJSONSchema(schema, {
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
        `/api/v1/admin/display-order/${path}`,
        {
          post: {
            operationId: `catalogDisplayOrder${action === "READ" ? "Read" : "Save"}`,
            summary: `${action.toLowerCase()} the storefront order of artists or gifts`,
            description:
              "Exact Origin, CSRF and a current admin session required. Reading needs content.read; saving publishes immediately and needs content.publish. Items left out follow in the storefront default order; an empty list restores the default.",
            "x-fan-support-rbac":
              action === "READ" ? "content.read" : "content.publish",
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
              "x-fan-support-max-body-bytes": 32768,
              content: { "application/json": { schema: body } },
            },
            responses: Object.fromEntries(
              ["200", "400", "401", "403", "404", "409", "413", "503"].map(
                (status) => [
                  status,
                  {
                    description:
                      "Current order with the items the storefront shows. No content, price or stock state is included.",
                    headers: {
                      "Cache-Control": {
                        schema: { type: "string", const: "private, no-store" },
                      },
                    },
                    content: {
                      "application/json": {
                        schema: {
                          $ref: "#/components/schemas/CatalogDisplayOrderResponse",
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
