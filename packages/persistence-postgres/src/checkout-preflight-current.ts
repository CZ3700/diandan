import { lockCartWishBindings } from "./wish-binding.js";
import {
  checkoutPreflightCurrentSchema,
  checkoutPreflightInventoryFactsSchema,
  checkoutPreflightLineFactsSchema,
  checkoutPreflightPolicyFactsSchema,
  publishedContentReadCommandSchema,
  storefrontGiftReadCommandSchema,
  type CheckoutPreflightLoadCurrentCommand,
  type CheckoutPreflightLineFacts,
  type CheckoutPreflightInventoryFacts,
  type CartRuntimeHeader,
} from "@fan-support/contracts";
import {
  projectPublishedContent,
  projectPublishedGiftCommerce,
} from "@fan-support/content";
import { createStorefrontCommerceRepository } from "./storefront-commerce-repository.js";
import { loadPublishedContentContext } from "./published-content-repository.js";
import { checkoutContentSnapshot } from "./checkout-preflight-content.js";
import {
  authorizeCheckout,
  rejectCheckout,
} from "./checkout-preflight-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { cartTimestamp } from "./cart-runtime-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

async function currentLine(
  client: TransactionClient,
  scope: TransactionScopeControl,
  base: string,
  row: DraftRow,
  cart: CartRuntimeHeader,
  command: CheckoutPreflightLoadCurrentCommand,
) {
  if (
    row["intent_status"] !== "ACTIVE" ||
    row["privacy_state"] !== "ACTIVE" ||
    row["intent_expired"] !== false
  )
    return rejectCheckout("INTENT_UNAVAILABLE");
  const giftRead = await createStorefrontCommerceRepository(
    client,
    scope,
    base,
  ).loadGift(
    storefrontGiftReadCommandSchema.parse({
      schemaVersion: 1,
      handle: row["gift_handle"],
      locale: command.presentationLocale,
      market: cart.market,
      currency: cart.currency,
      idolId: row["idol_id"],
    }),
  );
  if (giftRead.outcome !== "SUCCESS")
    return rejectCheckout("CONTENT_UNAVAILABLE");
  const gift = projectPublishedGiftCommerce(giftRead.gift);
  if (gift.outcome !== "SUCCESS" || gift.content.view.status !== "active")
    return rejectCheckout("GIFT_UNAVAILABLE");
  if (giftRead.recipient.kind !== "PUBLISHED")
    return rejectCheckout("IDOL_UNAVAILABLE");
  const artist = projectPublishedContent(giftRead.recipient.context);
  if (
    artist.outcome !== "SUCCESS" ||
    artist.content.kind !== "IDOL" ||
    artist.content.view.id !== row["idol_id"] ||
    artist.content.view.status !== "active" ||
    !artist.content.view.acceptingGifts
  )
    return rejectCheckout("IDOL_UNAVAILABLE");
  const variant = gift.content.view.variants.find(
    (entry) => entry.id === row["gift_variant_id"],
  );
  const fact = giftRead.variants.find(
    (entry) => entry.giftVariantId === row["gift_variant_id"],
  );
  if (!variant || variant.status !== "active")
    return rejectCheckout("GIFT_UNAVAILABLE");
  if (!fact?.eligibleForSelectedRecipient)
    return rejectCheckout("RECIPIENT_INELIGIBLE");
  if (!fact.price) return rejectCheckout("PRICE_UNAVAILABLE");
  const context = giftRead.gift.context;
  const candidate =
    context.schemaVersion === 3
      ? {
          objectKind: context.current.document.kind,
          prices: context.current.prices,
          priceBooks: context.current.priceBooks,
        }
      : context.canonical.candidate;
  if (
    candidate.objectKind !== "GIFT" ||
    !candidate.prices.some(
      (price) =>
        price.id === fact.price!.priceId &&
        price.revision === fact.price!.priceRevision &&
        price.giftVariantId === variant.id &&
        price.unitAmountMinor === fact.price!.unitAmountMinor &&
        candidate.priceBooks.some(
          (book) =>
            book.id === price.priceBookId &&
            book.revision === price.priceBookRevision &&
            book.market === cart.market &&
            book.currency === cart.currency,
        ),
    )
  )
    return rejectCheckout("CONTENT_UNAVAILABLE");
  const profiles = await draftRows(
    client,
    `SELECT id FROM public.idol_fulfillment_profiles WHERE idol_id=$1::uuid AND status='ACTIVE' AND profile_ciphertext IS NOT NULL AND encrypted_data_key IS NOT NULL AND encryption_key_version IS NOT NULL FOR SHARE`,
    [row["idol_id"]],
  );
  if (profiles.length !== 1) return rejectCheckout("FULFILLMENT_UNAVAILABLE");
  const items = await draftRows(
    client,
    `SELECT id,gift_variant_id,sku,policy,status FROM public.inventory_items WHERE gift_variant_id=$1::uuid FOR SHARE`,
    [variant.id],
  );
  if (items.length > 1) return rejectCheckout("INSUFFICIENT_STOCK");
  const item = items[0];
  if (
    item &&
    (item["policy"] !== variant.inventoryPolicy || item["status"] !== "ACTIVE")
  )
    return rejectCheckout("INSUFFICIENT_STOCK");
  if (!item && variant.inventoryPolicy === "TRACKED")
    return rejectCheckout("INSUFFICIENT_STOCK");
  const idolSnapshot = checkoutContentSnapshot(
    giftRead.recipient.context,
    "PORTRAIT",
  );
  const giftSnapshot = checkoutContentSnapshot(context, "PRIMARY");
  const [eligibility] = await draftRows(
    client,
    `SELECT EXISTS(SELECT 1 FROM public.gift_variant_idol_eligibility WHERE gift_variant_id=$1::uuid AND idol_id=$2::uuid) explicit`,
    [variant.id, row["idol_id"]],
  );
  const line = checkoutPreflightLineFactsSchema.parse({
    schemaVersion: 1,
    cartItemId: row["id"],
    itemVersion: Number(row["version"]),
    supportIntentId: row["intent_id"],
    intentVersion: Number(row["intent_version"]),
    fulfillmentProfileId: profiles[0]!["id"],
    idolId: artist.content.view.id,
    idolHandle: artist.content.view.handle,
    idolDisplayName: artist.content.view.displayName,
    idolTranslation: idolSnapshot.translation,
    idolPortrait: idolSnapshot.media,
    giftId: gift.content.view.id,
    giftVariantId: variant.id,
    giftTitle: gift.content.view.title,
    giftVariantLabel: variant.label,
    giftTranslation: giftSnapshot.translation,
    giftImage: giftSnapshot.media,
    observedPriceId: row["observed_price_id"],
    ...fact.price,
    quantity: row["quantity"],
    displayMode: row["display_mode"],
    inventoryPolicy: variant.inventoryPolicy,
    inventoryItemId: item?.["id"] ?? null,
    eligibility:
      eligibility?.["explicit"] === true ? "EXPLICIT" : "ALL_ACTIVE_ARTISTS",
  });
  let inventory: CheckoutPreflightInventoryFacts | undefined;
  if (line.inventoryPolicy === "TRACKED" && item) {
    const locations = await draftRows(
      client,
      `SELECT l.id,l.location_key,l.status,b.on_hand::text,b.reserved::text,b.version::text FROM public.inventory_balances b JOIN public.inventory_locations l ON l.id=b.location_id WHERE b.inventory_item_id=$1::uuid AND l.status='ACTIVE' ORDER BY l.id FOR SHARE OF l`,
      [item["id"]],
    );
    if (locations.length === 0) return rejectCheckout("INSUFFICIENT_STOCK");
    inventory = checkoutPreflightInventoryFactsSchema.parse({
      schemaVersion: 1,
      cartItemId: line.cartItemId,
      inventoryItem: {
        schemaVersion: 1,
        id: item["id"],
        giftVariantId: variant.id,
        sku: item["sku"],
        policy: item["policy"],
        status: item["status"],
      },
      locations: locations.map((entry) => ({
        location: {
          schemaVersion: 1,
          id: entry["id"],
          code: entry["location_key"],
          status: entry["status"],
        },
        balance: {
          schemaVersion: 1,
          inventoryItemId: item["id"],
          inventoryLocationId: entry["id"],
          onHand: Number(entry["on_hand"]),
          reserved: Number(entry["reserved"]),
          version: Number(entry["version"]),
        },
      })),
    });
  }
  return { line, inventory };
}

