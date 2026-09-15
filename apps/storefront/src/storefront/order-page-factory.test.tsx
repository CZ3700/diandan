import { expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";
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
const load = () => import("./order-page-factory").catch(() => null);
function props(node: ReactNode): Record<string, unknown> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.props["mode"]) return child.props;
    const found = props(child.props["children"] as ReactNode);
    if (found) return found;
  }
  return undefined;
}
it.each(SUPPORTED_LOCALES)(
  "creates private %s order pages without credentials or browse context",
  async (locale) => {
    const loaded = await load();
    expect(loaded?.createOrderPage).toBeTypeOf("function");
    if (!loaded) return;
    const id = "10000000-0000-4000-8000-000000000001";
    const page = await loaded.createOrderPage(
      locale,
      "detail",
    )({
      params: Promise.resolve({ publicOrderId: id }),
      searchParams: Promise.resolve({}),
    });
    expect(props(page)).toMatchObject({
      locale,
      mode: "detail",
      publicOrderId: id,
      invalid: false,
    });
    expect(page.props.contextQuery).toBe("");
    expect(await loaded.createOrderMetadata(locale, "detail")()).toMatchObject({
      robots: { index: false, follow: false },
      referrer: "no-referrer",
    });
  },
);
it("rejects query credentials and fake success without passing their values to the client", async () => {
  const loaded = await load();
  expect(loaded?.createOrderPage).toBeTypeOf("function");
  if (!loaded) return;
  const page = await loaded.createOrderPage(
    "en",
    "exchange",
  )({
    params: Promise.resolve({}),
    searchParams: Promise.resolve({ token: "secret", success: "true" }),
  });
  expect(props(page)).toMatchObject({ invalid: true });
  expect(JSON.stringify(page)).not.toContain("secret");
});
