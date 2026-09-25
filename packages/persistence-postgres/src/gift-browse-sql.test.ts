import { expect, test } from "vitest";
import { giftBrowseQuerySchema } from "@fan-support/contracts";
import { buildGiftBrowseQuery } from "./gift-browse-sql.js";

test("gift browsing has bounded stable pagination and no market or offer dependency", () => {
  const query = buildGiftBrowseQuery(
    giftBrowseQuerySchema.parse({
      schemaVersion: 1,
      locale: "th",
      page: 2,
      category: "FLOWERS",
    }),
  );
  expect(query.values).toEqual(["th", "FLOWERS", null, 12, 12]);
  expect(query.text).toContain("ORDER BY published_at DESC, id ASC");
  expect(query.text).toContain("LIMIT $4::integer OFFSET $5::integer");
  expect(query.text).toContain("replaces_publication_id = publication.id");
  expect(query.text).toContain("gift.published_revision_id");
  expect(query.text).toContain("ALL_ACTIVE_ARTISTS");
  expect(query.text).toContain("recipient.accepting_gifts");
  expect(query.text).not.toMatch(
    /public\.(prices|price_books|markets|inventory_balances)/u,
  );
});
test("browse version includes actual gift and media publication state", () => {
  const query = buildGiftBrowseQuery(
    giftBrowseQuerySchema.parse({ schemaVersion: 1, locale: "en" }),
  );
  for (const table of [
    "gifts",
    "gift_publication_heads",
    "gift_revision_translations",
    "content_publication_manifests",
    "daily_publication_revisions",
    "daily_publication_manifests",
    "media_assets",
    "media_variants",
    "media_metadata_revisions",
  ])
    expect(query.text).toContain(`public.${table}`);
  expect(query.text).toContain("sha256");
});
