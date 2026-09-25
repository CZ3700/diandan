import { expect, test, vi } from "vitest";
import { createAdminCatalogRepository } from "./admin-catalog-repository.js";
test("malformed management commands never reach PostgreSQL", async () => {
  const query = vi.fn();
  const repo = createAdminCatalogRepository(
    { query, release: () => undefined },
    {
      trackOperation: async (work) => work(),
      markRollbackOnly: () => undefined,
    },
    "https://media.example.test",
  );
  expect(await repo.write({ schemaVersion: 1 } as never)).toMatchObject({
    code: "INVALID_COMMAND",
  });
  expect(query).not.toHaveBeenCalled();
});
test("an unregistered handle resolves safely without exposing internal evidence", async () => {
  const query = vi.fn(async () => ({ rows: [] }));
  const repo = createAdminCatalogRepository(
    { query, release: () => undefined },
    {
      trackOperation: async (work) => work(),
      markRollbackOnly: () => undefined,
    },
    "https://media.example.test",
  );
  expect(
    await repo.resolveHandle({ schemaVersion: 1, handle: "absent" as never }),
  ).toMatchObject({ code: "NOT_FOUND" });
});
