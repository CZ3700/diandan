import { expect, it } from "vitest";
import { contentAuthoringPaths } from "./content-authoring-openapi.js";

it("documents distinct authoring commands with header authority and private responses", () => {
  const paths = contentAuthoringPaths();
  expect(Object.keys(paths)).toEqual([
    "/api/v1/admin/content-authoring/read",
    "/api/v1/admin/content-authoring/create",
    "/api/v1/admin/content-authoring/copy",
  ]);
  for (const [path, value] of Object.entries(paths)) {
    const operation = (value as { post: Record<string, unknown> }).post;
    expect(operation["security"]).toEqual([
      { AdminSession: [], AdminCsrf: [] },
    ]);
    expect(operation["x-fan-support-rbac"]).toBe(
      path.endsWith("/read") ? "content.read" : "content.edit",
    );
    const body = operation["requestBody"] as {
      content: {
        "application/json": {
          schema: {
            properties: Record<string, unknown>;
            required: string[];
            additionalProperties: boolean;
          };
        };
      };
    };
    const schema = body.content["application/json"].schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("schemaVersion");
    expect(schema.required).not.toContain("action");
    expect(schema.properties).not.toHaveProperty("idempotencyKey");
    expect(schema.properties).not.toHaveProperty("actorId");
    const parameters = operation["parameters"] as {
      name: string;
      required: boolean;
    }[];
    expect(parameters).toContainEqual(
      expect.objectContaining({ name: "Origin", required: true }),
    );
    expect(parameters.some((row) => row.name === "Idempotency-Key")).toBe(
      !path.endsWith("/read"),
    );
    const responses = operation["responses"] as Record<
      string,
      { headers: Record<string, { schema: { const: string } }> }
    >;
    for (const response of Object.values(responses)) {
      expect(response.headers["Cache-Control"]?.schema.const).toBe(
        "private, no-store",
      );
      expect(response.headers["X-Robots-Tag"]?.schema.const).toBe(
        "noindex, nofollow",
      );
      expect(response.headers["Referrer-Policy"]?.schema.const).toBe(
        "no-referrer",
      );
    }
  }
});
