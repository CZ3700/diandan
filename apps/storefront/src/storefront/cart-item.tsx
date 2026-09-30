"use client";
import { useId, useRef, useState, useEffect } from "react";
import { CART_RUNTIME_MAX_QUANTITY } from "@fan-support/contracts";
import type {
  CartRuntimeItemView,
  CartRuntimeView,
  SupportedLocale,
} from "@fan-support/contracts";
import { Quantity } from "@fan-support/ui/client";
import { Price } from "@fan-support/ui";
import { PublishedImage } from "./published-image";
import type { StorefrontCopy } from "./copy";
import { CartEditor } from "./cart-editor";
import { cartError, isUncertain } from "./cart-error";
import {
  createCartMutation,
  type CartMutation,
  type CartSession,
  type CartResult,
} from "./cart-session";
export function CartItem({
  item,
  cartVersion,
  currency,
  locale,
  copy,
  session,
  headingLevel = 3,
  onRemove,
}: Readonly<{
  item: CartRuntimeItemView;
  cartVersion: number;
  currency: CartRuntimeView["currency"];
  locale: SupportedLocale;
  copy: StorefrontCopy;
  session: CartSession;
  headingLevel?: 2 | 3;
  onRemove?: (request: CartMutation) => Promise<CartResult>;
}>) {
  const id = useId();
  const gallery =
    "galleryPreference" in item ? item.galleryPreference : undefined;
  const article = useRef<HTMLElement>(null);
  const editorTrigger = useRef<HTMLButtonElement>(null);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const [quantity, setQuantity] = useState(item.quantity);
  const [attempted, setAttempted] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"quantity" | "remove" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<CartMutation | null>(null);
  const quantityBaseline = useRef<{
    cartVersion: number;
    itemVersion: number;
    priceId: string;
  } | null>(null);
  const confirmQuantity = useRef(false);
  const active = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current = null;
    };
  }, []);
  useEffect(() => {
    if (!running.current && attempted === null) setQuantity(item.quantity);
  }, [item.quantity, attempted]);
  const max = Math.max(
    item.quantity,
    quantity,
    item.availability.maxQuantity ?? CART_RUNTIME_MAX_QUANTITY,
  );
  async function mutate(kind: "quantity" | "remove") {
    if (running.current) return;
    const intended = attempted ?? quantity;
    if (kind === "quantity" && !item.price.current) return;
    if (
      kind === "quantity" &&
      item.price.current &&
      (!quantityBaseline.current || confirmQuantity.current)
    ) {
      quantityBaseline.current = {
        cartVersion,
        itemVersion: item.version,
        priceId: item.price.current.priceId,
      };
      confirmQuantity.current = false;
    }
    running.current = true;
    setBusy(kind);
    setError(null);
    setNotice(null);
    if (kind === "quantity") {
      setAttempted(intended);
      setQuantity(intended);
    }
    request.current ??= createCartMutation(
      kind === "quantity" ? "PATCH" : "DELETE",
      `/api/storefront/cart/items/${item.id}`,
      {
        schemaVersion: 1,
        presentationLocale: locale,
        expectedCartVersion:
          kind === "quantity"
            ? quantityBaseline.current?.cartVersion
            : cartVersion,
        expectedItemVersion:
          kind === "quantity"
            ? quantityBaseline.current?.itemVersion
            : item.version,
        ...(kind === "quantity"
          ? {
              change: {
                kind: "QUANTITY",
                quantity: intended,
                observedPriceId: quantityBaseline.current?.priceId,
              },
            }
          : {}),
      },
    );
    try {
      const result =
        kind === "remove" && onRemove
          ? await onRemove(request.current)
          : await session.mutate(request.current);
      if (!active.current) return;
      if (result.outcome === "SUCCESS") {
        request.current = null;
        setAttempted(null);
        quantityBaseline.current = null;
        const current = result.cart.items.find((value) => value.id === item.id);
        if (current) setQuantity(current.quantity);
        setNotice(copy.cartUpdated);
      } else {
        if (!isUncertain(result)) request.current = null;
        setQuantity(item.quantity);
        setError(cartError(result, copy));
        if (
          result.outcome === "FAILURE" &&
          (result.code === "VERSION_CONFLICT" ||
            result.code === "PRICE_CHANGED")
        ) {
          confirmQuantity.current = true;
          await session.read();
        }
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(null);
    }
  }
  return (
    <article
      ref={article}
      className="cart-item"
      data-cart-item={item.id}
      data-cart-item-version={item.version}
      aria-busy={busy !== null}
    >
      <div className="cart-item-images">
        {item.gift && (
          <PublishedImage
            media={item.gift.primaryMedia}
            fallbackLabel={copy.mediaFallback}
            sizes="96px"
          />
        )}
        {item.idol && (
          <div className="cart-idol-portrait">
            <PublishedImage
              media={item.idol.portrait}
              fallbackLabel={copy.mediaFallback}
              sizes="40px"
            />
          </div>
        )}
      </div>
      <div className="cart-item-main">
        <Heading lang={item.gift?.localeContext.resolvedLocale}>
          {item.gift?.title ?? copy.cartUnavailable}
        </Heading>
        {item.gift && (
          <p lang={item.gift.localeContext.resolvedLocale}>
            {item.gift.variantLabel}
          </p>
        )}
        <p lang={item.idol?.localeContext.resolvedLocale}>
          {item.idol?.displayName ?? copy.cartUnavailable}
        </p>
        <div className="cart-private-state">
          <span>
            {item.hasFanMessage ? copy.cartSavedMessage : copy.cartNoMessage}
          </span>
          <span>
            {item.nicknameProvided
              ? copy.cartSavedName
              : copy.cartAnonymousSaved}
          </span>
        </div>
        {gallery && (
          <p className="cart-gallery-state">
            {gallery.visibility === "PRIVATE"
              ? copy.wishRecordPrivate
              : copy.wishRecordPlanned}
            {gallery.visibility !== "PRIVATE" && (
              <>
                {" "}
                ·{" "}
                {gallery.visibility === "PUBLIC_NAMED"
                  ? gallery.publicAlias
                  : copy.wishDisplayAnonymous}
              </>
            )}
          </p>
        )}
        {item.price.current ? (
          <Price
            locale={locale}
            currency={currency}
            amountMinor={item.price.current.lineTotalMinor}
          />
        ) : (
          <p>{copy.cartUnavailable}</p>
        )}
        {item.price.status === "CHANGED" && (
          <p className="cart-notice">{copy.cartPriceChanged}</p>
        )}
        {item.availability.status === "UNAVAILABLE" && (
          <p className="cart-notice">{copy.cartUnavailable}</p>
        )}
        {!gallery && (
          <div data-cart-quantity>
            <Quantity
              id={`${id}-quantity`}
              label={copy.giftQuantity}
              decreaseLabel={copy.giftQuantityDecrease}
              increaseLabel={copy.giftQuantityIncrease}
              min={1}
              max={max}
              value={quantity}
              disabled={
                busy !== null || request.current !== null || !item.price.current
              }
              onValueChange={(value) => {
                if (item.price.current)
                  quantityBaseline.current ??= {
                    cartVersion,
                    itemVersion: item.version,
                    priceId: item.price.current.priceId,
                  };
                setQuantity(value);
                setAttempted(null);
                setNotice(null);
              }}
            />
          </div>
        )}
        <div className="cart-actions">
          {!gallery && (
            <button
              data-cart-quantity-save
              type="button"
              disabled={
                busy !== null ||
                !item.price.current ||
                (request.current !== null &&
                  request.current.method === "DELETE")
              }
              onClick={() => {
                void mutate("quantity");
              }}
            >
              {busy === "quantity"
                ? copy.cartSaving
                : request.current?.method === "PATCH"
                  ? copy.cartRetry
                  : copy.cartConfirmQuantity}
            </button>
          )}
          <button
            type="button"
            ref={editorTrigger}
            data-cart-editor-open
            disabled={busy !== null || request.current !== null}
            onClick={() => setEditing((value) => !value)}
            aria-expanded={editing}
          >
            {gallery ? copy.wishEdit : copy.cartPrivateEdit}
          </button>
          <button
            type="button"
            data-cart-remove
            disabled={
              busy !== null ||
              (request.current !== null && request.current.method !== "DELETE")
            }
            onClick={() => {
              void mutate("remove");
            }}
          >
            {busy === "remove"
              ? copy.cartRemoving
              : request.current?.method === "DELETE"
                ? copy.cartRetry
                : copy.cartRemove}
          </button>
        </div>
        {error && (
          <p role="alert">
            {error}
            {attempted !== null ? ` ${copy.giftQuantity}: ${attempted}` : ""}
          </p>
        )}
        <p className="cart-feedback" role="status" aria-live="polite">
          {notice}
        </p>
      </div>
      {editing && (
        <CartEditor
          itemId={item.id}
          cartVersion={cartVersion}
          itemVersion={item.version}
          locale={locale}
          copy={copy}
          session={session}
          onClose={() => {
            const editor = article.current?.querySelector("[data-cart-editor]");
            if (editor?.contains(document.activeElement))
              editorTrigger.current?.focus();
            setEditing(false);
          }}
        />
      )}
    </article>
  );
}