export async function loadCheckoutCurrent(
  client: TransactionClient,
  scope: TransactionScopeControl,
  base: string,
  command: CheckoutPreflightLoadCurrentCommand,
) {
  const cart = await authorizeCheckout(
    client,
    command.accesses,
    command.cartId,
  );
  if (cart.version !== command.expectedCartVersion)
    return rejectCheckout("VERSION_CONFLICT");
  const items = await draftRows(
    client,
    `SELECT i.id,i.gift_variant_id,i.observed_price_id,i.quantity,i.display_mode,i.version::text,s.id intent_id,s.idol_id,s.version::text intent_version,s.status intent_status,s.privacy_state,s.expires_at<=clock_timestamp() intent_expired,g.handle gift_handle FROM public.cart_items i JOIN public.support_intents s ON s.cart_item_id=i.id JOIN public.gift_variants v ON v.id=i.gift_variant_id JOIN public.gifts g ON g.id=v.gift_id WHERE i.cart_id=$1::uuid AND s.status IS DISTINCT FROM 'CANCELED' ORDER BY i.id LIMIT 501 FOR UPDATE OF i,s`,
    [cart.id],
  );
  await lockCartWishBindings(client, cart.id);
  if (items.length === 0) return rejectCheckout("EMPTY_CART");
  if (items.length > 500) return rejectCheckout("CONTENT_UNAVAILABLE");
  const lines: CheckoutPreflightLineFacts[] = [],
    inventory: CheckoutPreflightInventoryFacts[] = [];
  for (const item of items) {
    const result = await currentLine(client, scope, base, item, cart, command);
    lines.push(result.line);
    if (result.inventory) inventory.push(result.inventory);
  }
  const keys = await draftRows(
    client,
    `SELECT p.policy_key FROM public.policies p JOIN public.policy_publication_heads h ON h.policy_key=p.policy_key ORDER BY p.policy_key COLLATE "C" LIMIT 501`,
  );
  if (keys.length === 0 || keys.length > 500)
    return rejectCheckout("POLICY_UNAVAILABLE");
  const policies = [];
  for (const key of keys) {
    const loaded = await loadPublishedContentContext(
      client,
      scope,
      publishedContentReadCommandSchema.parse({
        schemaVersion: 1,
        locator: { kind: "POLICY", policyKey: key["policy_key"] },
        locale: command.presentationLocale,
      }),
      base,
    );
    if (loaded.outcome !== "SUCCESS" || loaded.context.schemaVersion === 3)
      return rejectCheckout("POLICY_UNAVAILABLE");
    const projected = projectPublishedContent(loaded.context),
      snapshot = loaded.context.canonical.snapshot;
    if (
      projected.outcome !== "SUCCESS" ||
      projected.content.kind !== "POLICY" ||
      snapshot.content.kind !== "POLICY"
    )
      return rejectCheckout("POLICY_UNAVAILABLE");
    const audit = snapshot.translationAudits.find(
      (entry) => entry.locale === command.presentationLocale,
    );
    if (!audit) return rejectCheckout("POLICY_UNAVAILABLE");
    policies.push(
      checkoutPreflightPolicyFactsSchema.parse({
        schemaVersion: 1,
        policyKey: projected.content.view.policyKey,
        kind: projected.content.view.kind,
        locale: command.presentationLocale,
        policyRevisionId: snapshot.revisionId,
        policyTranslationRevisionId: audit.id,
        publicationId: loaded.context.publication.publicationId,
        manifestHash: loaded.context.publication.manifestHash,
        sourceHash: audit.sourceHash,
        title: projected.content.view.title,
        body: projected.content.view.body,
        effectiveAt: snapshot.content.structure.effectiveAt,
      }),
    );
  }
  const [now] = await draftRows(
    client,
    `SELECT ${cartTimestamp("clock_timestamp()")} evaluated_at`,
  );
  return checkoutPreflightCurrentSchema.parse({
    schemaVersion: 1,
    cart,
    evaluatedAt: now?.["evaluated_at"],
    consent: {
      schemaVersion: 1,
      cartId: cart.id,
      cartVersion: cart.version,
      presentationLocale: command.presentationLocale,
      market: cart.market,
      currency: cart.currency,
      lines,
      policies,
    },
    inventory,
  });
}
