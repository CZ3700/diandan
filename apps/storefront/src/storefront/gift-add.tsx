"use client";
import { useId, useRef, useState, useEffect } from "react";
import { Quantity } from "@fan-support/ui/client";
import type { SupportedLocale } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { useCartSession } from "./cart-provider";
import { createCartMutation, type CartMutation } from "./cart-session";
import {
  CartPersonalization,
  emptyCartDraft,
  cartPersonalization,
  validCartDraft,
} from "./cart-personalization";
import { cartError, isUncertain } from "./cart-error";
import { storefrontHref } from "./navigation";
export type GiftAddProps = Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  giftId: string;
  giftVariantId: string;
  idolId: string;
  observedPriceId: string;
  market: string;
  currency: string;
  max: number;
}>;
/** Buying now adds the gift to the bag, then checks out the whole bag in the same locale. */
export function giftCheckoutHref(locale: SupportedLocale): string {
  return storefrontHref(locale, "/checkout");
}
export function GiftAdd(props: GiftAddProps) {
  const { locale, copy, max, market, currency } = props;
  const session = useCartSession();
  const id = useId();
  const [quantity, setQuantity] = useState(1);
  const [draft, setDraft] = useState(() => emptyCartDraft(locale));
  const [status, setStatus] = useState<
    "idle" | "pending" | "confirmed" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<"add" | "buy">("add");
  const pending = useRef<CartMutation | null>(null);
  const mounted = useRef(true);
  const running = useRef(false);
  const epoch = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      epoch.current++;
      pending.current = null;
      setDraft(emptyCartDraft(locale));
      setStatus("idle");
      setError(null);
    };
    window.addEventListener("pagehide", hide);
    return () => {
      mounted.current = false;
      epoch.current++;
      pending.current = null;
      window.removeEventListener("pagehide", hide);
    };
  }, [locale]);
  async function add(buyNow = false) {
    if (running.current) return;
    if (!session || !validCartDraft(draft)) {
      setError(copy.cartInvalid);
      return;
    }
    const generation = epoch.current;
    running.current = true;
    setIntent(buyNow ? "buy" : "add");
    setStatus("pending");
    setError(null);
    try {
      if (!pending.current) {
        const ready = await session.initialize(market, currency);
        if (!mounted.current || epoch.current !== generation) return;
        if (ready.outcome !== "SUCCESS") {
          setStatus("error");
          setError(cartError(ready, copy));
          return;
        }
      }
      pending.current ??= createCartMutation(
        "POST",
        "/api/storefront/cart/items",
        {
          schemaVersion: 1,
          presentationLocale: locale,
          market,
          currency,
          giftId: props.giftId,
          giftVariantId: props.giftVariantId,
          idolId: props.idolId,
          observedPriceId: props.observedPriceId,
          quantity,
          ...cartPersonalization(draft),
        },
      );
      const result = await session.mutate(pending.current);
      if (!mounted.current || epoch.current !== generation) return;
      if (result.outcome === "SUCCESS") {
        pending.current = null;
        setDraft(emptyCartDraft(locale));
        // Stay pending while the browser leaves for checkout.
        if (buyNow) window.location.assign(giftCheckoutHref(locale));
        else setStatus("confirmed");
      } else {
        if (!isUncertain(result)) pending.current = null;
        setStatus("error");
        setError(cartError(result, copy));
      }
    } finally {
      running.current = false;
    }
  }
  return (
    <form
      className="gift-add"
      data-cart-add
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <Quantity
        id={id}
        label={copy.giftQuantity}
        decreaseLabel={copy.giftQuantityDecrease}
        increaseLabel={copy.giftQuantityIncrease}
        min={1}
        max={max}
        value={quantity}
        disabled={status === "pending" || pending.current !== null}
        onValueChange={(value) => {
          setQuantity(value);
          setStatus("idle");
        }}
      />
      <CartPersonalization
        draft={draft}
        onChange={(value) => {
          setDraft(value);
          setStatus("idle");
        }}
        copy={copy}
        disabled={status === "pending" || pending.current !== null}
      />
      <div className="gift-add-actions">
        <button
          className="storefront-primary gift-buy-now"
          type="button"
          data-cart-buy-now
          disabled={status === "pending"}
          aria-busy={status === "pending" && intent === "buy"}
          onClick={() => void add(true)}
        >
          {status === "pending" && intent === "buy"
            ? copy.cartBuyingNow
            : copy.cartBuyNow}
        </button>
        <button
          className="gift-add-secondary cart-add-button"
          type="submit"
          disabled={status === "pending"}
          aria-busy={status === "pending" && intent === "add"}
          data-cart-add-state={status}
        >
          {status === "pending" && intent === "add"
            ? copy.cartAdding
            : pending.current
              ? copy.cartRetry
              : status === "confirmed"
                ? copy.cartAdded
                : copy.cartAdd}
        </button>
      </div>
      <div className="cart-feedback" role="status" aria-live="polite">
        {status === "confirmed" ? copy.cartAdded : ""}
      </div>
      {error && <p role="alert">{error}</p>}
      {(status === "confirmed" || error) && (
        <a href={storefrontHref(locale, "/cart")}>{copy.cartViewBag}</a>
      )}
    </form>
  );
}
