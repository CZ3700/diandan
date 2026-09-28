import { afterEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_LOCALE } from "@fan-support/contracts";

const state = vi.hoisted(() => ({ mode: "DISABLED" }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("../server/runtime-config", () => ({
  loadAdminRuntimeConfig: () => ({}),
  loadAdminWorkspaceConfig: () => ({ mode: state.mode }),
}));
afterEach(() => {
  state.mode = "DISABLED";
});

test.each(["TEST", "LOCAL_OIDC", "OIDC"])(
  "%s root opens the default management locale",
  async (mode) => {
    state.mode = mode;
    const { default: Page } = await import("../app/page");
    expect(() => renderToStaticMarkup(<Page />)).toThrow(
      `REDIRECT:/${DEFAULT_LOCALE}`,
    );
  },
);
test("disabled root preserves the unavailable runtime page without a login link", async () => {
  const { default: Page } = await import("../app/page");
  const html = renderToStaticMarkup(<Page />);
  expect(html).toContain('id="runtime-title"');
  expect(html).not.toContain("/api/admin/auth/begin");
});
