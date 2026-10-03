import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));

const origin = "https://admin.example.invalid";
const issuer = "https://identity.example.invalid";
const browserToken = "b".repeat(42) + "A";
const sessionToken = "s".repeat(42) + "A";
const csrfToken = "c".repeat(42) + "A";
const state = "state-" + "a".repeat(43);
const now = Date.parse("2026-09-18T00:00:00Z");
const expiresAt = "2026-09-18T00:05:00Z";
const config = {
  schemaVersion: 1,
  mode: "LOCAL_OIDC",
  siteOrigin: origin,
  internalApiOrigin: "http://127.0.0.1:3200",
  adminAccessKey: "a".repeat(64),
  oidcIssuer: issuer,
} as const;
const redirectResult = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "LOGIN_REDIRECT",
  authorizationUrl: `${issuer}/authorize?state=${state}`,
  browserToken,
  expiresAt,
};
const sessionResult = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "SESSION_CREATED",
  sessionToken,
  csrfToken,
  expiresAt,
  locale: "zh-CN",
};
const logoutResult = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "LOGGED_OUT",
};
const credentials = `__Host-fan-admin-session=${sessionToken}; __Host-fan-admin-csrf=${csrfToken}`;
type Bff = {
  begin(request: Request): Promise<Response>;
  callback(request: Request): Promise<Response>;
  logout(request: Request): Promise<Response>;
};
async function setup(response: unknown = redirectResult, status = 200) {
  const modules = import.meta.glob("./admin-access-bff.ts");
  const load = modules["./admin-access-bff.ts"];
  expect(load, "dedicated authentication BFF must exist").toBeTypeOf(
    "function",
  );
  const loaded = (await load!()) as {
    createAdminAccessBff(options: unknown): Bff;
  };
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(response, { status }),
  );
  return {
    create: loaded.createAdminAccessBff,
    fetcher,
    bff: loaded.createAdminAccessBff({
      config,
      fetch: fetcher,
      now: () => now,
    }),
  };
}
function begin(body = "locale=zh-CN", headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/admin/auth/begin`, {
    method: "POST",
    body,
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
  });
}
function callback(
  query = `code=private-code&state=${state}`,
  cookie = `__Host-fan-admin-login=${browserToken}`,
) {
  return new Request(`${origin}/api/admin/auth/callback?${query}`, {
    headers: { cookie, "sec-fetch-site": "cross-site" },
  });
}
function logout(
  headers: Record<string, string> = {},
  body = '{"schemaVersion":1}',
) {
  return new Request(`${origin}/api/admin/auth/logout`, {
    method: "POST",
    body,
    headers: {
      origin,
      cookie: credentials,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
      ...headers,
    },
  });
}
function assertPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
}
test("login begins with a private API request and a browser-bound Secure cookie, never response JSON credentials", async () => {
  const { bff, fetcher } = await setup();
  const response = await bff.begin(begin());
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  const cookies = response.headers.getSetCookie();
  expect(cookies).toHaveLength(2);
  expect(cookies[0]).toContain(`__Host-fan-admin-login=${browserToken}`);
  for (const flag of [
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=300",
  ])
    expect(cookies[0]).toContain(flag);
  expect(cookies[0]).not.toContain("Domain=");
  expect(await response.json()).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LOGIN_REDIRECT",
    authorizationUrl: redirectResult.authorizationUrl,
  });
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe(`${config.internalApiOrigin}/api/v1/admin/access/begin`);
  expect(JSON.parse(String(init!.body))).toEqual({
    schemaVersion: 1,
    requestId: expect.any(String),
    locale: "zh-CN",
  });
  expect(new Headers(init!.headers).get("x-admin-access-key")).toBe(
    config.adminAccessKey,
  );
  expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
  assertPrivate(response);
});
test("failed login start clears login binding and language hint and returns a generic retryable failure", async () => {
  const { bff, fetcher } = await setup();
  fetcher.mockRejectedValue(new Error("private-provider-detail"));
  const response = await bff.begin(begin());
  expect(response.status).toBe(503);
  expect(response.headers.get("location")).toBeNull();
  expect(await response.json()).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "ACCESS_UNAVAILABLE",
  });
  expect(response.headers.getSetCookie()).toHaveLength(2);
  expect(response.headers.getSetCookie()[0]).toContain(
    "__Host-fan-admin-login=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
  );
  assertPrivate(response);
});
test.each([
  ["cross origin", "locale=en", { origin: "https://evil.invalid" }],
  ["missing origin", "locale=en", { origin: "" }],
  ["opaque native form origin", "locale=en", { origin: "null" }],
  ["cross site", "locale=en", { "sec-fetch-site": "cross-site" }],
  ["missing fetch metadata", "locale=en", { "sec-fetch-site": "" }],
  ["JSON", "locale=en", { "content-type": "application/json" }],
  ["duplicate locale", "locale=en&locale=ja", {}],
  ["open redirect", "locale=en&returnTo=https://evil.invalid", {}],
  ["invalid locale", "locale=zz", {}],
  ["oversize body", "locale=" + "a".repeat(4097), {}],
] as const)(
  "login rejects %s before contacting API",
  async (_name, body, headers) => {
    const { bff, fetcher } = await setup();
    const response = await bff.begin(begin(body, headers));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetcher).not.toHaveBeenCalled();
    assertPrivate(response);
  },
);
test("callback binds the browser cookie and optional issuer, then rotates both session credentials", async () => {
  const { bff, fetcher } = await setup(sessionResult);
  const response = await bff.callback(
    callback(
      `code=private-code&state=${state}&iss=${encodeURIComponent(issuer)}`,
    ),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`${origin}/zh-CN`);
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({
    schemaVersion: 1,
    requestId: expect.any(String),
    browserToken,
    code: "private-code",
    state,
  });
  const cookies = response.headers.getSetCookie();
  expect(cookies).toHaveLength(4);
  for (const name of ["session", "csrf"]) {
    const cookie = cookies.find((value) =>
      value.startsWith(`__Host-fan-admin-${name}=`),
    );
    for (const flag of ["Secure", "HttpOnly", "SameSite=Strict", "Path=/"])
      expect(cookie).toContain(flag);
  }
  expect(
    cookies.find((value) => value.startsWith("__Host-fan-admin-login=")),
  ).toContain("Max-Age=0");
  expect(await response.text()).toBe("");
  assertPrivate(response);
});
test.each([
  `code=private-code&state=${state}&state=${state}`,
  `code=one&code=two&state=${state}`,
  `code=private-code&state=${state}&iss=https://evil.invalid`,
  `code=private-code&state=${state}&error_description=secret-provider-error`,
  `error=access_denied&state=${state}`,
  `code=private-code&state=short`,
  `code=${"x".repeat(1025)}&state=${state}`,
])(
  "callback rejects ambiguous or invalid parameters without echoing them: %s",
  async (query) => {
    const { bff, fetcher } = await setup(sessionResult);
    const response = await bff.callback(callback(query));
    expect(response.headers.get("location")).toBe(`${origin}/en?login=failed`);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.getSetCookie()[0]).toContain("Max-Age=0");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await response.text()).toBe("");
    assertPrivate(response);
  },
);
test.each([
  "",
  `__Host-fan-admin-login=${browserToken}; __Host-fan-admin-login=${browserToken}`,
  "__Host-fan-admin-login=invalid",
])("callback rejects missing or ambiguous browser binding", async (cookie) => {
  const { bff, fetcher } = await setup(sessionResult);
  const response = await bff.callback(callback(undefined, cookie));
  expect(response.headers.get("location")).toBe(`${origin}/en?login=failed`);
  expect(fetcher).not.toHaveBeenCalled();
});
test.each([
  [{ ...sessionResult, accessToken: "private-provider-token" }, 200],
  [sessionResult, 503],
  [{ ...sessionResult, expiresAt: "2026-09-17T00:00:00Z" }, 200],
  [
    { schemaVersion: 1, outcome: "FAILURE", code: "LOGIN_RESTART_REQUIRED" },
    409,
  ],
])(
  "callback fails closed for bad or consumed API results",
  async (result, status) => {
    const { bff } = await setup(result, status);
    const response = await bff.callback(callback());
    expect(response.headers.get("location")).toBe(`${origin}/en?login=failed`);
    expect(
      response.headers
        .getSetCookie()
        .some((value) => value.startsWith("__Host-fan-admin-session=")),
    ).toBe(false);
    assertPrivate(response);
  },
);
test("unavailable API never exposes provider details or creates session cookies", async () => {
  const { create } = await setup();
  const bff = create({
    config,
    now: () => now,
    fetch: async () => {
      throw new Error("private-code private-provider-token");
    },
  });
  const response = await bff.callback(callback());
  expect(response.headers.get("location")).toBe(`${origin}/en?login=failed`);
  expect(await response.text()).toBe("");
});
test("logout revokes on API with bound CSRF before clearing cookies", async () => {
  const { bff, fetcher } = await setup(logoutResult);
  const response = await bff.logout(logout());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(logoutResult);
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({
    schemaVersion: 1,
    requestId: expect.any(String),
    sessionToken,
    csrfToken,
    revokeAll: false,
  });
  expect(response.headers.getSetCookie()).toHaveLength(4);
  expect(
    response.headers
      .getSetCookie()
      .every((value) => value.includes("Max-Age=0")),
  ).toBe(true);
  assertPrivate(response);
});
test.each([
  [{ origin: "https://evil.invalid" }, '{"schemaVersion":1}'],
  [{ "x-csrf-token": "x".repeat(42) + "A" }, '{"schemaVersion":1}'],
  [
    { cookie: credentials + `; __Host-fan-admin-session=${sessionToken}` },
    '{"schemaVersion":1}',
  ],
  [{}, '{"schemaVersion":1,"revokeAll":true}'],
])(
  "logout rejects foreign requests or client-supplied authority",
  async (headers, body) => {
    const { bff, fetcher } = await setup(logoutResult);
    const response = await bff.logout(logout(headers, body));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  },
);
test("logout preserves credentials when revocation outcome is unavailable", async () => {
  const { bff } = await setup(
    { schemaVersion: 1, outcome: "FAILURE", code: "ACCESS_UNAVAILABLE" },
    503,
  );
  const response = await bff.logout(logout());
  expect(response.status).toBe(503);
  expect(response.headers.getSetCookie()).toHaveLength(0);
  expect(await response.json()).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "ACCESS_UNAVAILABLE",
  });
});
test("TEST and disabled modes do not create a login bypass", async () => {
  const { create, fetcher } = await setup();
  for (const disabled of [
    { schemaVersion: 1, mode: "DISABLED" },
    { ...config, mode: "TEST" },
  ]) {
    const bff = create({ config: disabled, fetch: fetcher });
    for (const [method, request] of [
      ["begin", begin()],
      ["callback", callback()],
      ["logout", logout()],
    ] as const)
      expect((await bff[method](request)).status).toBe(404);
  }
  expect(fetcher).not.toHaveBeenCalled();
});
