import { expect, test } from "vitest";
import { renderContractArtifactDocuments } from "./artifact-documents.js";
test("admin orders exposes twelve exact, authenticated commands with isolated private responses", () => {
  const api = JSON.parse(renderContractArtifactDocuments().openapi),
    paths = Object.entries(api.paths).filter(([key]) =>
      key.startsWith("/api/v1/admin/orders/"),
    );
  expect(paths).toHaveLength(12);
  for (const [path, value] of paths) {
    const post = (value as { post: Record<string, unknown> }).post;
    expect(post["security"]).toEqual([{ AdminSession: [], AdminCsrf: [] }]);
    const body = JSON.stringify(post["requestBody"]);
    expect(body).not.toContain('"action"');
    expect(body).not.toContain('"sessionToken"');
    expect(body).not.toContain('"idempotencyKey"');
    expect(JSON.stringify(post["responses"])).toContain(
      ["message/read", "notes/read"].some((s) => path.endsWith(s))
        ? "AdminOrdersPrivateResponse"
        : "AdminOrdersResponse",
    );
  }
  expect(JSON.stringify(api.paths["/api/v1/admin/orders/hold"])).toContain(
    "Idempotency-Key",
  );
  const definitions = JSON.parse(
    renderContractArtifactDocuments().jsonSchema,
  ).$defs;
  expect(definitions.AdminOrdersPrivateSnapshot).toBeDefined();
  expect(definitions.AdminOrderNoteEncryptCommand).toBeDefined();
});
