import { expect, test } from "vitest";
import { renderContractArtifactDocuments } from "./artifact-documents.js";

test("documents the read-only publication preflight and its actual strict body", () => {
  const document = JSON.parse(renderContractArtifactDocuments().openapi);
  const operation =
    document.paths["/api/v1/admin/content/publication/preflight"]?.post;
  expect(operation).toBeDefined();
  expect(operation.security).toEqual([{ AdminSession: [], AdminCsrf: [] }]);
  expect(operation["x-fan-support-rbac"]).toBe("content.read");
  expect(operation.description).toContain("all seven locales");
  expect(operation.description).toContain("does not publish");
  const body = operation.requestBody.content["application/json"].schema;
  expect(body.additionalProperties).toBe(false);
  expect(Object.keys(body.properties).sort()).toEqual([
    "action",
    "schemaVersion",
    "target",
  ]);
  expect(body.properties.action.enum).toEqual(["PUBLISH", "ROLLBACK"]);
  expect(
    operation.parameters.some(
      (value: { name: string }) => value.name === "Idempotency-Key",
    ),
  ).toBe(false);
  for (const status of [
    "200",
    "400",
    "401",
    "403",
    "404",
    "409",
    "413",
    "503",
  ]) {
    const response = operation.responses[status];
    expect(response.headers["Cache-Control"].schema.const).toBe(
      "private, no-store",
    );
    expect(response.headers["Referrer-Policy"].schema.const).toBe(
      "no-referrer",
    );
  }
});
