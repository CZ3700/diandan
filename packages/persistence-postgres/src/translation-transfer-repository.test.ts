import { expect, test, vi } from "vitest";
const path = "./translation-transfer-repository.js";
test("translation receipt lookup rejects malformed ids before SQL", async () => {
  const module = await import(path).catch(() => ({}));
  expect(module.createTranslationTransferRepository).toBeDefined();
  const query = vi.fn();
  const repository = module.createTranslationTransferRepository(
    { query },
    { trackOperation: (work: () => unknown) => work() },
  );
  expect(
    (await repository.readExport({ schemaVersion: 1, id: "' OR true" })).code,
  ).toBe("INVALID_COMMAND");
  expect(query).not.toHaveBeenCalled();
});
test("receipt reread decodes the PostgreSQL custom locale enum array", async () => {
  const { createTranslationTransferRepository } =
    await import("./translation-transfer-repository.js");
  const id = "00000000-0000-4000-8000-000000000001";
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes("translation_export_receipts")
      ? [
          {
            id,
            idol_revision_id: id,
            expected_authoring_version: 1,
            source_snapshot_hash: "a".repeat(64),
            english_source_hash: "b".repeat(64),
            // pg leaves unknown custom enum[] OIDs as wire strings; JSON is decoded.
            locales: sql.includes("to_jsonb(r.locales)") ? ["ja"] : "{ja}",
            actor_id: id,
            session_id: id,
            created_at_text: "2026-09-07T00:00:00.123456Z",
          },
        ]
      : [{ value: { idol_id: id } }],
  }));
  const repository = createTranslationTransferRepository(
    { query, release: vi.fn() },
    {
      trackOperation: (work) => work(),
    } as Parameters<typeof createTranslationTransferRepository>[1],
  );
  const result = await repository.readExport({ schemaVersion: 1, id });
  expect(result.outcome).toBe("SUCCESS");
  if (result.outcome === "SUCCESS")
    expect(result.receipt.locales).toEqual(["ja"]);
});
