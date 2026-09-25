import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { expect, test, vi } from "vitest";
import copy from "../../../../packages/i18n/src/storefront/en";
import { CartProvider } from "./cart-provider";

const request = vi.hoisted(() => ({ has: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => request }));
vi.mock("./storefront-page-reads", () => ({
  readCommerceContext: async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "COMMERCE_UNAVAILABLE",
  }),
}));
import { StorefrontPageShell } from "./storefront-page-shell";

function provider(
  node: ReactNode,
): ReactElement<Record<string, unknown>> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.type === CartProvider) return child;
    const found = provider(child.props["children"] as ReactNode);
    if (found) return found;
  }
  return undefined;
}

test.each([false, true])(
  "passes request cookie presence %s into the shared browse/cart/checkout/order shell",
  async (present) => {
    request.has.mockReset().mockReturnValue(present);
    const tree = await StorefrontPageShell({
      locale: "en",
      copy,
      name: "Test studio",
      contextQuery: "",
      active: "home",
      children: <p>Public content</p>,
    });
    expect(provider(tree)?.props["restoreOnLoad"]).toBe(present);
  },
);
