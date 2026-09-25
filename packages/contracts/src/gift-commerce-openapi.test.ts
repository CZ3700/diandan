type Operation = {
  parameters: { name: string; in: string; required: boolean }[];
  requestBody: {
    [key: string]: unknown;
    content: {
      "application/json": {
        schema: {
          properties: {
            action?: unknown;
            idempotencyKey?: unknown;
            authoring: { oneOf?: unknown; anyOf?: unknown };
          };
        };
      };
    };
  };
  security: unknown;
  responses: Record<
    string,
    { headers: Record<string, { schema: { const?: string; enum?: string[] } }> }
  >;
};
import { expect, test } from "vitest";
import { giftCommercePaths } from "./gift-commerce-openapi.js";

test("new commerce OpenAPI documents all thirteen private routes and one separate public projection", () => {
  const paths = giftCommercePaths();
  expect(Object.keys(paths)).toHaveLength(14);
  expect(paths).toHaveProperty("/api/v1/admin/gift-commerce/context/read");
  expect(paths).toHaveProperty("/api/v1/admin/gift-commerce/inventory/adjust");
  expect(paths).toHaveProperty("/api/v1/gift-content/{handle}");
});
test("private commerce bodies remove only outer authority and keep nested authoring action", () => {
  const value = giftCommercePaths() as Record<
    string,
    { post: Operation; get: Operation }
  >;
  const read = value["/api/v1/admin/gift-commerce/context/read"]!.post;
  const write = value["/api/v1/admin/gift-commerce/content/save"]!.post;
  expect(read.parameters.map((p) => p.name)).toEqual(["Origin"]);
  expect(write.parameters.map((p) => p.name)).toEqual([
    "Origin",
    "Idempotency-Key",
  ]);
  const body = write.requestBody.content["application/json"].schema;
  expect(body.properties.action).toBeUndefined();
  expect(body.properties.idempotencyKey).toBeUndefined();
  expect(
    body.properties.authoring.oneOf ?? body.properties.authoring.anyOf,
  ).toBeDefined();
  expect(write.requestBody["x-fan-support-max-body-bytes"]).toBe(
    16 * 1024 * 1024,
  );
  expect(
    value["/api/v1/admin/gift-commerce/variants/save"]!.post.requestBody[
      "x-fan-support-max-body-bytes"
    ],
  ).toBe(128 * 1024);
  expect(write.security).toEqual([{ AdminSession: [], AdminCsrf: [] }]);
  expect(write.responses["503"]!.headers["Cache-Control"]!.schema.const).toBe(
    "private, no-store",
  );
});
test("public commerce content requires an explicit locale and no private session", () => {
  const value = giftCommercePaths() as Record<
    string,
    { post: Operation; get: Operation }
  >;
  const read = value["/api/v1/gift-content/{handle}"]!.get;
  expect(read.security).toEqual([]);
  expect(read.parameters.map((p) => [p.name, p.in, p.required])).toEqual([
    ["If-None-Match", "header", false],
    ["handle", "path", true],
    ["locale", "query", true],
  ]);
  expect(read.responses["200"]!.headers["Cache-Control"]!.schema).toEqual({
    type: "string",
    enum: [
      "public, max-age=0, s-maxage=0, must-revalidate",
      "private, no-store",
    ],
  });
  expect(read.responses["304"]).not.toHaveProperty("content");
  expect(read.requestBody).toBeUndefined();
});
