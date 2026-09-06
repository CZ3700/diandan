import { expect, test } from "vitest";
import { publicationRuntimePaths } from "./publication-runtime-openapi.js";

test("documents five session-protected publication actions and five explicit-locale public reads", () => {
  const paths = publicationRuntimePaths();
  expect(Object.keys(paths)).toHaveLength(10);
  for (const [path, value] of Object.entries(paths)) {
    const route = value as Record<string, Record<string, unknown>>;
    const privateRoute = path.includes("/admin/");
    const operation = route[privateRoute ? "post" : "get"]!;
    expect(operation).toBeDefined();
    const parameters = operation["parameters"] as {
      name: string;
      in: string;
      required: boolean;
    }[];
    if (privateRoute) {
      expect(operation["security"]).toEqual([
        { AdminSession: [], AdminCsrf: [] },
      ]);
      expect(operation["x-fan-support-rbac"]).toBe(
        path.endsWith("/status") ? "content.read" : "content.publish",
      );
      expect(
        parameters.some(
          (item) => item.name === "Idempotency-Key" && item.required,
        ),
      ).toBe(!path.endsWith("/status"));
      expect(parameters).toContainEqual(
        expect.objectContaining({ name: "Origin", required: true }),
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
      for (const key of [
        "action",
        "idempotencyKey",
        "actorId",
        "requestId",
        "sessionToken",
      ])
        expect(schema.properties).not.toHaveProperty(key);
      if (!path.endsWith("/status"))
        expect(schema.required).toContain("expectedVersion");
    } else {
      expect(operation["security"]).toEqual([]);
      expect(operation).not.toHaveProperty("requestBody");
      expect(parameters.filter((item) => item.in === "query")).toEqual([
        expect.objectContaining({ name: "locale", required: true }),
      ]);
      for (const match of path.matchAll(/\{([^}]+)\}/gu))
        expect(parameters).toContainEqual(
          expect.objectContaining({
            name: match[1],
            in: "path",
            required: true,
          }),
        );
    }
    const responses = operation["responses"] as Record<
      string,
      {
        headers: Record<string, { schema: { const: string } }>;
        content: { "application/json": { schema: { $ref: string } } };
      }
    >;
    for (const response of Object.values(responses)) {
      expect(response.headers["Cache-Control"]?.schema.const).toBe(
        privateRoute ? "private, no-store" : "no-store",
      );
      expect(response.headers["X-Robots-Tag"]?.schema.const).toBe(
        "noindex, nofollow",
      );
      expect(response.headers["Referrer-Policy"]?.schema.const).toBe(
        "no-referrer",
      );
    }
    expect(responses["200"]?.content["application/json"].schema.$ref).toBe(
      `#/components/schemas/${privateRoute ? "PublicationRuntimeResponse" : "PublishedContentResponse"}`,
    );
    if (privateRoute)
      expect(responses["409"]?.content["application/json"].schema.$ref).toBe(
        "#/components/schemas/PublicationRuntimeResponse",
      );
  }
});
