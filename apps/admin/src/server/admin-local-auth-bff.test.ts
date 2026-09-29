import { expect, test, vi } from "vitest";
import { createAdminLocalAuthBff } from "./admin-local-auth-bff";
import { createAdminAccessBff } from "./admin-access-bff";
vi.mock("server-only", () => ({}));

const origin = "https://admin.example.invalid";
const sessionToken = "s".repeat(42) + "A";
const csrfToken = "c".repeat(42) + "A";
const challengeToken = "h".repeat(42) + "A";
const now = Date.parse("2026-09-29T00:00:00Z");
const config = {
  schemaVersion: 1,
  mode: "LOCAL_ACCOUNT",
  siteOrigin: origin,
  internalApiOrigin: "http://127.0.0.1:3200",
  adminAccessKey: "a".repeat(64),
} as const;
const success = { schemaVersion: 1, outcome: "SUCCESS" } as const;
const sessionResult = {
  ...success,
  kind: "SESSION_CREATED",
  sessionToken,
  csrfToken,
  expiresAt: "2026-09-29T08:00:00.000000Z",
  locale: "th",
};
const stepResult = {
  ...success,
  kind: "STEP_REQUIRED",
  step: "SECOND_FACTOR",
  challengeToken,
  expiresAt: "2026-09-29T00:05:00.000000Z",
};
const failure = (code: string, extra = {}) => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
  ...extra,
});
function setup(response: unknown, status = 200, overrides = {}) {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(response, { status }),
  );
  return {
    fetcher,
    bff: createAdminLocalAuthBff({
      config: { ...config, ...overrides } as never,
      fetch: fetcher,
      now: () => now,
    }),
  };
}
function request(
  action: "login" | "step",
  body: unknown,
  headers: Record<string, string> = {},
  url = `${origin}/api/admin/local-auth/${action}`,
) {
  return new Request(url, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
const login = {
  schemaVersion: 1,
  locale: "th",
  loginName: "studio.owner",
  password: "correct horse battery",
};
const cookies = (response: Response) => response.headers.getSetCookie();

test("only LOCAL_ACCOUNT serves built-in sign-in", async () => {
  const { bff, fetcher } = setup(sessionResult, 200, { mode: "LOCAL_OIDC" });
  expect((await bff.login(request("login", login))).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});

test("cross-site, foreign origin, query strings, other types and extra fields never reach the API", async () => {
  const { bff, fetcher } = setup(sessionResult);
  for (const [candidate, status] of [
    [request("login", login, { "sec-fetch-site": "cross-site" }), 403],
    [request("login", login, { origin: "https://evil.example" }), 403],
    [
      request("login", login, {}, `${origin}/api/admin/local-auth/login?x=1`),
      400,
    ],
    [request("login", login, { "content-type": "text/plain" }), 400],
    [request("login", { ...login, requestId: crypto.randomUUID() }), 400],
    [request("login", { ...login, loginName: "" }), 400],
  ] as const)
    expect((await bff.login(candidate)).status).toBe(status);
  expect(fetcher).not.toHaveBeenCalled();
});

test("a completed sign-in sets strict session cookies and returns no credential", async () => {
  const { bff, fetcher } = setup(sessionResult);
  const response = await bff.login(request("login", login));
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(JSON.parse(body)).toEqual({
    ...success,
    kind: "SIGNED_IN",
    locale: "th",
  });
  expect(body).not.toContain(sessionToken);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const set = cookies(response);
  expect(set).toEqual(
    expect.arrayContaining([
      expect.stringMatching(
        new RegExp(
          `^__Host-fan-admin-session=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`,
        ),
      ),
      expect.stringMatching(
        /^__Host-fan-admin-csrf=c+A; Path=\/; Secure; HttpOnly; SameSite=Strict/,
      ),
      expect.stringMatching(/^__Host-fan-admin-local-login=; .*Max-Age=0/),
    ]),
  );
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe("http://127.0.0.1:3200/api/v1/admin/local-access/login");
  expect(init?.headers).toMatchObject({
    origin,
    "x-admin-access-key": "a".repeat(64),
  });
  expect(JSON.parse(String(init?.body))).toEqual({
    ...login,
    requestId: expect.any(String),
  });
});

test("a further step keeps the challenge in a short strict HttpOnly cookie only", async () => {
  const { bff } = setup(stepResult);
  const response = await bff.login(request("login", login));
  const body = await response.text();
  expect(JSON.parse(body)).toEqual({
    ...success,
    kind: "STEP_REQUIRED",
    step: "SECOND_FACTOR",
  });
  expect(body).not.toContain(challengeToken);
  expect(cookies(response)).toEqual([
    expect.stringMatching(
      new RegExp(
        `^__Host-fan-admin-local-login=${challengeToken}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300`,
      ),
    ),
  ]);
});

test("failures pass through with their status; ending failures clear the challenge", async () => {
  const rejected = setup(failure("INVALID_CREDENTIALS"), 403);
  const denied = await rejected.bff.login(request("login", login));
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual(failure("INVALID_CREDENTIALS"));
  const locked = setup(failure("ACCOUNT_LOCKED"), 403);
  const lockedResponse = await locked.bff.step(
    request(
      "step",
      { schemaVersion: 1, step: { kind: "TOTP", code: "123456" } },
      {
        cookie: `__Host-fan-admin-local-login=${challengeToken}`,
      },
    ),
  );
  expect(await lockedResponse.json()).toEqual(failure("ACCOUNT_LOCKED"));
  expect(cookies(lockedResponse)).toEqual([
    expect.stringMatching(/^__Host-fan-admin-local-login=; .*Max-Age=0/),
  ]);
  const weak = setup(
    failure("PASSWORD_REJECTED", { passwordProblem: "TOO_SHORT" }),
    403,
  );
  const weakResponse = await weak.bff.step(
    request(
      "step",
      {
        schemaVersion: 1,
        step: { kind: "NEW_PASSWORD", newPassword: "short" },
      },
      {
        cookie: `__Host-fan-admin-local-login=${challengeToken}`,
      },
    ),
  );
  expect(await weakResponse.json()).toEqual(
    failure("PASSWORD_REJECTED", { passwordProblem: "TOO_SHORT" }),
  );
  expect(cookies(weakResponse)).toEqual([]);
});

test("a step needs the challenge cookie and completes with session cookies", async () => {
  const missing = setup(sessionResult);
  const restart = await missing.bff.step(
    request("step", {
      schemaVersion: 1,
      step: { kind: "TOTP", code: "123456" },
    }),
  );
  expect(await restart.json()).toEqual(failure("LOGIN_RESTART_REQUIRED"));
  expect(missing.fetcher).not.toHaveBeenCalled();
  const { bff, fetcher } = setup(sessionResult);
  const response = await bff.step(
    request(
      "step",
      {
        schemaVersion: 1,
        step: { kind: "RECOVERY_CODE", code: "ABCD-EFGH-JKMN" },
      },
      {
        cookie: `__Host-fan-admin-local-login=${challengeToken}`,
      },
    ),
  );
  expect(await response.json()).toEqual({
    ...success,
    kind: "SIGNED_IN",
    locale: "th",
  });
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({
    schemaVersion: 1,
    requestId: expect.any(String),
    challengeToken,
    step: { kind: "RECOVERY_CODE", code: "ABCD-EFGH-JKMN" },
  });
  expect(cookies(response).map((value) => value.split("=")[0])).toEqual([
    "__Host-fan-admin-session",
    "__Host-fan-admin-csrf",
    "__Host-fan-admin-local-login",
  ]);
});

test("malformed or inconsistent API answers fail closed", async () => {
  for (const [body, status] of [
    [{ ...sessionResult, extra: true }, 200],
    [sessionResult, 403],
    [failure("INVALID_CREDENTIALS"), 200],
    [{ ...sessionResult, expiresAt: "2026-09-30T00:00:00.000000Z" }, 200],
  ] as const) {
    const { bff } = setup(body, status);
    const response = await bff.login(request("login", login));
    expect(response.status).toBe(503);
    expect(
      cookies(response).some((value) =>
        value.startsWith("__Host-fan-admin-session=s"),
      ),
    ).toBe(false);
  }
});

test("logout in LOCAL_ACCOUNT mode revokes through the built-in route", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ ...success, kind: "LOGGED_OUT" }),
  );
  const bff = createAdminAccessBff({
    config: config as never,
    fetch: fetcher,
    now: () => now,
  });
  const response = await bff.logout(
    new Request(`${origin}/api/admin/auth/logout`, {
      method: "POST",
      headers: {
        origin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: `__Host-fan-admin-session=${sessionToken}; __Host-fan-admin-csrf=${csrfToken}`,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ schemaVersion: 1 }),
    }),
  );
  expect(response.status).toBe(200);
  expect(fetcher.mock.calls[0]![0]).toBe(
    "http://127.0.0.1:3200/api/v1/admin/local-access/logout",
  );
  const bffOidc = createAdminAccessBff({
    config: config as never,
    fetch: fetcher,
    now: () => now,
  });
  expect(
    (
      await bffOidc.begin(
        new Request(`${origin}/api/admin/auth/begin`, { method: "POST" }),
      )
    ).status,
  ).toBe(404);
});
