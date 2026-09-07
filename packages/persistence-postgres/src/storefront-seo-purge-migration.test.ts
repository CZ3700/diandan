import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const migrations = new URL("../../../database/migrations/", import.meta.url);
const file = (name: string) => readFile(new URL(name, migrations), "utf8");
function guard(sql: string) {
  const start = sql.indexOf("CREATE ");
  const end = sql.indexOf("\nEND; $$;", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + "\nEND; $$;".length);
}
const original = async () => {
  const sql = await file("0018_publication-runtime.up.sql");
  return guard(
    sql.slice(sql.indexOf("CREATE FUNCTION public.guard_content_purge_job()")),
  );
};

for (const direction of ["up", "down"] as const) {
  test(`0021 ${direction} preserves every unrelated guard condition and state transition`, async () => {
    const sql = await file(`0021_storefront-seo-purge.${direction}.sql`);
    expect(sql.match(/CREATE OR REPLACE FUNCTION /gu)).toHaveLength(1);
    expect(sql).not.toMatch(/(?:ALTER|DROP|CREATE)\s+(?:TABLE|TRIGGER)/iu);
    const restored = guard(sql)
      .replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION")
      .replace(
        "expected_paths text[]; expanded_paths text[];",
        "expected_paths text[];",
      )
      .replace(
        '    SELECT array_agg(path ORDER BY path COLLATE "C") INTO expanded_paths\n' +
          "      FROM unnest(expected_paths||ARRAY['/sitemap.xml*',root||'/sitemap.xml*','/api/v1/storefront-seo/*']) AS paths(path);\n",
        "",
      )
      .replace(
        "(NEW.paths IS DISTINCT FROM expected_paths AND NEW.paths IS DISTINCT FROM expanded_paths)",
        "NEW.paths IS DISTINCT FROM expected_paths",
      )
      .replace(
        "      IF NEW.paths IS DISTINCT FROM expected_paths THEN RAISE EXCEPTION 'root purge jobs require legacy paths after rollback' USING ERRCODE='23514'; END IF;\n",
        "",
      );
    expect(restored).toBe(await original());
  });

  test(`0021 ${direction} allows only exact legacy/expanded sets and exact failed predecessor retries`, async () => {
    const sql = await file(`0021_storefront-seo-purge.${direction}.sql`);
    expect(sql).toContain(
      "(NEW.paths IS DISTINCT FROM expected_paths AND NEW.paths IS DISTINCT FROM expanded_paths)",
    );
    expect(sql).toContain(
      "ARRAY['/sitemap.xml*',root||'/sitemap.xml*','/api/v1/storefront-seo/*']",
    );
    expect(sql).toContain('array_agg(path ORDER BY path COLLATE "C")');
    expect(sql).toContain(
      "SELECT * INTO parent FROM public.content_purge_jobs WHERE id=NEW.retry_of FOR UPDATE;",
    );
    expect(sql).toContain("parent.status<>'FAILED'");
    expect(sql).toContain("NEW.paths IS DISTINCT FROM parent.paths");
    expect(sql).not.toMatch(/paths\s*(?:<@|@>|&&)|LIKE|SIMILAR TO/iu);
    expect(
      sql.includes("root purge jobs require legacy paths after rollback"),
    ).toBe(direction === "down");
  });
}
