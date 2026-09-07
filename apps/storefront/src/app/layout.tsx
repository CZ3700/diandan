import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { DEFAULT_LOCALE, supportedLocaleSchema } from "@fan-support/contracts";
import { FONT_PROFILE_BY_LOCALE } from "@fan-support/design-tokens";

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
  const parsed = supportedLocaleSchema.safeParse(
    (await headers()).get("x-storefront-locale"),
  );
  const locale = parsed.success ? parsed.data : DEFAULT_LOCALE;
  return (
    <html lang={locale} data-font-profile={FONT_PROFILE_BY_LOCALE[locale].id}>
      <body>{children}</body>
    </html>
  );
}
