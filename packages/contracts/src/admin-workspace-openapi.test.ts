import { expect, test } from "vitest";
import { createContractArtifactDocuments } from "./artifact-documents.js";
type Operation = {
  security: unknown;
  description: string;
  parameters: Array<{ name: string }>;
  "x-fan-support-audit-reason": string;
  requestBody: {
    "x-fan-support-max-body-bytes": number;
    content: {
      "application/json": { schema: { properties: Record<string, unknown> } };
    };
  };
  responses: Record<
    string,
    { headers: Record<string, { schema: { const: string } }> }
  >;
};

test("admin workspace documents all scoped routes and keeps credentials out of body envelopes", () => {
  const paths = createContractArtifactDocuments().openapi["paths"] as Record<
    string,
    { post: Operation }
  >;
  for (const path of [
    "session/read",
    "catalog/owners/list",
    "catalog/owners/read",
    "catalog/history/read",
    "catalog/idols/create",
    "catalog/idols/rename",
    "catalog/idols/status",
    "translation-workspace/read",
    "translation-transfer/export",
    "translation-transfer/import",
  ]) {
    const operation = paths[`/api/v1/admin/${path}`]?.post;
    expect(operation, path).toBeDefined();
    expect(operation?.["security"]).toEqual([
      { AdminSession: [], AdminCsrf: [] },
    ]);
    const body = operation?.["requestBody"].content["application/json"].schema;
    expect(body?.properties["action"]).toBeUndefined();
    expect(body?.properties["sessionToken"]).toBeUndefined();
    expect(body?.properties["idempotencyKey"]).toBeUndefined();
    expect(
      operation?.responses["200"]?.headers["Cache-Control"]?.schema.const,
    ).toBe("private, no-store");
  }
});
test("transfer documents audited replay, head expiry, draft-only writes and a bounded body", () => {
  const paths = createContractArtifactDocuments().openapi["paths"] as Record<
    string,
    { post: Operation }
  >;
  for (const action of ["export", "import"]) {
    const operation =
      paths[`/api/v1/admin/translation-transfer/${action}`]?.post;
    expect(operation).toBeDefined();
    expect(operation?.["requestBody"]["x-fan-support-max-body-bytes"]).toBe(
      16 * 1024 * 1024,
    );
    expect(
      operation?.parameters.some(
        (value: { name: string }) => value.name === "Idempotency-Key",
      ),
    ).toBe(true);
    expect(operation?.["x-fan-support-audit-reason"]).toBe("reasonCode");
  }
  expect(
    paths["/api/v1/admin/translation-transfer/import"]?.post.description,
  ).toContain("DRAFT");
});
test("preview-media documents body-only scoped credentials and no arbitrary media input", () => {
  const paths = createContractArtifactDocuments().openapi["paths"] as Record<
    string,
    { post: Operation }
  >;
  const operation = paths["/api/v1/admin-preview-media/read"]?.post;
  expect(operation).toBeDefined();
  expect(operation?.security).toEqual([]);
  const properties =
    operation?.requestBody.content["application/json"].schema.properties;
  expect(Object.keys(properties ?? {}).sort()).toEqual([
    "schemaVersion",
    "target",
    "token",
  ]);
  expect(operation?.requestBody["x-fan-support-max-body-bytes"]).toBe(65536);
});
