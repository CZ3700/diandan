import { describe, expect, test } from "vitest";

import {
  buildGiftDirectoryQuery,
  buildIdolDirectoryQuery,
} from "./catalog-directory-sql.js";

describe("catalog directory SQL boundaries", () => {
  test("single-source artist search is a distinct hash-bound projection without manufactured locale reviews", () => {
    const { text } = buildIdolDirectoryQuery({
      locale: "ja",
      searchTerm: "原文",
      take: 12,
      anchorId: null,
      afterId: null,
    });
    expect(text).toContain("public.idol_daily_search_projections");
    expect(text).toContain(
      "daily_projection.source_translation_id = daily.source_translation_id",
    );
    expect(text).toContain(
      "daily_projection.source_hash = daily.document#>>'{source,sourceHash}'",
    );
    expect(text).toContain(
      "daily_projection.document_hash = daily.document_hash",
    );
    expect(text).toContain("WHERE revision.proof_version=3");
    expect(text).toContain("WHERE revision.proof_version IN(1,2)");
    expect(text.match(/WHERE revision.proof_version=2/gu)).toHaveLength(1);
    expect(text).toContain("translation_id IS NULL OR projection_id IS NULL");
    expect(text).toContain("public.daily_publication_manifests");
  });
  test("daily gifts use the actual revision and recipient rule without requiring translated rows", () => {
    const { text } = buildGiftDirectoryQuery({
      locale: "ja",
      market: "TEST",
      currency: "USD",
      idolId: null,
      category: null,
      kind: null,
      priceMinMinor: null,
      priceMaxMinor: null,
      availability: "ALL",
      sort: "RECOMMENDED",
      take: 12,
      offset: 0,
    });
    expect(text).toContain(
      "LEFT JOIN public.gift_revision_translations translation",
    );
    expect(text).toContain("translation ON publication.proof_version IN(1,2)");
    expect(text).toContain(
      "publication.proof_version=3 OR translation.id IS NOT NULL",
    );
    expect(text.match(/rule='ALL_ACTIVE_ARTISTS'/gu)).toHaveLength(2);
    expect(text).toContain(
      "recipient.status = 'active' AND recipient.accepting_gifts",
    );
    expect(text).toContain(
      "recipient_head.idol_revision_id = recipient.published_revision_id",
    );
    expect(text).toContain("public.daily_publication_revisions");
  });
  test("approved aliases join only the current revision and bind the complete set hash", () => {
    const query = buildIdolDirectoryQuery({
      locale: "ja",
      searchTerm: "alias",
      take: 12,
      anchorId: null,
      afterId: null,
    });
    expect(query.text).toContain("idol_alias_search_projections");
    expect(query.text).toContain(
      "alias_projection.content_hash = alias_set.content_hash",
    );
    expect(query.text).toContain(
      "alias_review.reviewed_content_hash = alias_set.content_hash",
    );
    expect(query.text).toContain("alias_review.status = 'APPROVED'");
    expect(query.text).toContain("content_publication_manifests");
    expect(query.text).toContain("media_processing_jobs");
  });
  test("artist search uses literal substring matching and positional values", () => {
    const query = buildIdolDirectoryQuery({
      locale: "th",
      searchTerm: "'_%\\; drop table idols; --",
      take: 13,
      anchorId: null,
      afterId: null,
    });
    expect(query.text).not.toContain("drop table");
    expect(query.values).toEqual([
      "th",
      "'_%\\; drop table idols; --",
      null,
      null,
      13,
    ]);
    expect(query.text).toContain("strpos(");
    expect(query.text).not.toMatch(/\bILIKE\b/u);
  });

  test("artist query checks projection lineage and returns a window after deterministic ordering", () => {
    const query = buildIdolDirectoryQuery({
      locale: "en",
      take: 41,
      searchTerm: null,
      anchorId: "10000000-0000-4000-8000-000000000001",
      afterId: null,
    });
    expect(query.text).toContain(
      "projection.source_hash = translation.source_hash",
    );
    expect(query.text).toContain("projection.algorithm_version = 1");
    expect(query.text).toContain("ORDER BY match_rank, display_order, id");
    expect(query.text).toContain("LIMIT $5");
  });

  test("artist matching considers every published name and ranks each artist only once", () => {
    const query = buildIdolDirectoryQuery({
      locale: "en",
      searchTerm: "luna",
      take: 2,
      anchorId: null,
      afterId: null,
    });
    expect(query.text).toContain("requested_translation.locale = $1");
    expect(query.text).not.toMatch(/\btranslation\.locale = \$1/u);
    expect(query.text).toContain("min(CASE");
    expect(query.text).toContain("GROUP BY id, display_order");
    expect(query.text).toContain("revision.id = head.idol_revision_id");
  });

  test("gift query separates eligibility scope, purchasable minimum and pagination", () => {
    const query = buildGiftDirectoryQuery({
      locale: "ja",
      market: "TEST",
      currency: "USD",
      idolId: null,
      category: null,
      kind: null,
      priceMinMinor: 0,
      priceMaxMinor: 1000,
      availability: "ALL",
      sort: "PRICE_DESC",
      take: 12,
      offset: 12,
    });
    expect(query.values).toEqual([
      "ja",
      "TEST",
      "USD",
      null,
      null,
      0,
      1000,
      "ALL",
      12,
      12,
      null,
    ]);
    expect(query.text).toContain("min(price.amount_minor)");
    expect(query.text).toContain("price_minor DESC NULLS LAST, id ASC");
    expect(query.text).toContain("transaction_timestamp()");
    expect(query.text).toContain("price_book_publication_heads");
    expect(query.text).toContain("balance.on_hand > balance.reserved");
    expect(query.text).toContain("LIMIT $9 OFFSET $10");
  });

  test("gift kind filters the candidates before pagination and travels with each window row", () => {
    const query = buildGiftDirectoryQuery({
      locale: "en",
      market: "TEST",
      currency: "USD",
      idolId: null,
      category: null,
      kind: "WISH",
      priceMinMinor: null,
      priceMaxMinor: null,
      availability: "ALL",
      sort: "RECOMMENDED",
      take: 12,
      offset: 0,
    });
    expect(query.values.at(-1)).toBe("WISH");
    expect(query.values).toHaveLength(11);
    expect(query.text).toContain(
      "LEFT JOIN public.daily_publication_revisions kind_document ON kind_document.gift_revision_id = revision.id",
    );
    expect(query.text).toContain(
      "LEFT JOIN public.gift_revision_profiles kind_profile ON kind_profile.gift_revision_id = revision.id AND kind_profile.gift_id = gift.id",
    );
    expect(query.text).toContain(
      "coalesce(kind_document.document->>'giftKind', kind_profile.gift_kind) AS gift_kind",
    );
    expect(query.text).toContain("AND ($11::text IS NULL OR gift_kind = $11)");
    expect(query.text).toContain("'giftKind', gift_kind");
  });

  test("nontracked variants may omit inventory items but existing paused items remain unavailable", () => {
    const query = buildGiftDirectoryQuery({
      locale: "en",
      market: "TEST",
      currency: "USD",
      idolId: null,
      category: null,
      kind: null,
      priceMinMinor: null,
      priceMaxMinor: null,
      availability: "ALL",
      sort: "RECOMMENDED",
      take: 12,
      offset: 0,
    });
    expect(query.text).toContain(
      "LEFT JOIN public.inventory_items item ON item.gift_variant_id = variant.id",
    );
    expect(query.text).toContain(
      "item.id IS NULL OR (item.status = 'ACTIVE' AND item.policy = variant.inventory_policy)",
    );
  });
});
