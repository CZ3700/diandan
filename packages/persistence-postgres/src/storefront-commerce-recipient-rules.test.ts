import { expect, test, vi } from "vitest";
import { readStorefrontVariantFacts } from "./storefront-commerce-data.js";

const id = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

async function capturedQuery(idolId: string | null) {
  const query = vi.fn(async () => ({
    rows: [
      {
        id: id(1),
        prices: [],
        inventory_policy: null,
        inventory_status: null,
        available_quantity: "0",
        eligible_for_selected: false,
        witness_id: null,
        witness_handle: null,
      },
    ],
  }));
  await readStorefrontVariantFacts(
    { query, release: vi.fn() },
    {
      giftId: id(2),
      variantIds: [id(1)],
      market: "TEST",
      currency: "USD",
      idolId,
    },
  );
  const call = query.mock.calls[0] as unknown as [string, unknown[]];
  return { sql: call[0].replace(/\s+/gu, " "), parameters: call[1] };
}

test("selected daily recipient rules require the exact active accepting published artist alongside legacy eligibility", async () => {
  const { sql, parameters } = await capturedQuery(id(3));
  const eligibility = sql.slice(
    sql.indexOf(" eligible_for_selected") === -1
      ? 0
      : sql.indexOf(" prices,") + " prices,".length,
    sql.indexOf(" eligible_for_selected"),
  );
  expect(eligibility).toContain("public.gift_variant_idol_eligibility");
  expect(eligibility).toContain("public.gift_variant_recipient_rules");
  expect(eligibility).toContain("eligibility.rule='ALL_ACTIVE_ARTISTS'");
  expect(eligibility).toContain("recipient.id=$5");
  expect(eligibility).toContain(
    "recipient.status='active' AND recipient.accepting_gifts",
  );
  expect(eligibility).toContain(
    "recipient_head.idol_revision_id=recipient.published_revision_id",
  );
  expect(parameters).toEqual([id(2), [id(1)], "TEST", "USD", id(3)]);
});

test("unselected daily gifts keep a bounded fully published active witness without requiring a legacy eligibility row", async () => {
  const { sql, parameters } = await capturedQuery(null);
  const witness = sql.slice(
    sql.indexOf("LEFT JOIN LATERAL"),
    sql.indexOf("witness ON"),
  );
  expect(witness).toContain("FROM public.idols idol");
  expect(witness).not.toContain(
    "FROM public.gift_variant_idol_eligibility eligibility JOIN public.idols",
  );
  expect(witness).toContain("idol.status='active' AND idol.accepting_gifts");
  expect(witness).toContain("eligibility.idol_id=idol.id");
  expect(witness).toContain(
    "OR EXISTS(SELECT 1 FROM public.gift_variant_recipient_rules eligibility",
  );
  expect(witness).toContain(
    "eligibility.gift_variant_id=variant.id AND eligibility.rule='ALL_ACTIVE_ARTISTS'",
  );
  expect(witness).toContain("head.idol_revision_id=idol.published_revision_id");
  expect(witness).toContain(
    "publication.idol_id=idol.id AND publication.idol_revision_id=head.idol_revision_id",
  );
  expect(witness).toContain(
    "revision.lifecycle=CASE publication.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END",
  );
  expect(witness).toContain(
    "NOT EXISTS(SELECT 1 FROM public.content_publications successor WHERE successor.replaces_publication_id=publication.id)",
  );
  expect(witness).toContain("ORDER BY idol.id LIMIT 1");
  expect(parameters.at(-1)).toBeNull();
});
