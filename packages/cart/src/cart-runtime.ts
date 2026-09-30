import {
  cartRuntimeAddDecisionInputSchema,
  cartRuntimeAddDecisionSchema,
  cartRuntimeCommandSchema,
  cartRuntimeProjectionInputSchema,
  cartRuntimeViewSchema,
  cartRuntimeItemViewSchema,
  cartRuntimeAvailabilityReasonSchema,
  CART_RUNTIME_MAX_QUANTITY,
  type CartRuntimeAddDecision,
  type CartRuntimeFailure,
  type CartRuntimeFailureCode,
  type CartRuntimeItemRecord,
  type CartRuntimeItemView,
  type CartRuntimeView,
  type StorefrontGiftResponse,
  type SupportedLocale,
} from "@fan-support/contracts";

type Current = Extract<StorefrontGiftResponse, { outcome: "SUCCESS" }>;
type Selection = {
  current: Current;
  variant: Current["content"]["view"]["variants"][number];
  offer: Current["offers"][number];
  idol: Extract<Current["recipient"], { kind: "PUBLISHED" }>["idol"];
};
const failure = (code: CartRuntimeFailureCode): CartRuntimeFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const sameId = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/** This is a pure consumer of the existing, transaction-local commerce projection. */
function selectCurrent(
  request: {
    giftId: string;
    giftVariantId: string;
    idolId: string;
    presentationLocale: SupportedLocale;
    market: string;
    currency: string;
  },
  current: StorefrontGiftResponse,
): Selection | CartRuntimeFailure {
  if (current.outcome === "FAILURE") {
    if (current.code === "NOT_FOUND") return failure("GIFT_UNAVAILABLE");
    if (current.code === "MARKET_UNAVAILABLE")
      return failure("PRICE_UNAVAILABLE");
    return failure("CONTENT_UNAVAILABLE");
  }
  if (
    current.market !== request.market ||
    current.currency !== request.currency
  )
    return failure("SCOPE_MISMATCH");
  const gift = current.content.view;
  if (!sameId(gift.id, request.giftId)) return failure("GIFT_UNAVAILABLE");
  if (
    gift.localeContext.requestedLocale !== request.presentationLocale ||
    (gift.primaryMedia.schemaVersion === 2 &&
      gift.primaryMedia.localeContext.requestedLocale !==
        request.presentationLocale)
  )
    return failure("CONTENT_UNAVAILABLE");
  if (
    current.recipient.kind !== "PUBLISHED" ||
    !sameId(current.recipient.idol.id, request.idolId)
  )
    return failure("IDOL_UNAVAILABLE");
  const idol = current.recipient.idol;
  if (
    idol.localeContext.requestedLocale !== request.presentationLocale ||
    (idol.portrait.schemaVersion === 2 &&
      idol.portrait.localeContext.requestedLocale !==
        request.presentationLocale)
  )
    return failure("CONTENT_UNAVAILABLE");
  const variant = gift.variants.find((entry) =>
    sameId(entry.id, request.giftVariantId),
  );
  const offer = current.offers.find((entry) =>
    sameId(entry.giftVariantId, request.giftVariantId),
  );
  if (!variant || !offer) return failure("VARIANT_UNAVAILABLE");
  return { current, variant, offer, idol };
}

function offerFailure(
  selected: Selection,
  quantity: number,
): CartRuntimeFailure | undefined {
  const { current, offer, idol, variant } = selected;
  if (current.content.view.status !== "active")
    return failure("GIFT_UNAVAILABLE");
  if (idol.status !== "active" || !idol.acceptingGifts)
    return failure("IDOL_UNAVAILABLE");
  if (variant.status !== "active") return failure("VARIANT_UNAVAILABLE");
  if (offer.availability === "UNAVAILABLE") {
    switch (offer.reason) {
      case "GIFT_PAUSED":
        return failure("GIFT_UNAVAILABLE");
      case "VARIANT_PAUSED":
        return failure("VARIANT_UNAVAILABLE");
      case "RECIPIENT_UNAVAILABLE":
        return failure("IDOL_UNAVAILABLE");
      case "NOT_ELIGIBLE":
      case "NO_ELIGIBLE_RECIPIENT":
        return failure("RECIPIENT_INELIGIBLE");
      case "PRICE_UNAVAILABLE":
        return failure("PRICE_UNAVAILABLE");
      case "OUT_OF_STOCK":
        return failure("INSUFFICIENT_STOCK");
      default:
        return failure("CONTENT_UNAVAILABLE");
    }
  }
  if (!offer.price) return failure("PRICE_UNAVAILABLE");
  if (quantity > offer.maxQuantity)
    return failure(
      offer.stock.kind === "TRACKED"
        ? "INSUFFICIENT_STOCK"
        : "QUANTITY_EXCEEDED",
    );
  return undefined;
}

function lineAmount(
  unitAmountMinor: number,
  quantity: number,
): number | undefined {
  const amount = BigInt(unitAmountMinor) * BigInt(quantity);
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : undefined;
}

