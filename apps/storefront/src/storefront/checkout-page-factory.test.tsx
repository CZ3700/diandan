import { expect, it, vi } from "vitest";
import { isValidElement, Children, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";
import {
  checkoutTestId,
  attemptTestId,
} from "../test-support/checkout-fixtures";
vi.mock("server-only", () => ({}));
vi.mock("../server/runtime-config", () => ({
  loadStorefrontRuntimeConfig: () => ({}),
  loadStorefrontPresentationConfig: () => ({ name: "TEST" }),
}));
vi.mock("../server/storefront-copy", () => ({
  loadStorefrontCopy: async () => copy,
}));
vi.mock("./storefront-page-shell", () => ({
  StorefrontPageShell: ({ children }: { children: ReactNode }) => children,
}));
import {
  createCheckoutPage,
  createCheckoutMetadata,
} from "./checkout-page-factory";
import { CheckoutClient } from "./checkout-client";
function client(node: ReactNode): Record<string, unknown> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.type === CheckoutClient) return child.props;
    const found = client(child.props["children"] as ReactNode);
    if (found) return found;
  }
  return undefined;
}
it.each(SUPPORTED_LOCALES)(
  "creates a noindex %s shell without putting checkout locators into Header browse links",
  async (locale) => {
    const page = await createCheckoutPage(
      locale,
      true,
    )({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({
        session: checkoutTestId,
        attempt: attemptTestId,
      }),
    });
    expect(page.props.contextQuery).toBe("");
    expect(client(page)).toMatchObject({
      locale,
      locator: { session: checkoutTestId, attempt: attemptTestId },
      invalid: false,
    });
    expect(await createCheckoutMetadata(locale, true)()).toMatchObject({
      robots: { index: false, follow: false },
      referrer: "no-referrer",
    });
  },
);
it("rejects a browser success assertion and duplicate locators, without dispatching or rendering private state", async () => {
  for (const changes of [
    { success: "true" },
    { session: [checkoutTestId, checkoutTestId] },
  ]) {
    const page = await createCheckoutPage(
      "en",
      true,
    )({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({
        session: checkoutTestId,
        attempt: attemptTestId,
        ...changes,
      }),
    });
    expect(client(page)).toMatchObject({ invalid: true });
    expect(client(page)?.["locator"]).toBeUndefined();
  }
  const html = renderToStaticMarkup(<CheckoutClient locale="en" copy={copy} />);
  expect(html).not.toContain('type="email"');
  expect(html).not.toContain("payments.example");
});
