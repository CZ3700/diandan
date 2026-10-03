import {
  giftCommerceMutationSchema,
  giftCommerceWriteCommandSchema,
  type ManagementCenterClaim,
} from "@fan-support/contracts";
import {
  priceContext,
  loadCommerceBook,
} from "./gift-commerce-pricing-data.js";
import { writeCommercePrice } from "./gift-commerce-pricing-write.js";
import type { TransactionClient } from "./transaction-runner.js";

/** Called inside the fenced daily publication transaction; never opens or commits another transaction. */
export async function publishDailyGiftPrice(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  giftVariantId: string,
  eventTime: string,
): Promise<{ pricePublicationId: string }> {
  if (claim.intent.kind !== "SAVE_GIFT")
    throw new Error("Daily gift price requires a gift operation");
  const { market, currency, amountMinor } = claim.intent.price;
  const current = await priceContext(client, market, currency, true);
  if (!current || current.owner["status"] !== "ACTIVE")
    throw new Error("Daily price market unavailable");
  if (!current.head && current.authoringVersion !== 0)
    throw new Error("Daily price source is not published");
  const source = current.head
    ? await loadCommerceBook(
        client,
        String(current.head["price_book_id"]),
        Number(current.head["price_book_revision"]),
        true,
      )
    : null;
  if (current.head && (!source || !source.book.singleWindow))
    throw new Error("Daily price source unavailable");
  if (
    "commerceEdit" in claim.intent &&
    claim.intent.commerceEdit.price.mode === "PRESERVE"
  ) {
    if (
      !current.head ||
      !source ||
      !source.prices.some(
        (row) =>
          String(row["giftVariantId"]).toLowerCase() ===
          giftVariantId.toLowerCase(),
      )
    )
      throw new Error("Current gift price unavailable");
    return { pricePublicationId: String(current.head["publication_id"]) };
  }
  const common = {
    schemaVersion: 1,
    principal: {
      schemaVersion: 1,
      actorId: claim.actorId,
      sessionId: claim.sessionId,
      authorizedAt: eventTime,
      expiresAt: claim.authorizedUntil,
    },
    requestId: claim.requestId,
  };
  const command = {
    schemaVersion: 1,
    market,
    currency,
    expectedHeadVersion: current.headVersion,
    reasonCode: "MANAGEMENT_GIFT_PRICE",
    idempotencyKey: claim.operation.operationId,
  };
  const created = giftCommerceMutationSchema.parse(
    await writeCommercePrice(
      client,
      giftCommerceWriteCommandSchema.parse({
        ...common,
        command: {
          ...command,
          action: "CREATE_PRICE_REVISION",
          expectedBookRevision: current.authoringVersion,
          source: source
            ? {
                priceBookId: source.book.priceBookId,
                revision: source.book.revision,
                contentHash: source.book.contentHash,
              }
            : null,
          validFrom: source?.book.validFrom ?? eventTime,
          validUntil: source?.book.validUntil ?? null,
          changes: [{ giftVariantId, unitAmountMinor: amountMinor }],
        },
      }),
    ),
  );
  if (
    created.action !== "CREATE_PRICE_REVISION" ||
    created.market !== market ||
    created.currency !== currency ||
    created.headVersion !== current.headVersion
  )
    throw new Error("Daily price revision mismatch");
  // Validate the real creation receipt against the still-locked prior head.
  // Publishing below advances that head; its separate receipt remains deferred.
  await client.query(
    "SET CONSTRAINTS public.gift_price_revision_receipt_validate IMMEDIATE",
  );
  await client.query(
    "SET CONSTRAINTS public.gift_price_revision_receipt_validate DEFERRED",
  );
  const published = giftCommerceMutationSchema.parse(
    await writeCommercePrice(
      client,
      giftCommerceWriteCommandSchema.parse({
        ...common,
        command: {
          ...command,
          action: "PUBLISH_PRICE_BOOK",
          priceBookId: created.priceBookId,
          revision: created.revision,
          expectedContentHash: created.contentHash,
        },
      }),
    ),
  );
  if (
    published.action !== "PUBLISH_PRICE_BOOK" ||
    published.priceBookId !== created.priceBookId ||
    published.revision !== created.revision ||
    published.contentHash !== created.contentHash ||
    published.headVersion !== current.headVersion + 1
  )
    throw new Error("Daily price publication mismatch");
  return { pricePublicationId: published.publicationId };
}
