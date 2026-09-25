import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

async function readMigration(direction: "up" | "down"): Promise<string> {
  const migrationPath = path.join(
    workspaceRoot,
    `database/migrations/0006_publication-heads-outbox.${direction}.sql`,
  );

  return readFile(migrationPath, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
}

describe("publication current-head migration", () => {
  test("uses explicit typed heads for every publishable owner", async () => {
    const upSql = await readMigration("up");

    for (const tableName of [
      "idol_publication_heads",
      "gift_publication_heads",
      "homepage_publication_heads",
      "policy_publication_heads",
      "media_metadata_publication_heads",
      "site_locale_config_publication_heads",
      "price_book_publication_heads",
      "payment_config_publication_heads",
    ]) {
      expect(upSql).toContain(`CREATE TABLE public.${tableName}`);
    }

    expect(upSql).toContain("CREATE TABLE public.price_book_publications");
    expect(upSql).not.toMatch(/\bentity_type\b|\bjsonb\b/iu);
  });

  test("binds each publication, head, audit row, and exact outbox tuple", async () => {
    const upSql = await readMigration("up");

    expect(upSql).toContain(
      "ALTER TABLE public.content_publications ADD COLUMN audit_log_id",
    );
    expect(upSql).toContain(
      "CREATE UNIQUE INDEX outbox_content_publication_locale_unique",
    );
    expect(upSql).toContain(
      "ON public.outbox_events (event_type, primary_subject_id, locale)",
    );
    expect(upSql).toContain(
      "CREATE UNIQUE INDEX outbox_noncontent_publication_source_unique",
    );
    expect(upSql).toContain("PRICE_BOOK_PUBLISHED");
    expect(upSql).toContain("'PRICE_BOOK'");
    expect(upSql).toContain("public.assert_content_publication_heads");
    expect(upSql).toContain("public.assert_price_book_publication_heads");
    expect(upSql).toContain("public.assert_payment_config_publication_heads");
    expect(upSql).toContain("public.assert_publication_outbox_source");
    expect(
      upSql.match(/DEFERRABLE INITIALLY DEFERRED/gu)?.length ?? 0,
    ).toBeGreaterThanOrEqual(20);
    expect(upSql).toContain("audit.outcome <> 'SUCCEEDED'");
    expect(upSql).toContain("outbox.aggregate_version = 1");
    expect(upSql).toContain("locale_event_count <> 7");
    expect(upSql).toContain(
      "'content-publication:' || publication.id::text || ':' || outbox.locale::text",
    );
    for (const localeSourceTable of [
      "idol_revision_translations",
      "gift_revision_translations",
      "homepage_revision_translations",
      "policy_revision_translations",
      "media_metadata_revision_translations",
      "site_locale_config_entries",
    ]) {
      expect(upSql).toContain(`public.${localeSourceTable}`);
    }
  });

  test("keeps rollback immutable while enforcing one linear publication leaf", async () => {
    const upSql = await readMigration("up");

    expect(upSql).toContain("lifecycle IN ('PUBLISHED', 'SUPERSEDED')");
    expect(upSql).toContain("content_publications_idol_root_unique");
    expect(upSql).toContain("content_publications_gift_root_unique");
    expect(upSql).toContain("content_publications_homepage_root_unique");
    expect(upSql).toContain("content_publications_policy_root_unique");
    expect(upSql).toContain("content_publications_media_root_unique");
    expect(upSql).toContain("content_publications_site_locale_root_unique");
    expect(upSql).toContain("price_book_publications_root_unique");
    expect(upSql).toContain("payment_config_publications_root_unique");
    expect(upSql).toContain(
      "content publication leaf must equal its typed current head",
    );
    expect(upSql).toContain(
      "price-book publication leaf must equal its current head",
    );
    expect(upSql).toContain(
      "payment-config publication leaf must equal its current head",
    );
    expect(upSql).toContain(
      "idol published pointer must equal its current head",
    );
    expect(upSql).toContain(
      "gift published pointer must equal its current head",
    );
  });

  test("backfills pre-0006 publication history without requiring an empty database", async () => {
    const upSql = await readMigration("up");

    expect(upSql).not.toContain(
      "migration 0006 requires empty preexisting publication history",
    );
    expect(upSql).toContain(
      "ALTER TABLE public.content_publications ADD COLUMN audit_log_id uuid",
    );
    expect(upSql).toContain("MIGRATION_BACKFILL");
    expect(upSql).toContain("INSERT INTO public.idol_publication_heads");
    expect(upSql).toContain("INSERT INTO public.gift_publication_heads");
    expect(upSql).toContain("INSERT INTO public.homepage_publication_heads");
    expect(upSql).toContain("INSERT INTO public.policy_publication_heads");
    expect(upSql).toContain(
      "INSERT INTO public.media_metadata_publication_heads",
    );
    expect(upSql).toContain(
      "INSERT INTO public.site_locale_config_publication_heads",
    );
    expect(upSql).toContain(
      "INSERT INTO public.payment_config_publication_heads",
    );
    expect(upSql).toMatch(
      /ALTER TABLE public\.content_publications\s+ALTER COLUMN audit_log_id SET NOT NULL/u,
    );
  });

  test("has a data-preserving down migration for content and payment history", async () => {
    const downSql = await readMigration("down");

    expect(downSql).toContain(
      "ALTER TABLE public.content_publications DROP COLUMN audit_log_id",
    );
    expect(downSql).toContain(
      "DROP INDEX public.outbox_content_publication_locale_unique",
    );
    expect(downSql).toContain(
      "DROP INDEX public.outbox_noncontent_publication_source_unique",
    );
    expect(downSql).not.toContain(
      "EXISTS (SELECT 1 FROM public.content_publications)",
    );
    expect(downSql).not.toContain(
      "EXISTS (SELECT 1 FROM public.payment_config_publications)",
    );
    expect(downSql).toContain(
      "migration 0006 cannot be reverted after price-book publication history exists",
    );
    expect(downSql).toContain("'PRICE_BOOK_PUBLISHED'");

    for (const tableName of [
      "payment_config_publication_heads",
      "price_book_publication_heads",
      "price_book_publications",
      "site_locale_config_publication_heads",
      "media_metadata_publication_heads",
      "policy_publication_heads",
      "homepage_publication_heads",
      "gift_publication_heads",
      "idol_publication_heads",
    ]) {
      expect(downSql).toContain(`DROP TABLE public.${tableName}`);
    }
  });

  test("hardens every 0006 trigger function against search-path hijacking", async () => {
    const upSql = await readMigration("up");
    const functionNames = [
      "guard_publication_head_transition",
      "assert_content_publication_heads",
      "assert_price_book_publication_heads",
      "assert_payment_config_publication_heads",
      "assert_publication_outbox_source",
    ];

    for (const functionName of functionNames) {
      expect(upSql).toMatch(
        new RegExp(
          String.raw`CREATE FUNCTION public\.${functionName}\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY INVOKER\s+SET search_path = pg_catalog, public, pg_temp`,
          "u",
        ),
      );
    }

    expect(upSql.match(/CREATE FUNCTION /gu)?.length ?? 0).toBe(
      functionNames.length,
    );
  });
});
