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
import {
  navigationTargetHref,
  publicNavigationQuery,
} from "./navigation-target";
import { SiteNavigation } from "./site-navigation";
import { SiteMenuPreview } from "./site-menu-preview";
import { useStorefrontNavigation } from "./navigation-provider";
import type { StorefrontCopy } from "./copy";
import { SiteBrand } from "./site-brand";

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
  const { source, version, previewView } = useStorefrontNavigation();
  const [menu, setMenu] = useState(false),
    [scrolled, setScrolled] = useState(false);
  const cancelDrawerLanguage = useRef<(() => void) | null>(null);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  const navigation = (includeOrders = false) => (
    <SiteNavigation
      locale={locale}
      copy={copy}
      contextQuery={contextQuery}
      active={active}
      includeOrders={includeOrders}
    />
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
  const menuContent = () => (
    <div className="storefront-drawer-nav">
      {navigation(true)}
      {language(true)}
      {regionEntry ?? (
        <>
          <p>{copy.regionHint}</p>
          <a href={navigationTargetHref(locale, "REGION", contextQuery)}>
            {copy.region}
          </a>
        </>
      )}
    </div>
  );
  return (
    <>
      <a className="storefront-skip" href="#main-content">
        {copy.skip}
      </a>
      <header
        className="storefront-header"
        data-scrolled={scrolled}
        data-navigation-source={source}
        data-navigation-version={version}
      >
        <a
          className="storefront-wordmark"
          href={navigationTargetHref(locale, "HOME", contextQuery)}
        >
          <SiteBrand name={name} />
        </a>
        <div className="storefront-desktop-nav">{navigation()}</div>
        <div className="storefront-header-utilities">
          <div className="storefront-desktop-language">{language()}</div>
          <CartHeader
            locale={locale}
            copy={copy}
            contextQuery={publicNavigationQuery(contextQuery)}
          />
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
              {menuContent()}
            </LazyDrawer>
          </div>
        </div>
      </header>
      {previewView === "menu" && (
        <SiteMenuPreview copy={copy}>{menuContent()}</SiteMenuPreview>
      )}
    </>
  );
}
