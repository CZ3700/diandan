import { expect, test } from "vitest";
import { renderContractArtifactDocuments } from "./artifact-documents.js";

test("exception routes require current session, CSRF and exact recovery identity", () => {
  const documents = renderContractArtifactDocuments();
  const api = JSON.parse(documents.openapi);
  const paths = Object.keys(api.paths).filter((path) =>
    path.startsWith("/api/v1/admin/exceptions/"),
  );
  expect(paths).toHaveLength(7);
  for (const path of paths) {
    const operation = api.paths[path].post;
    expect(operation.security).toEqual([{ AdminSession: [], AdminCsrf: [] }]);
    const body = JSON.stringify(operation.requestBody);
    for (const secret of [
      "sessionToken",
      "csrfToken",
      "idempotencyKey",
      "rawBody",
      "ciphertext",
      "email",
      "credentialRef",
    ])
      expect(body).not.toContain(`"${secret}"`);
    const write = !["context", "list", "detail"].some((suffix) =>
      path.endsWith(`/${suffix}`),
    );
    if (write) {
      expect(operation.parameters).toContainEqual(
        expect.objectContaining({ name: "Idempotency-Key", required: true }),
      );
      for (const field of [
        "expectedVersion",
        "reasonCode",
        "confirmed",
        "target",
      ])
        expect(body).toContain(`"${field}"`);
    }
  }
  const roots = JSON.parse(documents.jsonSchema).$defs;
  for (const name of [
    "AdminExceptionsStoreRequest",
    "AdminExceptionsClaimRequest",
    "AdminExceptionsClaim",
    "AdminExceptionsSettleCommand",
    "AdminExceptionsSettleResult",
  ]) {
    expect(roots[name]).toBeDefined();
    expect(api.components.schemas[name]).toBeUndefined();
  }
});
