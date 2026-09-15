import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { DEFAULT_LOCALE, supportedLocaleSchema } from "@fan-support/contracts";
import { FONT_PROFILE_BY_LOCALE } from "@fan-support/design-tokens";

import { ORDER_ENTRY_SCRIPT } from "../order-entry";
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
  return (
    <html lang={locale} data-font-profile={FONT_PROFILE_BY_LOCALE[locale].id}>
      <body>
        {requestHeaders.get("x-storefront-order-access") === "1" && (
          <script
            id="order-access-entry"
            dangerouslySetInnerHTML={{ __html: ORDER_ENTRY_SCRIPT }}
          />
        )}
        {children}
      </body>
    </html>
  );
}
