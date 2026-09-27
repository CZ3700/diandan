import { isValidElement, type ReactElement } from "react";
import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-storefront-locale": "zh-CN" }),
}));
vi.mock("../server/rum-bootstrap", () => ({
  renderRumCollector: async () => null,
}));

type ElementProps = Readonly<{
  children?: unknown;
  lang?: string;
  suppressHydrationWarning?: boolean;
}>;

// The first import compiles the whole layout module graph, which is slow under parallel
// turbo load; the assertions themselves are synchronous.
test("keeps phone browsers from rewriting server HTML before hydration", async () => {
  const subject = await import("./layout");
  // iOS turns digit runs such as order numbers or artist names into tel: links.
  expect(subject.metadata.formatDetection).toEqual({
    telephone: false,
    date: false,
    email: false,
    address: false,
  });
  const html = (await subject.default({
    children: null,
  })) as ReactElement<ElementProps>;
  expect(html.type).toBe("html");
  expect(html.props.lang).toBe("zh-CN");
  // In-app browsers inject attributes on these two elements before React hydrates.
  expect(html.props.suppressHydrationWarning).toBe(true);
  const body = html.props.children;
  expect(isValidElement(body)).toBe(true);
  expect((body as ReactElement<ElementProps>).type).toBe("body");
  expect(
    (body as ReactElement<ElementProps>).props.suppressHydrationWarning,
  ).toBe(true);
}, 30_000);
