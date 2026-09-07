import {
  publicRevalidationHeaders,
  publicRevalidationParameter,
} from "./public-revalidation-openapi.js";
import { z } from "zod";
import {
  giftCommerceReadCommandSchema,
  giftCommerceMutationCommandSchema,
} from "./gift-commerce.js";
import { slugSchema } from "./presentation.js";
import { supportedLocaleSchema } from "./locale.js";

type JsonObject = Record<string, unknown>;
const SMALL = 64 * 1024;
const routes = [
  [
    "context/read",
    "CONTEXT",
    "commerce.read",
    "readGiftCommerceContext",
    SMALL,
  ],
  ["gifts/read", "READ_GIFT", "commerce.read", "readGiftCommerceGift", SMALL],
  [
    "prices/read",
    "READ_PRICES",
    "commerce.read",
    "readGiftCommercePrices",
    SMALL,
  ],
  [
    "inventory/read",
    "READ_INVENTORY",
    "commerce.read",
    "readGiftCommerceInventory",
    SMALL,
  ],
  ["gifts/create", "CREATE_GIFT", "gift.manage", "createCommerceGift", SMALL],
  [
    "gifts/status",
    "SET_GIFT_STATUS",
    "gift.manage",
    "setCommerceGiftStatus",
    SMALL,
  ],
  [
    "variants/save",
    "SAVE_VARIANT",
    "gift.manage",
    "saveCommerceGiftVariant",
    128 * 1024,
  ],
  [
    "content/save",
    "SAVE_GIFT_CONTENT",
    "gift.manage + content.edit",
    "saveCommerceGiftContent",
    16 * 1024 * 1024,
  ],
  [
    "prices/create",
    "CREATE_PRICE_REVISION",
    "pricing.manage",
    "createCommercePriceRevision",
    SMALL,
  ],
  [
    "prices/publish",
    "PUBLISH_PRICE_BOOK",
    "pricing.manage",
    "publishCommercePriceBook",
    SMALL,
  ],
  [
    "prices/rollback",
    "ROLLBACK_PRICE_BOOK",
    "pricing.manage",
    "rollbackCommercePriceBook",
    SMALL,
  ],
  [
    "inventory/locations/create",
    "CREATE_INVENTORY_LOCATION",
    "inventory.manage",
    "createCommerceInventoryLocation",
    SMALL,
  ],
  [
    "inventory/adjust",
    "ADJUST_INVENTORY",
    "inventory.manage",
    "adjustCommerceInventory",
    SMALL,
  ],
] as const;
function schema(input: z.ZodType): JsonObject {
  const value = z.toJSONSchema(input, {
    target: "draft-2020-12",
    io: "input",
  }) as JsonObject;
  delete value["$schema"];
  return value;
}
function responses(privateRoute: boolean): JsonObject {
  return Object.fromEntries(
    (privateRoute
      ? ["200", "400", "401", "403", "404", "409", "413", "503"]
      : ["200", "304", "400", "404", "503"]
    ).map((status) => [
      status,
      {
        description:
          status === "200"
            ? "Strict authorized commerce result or safe current published gift projection."
            : status === "304"
              ? "Unchanged anonymous representation after fresh validation; no response body."
              : "Safe typed rejection without credentials, storage keys, internal proof or connection details.",
        headers: {
          ...(privateRoute
            ? {
                "Cache-Control": {
                  schema: { type: "string", const: "private, no-store" },
                },
              }
            : publicRevalidationHeaders(
                status === "200" ? 200 : status === "304" ? 304 : "FAILURE",
              )),
          "X-Robots-Tag": {
            schema: { type: "string", const: "noindex, nofollow" },
          },
          "Referrer-Policy": {
            schema: { type: "string", const: "no-referrer" },
          },
        },
        ...(status === "304"
          ? {}
          : {
              content: {
                "application/json": {
                  schema: {
                    $ref: `#/components/schemas/${privateRoute ? "GiftCommerceResponse" : "PublishedGiftCommerceResponse"}`,
                  },
                },
              },
            }),
      },
    ]),
  ) as JsonObject;
}
function concurrency(action: (typeof routes)[number][1]): string {
  switch (action) {
    case "CREATE_GIFT":
    case "SET_GIFT_STATUS":
      return "expectedBaseVersion is the current gift identity version; creation requires 0.";
    case "SAVE_VARIANT":
      return "expectedBaseVersion binds its parent; expectedVariantVersion binds the variant and is 0 only for creation.";
    case "SAVE_GIFT_CONTENT":
      return "expectedBaseVersion binds the gift. Nested authoring expectedVersion and expectedSourceHash retain the immutable content-authoring contract.";
    case "CREATE_PRICE_REVISION":
      return "expectedBookRevision binds authoring history separately from expectedHeadVersion; source contentHash binds the immutable server-copied book.";
    case "PUBLISH_PRICE_BOOK":
    case "ROLLBACK_PRICE_BOOK":
      return "expectedHeadVersion binds current publication; expectedContentHash binds the selected immutable book. Historical rows are not rewritten.";
    case "ADJUST_INVENTORY":
      return "expectedVariantVersion and expectedBalanceVersion bind the selected item/location. Balance version 0 is a first positive stock receipt; reserved units are not browser-controlled.";
    case "CREATE_INVENTORY_LOCATION":
      return "expectedVersion must be 0; the server generates the identity.";
    default:
      return "not-applicable";
  }
}
export function giftCommercePaths(): JsonObject {
  const paths: JsonObject = {};
  const commands = [
    ...giftCommerceReadCommandSchema.options,
    ...giftCommerceMutationCommandSchema.options,
  ];
  for (const [path, action, permission, operationId, bodyLimit] of routes) {
    const source = commands.find(
      (command) => command.shape.action.value === action,
    )!;
    const body = schema(source),
      properties = body["properties"] as JsonObject;
    const idempotency = properties["idempotencyKey"];
    delete properties["action"];
    delete properties["idempotencyKey"];
    body["required"] = (body["required"] as string[]).filter(
      (key) => key !== "action" && key !== "idempotencyKey",
    );
    paths[`/api/v1/admin/gift-commerce/${path}`] = {
      post: {
        operationId,
        summary: action.toLowerCase().replaceAll("_", " "),
        description:
          "Explicit TEST admin composition requires a current canonical session, MFA, exact Origin, CSRF and current permission. The route injects the outer action and authority; unknown body fields and query strings are rejected. Writes and replay authorize in the same transaction as canonical state, audit and idempotency receipt. READ_GIFT checks the selected locale; SAVE_GIFT_CONTENT retains independent content.edit checks for actual affected base/detail locales. Gift kind, inventory policy, language, market and currency are separate dimensions. No login sessions, payments or fan delivery addresses are issued here.",
        security: [{ AdminSession: [], AdminCsrf: [] }],
        "x-fan-support-rbac": permission,
        "x-fan-support-concurrency": concurrency(action),
        "x-fan-support-audit-reason": idempotency
          ? "reasonCode"
          : "not-applicable",
        "x-fan-support-idempotency": idempotency
          ? "Same current authorized actor, action, key and exact command returns the original safe receipt. Changed privilege denies replay."
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
          "x-fan-support-max-body-bytes": bodyLimit,
          content: { "application/json": { schema: body } },
        },
        responses: responses(true),
      },
    };
  }
  paths["/api/v1/gift-content/{handle}"] = {
    get: {
      operationId: "readPublishedGiftCommerce",
      summary:
        "Read current published gift content and its pinned classification",
      description:
        "Anonymous revalidated projection from the current PostgreSQL publication and exact classification proof. Exactly one explicit supported locale is required; duplicate/unknown query fields or caller-selected revisions are rejected. Classification is bound to the selected publication, including rollback; legacy publications remain explicitly represented. This response does not quote a price or complete a purchase.",
      security: [],
      parameters: [
        publicRevalidationParameter(),
        {
          name: "handle",
          in: "path",
          required: true,
          schema: schema(slugSchema),
        },
        {
          name: "locale",
          in: "query",
          required: true,
          schema: schema(supportedLocaleSchema),
        },
      ],
      responses: responses(false),
    },
  };
  return paths;
}
