import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { SiteHeader } from "./site-header";

// Inspect the navigation passed to the lazy drawer without mounting its modal.
vi.mock("./lazy-drawer", () => ({
  LazyDrawer: ({ children }: Readonly<{ children: ReactNode }>) => (
    <section data-navigation-drawer>{children}</section>
  ),
}));

test.each(SUPPORTED_LOCALES)(
  "%s keeps order lookup inside the navigation drawer, outside the top links",
  async (locale) => {
    const copy = await loadStorefrontCopy(locale);
    const html = renderToStaticMarkup(
      <SiteHeader
        locale={locale}
        copy={copy}
        name="Fixture Studio"
        contextQuery="market=TEST_MARKET&currency=USD"
        active="home"
      />,
    );
    const desktop = html.match(
      /<div class="storefront-desktop-nav">([\s\S]*?)<\/nav>/u,
    )?.[1];
    const drawer = html.match(
      /<section data-navigation-drawer="true">([\s\S]*?)<\/section>/u,
    )?.[1];
    expect(desktop).toBeDefined();
    expect(drawer).toBeDefined();
    expect(desktop).not.toContain("/orders/lookup");
    for (const path of ["", "/idols", "/gifts"]) {
      const href = `href="/${locale}${path}?market=TEST_MARKET&amp;currency=USD"`;
      expect(desktop).toContain(href);
      expect(drawer).toContain(href);
    }
    expect(drawer).toContain(`href="/${locale}/orders/lookup"`);
    expect(drawer).toContain(copy.navOrders);
    expect(drawer?.match(/\/orders\/lookup/gu)).toHaveLength(1);
  },
);
