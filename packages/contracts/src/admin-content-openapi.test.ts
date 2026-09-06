import { expect, it } from "vitest";
import { createContractArtifactDocuments } from "./artifact-documents.js";
it("documents every secured admin content operation and token-body preview", () => {
  const doc = createContractArtifactDocuments().openapi;
  const paths = doc["paths"] as Record<
    string,
    { post: Record<string, unknown> }
  >;
  for (const path of [
    "/drafts/read",
    "/reviews/read",
    "/drafts/aliases",
    "/drafts/gift-details",
    "/reviews/submit",
    "/reviews/approve",
    "/preview/issue",
    "/preview/revoke",
  ]) {
    const operation = paths["/api/v1/admin/content" + path]?.post;
    expect(operation).toBeDefined();
    expect(operation?.["security"]).toEqual([
      { AdminSession: [], AdminCsrf: [] },
    ]);
    expect(operation?.["x-fan-support-rbac"]).toBeTypeOf("string");
  }
  expect(paths["/api/v1/content-preview/read"]?.post).toHaveProperty(
    "requestBody",
  );
});
