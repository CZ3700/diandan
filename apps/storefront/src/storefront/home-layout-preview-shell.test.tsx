import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
const restore = vi.hoisted(() => vi.fn(async () => true));
vi.mock("server-only", () => ({}));
vi.mock("../server/cart-restoration-hint", () => ({
  readCartRestorationHint: restore,
}));
vi.mock("./storefront-page-reads", () => ({
  readCommerceContext: async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "COMMERCE_UNAVAILABLE",
  }),
}));
vi.mock("./region-entry", () => ({
  regionEntries: () => ({ header: <span />, footer: <span /> }),
}));
test.each(["home", "artists", "gifts"] as const)(
  "%s preview uses the real header and footer without restoring private cart state, and every control is inert",
  async (active) => {
    const { StorefrontPageShell } = await import("./storefront-page-shell");
    const result = await StorefrontPageShell({
      preview: true,
      locale: "en",
      copy: await loadStorefrontCopy("en"),
      name: "Studio",
      contextQuery: "",
      active,
      children: <h1>Published content</h1>,
    });
    const html = renderToStaticMarkup(result);
    expect(restore).not.toHaveBeenCalled();
    expect(html).toContain('inert=""');
    expect(html).toContain('data-layout-preview="true"');
    expect(html).toContain('class="storefront-header"');
    expect(html).toContain('class="storefront-footer"');
    expect(html).not.toContain("data-cart-trigger");
  },
);
