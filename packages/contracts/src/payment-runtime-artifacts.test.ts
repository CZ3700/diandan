import { expect, it } from "vitest";
import { createContractArtifactDocuments } from "./artifact-documents.js";

it("publishes scoped payment requests while keeping internal configuration out of public OpenAPI", () => {
  const { openapi, jsonSchema } = createContractArtifactDocuments();
  const api = openapi as {
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
  const base = "/api/v1/checkout/sessions/{checkoutSessionId}";
  for (const path of [
    `${base}/attempts`,
    `${base}/attempts/{attemptId}/recover`,
  ]) {
    const operation = api.paths[path]?.["post"];
    expect(operation).toBeDefined();
    expect(operation?.security).toEqual([{ CartSession: [], CartCsrf: [] }]);
    expect(operation?.parameters).toContainEqual(
      expect.objectContaining({ name: "Idempotency-Key", required: true }),
    );
  }
  for (const path of [
    "/api/v1/checkout/current/status",
    `${base}/capabilities`,
    `${base}/attempts/{attemptId}`,
  ]) {
    expect(api.paths[path]?.["get"]?.security).toEqual([{ CartSession: [] }]);
    expect(api.paths[path]?.["get"]?.requestBody).toBeUndefined();
  }
  expect(api.components.schemas["PaymentRuntimeResponse"]).toBeDefined();
  expect(api.components.schemas["PaymentRuntimeCreateRequest"]).toBeDefined();
  expect(
    api.components.schemas["PaymentRuntimeProviderBinding"],
  ).toBeUndefined();
  expect(
    (jsonSchema["$defs"] as Record<string, unknown>)[
      "PaymentRuntimeProviderBinding"
    ],
  ).toBeDefined();
});
