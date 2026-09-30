import { expect, test, vi } from "vitest";
import { createManagementCenterOperationRepository } from "./management-center-operation-repository.js";
const id = "00000000-0000-4000-8000-000000000001";
const target = { kind: "ARTIST" as const, id, expectedVersion: 2 };
test("source reader rejects stale targets and cannot sign or guess from a shared master", async () => {
  const scope = "p.permission_key=ANY($2::text[])";
  const query = vi.fn(async (sql: string) => {
    // ADR-022: the account manages every artist, so only the target itself is read.
    if (sql.includes(scope))
      return { rows: [{ permission_key: "management.direct" }] };
    return {
      rows: sql.startsWith("SELECT")
        ? [{ id, version: 3, status: "active", published_revision_id: id }]
        : [],
    };
  });
  const repo = createManagementCenterOperationRepository(
    { query } as never,
    {
      trackOperation: (work: () => unknown) => work(),
      markRollbackOnly: () => {},
    } as never,
    "https://media.example.test",
  );
  expect(typeof repo.readImageSource).toBe("function");
  const result = await repo.readImageSource({
    target,
    principal: {
      schemaVersion: 1,
      actorId: id,
      sessionId: id,
      authorizedAt: "2026-09-28T00:00:00Z",
      expiresAt: "2026-09-28T01:00:00Z",
    },
  });
  expect(result).toMatchObject({ outcome: "FAILURE", code: "TARGET_CONFLICT" });
  expect(
    query.mock.calls.filter(
      (call) =>
        String(call[0]).startsWith("SELECT") &&
        !String(call[0]).includes(scope),
    ),
  ).toHaveLength(1);
});
