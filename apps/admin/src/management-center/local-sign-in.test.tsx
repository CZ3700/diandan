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
vi.mock("./hub", () => ({ ManagementHub: () => <div data-workspace /> }));
import { ManagementCenter } from "./center";
import { LocalSignIn } from "./local-sign-in";
import { signInCopy } from "./local-sign-in-copy";
import { submitSignIn } from "./local-sign-in-api";
import { managementCopy } from "./copy";

beforeEach(() =>
  Object.assign(state, {
    session: null,
    loading: false,
    unavailable: false,
    expired: false,
  }),
);
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node);
const attribute = (html: string, id: string, name: string) =>
  new RegExp(`<input[^>]*id="${id}"[^>]*${name}`, "u").test(html) ||
  new RegExp(`<input[^>]*${name}[^>]*id="${id}"`, "u").test(html);

test("every language has the full sign-in vocabulary and keeps the account placeholder", () => {
  const keys = Object.keys(signInCopy("en")).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const copy = signInCopy(locale);
    expect(Object.keys(copy).sort()).toEqual(keys);
    expect(Object.values(copy).every((value) => value.trim().length > 0)).toBe(
      true,
    );
    expect(copy.codeIntro).toContain("{account}");
    expect(copy.newPasswordIntro).toContain("{account}");
  }
  // Operator-facing words stay consistent with the rest of the center.
  expect(signInCopy("zh-CN").loginName).toBe("登录名");
});

test.each(SUPPORTED_LOCALES)(
  "%s shows a password form for password managers, with no identity-provider redirect",
  (locale) => {
    const copy = signInCopy(locale);
    const html = render(<LocalSignIn locale={locale} onSignedIn={() => {}} />);
    expect(html).toContain(`<h1>${copy.signInTitle}</h1>`);
    expect(html).toContain(managementCopy(locale).center);
    expect(html.match(/<form/gu)).toHaveLength(1);
    expect(html).not.toContain("/api/admin/auth/begin");
    expect(html).not.toMatch(/<form[^>]*action=/u);
    expect(attribute(html, "si-login-name", 'autoComplete="username"')).toBe(
      true,
    );
    expect(attribute(html, "si-password", 'type="password"')).toBe(true);
    expect(
      attribute(html, "si-password", 'autoComplete="current-password"'),
    ).toBe(true);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(copy.showPassword);
    expect(html).toContain("data-management-language");
    expect(html).not.toContain(copy.differentAccount);
  },
);

test("the code step names the account and offers a recovery code; each variant fits its keyboard", () => {
  const copy = signInCopy("ja");
  const totp = render(
    <LocalSignIn
      locale="ja"
      onSignedIn={() => {}}
      initial={{ step: "SECOND_FACTOR", loginName: "studio.owner" }}
    />,
  );
  expect(totp).toContain(`<h1>${copy.codeTitle}</h1>`);
  expect(totp).toContain(copy.codeIntro.replace("{account}", "studio.owner"));
  expect(attribute(totp, "si-code", 'autoComplete="one-time-code"')).toBe(true);
  expect(attribute(totp, "si-code", 'inputMode="numeric"')).toBe(true);
  expect(totp).toContain(copy.useRecovery);
  expect(totp).toContain(copy.differentAccount);
  expect(totp).not.toContain('type="password"');
  const recovery = render(
    <LocalSignIn
      locale="ja"
      onSignedIn={() => {}}
      initial={{
        step: "SECOND_FACTOR",
        factor: "RECOVERY_CODE",
        loginName: "studio.owner",
      }}
    />,
  );
  expect(recovery).toContain(`<h1>${copy.recoveryTitle}</h1>`);
  expect(attribute(recovery, "si-code", 'autoCapitalize="characters"')).toBe(
    true,
  );
  expect(recovery).toContain(copy.useAuthenticator);
});

test("the new-password step files the password under the account for password managers", () => {
  const copy = signInCopy("th");
  const html = render(
    <LocalSignIn
      locale="th"
      onSignedIn={() => {}}
      initial={{ step: "NEW_PASSWORD", loginName: "night.shift" }}
    />,
  );
  expect(html).toContain(`<h1>${copy.newPasswordTitle}</h1>`);
  expect(html).toContain(copy.passwordHint);
  expect(html.match(/autoComplete="new-password"/gu)).toHaveLength(2);
  const username = html.match(/<input[^>]*autoComplete="username"[^>]*>/u)?.[0];
  expect(username).toContain('value="night.shift"');
  expect(username).toContain("hidden");
  expect(username).toContain("readOnly");
});

test("the center shows this page only for built-in accounts without a session", () => {
  const html = render(
    <ManagementCenter locale="vi" authenticationAvailable localAccounts />,
  );
  expect(html).toContain('data-local-sign-in="PASSWORD"');
  expect(html).not.toContain("/api/admin/auth/begin");
  state.expired = true;
  expect(
    render(
      <ManagementCenter locale="vi" authenticationAvailable localAccounts />,
    ),
  ).toContain(managementCopy("vi").sessionExpired);
  state.unavailable = true;
  const unavailable = render(
    <ManagementCenter locale="vi" authenticationAvailable localAccounts />,
  );
  expect(unavailable).not.toContain("data-local-sign-in");
  expect(unavailable).toContain(managementCopy("vi").retry);
  Object.assign(state, {
    unavailable: false,
    session: { permissions: [], localeScopes: [] },
  });
  expect(
    render(
      <ManagementCenter locale="vi" authenticationAvailable localAccounts />,
    ),
  ).toContain("data-workspace");
});

test("browser calls stay same-origin JSON and any unexpected answer reads as unavailable", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "SIGNED_IN",
      locale: "en",
    }),
  );
  expect(await submitSignIn("login", { schemaVersion: 1 }, fetcher)).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "SIGNED_IN",
    locale: "en",
  });
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe("/api/admin/local-auth/login");
  expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
  const unavailable = {
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "ACCESS_UNAVAILABLE",
  };
  expect(
    await submitSignIn("step", {}, async () =>
      Response.json({ sessionToken: "x" }),
    ),
  ).toEqual(unavailable);
  expect(
    await submitSignIn("step", {}, async () => {
      throw new TypeError("offline");
    }),
  ).toEqual(unavailable);
});