export function decideCartRuntimeAdd(input: unknown): CartRuntimeAddDecision {
  const parsed = cartRuntimeAddDecisionInputSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_COMMAND");
  const { cart, command, current } = parsed.data;
  if (cart.expired || cart.status === "EXPIRED") return failure("CART_EXPIRED");
  if (cart.status !== "ACTIVE") return failure("CART_LOCKED");
  if (cart.market !== command.market || cart.currency !== command.currency)
    return failure("SCOPE_MISMATCH");
  const selected = selectCurrent(command, current);
  if ("outcome" in selected) return selected;
  const unavailable = offerFailure(selected, command.quantity);
  if (unavailable) return unavailable;
  const price = selected.offer.price!;
  if (!sameId(price.priceId, command.observedPriceId))
    return failure("PRICE_CHANGED");
  const lineTotalMinor = lineAmount(price.unitAmountMinor, command.quantity);
  if (lineTotalMinor === undefined) return failure("AMOUNT_OVERFLOW");
  return cartRuntimeAddDecisionSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    priceId: price.priceId,
    unitAmountMinor: price.unitAmountMinor,
    lineTotalMinor,
  });
}

function safeFlags(item: CartRuntimeItemRecord) {
  return {
    schemaVersion: 1 as const,
    id: item.id,
    version: item.version,
    quantity: item.quantity,
    displayMode: item.displayMode,
    nicknameProvided: item.nicknameProvided,
    hasFanMessage: item.hasFanMessage,
    ...("galleryPreference" in item
      ? { galleryPreference: item.galleryPreference }
      : {}),
  };
}

function unavailableLine(
  item: CartRuntimeItemRecord,
  code: CartRuntimeFailureCode,
): CartRuntimeItemView {
  const reason =
    code === "GIFT_UNAVAILABLE" ||
    code === "IDOL_UNAVAILABLE" ||
    code === "VARIANT_UNAVAILABLE" ||
    code === "PRICE_UNAVAILABLE"
      ? code
      : "CONTENT_UNAVAILABLE";
  return {
    ...safeFlags(item),
    idol: null,
    gift: null,
    price: {
      status: "UNAVAILABLE",
      observedPriceId: item.observedPriceId,
      current: null,
    },
    availability: { status: "UNAVAILABLE", reason, maxQuantity: 0 },
  };
}

/** Rebuild safe content from current proofs; never re-emit a cached mutation response. */
export function projectCartRuntimeView(input: unknown): CartRuntimeView {
  const { cart, presentationLocale, items } =
    cartRuntimeProjectionInputSchema.parse(input);
  if (cart.expired) throw new Error("Cart expired");
  const views = items.map(({ item, current }): CartRuntimeItemView => {
    if (!sameId(item.cartId, cart.id))
      throw new Error("Cart item ownership mismatch");
    if (
      current.outcome === "FAILURE" &&
      current.code !== "NOT_FOUND" &&
      current.code !== "MARKET_UNAVAILABLE"
    )
      throw new Error("Current commerce read unavailable");
    const selected = selectCurrent(
      {
        ...item,
        presentationLocale,
        market: cart.market,
        currency: cart.currency,
      },
      current,
    );
    if ("outcome" in selected) {
      if (
        selected.code === "CONTENT_UNAVAILABLE" ||
        selected.code === "SCOPE_MISMATCH"
      )
        throw new Error("Current commerce projection mismatch");
      return unavailableLine(item, selected.code);
    }
    const gift = selected.current.content.view;
    const amount = selected.offer.price
      ? lineAmount(selected.offer.price.unitAmountMinor, item.quantity)
      : undefined;
    const problem =
      offerFailure(selected, item.quantity) ??
      (amount === undefined ? failure("AMOUNT_OVERFLOW") : undefined);
    const price =
      selected.offer.price && amount !== undefined
        ? {
            priceId: selected.offer.price.priceId,
            unitAmountMinor: selected.offer.price.unitAmountMinor,
            lineTotalMinor: amount,
          }
        : null;
    let priceStatus: CartRuntimeItemView["price"]["status"] = "UNAVAILABLE";
    if (price)
      priceStatus = sameId(price.priceId, item.observedPriceId)
        ? "CURRENT"
        : "CHANGED";
    const maxQuantity =
      selected.offer.stock.kind === "TRACKED"
        ? Math.min(selected.offer.maxQuantity, CART_RUNTIME_MAX_QUANTITY)
        : null;
    return cartRuntimeItemViewSchema.parse({
      ...safeFlags(item),
      idol: {
        handle: selected.idol.handle,
        displayName: selected.idol.displayName,
        portrait: selected.idol.portrait,
        localeContext: selected.idol.localeContext,
      },
      gift: {
        handle: gift.handle,
        title: gift.title,
        variantLabel: selected.variant.label,
        primaryMedia: gift.primaryMedia,
        localeContext: gift.localeContext,
      },
      price: {
        observedPriceId: item.observedPriceId,
        status: priceStatus,
        current: price,
      },
      availability: {
        status: problem ? "UNAVAILABLE" : selected.offer.availability,
        reason: problem
          ? cartRuntimeAvailabilityReasonSchema.parse(problem.code)
          : null,
        maxQuantity,
      },
    });
  });
  return cartRuntimeViewSchema.parse({
    schemaVersion: 1,
    kind: "CART_RUNTIME",
    version: cart.version,
    status: cart.status,
    presentationLocale,
    market: cart.market,
    currency: cart.currency,
    expiresAt: cart.expiresAt,
    items: views,
  });
}

/** Return only in memory for hashing; this contains private input and must never be logged. */
export function canonicalCartRuntimeRequest(input: unknown): string {
  return JSON.stringify(cartRuntimeCommandSchema.parse(input));
}
