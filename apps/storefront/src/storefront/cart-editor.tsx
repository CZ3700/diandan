"use client";
import { useEffect, useRef, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import {
  CartPersonalization,
  cartPersonalization,
  validCartDraft,
  type CartDraft,
} from "./cart-personalization";
import {
  createCartMutation,
  type CartMutation,
  type CartSession,
} from "./cart-session";
import { cartError, isUncertain } from "./cart-error";

/** Mounted only after the user opens the editor. Unmount drops all plaintext. */
export function CartEditor({
  itemId,
  cartVersion,
  itemVersion,
  locale,
  copy,
  session,
  onClose,
}: Readonly<{
  itemId: string;
  cartVersion: number;
  itemVersion: number;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  session: CartSession;
  onClose: () => void;
}>) {
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [load, setLoad] = useState(0);
  const active = useRef(false);
  const request = useRef<CartMutation | null>(null);
  const running = useRef(false);
  const initial = useRef({ cartVersion, itemVersion });
  const baseline = useRef({ cartVersion, itemVersion });
  const confirmConflict = useRef(false);
  useEffect(() => {
    let valid = true;
    active.current = true;
    const hide = () => {
      valid = false;
      active.current = false;
      request.current = null;
      onClose();
    };
    window.addEventListener("pagehide", hide);
    void session
      .editor(itemId, initial.current.cartVersion, initial.current.itemVersion)
      .then((result) => {
        if (!valid) return;
        if (result.outcome === "SUCCESS") {
          const { content } = result;
          baseline.current = {
            cartVersion: result.cartVersion,
            itemVersion: result.itemVersion,
          };
          confirmConflict.current = false;
          setDraft({
            displayMode: content.displayMode,
            displayName:
              content.displayMode === "nickname" ? content.displayName : "",
            fanMessage: content.fanMessage ?? "",
            fanMessageLocale: content.fanMessageLocale,
          });
        } else {
          setError(cartError(result, copy));
          if (
            result.outcome === "FAILURE" &&
            result.code === "VERSION_CONFLICT"
          )
            void session.read();
        }
      });
    return () => {
      valid = false;
      active.current = false;
      request.current = null;
      window.removeEventListener("pagehide", hide);
    };
  }, [session, itemId, load, copy]);
  async function save() {
    if (running.current || !draft) return;
    if (!validCartDraft(draft)) {
      setError(copy.cartInvalid);
      return;
    }
    running.current = true;
    setBusy(true);
    setError(null);
    if (!request.current && confirmConflict.current) {
      // This explicit second save confirms the retained draft against refreshed facts.
      baseline.current = { cartVersion, itemVersion };
      confirmConflict.current = false;
    }
    request.current ??= createCartMutation(
      "PATCH",
      `/api/storefront/cart/items/${itemId}`,
      {
        schemaVersion: 1,
        presentationLocale: locale,
        expectedCartVersion: baseline.current.cartVersion,
        expectedItemVersion: baseline.current.itemVersion,
        change: { kind: "PERSONALIZATION", ...cartPersonalization(draft) },
      },
    );
    try {
      const result = await session.mutate(request.current);
      if (!active.current) return;
      if (result.outcome === "SUCCESS") {
        request.current = null;
        onClose();
      } else {
        if (!isUncertain(result)) request.current = null;
        setError(cartError(result, copy));
        if (
          result.outcome === "FAILURE" &&
          result.code === "VERSION_CONFLICT"
        ) {
          confirmConflict.current = true;
          await session.read();
        }
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className="cart-editor" data-cart-editor>
      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <CartPersonalization
            copy={copy}
            draft={draft}
            onChange={setDraft}
            disabled={busy || request.current !== null}
          />
          <div className="cart-actions">
            <button
              data-cart-editor-save
              className="storefront-primary"
              disabled={busy}
              aria-busy={busy}
              type="submit"
            >
              {busy
                ? copy.cartSaving
                : request.current
                  ? copy.cartRetry
                  : copy.cartSave}
            </button>
            <button type="button" data-cart-editor-close onClick={onClose}>
              {copy.cartCancel}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p role="status">
            {error ? copy.cartLoadError : copy.cartPrivateLoading}
          </p>
          {error && (
            <button
              type="button"
              onClick={() => {
                initial.current = { cartVersion, itemVersion };
                setError(null);
                setLoad((value) => value + 1);
              }}
            >
              {copy.cartRetry}
            </button>
          )}
          <button type="button" data-cart-editor-close onClick={onClose}>
            {copy.cartCancel}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
