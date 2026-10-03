"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  minorAmountSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Price } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";
import { useCartSession, useCartSnapshot } from "./cart-provider";
import { CartItem } from "./cart-item";
import { storefrontHref } from "./navigation";
import type { CartSession, CartMutation } from "./cart-session";
import { prepareCartRemovalFocus } from "./cart-removal-focus";
export function CartBody(
  props: Readonly<{
    locale: SupportedLocale;
    copy: StorefrontCopy;
    contextQuery: string;
    page?: boolean;
  }>,
) {
  const session = useCartSession();
  return session ? (
    <CartContents {...props} session={session} />
  ) : (
    <p role="alert">{props.copy.cartLoadError}</p>
  );
}
function CartContents({
  locale,
  copy,
  contextQuery,
  page,
  session,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  page?: boolean;
  session: CartSession;
}>) {
  const state = useCartSnapshot(session);
  const hintId = useId();
  const root = useRef<HTMLElement>(null);
  const bindRoot = useCallback((element: HTMLElement | null) => {
    root.current = element;
  }, []);
  const frame = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(
    () => () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    },
    [],
  );
  async function remove(request: CartMutation, itemId: string) {
    const restoreFocus = root.current
      ? prepareCartRemovalFocus(root.current, itemId)
      : () => {};
    setAnnouncement("");
    const result = await session.mutate(request);
    if (
      result.outcome === "SUCCESS" &&
      !result.cart.items.some((item) => item.id === itemId) &&
      root.current?.isConnected
    ) {
      setAnnouncement(copy.cartRemoved);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = window.requestAnimationFrame(restoreFocus);
    }
    return result;
  }
  useEffect(() => {
    void session.read();
  }, [session]);
  const cart = state.cart;
  const total =
    cart?.items.reduce(
      (sum, item) => sum + BigInt(item.price.current?.lineTotalMinor ?? 0),
      0n,
    ) ?? 0n;
  const partial = cart?.items.some(
    (item) => !item.price.current || item.availability.status === "UNAVAILABLE",
  );
  // A locked bag can still continue to its existing checkout, so it gets no removal instruction.
  let footerHint = copy.checkoutEmpty;
  if (partial)
    footerHint =
      cart?.status === "LOCKED"
        ? copy.cartUnavailable
        : copy.cartCheckoutBlocked;
  const Container = page ? "section" : "div";
  return (
    <Container
      ref={bindRoot}
      tabIndex={-1}
      className="cart-contents"
      data-cart-root
      data-cart-version={cart?.version}
      aria-label={page ? copy.bag : undefined}
    >
      <p
        className="cart-feedback"
        role="status"
        aria-live="polite"
        data-cart-announcement
      >
        {announcement}
      </p>
      {(state.status === "idle" || state.status === "loading") && (
        <p role="status" aria-busy="true">
          {copy.loading}
        </p>
      )}
      {state.status === "error" && (
        <div role="alert">
          <p>{copy.cartLoadError}</p>
          <button
            data-cart-refresh
            type="button"
            onClick={() => {
              void session.read();
            }}
          >
            {copy.cartRetry}
          </button>
        </div>
      )}
      {((cart && cart.items.length === 0) || state.status === "empty") && (
        <div className="cart-empty">
          <p className="cart-empty-title">{copy.cartEmptyTitle}</p>
          <p>{copy.cartEmptyBody}</p>
        </div>
      )}
      {cart && (
        <>
          <p className="cart-scope">
            {cart.currency} · {cart.market}
          </p>
          <div className="cart-items">
            {cart.items.map((item) => (
              <CartItem
                key={item.id}
                item={item}
                cartVersion={cart.version}
                currency={cart.currency}
                locale={locale}
                copy={copy}
                session={session}
                onRemove={(request) => remove(request, item.id)}
                headingLevel={page ? 2 : 3}
              />
            ))}
          </div>
          {cart.items.length > 0 && (
            <div className="cart-total">
              <span>{partial ? copy.cartPartialTotal : copy.cartTotal}</span>
              {total <= BigInt(Number.MAX_SAFE_INTEGER) ? (
                <Price
                  locale={locale}
                  currency={cart.currency}
                  amountMinor={minorAmountSchema.parse(Number(total))}
                />
              ) : (
                <span>{copy.cartUnavailable}</span>
              )}
            </div>
          )}
        </>
      )}
      <div className="cart-footer">
        {cart &&
        cart.items.length > 0 &&
        (cart.status === "LOCKED" || !partial) ? (
          <a
            className="storefront-primary"
            data-cart-checkout
            href={storefrontHref(locale, "/checkout")}
          >
            {copy.checkoutContinue}
          </a>
        ) : (
          <button
            className="storefront-primary"
            disabled
            type="button"
            aria-describedby={hintId}
          >
            {copy.checkoutContinue}
          </button>
        )}
        {(!cart || cart.items.length === 0 || partial) && (
          <p id={hintId}>{footerHint}</p>
        )}
        <a
          className="storefront-secondary"
          href={storefrontHref(locale, "/gifts", contextQuery)}
        >
          {copy.cartContinue}
        </a>
        {!page && (
          <a href={storefrontHref(locale, "/cart", contextQuery)}>
            {copy.cartViewBag}
          </a>
        )}
      </div>
    </Container>
  );
}
