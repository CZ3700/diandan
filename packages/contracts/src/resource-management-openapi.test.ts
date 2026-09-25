import { expect, it } from "vitest";
import { renderContractArtifactDocuments } from "./artifact-documents.js";
it("documents private resource commands with explicit permissions and no client authority", () => {
  const { paths } = JSON.parse(renderContractArtifactDocuments().openapi);
  for (const [path, permission, write] of [
    ["policies/read", "content.policy.manage", false],
    ["policies/register", "content.policy.manage", true],
    ["uploads/begin", "content.media.upload", true],
    ["uploads/read", "content.media.upload", false],
    ["uploads/complete", "content.media.upload", true],
    ["media/read", "content.media.read", false],
    ["media/rights", "content.media.rights", true],
    ["processing/enqueue", "content.media.process", true],
    ["processing/read", "content.media.read", false],
    ["processing/retry", "content.media.process", true],
  ] as const) {
    const operation = paths["/api/v1/admin/resources/" + path]?.post;
    expect(operation).toBeDefined();
    expect(operation.security).toEqual([{ AdminSession: [], AdminCsrf: [] }]);
    expect(operation["x-fan-support-rbac"]).toBe(permission);
    const schema = operation.requestBody.content["application/json"].schema;
    expect(schema.additionalProperties).toBe(false);
    for (const field of [
      "actorId",
      "sessionId",
      "objectKey",
      "receipt",
      "action",
      "idempotencyKey",
    ])
      expect(schema.properties).not.toHaveProperty(field);
    expect(
      operation.parameters.some(
        (p: { name: string }) => p.name === "Idempotency-Key",
      ),
    ).toBe(write);
    expect(operation.requestBody["x-fan-support-max-body-bytes"]).toBe(65536);
    for (const response of Object.values(operation.responses) as {
      headers: Record<string, { schema: { const: string } }>;
    }[])
      expect(response.headers["Cache-Control"]?.schema.const).toBe(
        "private, no-store",
      );
  }
});
