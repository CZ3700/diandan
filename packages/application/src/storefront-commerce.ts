import {
  storefrontContextReadCommandSchema,
  storefrontContextResponseSchema,
  storefrontGiftReadCommandSchema,
  storefrontGiftContextResponseSchema,
  storefrontGiftResponseSchema,
  storefrontGiftRecipientSchema,
  type StorefrontContextResponse,
  type StorefrontGiftResponse,
  type StorefrontGiftContextResponse,
  type StorefrontGiftRecipient,
} from "@fan-support/contracts";
import {
  projectPublishedContent,
  projectPublishedGiftCommerce,
} from "@fan-support/content";
import { projectStorefrontGiftOffers } from "@fan-support/catalog";
import type {
  StorefrontCommerceTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";

const failure = <
  Code extends "INVALID_QUERY" | "CONTENT_UNAVAILABLE" | "COMMERCE_UNAVAILABLE",
>(
  code: Code,
) => ({ schemaVersion: 1, outcome: "FAILURE", code }) as const;
const sameId = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
type Loaded = Extract<StorefrontGiftContextResponse, { outcome: "SUCCESS" }>;
function projectRecipient(
  loaded: Loaded,
  boundArtistId?: string,
): StorefrontGiftRecipient {
  const { recipient, command } = loaded;
  const recipientId = boundArtistId ?? command.idolId;
  if (recipient.kind === "NONE") {
    if (recipientId !== undefined) throw new Error("Invalid recipient binding");
    return recipient;
  }
  if (recipientId === undefined) throw new Error("Invalid recipient binding");
  if (recipient.kind === "UNAVAILABLE") {
    if (!sameId(recipientId, recipient.idolId))
      throw new Error("Invalid recipient binding");
    return recipient;
  }
  const result = projectPublishedContent(recipient.context);
  if (result.outcome !== "SUCCESS" || result.content.kind !== "IDOL")
    throw new Error("Invalid recipient publication");
  const {
    id,
    handle,
    status,
    acceptingGifts,
    localeContext,
    displayName,
    portrait,
  } = result.content.view;
  if (
    !sameId(recipientId, id) ||
    localeContext.requestedLocale !== command.locale ||
    (localeContext.schemaVersion === 2
      ? localeContext.resolvedLocale !== localeContext.sourceLocale ||
        localeContext.fallbackUsed !==
          (command.locale !== localeContext.sourceLocale)
      : localeContext.resolvedLocale !== command.locale ||
        localeContext.fallbackUsed)
  )
    throw new Error("Invalid recipient binding");
  return storefrontGiftRecipientSchema.parse({
    kind: "PUBLISHED",
    idol: {
      schemaVersion: 1,
      id,
      handle,
      status,
      acceptingGifts,
      localeContext,
      displayName,
      portrait,
    },
  });
}

/** The read port supplies all content and commerce facts from the same SERIALIZABLE transaction. */
export function createStorefrontCommerceUseCases({
  transactions,
}: {
  transactions: StorefrontCommerceTransactionManager;
}) {
  return Object.freeze({
    async readContext(input: unknown): Promise<StorefrontContextResponse> {
      const command = storefrontContextReadCommandSchema.safeParse(input);
      if (!command.success) return failure("INVALID_QUERY");
      try {
        return storefrontContextResponseSchema.parse(
          await transactions.runInStorefrontCommerceTransaction(
            async ({ storefrontCommerce }) =>
              storefrontContextResponseSchema.parse(
                await storefrontCommerce.readContext(command.data),
              ),
          ),
        );
      } catch {
        return failure("COMMERCE_UNAVAILABLE");
      }
    },
    async readGift(input: unknown): Promise<StorefrontGiftResponse> {
      const command = storefrontGiftReadCommandSchema.safeParse(input);
      if (!command.success) return failure("INVALID_QUERY");
      try {
        return storefrontGiftResponseSchema.parse(
          await transactions.runInStorefrontCommerceTransaction(
            async ({ storefrontCommerce }) => {
              const loaded = storefrontGiftContextResponseSchema.parse(
                await storefrontCommerce.loadGift(command.data),
              );
              if (loaded.outcome === "FAILURE") return loaded;
              if (
                JSON.stringify(loaded.command) !== JSON.stringify(command.data)
              )
                return failure("CONTENT_UNAVAILABLE");
              const gift = projectPublishedGiftCommerce(loaded.gift);
              if (
                gift.outcome !== "SUCCESS" ||
                gift.content.view.handle !== command.data.handle ||
                gift.content.view.localeContext.requestedLocale !==
                  command.data.locale ||
                (gift.content.view.localeContext.schemaVersion === 1 &&
                  (gift.content.view.localeContext.resolvedLocale !==
                    command.data.locale ||
                    gift.content.view.localeContext.fallbackUsed))
              )
                return failure("CONTENT_UNAVAILABLE");
              const context = loaded.gift.context;
              const candidate =
                context.schemaVersion === 3
                  ? {
                      objectKind: context.current.document.kind,
                      prices: context.current.prices,
                      priceBooks: context.current.priceBooks,
                    }
                  : context.canonical.candidate;
              if (candidate.objectKind !== "GIFT")
                return failure("CONTENT_UNAVAILABLE");
              // A selected SQL price must also be part of the canonical current-price evidence.
              for (const fact of loaded.variants) {
                if (
                  fact.price !== null &&
                  !candidate.prices.some(
                    (price) =>
                      sameId(price.id, fact.price!.priceId) &&
                      price.revision === fact.price!.priceRevision &&
                      sameId(price.giftVariantId, fact.giftVariantId) &&
                      price.unitAmountMinor === fact.price!.unitAmountMinor &&
                      candidate.priceBooks.some(
                        (book) =>
                          sameId(book.id, price.priceBookId) &&
                          book.revision === price.priceBookRevision &&
                          book.market === command.data.market &&
                          book.currency === command.data.currency,
                      ),
                  )
                )
                  return failure("CONTENT_UNAVAILABLE");
              }
              const recipient = projectRecipient(
                loaded,
                "wish" in gift.content.view
                  ? gift.content.view.wish?.artistId
                  : undefined,
              );
              const offers = projectStorefrontGiftOffers({
                schemaVersion: 1,
                giftStatus: gift.content.view.status,
                variants: gift.content.view.variants,
                recipient,
                facts: loaded.variants,
              });
              return JSON.parse(
                JSON.stringify(
                  storefrontGiftResponseSchema.parse({
                    ...gift,
                    kind: "STOREFRONT_GIFT",
                    market: command.data.market,
                    currency: command.data.currency,
                    recipient,
                    offers,
                  }),
                ),
              ) as JsonValue;
            },
          ),
        );
      } catch {
        return failure("CONTENT_UNAVAILABLE");
      }
    },
  });
}
