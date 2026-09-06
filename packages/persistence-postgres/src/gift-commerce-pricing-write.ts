import { type GiftCommerceWriteCommand } from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import {
  commerceFailure,
  commerceTime,
  commerceAudit,
  commerceCommandHash,
  priceContext,
  loadCommerceBook,
  readPriceReceipt,
} from "./gift-commerce-pricing-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export async function writeCommercePrice(
  client: TransactionClient,
  input: GiftCommerceWriteCommand,
) {
  const c = input.command;
  if (
    c.action !== "CREATE_PRICE_REVISION" &&
    c.action !== "PUBLISH_PRICE_BOOK" &&
    c.action !== "ROLLBACK_PRICE_BOOK"
  )
    return commerceFailure("INVALID_COMMAND");
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const context = await priceContext(client, c.market, c.currency, true);
  if (!context) return commerceFailure("NOT_FOUND");
  if (context.owner["status"] !== "ACTIVE")
    return commerceFailure("PRICE_BOOK_NOT_READY");
  if (context.headVersion !== c.expectedHeadVersion)
    return commerceFailure("STALE_VERSION");
  if (c.action === "CREATE_PRICE_REVISION") {
    if (context.authoringVersion !== c.expectedBookRevision)
      return commerceFailure("STALE_VERSION");
    const source = c.source
      ? await loadCommerceBook(
          client,
          c.source.priceBookId,
          c.source.revision,
          true,
        )
      : null;
    if (c.source && !source) return commerceFailure("NOT_FOUND");
    if (
      source &&
      (source.book.market !== c.market || source.book.currency !== c.currency)
    )
      return commerceFailure("NOT_FOUND");
    if (source && source.book.contentHash !== c.source?.contentHash)
      return commerceFailure("STALE_CONTENT");
    if (source && !source.book.singleWindow)
      return commerceFailure("UNSUPPORTED_PRICE_SOURCE");
    const amounts = new Map<string, { amount: number; revision: number }>();
    for (const row of source?.prices ?? [])
      amounts.set(String(row["giftVariantId"]), {
        amount: Number(row["unitAmountMinor"]),
        revision: Number(row["priceRevision"]) + 1,
      });
    for (const row of c.changes)
      amounts.set(row.giftVariantId.toLowerCase(), {
        amount: row.unitAmountMinor,
        revision: amounts.get(row.giftVariantId.toLowerCase())?.revision ?? 1,
      });
    const variants = await draftRows(
      client,
      "SELECT id FROM public.gift_variants WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
      [Array.from(amounts.keys())],
    );
    if (variants.length !== amounts.size) return commerceFailure("NOT_FOUND");
    const event = await commerceTime(
      client,
      input.principal,
      "pricing.manage",
      source ? [String(source.raw["created_at"])] : [],
    );
    const [newIds] = await draftRows(
      client,
      "SELECT gen_random_uuid() AS book_id",
    );
    const bookId = source?.book.priceBookId ?? String(newIds?.["book_id"]);
    const revision = context.authoringVersion + 1;
    await client.query(
      `INSERT INTO public.price_books(id,market_id,market,currency,revision,lifecycle,valid_from,valid_until,created_by,created_at)
   VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9)`,
      [
        bookId,
        context.owner["id"],
        c.market,
        c.currency,
        revision,
        c.validFrom,
        c.validUntil,
        input.principal.actorId,
        event.at,
      ],
    );
    for (const [variantId, price] of [...amounts].sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      await client.query(
        `INSERT INTO public.prices(id,price_book_id,price_book_revision,market,currency,gift_variant_id,revision,amount_minor,valid_from,valid_to,status,created_at)
   VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10)`,
        [
          bookId,
          revision,
          c.market,
          c.currency,
          variantId,
          price.revision,
          price.amount,
          c.validFrom,
          c.validUntil,
          event.at,
        ],
      );
    const created = await loadCommerceBook(client, bookId, revision);
    if (!created) return commerceFailure("COMMERCE_UNAVAILABLE");
    await commerceAudit(
      client,
      input,
      event,
      "CREATE_PRICE_REVISION",
      "PRICE_BOOK_REVISION",
      event.id,
    );
    await client.query(
      `INSERT INTO public.gift_price_revision_receipts(id,price_book_id,revision,expected_book_revision,expected_head_version,source_price_book_id,source_revision,source_content_hash,content_hash,actor_id,session_id,audit_log_id,request_id,reason_code,command_hash,created_at,changed_variant_ids)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        event.id,
        bookId,
        revision,
        c.expectedBookRevision,
        c.expectedHeadVersion,
        c.source?.priceBookId ?? null,
        c.source?.revision ?? null,
        c.source?.contentHash ?? null,
        created.book.contentHash,
        input.principal.actorId,
        input.principal.sessionId,
        event.auditId,
        input.requestId,
        c.reasonCode,
        commerceCommandHash(c),
        event.at,
        c.changes.map((p) => p.giftVariantId.toLowerCase()).sort(),
      ],
    );
    return readPriceReceipt(client, event.id, input.principal.actorId);
  }
  const target = await loadCommerceBook(
    client,
    c.priceBookId,
    c.revision,
    true,
  );
  if (
    !target ||
    target.book.market !== c.market ||
    target.book.currency !== c.currency
  )
    return commerceFailure("NOT_FOUND");
  if (target.book.contentHash !== c.expectedContentHash)
    return commerceFailure("STALE_CONTENT");
  if (
    c.action === "PUBLISH_PRICE_BOOK" &&
    target.book.lifecycle.status !== "DRAFT" &&
    target.book.lifecycle.status !== "VALIDATED"
  )
    return commerceFailure("PRICE_BOOK_NOT_READY");
  if (c.action === "ROLLBACK_PRICE_BOOK") {
    if (
      target.book.lifecycle.status !== "SUPERSEDED" ||
      (context.head?.["price_book_id"] === c.priceBookId &&
        Number(context.head?.["price_book_revision"]) === c.revision)
    )
      return commerceFailure("PRICE_BOOK_NOT_READY");
    const [history] = await draftRows(
      client,
      "SELECT id FROM public.price_book_publications WHERE price_book_id=$1 AND price_book_revision=$2 AND market=$3 AND currency=$4 LIMIT 1",
      [c.priceBookId, c.revision, c.market, c.currency],
    );
    if (!history) return commerceFailure("PRICE_BOOK_NOT_READY");
  }
  const [window] = await draftRows(
    client,
    "SELECT $1::timestamptz<=clock_timestamp() AND ($2::timestamptz IS NULL OR $2::timestamptz>clock_timestamp()) AS valid",
    [target.book.validFrom, target.book.validUntil],
  );
  if (!window?.["valid"] || target.prices.length === 0)
    return commerceFailure("INVALID_PRICE_WINDOW");
  const bounds = [
    String(target.raw["created_at"]),
    ...["validated_at", "published_at", "superseded_at"].flatMap((k) =>
      typeof target.raw[k] === "string" ? [String(target.raw[k])] : [],
    ),
  ];
  if (context.head) {
    const [prior] = await draftRows(
      client,
      `SELECT ${utcTimestampSql("(updated_at+interval '1 microsecond')")} AS at FROM public.price_book_publication_heads WHERE id=$1`,
      [context.head["id"]],
    );
    bounds.push(String(prior?.["at"]));
  }
  const event = await commerceTime(
    client,
    input.principal,
    "pricing.manage",
    bounds,
  );
  const [ids] = await draftRows(
    client,
    "SELECT gen_random_uuid() AS publication_id,gen_random_uuid() AS head_id,gen_random_uuid() AS outbox_id",
  );
  const publicationId = String(ids?.["publication_id"]);
  if (context.head) {
    await client.query(
      "UPDATE public.price_books SET lifecycle='SUPERSEDED',superseded_at=$3 WHERE id=$1 AND revision=$2 AND lifecycle='PUBLISHED'",
      [
        context.head["price_book_id"],
        context.head["price_book_revision"],
        event.at,
      ],
    );
    await client.query(
      "UPDATE public.prices SET status='SUPERSEDED' WHERE price_book_id=$1 AND price_book_revision=$2 AND status='PUBLISHED'",
      [context.head["price_book_id"], context.head["price_book_revision"]],
    );
  }
  if (c.action === "PUBLISH_PRICE_BOOK") {
    if (target.book.lifecycle.status === "DRAFT")
      await client.query(
        "UPDATE public.price_books SET lifecycle='VALIDATED',validated_at=$3 WHERE id=$1 AND revision=$2",
        [c.priceBookId, c.revision, event.at],
      );
    await client.query(
      "UPDATE public.price_books SET lifecycle='PUBLISHED',published_at=$3 WHERE id=$1 AND revision=$2",
      [c.priceBookId, c.revision, event.at],
    );
    await client.query(
      "UPDATE public.prices SET status='PUBLISHED' WHERE price_book_id=$1 AND price_book_revision=$2",
      [c.priceBookId, c.revision],
    );
  }
  const action = c.action === "PUBLISH_PRICE_BOOK" ? "PUBLISH" : "ROLLBACK";
  await commerceAudit(
    client,
    input,
    event,
    action === "PUBLISH" ? "PRICE_BOOK_PUBLISH" : "PRICE_BOOK_ROLLBACK",
    "PRICE_BOOK_PUBLICATION",
    publicationId,
  );
  await client.query(
    `INSERT INTO public.price_book_publications(id,price_book_id,price_book_revision,market_id,market,currency,action,replaces_publication_id,manifest_hash,published_by,audit_log_id,published_at,idempotency_key)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      publicationId,
      c.priceBookId,
      c.revision,
      context.owner["id"],
      c.market,
      c.currency,
      action,
      context.head?.["publication_id"] ?? null,
      target.book.contentHash,
      input.principal.actorId,
      event.auditId,
      event.at,
      `gift-price:${event.id}`,
    ],
  );
  if (context.head)
    await client.query(
      "UPDATE public.price_book_publication_heads SET publication_id=$2,price_book_id=$3,price_book_revision=$4,version=version+1,updated_at=$5 WHERE id=$1",
      [context.head["id"], publicationId, c.priceBookId, c.revision, event.at],
    );
  else
    await client.query(
      `INSERT INTO public.price_book_publication_heads(id,market_id,market,currency,publication_id,price_book_id,price_book_revision,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8)`,
      [
        ids?.["head_id"],
        context.owner["id"],
        c.market,
        c.currency,
        publicationId,
        c.priceBookId,
        c.revision,
        event.at,
      ],
    );
  await client.query(
    `INSERT INTO public.outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,secondary_subject_id,market,currency,idempotency_key,request_id,correlation_id,occurred_at,available_at,created_at)
 VALUES($1,'PRICE_BOOK_PUBLISHED','PRICE_BOOK',$2,$3,$4,$2,$5,$6,$7,$8,$8,$9::timestamptz,$9::timestamptz,$9::timestamptz)`,
    [
      ids?.["outbox_id"],
      c.priceBookId,
      c.revision,
      publicationId,
      c.market,
      c.currency,
      `price-book-publication:${publicationId}`,
      input.requestId,
      event.at,
    ],
  );
  await client.query(
    `INSERT INTO public.gift_price_publication_receipts(id,publication_id,action,price_book_id,revision,expected_head_version,result_head_version,content_hash,actor_id,session_id,audit_log_id,request_id,reason_code,command_hash,created_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      event.id,
      publicationId,
      c.action,
      c.priceBookId,
      c.revision,
      c.expectedHeadVersion,
      c.expectedHeadVersion + 1,
      target.book.contentHash,
      input.principal.actorId,
      input.principal.sessionId,
      event.auditId,
      input.requestId,
      c.reasonCode,
      commerceCommandHash(c),
      event.at,
    ],
  );
  return readPriceReceipt(client, event.id, input.principal.actorId);
}
