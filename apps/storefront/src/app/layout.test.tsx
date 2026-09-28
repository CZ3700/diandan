import { isValidElement, type ReactElement } from "react";
import { expect, test, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  preview: false,
  locale: "zh-CN" as string | null,
  theme: vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  })),
  collector: vi.fn(async () => null),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      ...(runtime.locale ? { "x-storefront-locale": runtime.locale } : {}),
      ...(runtime.preview ? { "x-storefront-layout-preview": "1" } : {}),
    }),
}));
vi.mock("../server/rum-bootstrap", () => ({
  renderRumCollector: runtime.collector,
}));
vi.mock("../server/public-storefront-theme", () => ({
  readPublicStorefrontTheme: runtime.theme,
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

test("layout preview does not initialize telemetry collection", async () => {
  runtime.preview = true;
  runtime.collector.mockClear();
  try {
    const { default: RootLayout } = await import("./layout");
    await RootLayout({ children: null });
    expect(runtime.collector).not.toHaveBeenCalled();
  } finally {
    runtime.preview = false;
  }
});

test("a theme outage retains the page and marks its safe fallback without claiming publication", async () => {
  const { default: RootLayout } = await import("./layout");
  const html = await RootLayout({
    children: "payment-return-or-order-content",
  });
  expect(html.props["data-storefront-palette"]).toBe("BLACK_GOLD");
  expect(html.props["data-theme-source"]).toBe("FALLBACK");
  expect(html.props["data-theme-status"]).toBe("UNAVAILABLE");
  expect(html.props["data-theme-version"]).toBeUndefined();
  expect(JSON.stringify(html)).toContain("payment-return-or-order-content");
});

test("internal pages never load or apply published storefront themes", async () => {
  runtime.locale = null;
  runtime.theme.mockClear();
  try {
    const { default: RootLayout } = await import("./layout");
    const html = await RootLayout({ children: null });
    expect(runtime.theme).not.toHaveBeenCalled();
    expect(html.props["data-storefront-palette"]).toBeUndefined();
  } finally {
    runtime.locale = "zh-CN";
  }
});
