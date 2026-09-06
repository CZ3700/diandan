import {
  giftCommerceRawContextSchema,
  giftCommerceReadResponseSchema,
  type GiftCommerceReadCommand,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import {
  commerceFailure,
  priceContext,
  loadCommerceBook,
} from "./gift-commerce-pricing-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export async function readCommercePrices(
  client: TransactionClient,
  command: GiftCommerceReadCommand,
) {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  if (command.action === "CONTEXT") {
    const markets = await draftRows(
      client,
      `SELECT m.id,m.market,to_jsonb(ARRAY(SELECT currency FROM (SELECT m.default_currency AS currency UNION SELECT b.currency FROM public.price_books b WHERE b.market_id=m.id) currencies ORDER BY currency)) AS currencies FROM public.markets m WHERE m.status='ACTIVE' ORDER BY m.market LIMIT 501`,
    );
    const locations = await draftRows(
      client,
      "SELECT id,location_key,status FROM public.inventory_locations ORDER BY location_key LIMIT 2001",
    );
    return giftCommerceRawContextSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "COMMERCE_CONTEXT",
      markets: markets.map((m) => ({
        marketId: m["id"],
        market: m["market"],
        currencies: m["currencies"],
      })),
      inventoryLocations: locations.map((l) => ({
        schemaVersion: 1,
        id: l["id"],
        code: l["location_key"],
        status: l["status"],
      })),
    });
  }
  if (command.action !== "READ_PRICES")
    return commerceFailure("INVALID_COMMAND");
  const context = await priceContext(client, command.market, command.currency);
  if (!context) return commerceFailure("NOT_FOUND");
  const common = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    market: command.market,
    currency: command.currency,
    authoringVersion: context.authoringVersion,
    head: context.publicHead,
    page: command.page,
    pageSize: command.pageSize,
  };
  if (command.revision === null) {
    const [count] = await draftRows(
      client,
      "SELECT count(*) AS total FROM public.price_books WHERE market=$1 AND currency=$2",
      [command.market, command.currency],
    );
    const rows = await draftRows(
      client,
      "SELECT id,revision FROM public.price_books WHERE market=$1 AND currency=$2 ORDER BY revision DESC LIMIT $3 OFFSET $4",
      [
        command.market,
        command.currency,
        command.pageSize,
        (command.page - 1) * command.pageSize,
      ],
    );
    const books = [];
    for (const row of rows) {
      const loaded = await loadCommerceBook(
        client,
        String(row["id"]),
        Number(row["revision"]),
      );
      if (!loaded) return commerceFailure("COMMERCE_UNAVAILABLE");
      books.push(loaded.book);
    }
    return giftCommerceReadResponseSchema.parse({
      ...common,
      kind: "PRICE_BOOKS",
      totalItems: Number(count?.["total"] ?? 0),
      items: books,
    });
  }
  const [row] = await draftRows(
    client,
    "SELECT id FROM public.price_books WHERE market=$1 AND currency=$2 AND revision=$3",
    [command.market, command.currency, command.revision],
  );
  if (!row) return commerceFailure("NOT_FOUND");
  const loaded = await loadCommerceBook(
    client,
    String(row["id"]),
    command.revision,
  );
  if (!loaded) return commerceFailure("NOT_FOUND");
  return giftCommerceReadResponseSchema.parse({
    ...common,
    kind: "PRICES",
    book: loaded.book,
    totalItems: loaded.prices.length,
    items: loaded.prices
      .slice(
        (command.page - 1) * command.pageSize,
        command.page * command.pageSize,
      )
      .map((p) => ({
        schemaVersion: 1,
        ...p,
        priceBookId: loaded.book.priceBookId,
        priceBookRevision: loaded.book.revision,
      })),
  });
}
