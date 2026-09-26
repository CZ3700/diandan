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
  expect(query.values).toEqual(["th", "FLOWERS", null, 12, 12, null]);
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

test("gift kind is read from the published revision's daily document, then its profile, before pagination", () => {
  const query = buildGiftBrowseQuery(
    giftBrowseQuerySchema.parse({
      schemaVersion: 1,
      locale: "en",
      kind: "VIRTUAL",
    }),
  );
  expect(query.values).toEqual(["en", null, null, 12, 0, "VIRTUAL"]);
  expect(query.text).toContain(
    "LEFT JOIN public.daily_publication_revisions kind_document ON kind_document.gift_revision_id = revision.id",
  );
  expect(query.text).toContain(
    "LEFT JOIN public.gift_revision_profiles kind_profile ON kind_profile.gift_revision_id = revision.id AND kind_profile.gift_id = gift.id",
  );
  expect(query.text).toContain(
    "coalesce(kind_document.document->>'giftKind', kind_profile.gift_kind) AS gift_kind",
  );
  expect(query.text).toContain("($6::text IS NULL OR gift_kind = $6::text)");
  const [filter, window] = [
    query.text.indexOf("$6::text IS NULL"),
    query.text.indexOf("LIMIT $4"),
  ];
  expect(filter).toBeGreaterThan(-1);
  expect(filter).toBeLessThan(window);
  expect(query.text).toContain(
    "jsonb_agg(jsonb_build_array(id, gift_kind) ORDER BY published_at DESC,id ASC)",
  );
});
