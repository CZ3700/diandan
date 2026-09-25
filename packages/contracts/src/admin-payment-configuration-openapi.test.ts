import { expect, test } from "vitest";
import { renderContractArtifactDocuments } from "./artifact-documents.js";
test("configuration operations bind session, CSRF, idempotency and reviewed publication", () => {
  const api = JSON.parse(renderContractArtifactDocuments().openapi);
  const paths = Object.keys(api.paths).filter((p) =>
    p.startsWith("/api/v1/admin/payment-configuration/"),
  );
  expect(paths).toHaveLength(7);
  for (const path of paths) {
    const op = api.paths[path].post;
    expect(op.security).toEqual([{ AdminSession: [], AdminCsrf: [] }]);
    const body = JSON.stringify(op.requestBody);
    for (const forbidden of [
      '"action"',
      '"sessionToken"',
      '"csrfToken"',
      '"idempotencyKey"',
      '"credentialRef"',
    ])
      expect(body).not.toContain(forbidden);
    if (!path.endsWith("read") && !path.endsWith("validate"))
      expect(op.parameters).toContainEqual(
        expect.objectContaining({ name: "Idempotency-Key", required: true }),
      );
    if (path.endsWith("publish") || path.endsWith("rollback")) {
      expect(body).toContain('"confirmed"');
      expect(body).toContain('"validationHash"');
      expect(body).toContain('"expectedPublicationId"');
    }
  }
  const defs = JSON.parse(renderContractArtifactDocuments().jsonSchema).$defs;
  expect(defs.AdminPaymentConfigurationStoreRequest).toBeDefined();
  expect(
    api.components.schemas.AdminPaymentConfigurationStoreRequest,
  ).toBeUndefined();
});
