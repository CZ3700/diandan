import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { DisplayOrderWorkspace } from "./display-order-workspace";
import { displayOrderCopy } from "./display-order-copy";
import { DecorationCenter } from "./center";
import type { DisplayOrderApi } from "./display-order-api";

const api = {
  read: vi.fn(() => new Promise(() => {})),
  save: vi.fn(),
} as unknown as DisplayOrderApi;

it("offers artist and gift ordering in every language and explains read-only access", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = displayOrderCopy(locale);
    const html = renderToStaticMarkup(
      <DisplayOrderWorkspace
        api={api}
        locale={locale}
        canPublish={false}
        onBusy={() => {}}
        onDirtyChange={() => {}}
      />,
    );
    expect(html).toContain(copy.title);
    expect(html).toContain('data-display-order-kind="IDOL"');
    expect(html).toContain('data-display-order-kind="GIFT"');
    expect(html).toContain(copy.readOnly);
    expect(html).toMatch(/data-display-order-save="true"[^>]*disabled=""/u);
  }
});

it("shows the display order tab only when its API is available", () => {
  const layoutApi = {
    read: vi.fn(() => new Promise(() => {})),
    save: vi.fn(),
    publish: vi.fn(),
    restore: vi.fn(),
    history: vi.fn(),
  };
  const base = {
    api: layoutApi,
    themeApi: layoutApi,
    locale: "zh-CN" as const,
    canEdit: true,
    canPublish: true,
    onBusy: () => {},
    onDirtyChange: () => {},
  } as unknown as Parameters<typeof DecorationCenter>[0];
  expect(
    renderToStaticMarkup(<DecorationCenter {...base} displayOrderApi={api} />),
  ).toContain('data-decoration-tab="order"');
  expect(renderToStaticMarkup(<DecorationCenter {...base} />)).not.toContain(
    'data-decoration-tab="order"',
  );
});
