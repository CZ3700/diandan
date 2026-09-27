import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { DEFAULT_LOCALE, supportedLocaleSchema } from "@fan-support/contracts";
import { FONT_PROFILE_BY_LOCALE } from "@fan-support/design-tokens";

import { ORDER_ENTRY_SCRIPT } from "../order-entry";
import { renderRumCollector } from "../server/rum-bootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "Storefront runtime",
  description: "Fan Support Platform storefront runtime preview",
  robots: { index: false, follow: false },
  // iOS would otherwise rewrite digit runs (order numbers, amounts, names) into links
  // before hydration, which both breaks hydration and turns reference numbers into calls.
  formatDetection: {
    telephone: false,
    date: false,
    email: false,
    address: false,
  },
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
  const rumCollector = await renderRumCollector(
    locale,
    requestHeaders.get("x-storefront-order-access") === "1",
  );
  // In-app browsers (for example WeChat on iOS) inject attributes on <html>/<body> before
  // React hydrates. Every attribute we set here is server-derived, so ignoring foreign ones
  // on these two elements hides no mismatch of ours; descendants are still checked.
  return (
    <html
      lang={locale}
      data-font-profile={FONT_PROFILE_BY_LOCALE[locale].id}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        {requestHeaders.get("x-storefront-order-access") === "1" && (
          <script
            id="order-access-entry"
            dangerouslySetInnerHTML={{ __html: ORDER_ENTRY_SCRIPT }}
          />
        )}
        {rumCollector}
        {children}
      </body>
    </html>
  );
}
