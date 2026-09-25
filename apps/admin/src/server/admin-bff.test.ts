import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createAdminBff } from "./admin-bff";
const siteOrigin = "http://localhost:3100";
const session = "s".repeat(43),
  csrf = "c".repeat(43);
const config = {
  schemaVersion: 1,
  mode: "TEST",
  siteOrigin,
  internalApiOrigin: "http://127.0.0.1:3200",
} as const;
const context = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "ADMIN_SESSION",
  actorId: "10000000-0000-4000-8000-000000000001",
  permissions: [],
  localeScopes: [],
};
const cookie = `__Host-fan-admin-session=${session}; __Host-fan-admin-csrf=${csrf}`;
function request(path: string, options: RequestInit = {}) {
  return new Request(`${siteOrigin}/api/admin/${path}`, {
    ...options,
    headers: { cookie, "sec-fetch-site": "same-origin", ...options.headers },
  });
}
function post(overrides: Record<string, string> = {}) {
  return request("catalog-list", {
    method: "POST",
    headers: {
      origin: siteOrigin,
      "content-type": "application/json",
      "x-csrf-token": csrf,
      ...overrides,
    },
    body: JSON.stringify({
      schemaVersion: 1,
      kind: "IDOL",
      locale: "en",
      page: 1,
      pageSize: 10,
    }),
  });
}
test("same-origin bootstrap forwards only the fixed private session capability and returns csrf in no-store JSON", async () => {
  const fetcher = vi.fn(async () => Response.json(context));
  const response = await createAdminBff({ config, fetch: fetcher }).session(
    request("session"),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...context, csrfToken: csrf });
  const [url, options] = fetcher.mock.calls[0]! as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe(`${config.internalApiOrigin}/api/v1/admin/session/read`);
  expect(new Headers(options.headers).get("cookie")).toBe(
    `__Host-fan-admin-session=${session}`,
  );
  expect(new Headers(options.headers).get("x-csrf-token")).toBe(csrf);
  expect(options.redirect).toBe("error");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
test("BFF rejects cross-origin, absent/duplicate/changed CSRF, missing cookies and query credentials before fetch", async () => {
  const fetcher = vi.fn();
  const bff = createAdminBff({ config, fetch: fetcher });
  for (const req of [
    post({ origin: "http://localhost:3101" }),
    post({ "x-csrf-token": "x".repeat(43) }),
    post({ cookie: `__Host-fan-admin-session=${session}` }),
    post({ cookie: `${cookie}; __Host-fan-admin-session=${session}` }),
    post({ "sec-fetch-site": "cross-site" }),
  ])
    expect(
      (await bff.operation(req, "catalog-list")).status,
    ).toBeGreaterThanOrEqual(400);
  expect((await bff.session(request("session?token=invalid"))).status).toBe(
    400,
  );
  expect(
    (
      await bff.session(
        request("session", { headers: { "sec-fetch-site": "cross-site" } }),
      )
    ).status,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
test("strict DTOs, operation allowlist, parser limits and safe upstream failures prevent credential disclosure", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "OWNERS",
      items: [],
      totalItems: 0,
      page: 1,
      pageSize: 10,
      secret: session,
    }),
  );
  const bff = createAdminBff({ config, fetch: fetcher });
  expect((await bff.operation(post(), "https://example.com")).status).toBe(404);
  const failed = await bff.operation(post(), "catalog-list");
  expect(failed.status).toBe(503);
  expect((await failed.text()).includes(session)).toBe(false);
  const large = request("catalog-list", {
    method: "POST",
    headers: {
      origin: siteOrigin,
      "content-type": "application/json",
      "x-csrf-token": csrf,
    },
    body: "x".repeat(65537),
  });
  expect((await bff.operation(large, "catalog-list")).status).toBe(413);
  expect(
    (
      await createAdminBff({
        config: { schemaVersion: 1, mode: "DISABLED" },
        fetch: fetcher,
      }).session(request("session"))
    ).status,
  ).toBe(404);
});
test("valid read returns its safe DTO and forwarded requests never inherit browser headers", async () => {
  const value = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "OWNERS",
    items: [],
    totalItems: 0,
    page: 1,
    pageSize: 10,
  };
  const fetcher = vi.fn(async () => Response.json(value));
  const response = await createAdminBff({ config, fetch: fetcher }).operation(
    post({ authorization: "discard", "x-forwarded-host": "evil" }),
    "catalog-list",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(value);
  const [, options] = fetcher.mock.calls[0]! as unknown as [
    string,
    RequestInit,
  ];
  expect(new Headers(options.headers).has("authorization")).toBe(false);
  expect(new Headers(options.headers).has("x-forwarded-host")).toBe(false);
});

test("LOCAL_OIDC sessions use the same canonical authorization endpoint without exposing the access key", async () => {
  const oidc = {
    ...config,
    mode: "LOCAL_OIDC",
    siteOrigin: "https://admin.example.invalid",
    adminAccessKey: "a".repeat(64),
    oidcIssuer: "https://identity.example.invalid",
  } as const;
  const fetcher = vi.fn(async () => Response.json(context));
  const response = await createAdminBff({
    config: oidc,
    fetch: fetcher,
  }).session(
    new Request(`${oidc.siteOrigin}/api/admin/session`, {
      headers: { cookie, "sec-fetch-site": "same-origin" },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...context, csrfToken: csrf });
  expect(
    new Headers(
      (fetcher.mock.calls[0]! as unknown as [string, RequestInit])[1].headers,
    ).has("x-admin-access-key"),
  ).toBe(false);
});
test("exception discovery tolerates an absent capability and mismatched receipts fail closed", async () => {
  const req = () =>
    request("exceptions-context", {
      method: "POST",
      headers: {
        origin: siteOrigin,
        "content-type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ schemaVersion: 1 }),
    });
  const absent = await createAdminBff({
    config,
    fetch: async () => new Response("missing", { status: 404 }),
  }).operation(req(), "exceptions-context");
  expect(absent.status).toBe(404);
  expect(await absent.json()).toMatchObject({ code: "NOT_FOUND" });
  const id = "10000000-0000-4000-8000-000000000001",
    other = "10000000-0000-4000-8000-000000000002";
  const mismatch = await createAdminBff({
    config,
    fetch: async () =>
      Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        action: "REPLAY_WEBHOOK",
        target: { kind: "WEBHOOK", id: other, consumerKey: null },
        operationId: other,
        replayed: false,
      }),
  }).operation(
    request("exceptions-replay-webhook", {
      method: "POST",
      headers: {
        origin: siteOrigin,
        "content-type": "application/json",
        "x-csrf-token": csrf,
        "idempotency-key": id,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        target: { kind: "WEBHOOK", id, consumerKey: null },
        expectedVersion: "a".repeat(64),
        reasonCode: "OPERATOR_REVIEW",
        confirmed: true,
      }),
    }),
    "exceptions-replay-webhook",
  );
  expect(mismatch.status).toBe(503);
  expect(await mismatch.json()).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
});
