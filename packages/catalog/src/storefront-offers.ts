import {
  storefrontGiftOffersInputSchema,
  storefrontGiftOfferSchema,
  lineAmountCalculationInputSchema,
  type StorefrontGiftOffer,
} from "@fan-support/contracts";

/** Availability is a current browse result; it never grants cart or checkout authority. */
export function projectStorefrontGiftOffers(
  input: unknown,
): StorefrontGiftOffer[] {
  const parsed = storefrontGiftOffersInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("STOREFRONT_OFFER_DATA_INVALID");
  const { giftStatus, recipient, variants, facts } = parsed.data;
  const byId = new Map(
    facts.map((fact) => [fact.giftVariantId.toLowerCase(), fact]),
  );
  if (
    byId.size !== facts.length ||
    facts.length !== variants.length ||
    new Set(variants.map((variant) => variant.id.toLowerCase())).size !==
      variants.length
  )
    throw new Error("STOREFRONT_OFFER_DATA_INVALID");
  return variants.map((variant) => {
    const fact = byId.get(variant.id.toLowerCase());
    if (!fact) throw new Error("STOREFRONT_OFFER_DATA_INVALID");
    const policy = variant.inventoryPolicy;
    const itemValid =
      fact.inventoryItem === null
        ? policy !== "TRACKED"
        : fact.inventoryItem.status === "ACTIVE" &&
          fact.inventoryItem.policy === policy;
    let reason: StorefrontGiftOffer["reason"] = null;
    if (giftStatus !== "active") reason = "GIFT_PAUSED";
    else if (variant.status !== "active") reason = "VARIANT_PAUSED";
    else if (
      recipient.kind === "UNAVAILABLE" ||
      (recipient.kind === "PUBLISHED" &&
        (recipient.idol.status !== "active" || !recipient.idol.acceptingGifts))
    )
      reason = "RECIPIENT_UNAVAILABLE";
    else if (
      recipient.kind === "PUBLISHED" &&
      !fact.eligibleForSelectedRecipient
    )
      reason = "NOT_ELIGIBLE";
    else if (recipient.kind === "NONE" && !fact.hasEligibleRecipient)
      reason = "NO_ELIGIBLE_RECIPIENT";
    else if (fact.price === null) reason = "PRICE_UNAVAILABLE";
    else if (!itemValid) reason = "INVENTORY_UNAVAILABLE";
    else if (
      policy === "TRACKED" &&
      fact.maximumLocationAvailableQuantity === 0
    )
      reason = "OUT_OF_STOCK";
    const stock =
      policy === "TRACKED"
        ? {
            kind: policy,
            availableQuantity: fact.maximumLocationAvailableQuantity,
          }
        : { kind: policy };
    return storefrontGiftOfferSchema.parse({
      giftVariantId: variant.id,
      price: fact.price,
      availability:
        reason !== null
          ? "UNAVAILABLE"
          : policy === "PREORDER"
            ? "PREORDER"
            : "AVAILABLE",
      reason,
      requiresRecipient: recipient.kind === "NONE",
      stock,
      maxQuantity:
        reason !== null
          ? 0
          : policy === "TRACKED"
            ? fact.maximumLocationAvailableQuantity
            : lineAmountCalculationInputSchema.shape.quantity.parse(
                Number.MAX_SAFE_INTEGER,
              ),
    });
  });
}
