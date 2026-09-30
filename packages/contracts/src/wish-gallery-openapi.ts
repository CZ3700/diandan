import { z } from "zod";
import { wishGalleryReadCommandSchema } from "./wish-gallery.js";

export function wishGalleryPaths(): Record<string, unknown> {
  const schema = z.toJSONSchema(wishGalleryReadCommandSchema, {
    target: "draft-2020-12",
    io: "input",
  });
  const responses = (name: string, privateRead: boolean) =>
    Object.fromEntries(
      [200, 400, ...(privateRead ? [401] : []), 403, 413, 415, 429, 503].map(
        (status) => [
          status,
          {
            description:
              status === 200
                ? "Validated wish gallery result."
                : "Stable privacy-safe failure.",
            headers: {
              "Cache-Control": {
                schema: {
                  type: "string",
                  const: privateRead ? "private, no-store" : "no-store",
                },
              },
            },
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${name}` },
              },
            },
          },
        ],
      ),
    );
  return {
    "/api/v1/storefront/wish-gallery": {
      get: {
        operationId: "readWishGallery",
        security: [],
        description:
          "Current opt-in WISH supports only. Anonymous or explicitly chosen public aliases; never private personalization, contacts, order IDs or payment amounts. Withdrawn entries, fully refunded lines and lost disputes are excluded on every read. Locale labels the interface; historical names and images retain their recorded source locales. Unknown and duplicate query keys are rejected.",
        parameters: Object.entries(schema.properties ?? {})
          .filter(([key]) => key !== "schemaVersion")
          .map(([key, value]) => ({
            name: key === "idolId" ? "idol" : key,
            in: "query",
            required: schema.required?.includes(key) ?? false,
            schema: value,
          })),
        responses: responses("WishGalleryReadResponse", false),
      },
    },
    "/api/v1/orders/{publicOrderId}/wish-gallery/{entryId}/withdraw": {
      post: {
        operationId: "withdrawWishGalleryEntry",
        security: [{ OrderSession: [], OrderCsrf: [] }],
        description:
          "Hide this order's public wish entry using its active scoped session, same-origin request and independent CSRF proof. Repeated withdrawal is safe. This never cancels a payment, deletes historical support or reopens the wish. Shares the durable order REVOKE rate-limit bucket.",
        parameters: [
          {
            name: "Origin",
            in: "header",
            required: true,
            schema: { type: "string", format: "uri" },
          },
          ...["publicOrderId", "entryId"].map((name) => ({
            name,
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          })),
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["schemaVersion"],
                properties: { schemaVersion: { type: "integer", const: 1 } },
              },
            },
          },
        },
        responses: responses("WishGalleryWithdrawResponse", true),
      },
    },
  };
}
