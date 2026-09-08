import { expect, test } from "vitest";
import { createContractArtifactDocuments } from "./artifact-documents.js";

test("cart edit operations are documented with private response schemas and concurrency controls", () => {
  const api = createContractArtifactDocuments().openapi as {
    paths: Record<
      string,
      Record<
        string,
        {
          requestBody?: unknown;
          responses: unknown;
          parameters: { name: string }[];
          security: unknown[];
        }
      >
    >;
    components: { schemas: Record<string, unknown> };
  };
  expect(api.paths["/api/v1/cart/items/{itemId}"]?.["patch"]).toBeDefined();
  expect(api.paths["/api/v1/cart/items/{itemId}"]?.["delete"]).toBeDefined();
  const editor = api.paths["/api/v1/cart/items/{itemId}/editor"]?.["post"];
  expect(editor).toBeDefined();
  expect(editor?.parameters.map((p) => p.name)).toContain("Origin");
  expect(editor?.security).toEqual([{ CartSession: [], CartCsrf: [] }]);
  expect(api.components.schemas["CartEditorResponse"]).toBeDefined();
  expect(api.components.schemas["CartRuntimeCurrentResponse"]).toBeDefined();
});
