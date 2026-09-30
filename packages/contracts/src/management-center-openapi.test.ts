import { expect, test } from "vitest";
import { managementCenterPaths } from "./management-center-openapi.js";
test("management API documents nine strictly private operations without browser orchestration", () => {
  const paths = managementCenterPaths();
  expect(Object.keys(paths)).toHaveLength(9);
  expect(paths).toHaveProperty("/api/v1/admin/management/posters/archive");
  expect(paths).toHaveProperty("/api/v1/admin/management/artists/assign");
  const submit = paths["/api/v1/admin/management/submit"] as {
    post: {
      parameters: { name: string }[];
      security: unknown;
      requestBody: {
        content: {
          "application/json": {
            schema: { properties: Record<string, unknown> };
          };
        };
      };
      responses: Record<
        string,
        { headers: Record<string, { schema: { const: string } }> }
      >;
    };
  };
  expect(submit.post.parameters.map((entry) => entry.name)).toEqual([
    "Origin",
    "Idempotency-Key",
  ]);
  expect(submit.post.security).toEqual([{ AdminSession: [], AdminCsrf: [] }]);
  expect(
    Object.keys(
      submit.post.requestBody.content["application/json"].schema.properties,
    ),
  ).toEqual(["schemaVersion", "intent"]);
  expect(
    submit.post.responses["200"]?.headers["Cache-Control"]?.schema.const,
  ).toBe("private, no-store");
  expect(submit.post.responses).not.toHaveProperty("304");
});
