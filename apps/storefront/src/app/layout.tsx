import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { DEFAULT_LOCALE, supportedLocaleSchema } from "@fan-support/contracts";
import { FONT_PROFILE_BY_LOCALE } from "@fan-support/design-tokens";

import { ORDER_ENTRY_SCRIPT } from "../order-entry";
import { renderRumCollector } from "../server/rum-bootstrap";
import { readPublicStorefrontTheme } from "../server/public-storefront-theme";
import { readPublicStorefrontBrand } from "../server/public-storefront-brand";
import { BrandingProvider } from "../storefront/branding-provider";
import { themePresentation } from "../storefront/theme-presentation";
import "./globals.css";

export const metadata: Metadata = {
  title: "Storefront runtime",
  description: "Fan Support Platform storefront runtime preview",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const requestHeaders = await headers();
  const parsed = supportedLocaleSchema.safeParse(
    requestHeaders.get("x-storefront-locale"),
  );
  const locale = parsed.success ? parsed.data : DEFAULT_LOCALE;
  const [rumCollector, theme, brand] = await Promise.all([
    requestHeaders.get("x-storefront-layout-preview") === "1"
      ? null
      : renderRumCollector(
          locale,
          requestHeaders.get("x-storefront-order-access") === "1",
        ),
    parsed.success ? readPublicStorefrontTheme() : null,
    parsed.success ? readPublicStorefrontBrand() : null,
  ]);
  // In-app browsers (for example WeChat on iOS) inject attributes on <html>/<body> before
  // React hydrates. Every attribute we set here is server-derived, so ignoring foreign ones
  // on these two elements hides no mismatch of ours; descendants are still checked.
  return (
    <html
      lang={locale}
      data-font-profile={FONT_PROFILE_BY_LOCALE[locale].id}
      {...(theme ? themePresentation(theme) : {})}
      suppressHydrationWarning
    >
      {/* Streaming metadata appends tags after the body content, too late to stop iOS from
          rewriting digit runs (order numbers, amounts, names) into links before hydration,
          which breaks hydration and turns reference numbers into calls. */}
      <head>
        <meta
          name="format-detection"
          content="telephone=no, date=no, email=no, address=no"
        />
      </head>
      <body suppressHydrationWarning>
        {requestHeaders.get("x-storefront-order-access") === "1" && (
          <script
            id="order-access-entry"
            dangerouslySetInnerHTML={{ __html: ORDER_ENTRY_SCRIPT }}
          />
        )}
        {rumCollector}
        <BrandingProvider result={brand}>{children}</BrandingProvider>
      </body>
    </html>
  );
}
