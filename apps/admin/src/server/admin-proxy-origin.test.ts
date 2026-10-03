import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createAdminAccessBff } from "./admin-access-bff";
import { createAdminBff } from "./admin-bff";

const siteOrigin = "https://admin.example.invalid:8443";
const config = {
  schemaVersion: 1,
  mode: "OIDC",
  siteOrigin,
  internalApiOrigin: "https://api.example.invalid",
  adminAccessKey: "a".repeat(64),
  oidcIssuer: "https://identity.example.invalid",
} as const;
const now = Date.parse("2026-09-29T00:00:00Z");
const expiresAt = "2026-09-29T00:05:00Z";
const sessionToken = "s".repeat(42) + "A",
  csrfToken = "c".repeat(42) + "A",
  browserToken = "b".repeat(42) + "A";
const state = "state-" + "a".repeat(43);
const proxyHeaders = {
  host: "admin.example.invalid:8443",
  "x-forwarded-host": "admin.example.invalid:8443",
  "x-forwarded-proto": "https",
};
const credentials = `__Host-fan-admin-session=${sessionToken}; __Host-fan-admin-csrf=${csrfToken}; __Host-fan-admin-login=${browserToken}`;
const session = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "ADMIN_SESSION",
  actorId: "10000000-0000-4000-8000-000000000001",
  permissions: [],
  localeScopes: [],
};
const owners = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "OWNERS",
  items: [],
  totalItems: 0,
  page: 1,
  pageSize: 10,
};
const actions = [
  "begin",
  "callback",
  "logout",
  "session",
  "operation",
] as const;
type Action = (typeof actions)[number];
function fixture() {
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const path = new URL(String(url)).pathname;
    const value = path.endsWith("/begin")
      ? {
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "LOGIN_REDIRECT",
          authorizationUrl: `${config.oidcIssuer}/authorize?state=${state}`,
          browserToken,
          expiresAt,
        }
      : path.endsWith("/callback")
        ? {
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "SESSION_CREATED",
            sessionToken,
            csrfToken,
            expiresAt,
            locale: "zh-CN",
          }
        : path.endsWith("/logout")
          ? { schemaVersion: 1, outcome: "SUCCESS", kind: "LOGGED_OUT" }
          : path.endsWith("/session/read")
            ? session
            : owners;
    return Response.json(value);
  });
  const access = createAdminAccessBff({
    config,
    fetch: fetcher,
    now: () => now,
  });
  const admin = createAdminBff({ config, fetch: fetcher });
  function request(
    action: Action,
    overrides: Record<string, string | null> = {},
  ) {
    const headers = new Headers({
      ...proxyHeaders,
      cookie: credentials,
      "sec-fetch-site": action === "callback" ? "cross-site" : "same-origin",
    });
    if (action !== "callback") headers.set("origin", siteOrigin);
    headers.set("x-csrf-token", csrfToken);
    headers.set(
      "content-type",
      action === "begin"
        ? "application/x-www-form-urlencoded"
        : "application/json",
    );
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) headers.delete(key);
      else headers.set(key, value);
    }
    const path =
      action === "operation"
        ? "catalog-list"
        : action === "session"
          ? "session"
          : `auth/${action}`;
    const url = `http://127.0.0.1:3100/api/admin/${path}${action === "callback" ? `?code=private-code&state=${state}` : ""}`;
    return new Request(url, {
      headers,
      method: action === "session" || action === "callback" ? "GET" : "POST",
      ...(action === "session" || action === "callback"
        ? {}
        : {
            body:
              action === "begin"
                ? "locale=zh-CN"
                : action === "operation"
                  ? JSON.stringify({
                      schemaVersion: 1,
                      kind: "IDOL",
                      locale: "en",
                      page: 1,
                      pageSize: 10,
                    })
                  : '{"schemaVersion":1}',
          }),
    });
  }
  const run = (action: Action, headers?: Record<string, string | null>) =>
    action === "operation"
      ? admin.operation(request(action, headers), "catalog-list")
      : action === "session"
        ? admin.session(request(action, headers))
        : access[action](request(action, headers));
  return { fetcher, run };
}

test.each(actions)(
  "configured private proxy reaches %s without replacing its authority checks",
  async (action) => {
    const { run, fetcher } = fixture();
    const response = await run(action);
    expect(response.status).toBe(action === "callback" ? 303 : 200);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toMatch(
      /^https:\/\/api\.example\.invalid\/api\/v1\/admin\//,
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("origin")).toBe(siteOrigin);
    for (const name of ["host", "x-forwarded-host", "x-forwarded-proto"])
      expect(headers.has(name)).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
  },
);
test("an anonymous session behind the configured proxy remains unauthenticated instead of forbidden", async () => {
  const { run, fetcher } = fixture();
  const response = await run("session", { cookie: null });
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  expect(fetcher).not.toHaveBeenCalled();
});
const invalidProxyHeaders = [
  ["host", null],
  ["host", "attacker.invalid"],
  ["host", "admin.example.invalid"],
  ["host", "admin.example.invalid:8443, attacker.invalid"],
  ["x-forwarded-host", null],
  ["x-forwarded-host", "attacker.invalid"],
  ["x-forwarded-host", "https://admin.example.invalid:8443"],
  [
    "x-forwarded-host",
    "admin.example.invalid:8443, admin.example.invalid:8443",
  ],
  ["x-forwarded-proto", null],
  ["x-forwarded-proto", "http"],
  ["x-forwarded-proto", "https:"],
  ["x-forwarded-proto", "https, https"],
] as const;
test.each(invalidProxyHeaders)(
  "all five entry points reject invalid proxy evidence %s=%s",
  async (name, value) => {
    const { run, fetcher } = fixture();
    for (const action of actions)
      expect((await run(action, { [name]: value })).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  },
);
test("Origin or RFC Forwarded alone cannot authorize an internal URL", async () => {
  const { run, fetcher } = fixture();
  for (const action of actions)
    expect(
      (
        await run(action, {
          host: null,
          "x-forwarded-host": null,
          "x-forwarded-proto": null,
          forwarded: "host=admin.example.invalid:8443;proto=https",
          origin: siteOrigin,
        })
      ).status,
    ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
test("proxy matching leaves Origin and Fetch Metadata requirements unchanged", async () => {
  const { run, fetcher } = fixture();
  for (const action of ["begin", "logout", "session", "operation"] as const) {
    expect(
      (await run(action, { origin: "https://attacker.invalid" })).status,
    ).toBe(403);
    expect((await run(action, { "sec-fetch-site": "cross-site" })).status).toBe(
      403,
    );
  }
  for (const action of ["begin", "logout", "operation"] as const)
    expect((await run(action, { origin: null })).status).toBe(403);
  for (const action of ["begin", "logout", "session"] as const)
    expect((await run(action, { "sec-fetch-site": null })).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
test("proxy matching cannot create a session or bypass business CSRF and browser binding", async () => {
  const { run, fetcher } = fixture();
  for (const action of ["logout", "operation"] as const) {
    expect((await run(action, { "x-csrf-token": browserToken })).status).toBe(
      403,
    );
    expect((await run(action, { "x-csrf-token": null })).status).toBe(403);
    expect((await run(action, { cookie: null })).status).toBe(401);
  }
  const callback = await run("callback", { cookie: null });
  expect(callback.status).toBe(303);
  expect(callback.headers.get("location")).toBe(
    `${siteOrigin}/en?login=failed`,
  );
  expect(fetcher).not.toHaveBeenCalled();
});
