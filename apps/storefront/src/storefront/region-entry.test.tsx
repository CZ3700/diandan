import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { expect, test, vi } from "vitest";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";

vi.mock("server-only", () => ({}));
vi.mock("./sole-scope-read", () => ({
  readSoleCommerceScope: async () => null,
}));

type Wrapper = ReactElement<{
  children: ReactElement<{ children: ReactNode }>;
}>;

// The header entry reaches the client SiteHeader through the RSC payload, where an
// unkeyed child array is a list: React logs a key warning (the phone menu's "1 Issue").
test("region entries hand the client header keyed children", async () => {
  const { regionEntries } = await import("./region-entry");
  const entries = regionEntries("en", await loadStorefrontCopy("en"), "");
  for (const entry of [entries.header, entries.footer] as Wrapper[]) {
    const choice = entry.props.children;
    const children = Children.toArray(choice.props.children);
    expect(children.length).toBeGreaterThan(0);
    const raw = choice.props.children;
    if (Array.isArray(raw))
      for (const child of raw) {
        expect(isValidElement(child)).toBe(true);
        expect((child as ReactElement).key).not.toBeNull();
      }
  }
});
