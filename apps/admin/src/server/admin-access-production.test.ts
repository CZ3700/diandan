import { expect, test, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
vi.mock("server-only", () => ({}));
import { createAdminAccessBff } from "./admin-access-bff";

const origin = "https://admin.example.invalid";
const issuer = "https://identity.example.invalid";
const config = {
  schemaVersion: 1,
  mode: "OIDC",
  siteOrigin: origin,
  internalApiOrigin: "https://api.example.invalid",
  adminAccessKey: "a".repeat(64),
  oidcIssuer: issuer,
} as const;
const now = Date.parse("2026-09-29T00:00:00Z");
const expiresAt = "2026-09-29T00:05:00Z";
const browserToken = "b".repeat(42) + "A";
const sessionToken = "s".repeat(42) + "A";
const csrfToken = "c".repeat(42) + "A";
const state = "state-" + "a".repeat(43);
const session = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "SESSION_CREATED",
  sessionToken,
  csrfToken,
  expiresAt,
  locale: "ja",
};
const binding = `__Host-fan-admin-login=${browserToken}`;
const localeHint = (locale: string, deadline = Date.parse(expiresAt)) =>
  `__Host-fan-admin-login-locale=${locale}.${deadline}`;
function post(
  action: string,
  body: string,
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/admin/auth/${action}`, {
    method: "POST",
    body,
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...headers,
    },
  });
}
function callback(
  cookie = binding,
  query = `code=private-code&state=${state}`,
) {
  return new Request(`${origin}/api/admin/auth/callback?${query}`, {
    headers: { cookie, "sec-fetch-site": "cross-site" },
  });
}
function fixture(value: unknown, status = 200) {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(value, { status }),
  );
  return {
    fetcher,
    bff: createAdminAccessBff({ config, fetch: fetcher, now: () => now }),
  };
}
test("formal OIDC begin uses the canonical HTTPS API and the existing private browser binding", async () => {
  const value = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LOGIN_REDIRECT",
    authorizationUrl: `${issuer}/authorize?state=${state}`,
    browserToken,
    expiresAt,
  };
  const { bff, fetcher } = fixture(value);
  const response = await bff.begin(
    post("begin", "locale=zh-CN", {
      "content-type": "application/x-www-form-urlencoded",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LOGIN_REDIRECT",
    authorizationUrl: value.authorizationUrl,
  });
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe(`${config.internalApiOrigin}/api/v1/admin/access/begin`);
  expect(new Headers(init?.headers).get("x-admin-access-key")).toBe(
    config.adminAccessKey,
  );
  expect(response.headers.getSetCookie()).toEqual(
    expect.arrayContaining([
      expect.stringContaining(
        `${localeHint("zh-CN")}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300`,
      ),
    ]),
  );
});
test("formal callback trusts the API-bound locale, rotates credentials, and clears both login cookies", async () => {
  const { bff } = fixture(session);
  const response = await bff.callback(
    callback(`${binding}; ${localeHint("es")}`),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`${origin}/ja`);
  const cookies = response.headers.getSetCookie();
  expect(cookies).toHaveLength(4);
  expect(cookies.filter((value) => value.includes("Max-Age=0"))).toHaveLength(
    2,
  );
  expect(
    cookies.filter((value) => value.includes("SameSite=Strict")),
  ).toHaveLength(2);
});
test.each(SUPPORTED_LOCALES)(
  "failed or denied %s login keeps only the bounded interface language",
  async (locale) => {
    const { bff, fetcher } = fixture(session);
    const response = await bff.callback(
      callback(
        `${binding}; ${localeHint(locale)}`,
        `error=access_denied&error_description=private-provider-detail&state=${state}`,
      ),
    );
    expect(response.headers.get("location")).toBe(
      `${origin}/${locale}?login=failed`,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(
      response.headers
        .getSetCookie()
        .every((value) => value.includes("Max-Age=0")),
    ).toBe(true);
    expect(await response.text()).toBe("");
  },
);
test.each([
  "",
  localeHint("https://evil.invalid"),
  localeHint("../ja"),
  localeHint("zz"),
  localeHint("zh-CN", now),
  localeHint("zh-CN", now - 1),
  localeHint("zh-CN", now + 601_000),
  `${localeHint("ja")}; ${localeHint("es")}`,
])(
  "untrusted or expired login language cannot become a redirect target: %s",
  async (hint) => {
    const { bff } = fixture(session);
    const response = await bff.callback(
      callback(`${binding}; ${hint}`, "error=access_denied"),
    );
    expect(response.headers.get("location")).toBe(`${origin}/en?login=failed`);
  },
);
test("formal logout only clears credentials after confirmed API revocation", async () => {
  const { bff, fetcher } = fixture({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LOGGED_OUT",
  });
  const request = () =>
    post("logout", '{"schemaVersion":1}', {
      cookie: `__Host-fan-admin-session=${sessionToken}; __Host-fan-admin-csrf=${csrfToken}`,
      "x-csrf-token": csrfToken,
    });
  const response = await bff.logout(request());
  expect(response.status).toBe(200);
  expect(response.headers.getSetCookie()).toHaveLength(4);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `${config.internalApiOrigin}/api/v1/admin/access/logout`,
  );
  fetcher.mockRejectedValueOnce(new Error("private-network-detail"));
  const failed = await bff.logout(request());
  expect(failed.status).toBe(503);
  expect(failed.headers.getSetCookie()).toEqual([]);
  expect(await failed.text()).not.toContain("private-network-detail");
});
test("formal OIDC keeps exact-origin, issuer, and CSRF checks", async () => {
  const { bff, fetcher } = fixture(session);
  expect(
    (
      await bff.begin(
        post("begin", "locale=en", {
          origin: "https://evil.invalid",
          "content-type": "application/x-www-form-urlencoded",
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await bff.logout(
        post("logout", '{"schemaVersion":1}', {
          cookie: `__Host-fan-admin-session=${sessionToken}; __Host-fan-admin-csrf=${csrfToken}`,
          "x-csrf-token": browserToken,
        }),
      )
    ).status,
  ).toBe(403);
  const response = await bff.callback(
    callback(
      binding,
      `code=private-code&state=${state}&iss=https://evil.invalid`,
    ),
  );
  expect(response.headers.get("location")).toBe(`${origin}/en?login=failed`);
  expect(fetcher).not.toHaveBeenCalled();
});
