import { expect, test } from "vitest";
import { renderContractArtifactDocuments } from "./artifact-documents.js";
test("admin orders exposes seventeen exact, authenticated commands with isolated private responses", () => {
  const api = JSON.parse(renderContractArtifactDocuments().openapi),
    paths = Object.entries(api.paths).filter(([key]) =>
      key.startsWith("/api/v1/admin/orders/"),
    );
  expect(paths).toHaveLength(17);
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
  // Proof reservations and attachments are replay-safe; completion and viewing are state reads.
  for (const [path, keyed] of [
    ["proof-uploads/begin", true],
    ["proof-uploads/complete", false],
    ["proofs/attach", true],
    ["proofs/withdraw", true],
    ["proofs/view", false],
  ] as const)
    expect(
      (
        api.paths[`/api/v1/admin/orders/${path}`].post.parameters as {
          name: string;
        }[]
      ).some((parameter) => parameter.name === "Idempotency-Key"),
      path,
    ).toBe(keyed);
  const definitions = JSON.parse(
    renderContractArtifactDocuments().jsonSchema,
  ).$defs;
  expect(definitions.AdminOrdersPrivateSnapshot).toBeDefined();
  expect(definitions.AdminOrderNoteEncryptCommand).toBeDefined();
});
