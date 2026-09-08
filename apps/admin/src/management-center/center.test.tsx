import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ManagementShell } from "./shell";
vi.mock("server-only", () => ({}));
vi.mock("../server/runtime-config", () => ({
  loadAdminWorkspaceConfig: () => ({ mode: "TEST" }),
}));
vi.mock("../server/management-config", () => ({
  getManagementStorefrontOrigin: () => "https://storefront.example.invalid",
}));
vi.mock("./center", () => ({
  ManagementCenter: ({
    locale,
    storefrontOrigin,
  }: {
    locale: string;
    storefrontOrigin: string;
  }) => (
    <div data-new-center={locale} data-storefront-origin={storefrontOrigin} />
  ),
}));
it("has exactly three primary working sections", () => {
  const html = renderToStaticMarkup(
    <ManagementShell locale="zh-CN" section="ARTISTS" onSection={() => {}}>
      <h1>艺人</h1>
    </ManagementShell>,
  );
  expect(html.match(/data-management-section=/gu)).toHaveLength(3);
  expect(html).not.toMatch(/角色|翻译包|培训|倒计时/u);
});
it("opens the new management center at the ordinary locale entry", async () => {
  const { WorkspacePage } = await import("../workspace/pages");
  const html = renderToStaticMarkup(<WorkspacePage locale="zh-CN" />);
  expect(html).toContain('data-new-center="zh-CN"');
  expect(html).toContain(
    'data-storefront-origin="https://storefront.example.invalid"',
  );
});
