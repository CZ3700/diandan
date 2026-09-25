import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { supportedLocaleSchema } from "@fan-support/contracts";
import { FONT_PROFILE_BY_LOCALE } from "@fan-support/design-tokens";

import "./globals.css";

export const metadata: Metadata = {
  title: "Admin runtime",
  description: "Fan Support Platform admin runtime preview",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const parsed = supportedLocaleSchema.safeParse(
    (await headers()).get("x-admin-locale"),
  );
  const locale = parsed.success ? parsed.data : "en";
  return (
    <html lang={locale}>
      <body
        style={{
          fontFamily: `"${FONT_PROFILE_BY_LOCALE[locale].family}", system-ui, sans-serif`,
        }}
      >
        {children}
      </body>
    </html>
  );
}
