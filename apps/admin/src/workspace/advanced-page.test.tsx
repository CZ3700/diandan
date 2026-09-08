import { afterEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";

const state = vi.hoisted(() => ({ mode: "TEST" }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("../server/runtime-config", () => ({
  loadAdminWorkspaceConfig: () => ({ mode: state.mode }),
}));
vi.mock("../server/management-config", () => ({
  getManagementStorefrontOrigin: () => undefined,
}));
vi.mock("./workspace", () => ({
  AdminWorkspace: ({ locale }: { locale: string }) => (
    <div data-advanced-workspace={locale} />
  ),
}));
vi.mock("../management-center/center", () => ({
  ManagementCenter: ({ locale }: { locale: string }) => (
    <div data-daily-center={locale} />
  ),
}));

afterEach(() => {
  state.mode = "TEST";
});

test("advanced editor remains separate from the simple default entry", async () => {
  const { AdvancedWorkspacePage, WorkspacePage } = await import("./pages");
  const advanced = renderToStaticMarkup(
    <AdvancedWorkspacePage locale="zh-CN" />,
  );
  const daily = renderToStaticMarkup(<WorkspacePage locale="zh-CN" />);
  expect(advanced).toContain('data-advanced-workspace="zh-CN"');
  expect(advanced).not.toContain("data-daily-center");
  expect(daily).toContain('data-daily-center="zh-CN"');
  expect(daily).not.toContain("data-advanced-workspace");
});

test("all seven advanced routes keep their actual locale and TEST-only server boundary", async () => {
  const routes = import.meta.glob("../app/**/advanced/page.tsx", {
    eager: true,
  }) as unknown as Record<string, { default: () => React.ReactNode }>;
  expect(Object.keys(routes)).toHaveLength(SUPPORTED_LOCALES.length);
  for (const locale of SUPPORTED_LOCALES) {
    const entry = Object.entries(routes).find(([filename]) =>
      filename.endsWith(`/${locale}/advanced/page.tsx`),
    );
    expect(entry).toBeDefined();
    const Page = entry![1].default;
    expect(renderToStaticMarkup(<Page />)).toContain(
      `data-advanced-workspace="${locale}"`,
    );
    state.mode = "DISABLED";
    expect(() => renderToStaticMarkup(<Page />)).toThrow("NOT_FOUND");
    state.mode = "TEST";
  }
});
