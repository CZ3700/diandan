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
  // In-app browsers inject attributes on <html>/<body> before React hydrates; ours are all
  // server-derived, so only these two elements ignore foreign attributes.
  return (
    <html lang={locale} suppressHydrationWarning>
      {/* Streaming metadata appends tags after the body content, too late to stop iOS from
          rewriting digit runs (order numbers, amounts, names) into links before hydration,
          which breaks hydration and turns reference numbers into calls. */}
      <head>
        <meta
          name="format-detection"
          content="telephone=no, date=no, email=no, address=no"
        />
      </head>
      <body
        suppressHydrationWarning
        style={{
          fontFamily: `"${FONT_PROFILE_BY_LOCALE[locale].family}", system-ui, sans-serif`,
        }}
      >
        {children}
      </body>
    </html>
  );
}
