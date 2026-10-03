import { expect, it } from "vitest";
import { createContractArtifactDocuments } from "./artifact-documents.js";
it("documents public gallery and same-order CSRF protected withdrawal separately", () => {
  const paths = createContractArtifactDocuments().openapi["paths"] as Record<
    string,
    Record<string, unknown>
  >;
  expect(paths["/api/v1/storefront/wish-gallery"]?.["get"]).toMatchObject({
    security: [],
    responses: {
      200: { headers: { "Cache-Control": { schema: { const: "no-store" } } } },
    },
  });
  expect(
    paths["/api/v1/orders/{publicOrderId}/wish-gallery/{entryId}/withdraw"]?.[
      "post"
    ],
  ).toMatchObject({
    security: [{ OrderSession: [], OrderCsrf: [] }],
    responses: {
      401: {
        headers: {
          "Cache-Control": { schema: { const: "private, no-store" } },
        },
      },
    },
  });
});
