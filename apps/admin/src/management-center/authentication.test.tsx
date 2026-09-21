import { beforeEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
const state = vi.hoisted(() => ({
  session: null as unknown,
  loading: false,
  unavailable: false,
  expired: false,
  reload: vi.fn(),
  logout: vi.fn(),
  client: {},
}));
vi.mock("../workspace/client", () => ({ useAdminSession: () => state }));
vi.mock("./hub", () => ({
  ManagementHub: ({ onLogout }: { onLogout?: unknown }) => (
    <div data-workspace data-logout-enabled={typeof onLogout === "function"} />
  ),
}));
import { ManagementCenter } from "./center";
import { managementCopy } from "./copy";
beforeEach(() =>
  Object.assign(state, {
    session: null,
    loading: false,
    unavailable: false,
    expired: false,
  }),
);

test.each(SUPPORTED_LOCALES)(
  "%s offers a single same-origin POST login form without requesting credentials in the management UI",
  (locale) => {
    const html = renderToStaticMarkup(
      <ManagementCenter locale={locale} authenticationAvailable />,
    );
    expect(html).toContain('action="/api/admin/auth/begin"');
    expect(html).toContain('method="post"');
    expect(html).toContain(`name="locale" value="${locale}"`);
    expect(html.match(/<form/gu)).toHaveLength(1);
    expect(html).not.toMatch(
      /type="password"|accessKey|browserToken|oidcIssuer/u,
    );
  },
);
test("existing TEST missing-session state retains reconnect without installing a login bypass", () => {
  const html = renderToStaticMarkup(<ManagementCenter locale="zh-CN" />);
  expect(html).toContain(managementCopy("zh-CN").reconnect);
  expect(html).not.toContain("/api/admin/auth/begin");
});
test("unavailable session service is shown as a retryable failure instead of claiming sign-in is needed", () => {
  state.unavailable = true;
  const html = renderToStaticMarkup(
    <ManagementCenter locale="en" authenticationAvailable />,
  );
  expect(html).toContain("We could not check your session");
  expect(html).not.toContain("/api/admin/auth/begin");
});
test("expired session offers sign-in again and active session keeps the existing workspace with logout", () => {
  state.expired = true;
  expect(
    renderToStaticMarkup(
      <ManagementCenter locale="en" authenticationAvailable />,
    ),
  ).toContain("Your session has ended");
  state.session = { outcome: "SUCCESS" };
  const html = renderToStaticMarkup(
    <ManagementCenter locale="en" authenticationAvailable />,
  );
  expect(html).toContain('data-logout-enabled="true"');
  expect(html).not.toContain("/api/admin/auth/begin");
});
