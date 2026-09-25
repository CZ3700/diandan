import { expect, it } from "vitest";
import { renderContractArtifactDocuments } from "./artifact-documents.js";

it("documents five base admin commands and an isolated token POST preview", () => {
  const rendered = renderContractArtifactDocuments();
  const document = JSON.parse(rendered.openapi);
  const prefix = "/api/v1/admin/content-review/";
  for (const [path, permission, idempotent] of [
    ["read", "content.read", false],
    ["submit", "content.edit", true],
    ["approve", "content.translation.review", true],
    ["preview/issue", "content.preview", false],
    ["preview/revoke", "content.preview", true],
  ] as const) {
    const operation = document.paths[prefix + path]?.post;
    expect(operation).toBeDefined();
    expect(operation.security).toEqual([{ AdminSession: [], AdminCsrf: [] }]);
    expect(operation["x-fan-support-rbac"]).toBe(permission);
    if (path === "preview/revoke")
      expect(operation.description).toContain(
        "locale assignment has been withdrawn",
      );
    const schema = operation.requestBody.content["application/json"].schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).not.toHaveProperty("actorId");
    expect(schema.properties).not.toHaveProperty("action");
    expect(schema.properties).not.toHaveProperty("idempotencyKey");
    expect(
      operation.parameters.some(
        (item: { name: string }) => item.name === "Idempotency-Key",
      ),
    ).toBe(idempotent);
    for (const response of Object.values(operation.responses) as {
      headers: Record<string, { schema: { const: string } }>;
    }[]) {
      expect(response.headers["Cache-Control"]?.schema.const).toBe(
        "private, no-store",
      );
      expect(response.headers["Referrer-Policy"]?.schema.const).toBe(
        "no-referrer",
      );
    }
  }
  const preview = document.paths["/api/v1/content-review-preview/read"]?.post;
  expect(preview).toBeDefined();
  expect(preview.security).toEqual([]);
  expect(
    preview.parameters.some((item: { in: string }) => item.in === "query"),
  ).toBe(false);
  expect(
    preview.requestBody.content["application/json"].schema.properties.token,
  ).toBeDefined();
});
