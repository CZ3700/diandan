import { randomUUID } from "node:crypto";
import { seedGiftCommerceMarket } from "./postgres-gift-commerce-fixtures.mjs";
/** Legacy draft source evidence is produced before 0020 with ordinary constraints. */
export async function seedGiftCommerceLegacyPrices(client, { editor }) {
  const { rows: variants } = await client.query(
    "SELECT id FROM public.gift_variants ORDER BY id LIMIT 2",
  );
  const {
    rows: [currency],
  } = await client.query(
    "SELECT default_currency FROM public.markets ORDER BY market LIMIT 1",
  );
  const market = await seedGiftCommerceMarket(client, {
    market: `SRC_${randomUUID().slice(0, 8).toUpperCase()}`,
    currency: currency.default_currency,
  });
  const bookId = randomUUID();
  await client.query("BEGIN");
  try {
    for (const revision of [1, 2])
      await client.query(
        "INSERT INTO public.price_books(id,market_id,market,currency,revision,lifecycle,valid_from,valid_until,created_by) VALUES($1,$2,$3,$4,$5,'DRAFT','2026-01-01T00:00:00Z','2099-01-01T00:00:00Z',$6)",
        [
          bookId,
          market.marketId,
          market.market,
          market.currency,
          revision,
          editor,
        ],
      );
    for (const [index, v] of variants.entries())
      await client.query(
        "INSERT INTO public.prices(id,price_book_id,price_book_revision,market,currency,gift_variant_id,revision,amount_minor,valid_from,valid_to,status) VALUES(gen_random_uuid(),$1,1,$2,$3,$4,1,$5,'2026-01-01T00:00:00Z','2099-01-01T00:00:00Z','DRAFT')",
        [bookId, market.market, market.currency, v.id, 100 + index],
      );
    for (const [index, [start, end]] of [
      ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"],
      ["2026-01-02T00:00:00Z", "2099-01-01T00:00:00Z"],
    ].entries())
      await client.query(
        "INSERT INTO public.prices(id,price_book_id,price_book_revision,market,currency,gift_variant_id,revision,amount_minor,valid_from,valid_to,status) VALUES(gen_random_uuid(),$1,2,$2,$3,$4,$5,100,$6,$7,'DRAFT')",
        [
          bookId,
          market.market,
          market.currency,
          variants[0].id,
          index + 1,
          start,
          end,
        ],
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { ...market, bookId, variantId: variants[0].id };
}
export async function verifyGiftCommercePriceSealing({
  client,
  pricing,
  write,
  tx,
  legacy,
  check,
}) {
  const read = (revision) =>
    tx(() =>
      pricing.read({
        schemaVersion: 1,
        action: "READ_PRICES",
        market: legacy.market,
        currency: legacy.currency,
        revision,
        page: 1,
        pageSize: 50,
      }),
    );
  const source = await read(1),
    multi = await read(2);
  check(
    [source.book.singleWindow, multi.book.singleWindow],
    [true, false],
    "legacy multi-window source is represented without dropping rows",
  );
  const command = (book) => ({
    action: "CREATE_PRICE_REVISION",
    market: legacy.market,
    currency: legacy.currency,
    expectedBookRevision: 2,
    expectedHeadVersion: 0,
    source: {
      priceBookId: book.priceBookId,
      revision: book.revision,
      contentHash: book.contentHash,
    },
    validFrom: book.validFrom,
    validUntil: book.validUntil,
    changes: [{ giftVariantId: legacy.variantId, unitAmountMinor: 222 }],
  });
  check(
    (await write(pricing, command(multi.book))).code,
    "UNSUPPORTED_PRICE_SOURCE",
    "multi-window source is explicitly rejected instead of collapsed",
  );
  const copy = await write(pricing, command(source.book));
  check(
    copy.outcome,
    "SUCCESS",
    "explicit legacy draft source can be copied and sealed",
  );
  const failures = [];
  for (const [revision, label] of [
    [3, "new authored draft price set cannot shrink"],
    [1, "copied legacy draft source price set cannot shrink"],
  ]) {
    await client.query("BEGIN");
    let rejected = false;
    try {
      await client.query(
        "DELETE FROM public.prices WHERE price_book_id=$1 AND price_book_revision=$2 AND gift_variant_id=$3",
        [legacy.bookId, revision, legacy.variantId],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    } catch (error) {
      if (error.code !== "55000") throw error;
      rejected = true;
    } finally {
      await client.query("ROLLBACK");
    }
    if (!rejected) failures.push(label);
  }
  check(failures, [], "target and source sealed drafts reject price deletion");
  check(
    (await read(1)).book.contentHash,
    source.book.contentHash,
    "legacy source remains byte-identical after copy",
  );
}
