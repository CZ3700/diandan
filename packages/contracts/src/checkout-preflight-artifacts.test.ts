import { expect, test } from "vitest";
import { createContractArtifactDocuments } from "./artifact-documents.js";
test("checkout operations expose exact private requests, idempotency and read-only historical status", () => {
  const documents = createContractArtifactDocuments();
  const api = documents.openapi as {
    paths: Record<
      string,
      Record<
        string,
        {
          parameters: { name: string; required?: boolean }[];
          security: unknown[];
          requestBody?: unknown;
        }
      >
    >;
    components: { schemas: Record<string, unknown> };
  };
  for (const path of ["/api/v1/cart/validate", "/api/v1/checkout/sessions"]) {
    const operation = api.paths[path]?.["post"];
    expect(operation).toBeDefined();
    expect(operation?.parameters).toContainEqual(
      expect.objectContaining({ name: "Idempotency-Key", required: true }),
    );
    expect(operation?.security).toEqual([{ CartSession: [], CartCsrf: [] }]);
  }
  const status =
    api.paths["/api/v1/checkout/sessions/{checkoutSessionId}/status"]?.["get"];
  expect(status).toBeDefined();
  expect(status?.requestBody).toBeUndefined();
  for (const name of [
    "CheckoutPreflightResponse",
    "CheckoutPreflightCreateRequest",
  ])
    expect(api.components.schemas[name]).toBeDefined();
  const internal = documents.jsonSchema["$defs"] as Record<string, unknown>;
  for (const name of [
    "CheckoutPreflightObservation",
    "CheckoutPreflightCommitCommand",
  ]) {
    expect(internal[name]).toBeDefined();
    expect(api.components.schemas[name]).toBeUndefined();
  }
});
