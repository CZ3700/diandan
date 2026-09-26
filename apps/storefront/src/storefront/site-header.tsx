"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { CartHeader } from "./cart-header";
import { LazyDrawer } from "./lazy-drawer";
import { HeaderLanguage } from "./site-header-language";
import {
  createPresentationLocaleUrl,
  serializePresentationLocaleCookie,
} from "../presentation-locale";
import { storefrontHref } from "./navigation";
import type { StorefrontCopy } from "./copy";

export function SiteHeader({
  locale,
  copy,
  name,
  contextQuery,
  active,
  regionEntry,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  name: string;
  contextQuery: string;
  active: "home" | "artists" | "gifts" | "other";
  /** Server-decided region entry; a sole published market hides it (ADR-017 addendum). */
  regionEntry?: ReactNode;
}>) {
  const [menu, setMenu] = useState(false),
    [scrolled, setScrolled] = useState(false);
  const cancelDrawerLanguage = useRef<(() => void) | null>(null);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  const links = [
    { path: "/", label: copy.navHome, key: "home" },
    { path: "/idols", label: copy.navArtists, key: "artists" },
    { path: "/gifts", label: copy.navGifts, key: "gifts" },
  ];
  const navigation = (showOrderLookup = false) => (
    <nav aria-label={copy.navLabel}>
      {links.map((link) => (
        <a
          key={link.path}
          href={storefrontHref(locale, link.path, contextQuery)}
          aria-current={
            active !== "other" && active === link.key ? "page" : undefined
          }
        >
          {link.label}
        </a>
      ))}
      {showOrderLookup && (
        <a href={storefrontHref(locale, "/orders/lookup", contextQuery)}>
          {copy.navOrders}
        </a>
      )}
    </nav>
  );
  const language = (inDrawer = false) => (
    <HeaderLanguage
      label={copy.language}
      locale={locale}
      loadingLabel={copy.loading}
      errorLabel={copy.contentErrorBody}
      retryLabel={copy.artistRetry}
      {...(inDrawer ? { cancelRef: cancelDrawerLanguage } : {})}
      onValueChange={(next) => {
        const destination = createPresentationLocaleUrl(
          new URL(window.location.href),
          next,
        );
        document.cookie = serializePresentationLocaleCookie(next, {
          secure: window.location.protocol === "https:",
        });
        window.location.assign(destination.href);
      }}
    />
  );
  return (
    <>
      <a className="storefront-skip" href="#main-content">
        {copy.skip}
      </a>
      <header className="storefront-header" data-scrolled={scrolled}>
        <a
          className="storefront-wordmark"
          href={storefrontHref(locale, "/", contextQuery)}
        >
          {name}
          <span aria-hidden="true">.</span>
        </a>
        <div className="storefront-desktop-nav">{navigation()}</div>
        <div className="storefront-header-utilities">
          <div className="storefront-desktop-language">{language()}</div>
          <CartHeader locale={locale} copy={copy} contextQuery={contextQuery} />
          <div className="storefront-navigation-menu storefront-mobile-menu">
            <LazyDrawer
              loadingLabel={copy.loading}
              errorLabel={copy.contentErrorBody}
              retryLabel={copy.artistRetry}
              open={menu}
              onOpenChange={(next) => {
                if (!next) cancelDrawerLanguage.current?.();
                setMenu(next);
              }}
              title={copy.navMenu}
              description={copy.navLabel}
              closeLabel={copy.close}
              triggerLabel={
                <>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                  <span className="storefront-sr-only">{copy.navMenu}</span>
                </>
              }
            >
              <div className="storefront-drawer-nav">
                {navigation(true)}
                {language(true)}
                {regionEntry ?? (
                  <>
                    <p>{copy.regionHint}</p>
                    <a href={storefrontHref(locale, "/region", contextQuery)}>
                      {copy.region}
                    </a>
                  </>
                )}
              </div>
            </LazyDrawer>
          </div>
        </div>
      </header>
    </>
  );
}
