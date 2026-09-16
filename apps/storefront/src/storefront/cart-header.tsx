"use client";
import { useEffect, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Icon } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";
import {
  useCartSession,
  useCartSnapshot,
  useCartRestorationHint,
} from "./cart-provider";
import { LazyDrawer } from "./lazy-drawer";
import { CartPanel } from "./cart-panel";
import { storefrontHref } from "./navigation";
import type { CartSession } from "./cart-session";
type Props = Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
}>;
export function CartHeader(props: Props) {
  const session = useCartSession();
  return session ? (
    <CartControl {...props} session={session} />
  ) : (
    <a
      className="storefront-bag"
      href={storefrontHref(props.locale, "/cart", props.contextQuery)}
      aria-label={props.copy.bag}
    >
      <Icon name="shopping-bag" decorative />
    </a>
  );
}
function CartControl({ session, ...props }: Props & { session: CartSession }) {
  const { copy, locale, contextQuery } = props;
  const state = useCartSnapshot(session);
  const restoreOnLoad = useCartRestorationHint();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!restoreOnLoad) return;
    // Cart restoration is private and does not compete with the public hero load.
    const restore = () => {
      if (session.snapshot().status === "idle") void session.read();
    };
    if (document.readyState === "complete") restore();
    else window.addEventListener("load", restore, { once: true });
    return () => window.removeEventListener("load", restore);
  }, [session, restoreOnLoad]);
  const count = state.cart?.items.reduce(
    (sum, item) => sum + BigInt(item.quantity),
    0n,
  );
  return (
    <div className="storefront-cart-control" data-cart-trigger>
      <LazyDrawer
        loadingLabel={copy.loading}
        errorLabel={copy.cartLoadError}
        retryLabel={copy.cartRetry}
        open={open}
        onOpenChange={setOpen}
        title={copy.bag}
        description={copy.cartMessageHint}
        closeLabel={copy.close}
        triggerLabel={
          <>
            <Icon name="shopping-bag" decorative />
            <span className="storefront-sr-only">{copy.bag}</span>
            {count !== undefined && count > 0n && (
              <span className="cart-count" data-cart-count>
                {count.toLocaleString(locale)}
              </span>
            )}
          </>
        }
      >
        {open && (
          <div data-cart-drawer>
            <CartPanel {...props} />
          </div>
        )}
      </LazyDrawer>
      <noscript>
        <a href={storefrontHref(locale, "/cart", contextQuery)}>{copy.bag}</a>
      </noscript>
    </div>
  );
}
