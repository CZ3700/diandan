import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
test("information pages have dedicated immutable localized history and typed publication outbox", () => {
  const sql = readFileSync(
    fileURLToPath(
      new URL(
        "../../../database/migrations/0049_information-pages.up.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  for (const name of [
    "information_page_heads",
    "information_page_revisions",
    "information_page_revision_translations",
    "information_page_translation_reviews",
    "information_page_translation_copy_evidence",
    "information_page_publications",
    "information_page_receipts",
  ])
    expect(sql).toContain(`CREATE TABLE ${name}`);
  expect(sql).toContain("INFORMATION_PAGE_PUBLICATION_CHANGED");
  expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
  expect(sql).not.toContain("ALTER TABLE policies");
});
