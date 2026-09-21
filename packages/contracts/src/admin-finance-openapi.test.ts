import { expect, test } from "vitest";
import { renderContractArtifactDocuments } from "./artifact-documents.js";
test("finance exposes five authenticated commands and private durable recovery contracts", () => {
  const api = JSON.parse(renderContractArtifactDocuments().openapi);
  expect(
    Object.keys(api.paths).filter((p) =>
      p.startsWith("/api/v1/admin/finance/"),
    ),
  ).toHaveLength(5);
  for (const action of ["list", "detail", "refund", "cancel", "reconcile"]) {
    const op = api.paths[`/api/v1/admin/finance/${action}`].post;
    expect(op.security).toEqual([{ AdminSession: [], AdminCsrf: [] }]);
    const body = JSON.stringify(op.requestBody);
    for (const secret of [
      '"action"',
      '"sessionToken"',
      '"csrfToken"',
      '"idempotencyKey"',
      '"providerAccountId"',
    ])
      expect(body).not.toContain(secret);
    expect(JSON.stringify(op.responses)).toContain("AdminFinanceResponse");
    if (!["list", "detail"].includes(action)) {
      expect(op.parameters).toContainEqual(
        expect.objectContaining({ name: "Idempotency-Key", required: true }),
      );
      expect(body).toContain('"confirmed"');
      expect(body).toContain('"expectedOrderVersion"');
      expect(body).toContain('"reasonCode"');
    }
  }
  const defs = JSON.parse(renderContractArtifactDocuments().jsonSchema).$defs;
  expect(defs.AdminFinanceClaim).toBeDefined();
  expect(api.components.schemas.AdminFinanceClaim).toBeUndefined();
});

test("refund OpenAPI excludes zero amounts in both totals and line allocations", () => {
  const api = JSON.parse(renderContractArtifactDocuments().openapi);
  const schema =
    api.paths["/api/v1/admin/finance/refund"].post.requestBody.content[
      "application/json"
    ].schema;
  expect(schema.properties.amountMinor.minimum).toBe(1);
  expect(
    schema.properties.allocations.items.properties.amountMinor.minimum,
  ).toBe(1);
});
