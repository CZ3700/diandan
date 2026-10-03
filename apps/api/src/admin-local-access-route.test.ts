import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { registerAdminLocalAccessRoute } from "./admin-access-route.js";
import { registerAdminAccountRoutes } from "./admin-account-route.js";

const origin = "https://admin.example.invalid",
  accessKey = "a".repeat(64),
  requestId = "10000000-0000-4000-8000-000000000001",
  accountId = "10000000-0000-4000-8000-000000000002",
  token = "A".repeat(42) + "A",
  at = "2026-09-29T12:00:00.000000Z";
const success = { schemaVersion: 1, outcome: "SUCCESS" } as const;
const fail = (code: string) => ({ schemaVersion: 1, outcome: "FAILURE", code });
const accessHeaders = {
  origin,
  "x-admin-access-key": accessKey,
  "content-type": "application/json",
};
const sessionHeaders = {
  origin,
  cookie: `__Host-fan-admin-session=${token}`,
  "x-csrf-token": token,
  "content-type": "application/json",
};
const without = (headers: Record<string, string>, name: string) =>
  Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name));
const view = {
  loginName: "studio.owner",
  displayName: "Studio Owner",
  twoFactorEnabled: false,
  recoveryCodesRemaining: 0,
  passwordChangedAt: at,
};
const member = {
  accountId,
  version: 1,
  loginName: "night.shift",
  displayName: "Night shift",
  status: "ACTIVE",
  twoFactorEnabled: false,
  mustChangePassword: true,
  roleKeys: ["studio:operator"],
  lastLoginAt: null,
  self: false,
  assignedArtists: 0,
};

function setup() {
  const app = Fastify({ logger: false });
  const useCases = {
    login: vi.fn(async () => fail("INVALID_CREDENTIALS")),
    step: vi.fn(async () => ({
      ...success,
      kind: "STEP_REQUIRED",
      step: "NEW_PASSWORD",
      challengeToken: token,
      expiresAt: at,
    })),
    logout: vi.fn(async () => ({ ...success, kind: "LOGGED_OUT" })),
    account: vi.fn(async (): Promise<unknown> => ({
      ...success,
      kind: "ACCOUNT",
      account: view,
    })),
    staff: vi.fn(async (): Promise<unknown> => ({
      ...success,
      kind: "STAFF_CONTEXT",
    })),
  };
  registerAdminLocalAccessRoute(app, {
    allowedOrigin: origin,
    accessKey,
    useCases: useCases as never,
  });
  registerAdminAccountRoutes(app, {
    allowedOrigin: origin,
    useCases: useCases as never,
  });
  return { app, useCases };
}
const post = (
  app: ReturnType<typeof Fastify>,
  url: string,
  headers: Record<string, unknown>,
  payload: unknown,
) =>
  app.inject({
    method: "POST",
    url,
    headers: headers as never,
    payload: payload as never,
  });

test("sign-in endpoints sit behind the BFF access key, origin and strict schemas", async () => {
  const { app, useCases } = setup();
  try {
    const login = {
      schemaVersion: 1,
      requestId,
      locale: "ja",
      loginName: "studio.owner",
      password: "correct horse battery",
    };
    const ok = await post(
      app,
      "/api/v1/admin/local-access/login",
      accessHeaders,
      login,
    );
    expect(ok.statusCode).toBe(403);
    expect(ok.json()).toEqual(fail("INVALID_CREDENTIALS"));
    expect(ok.headers["cache-control"]).toBe("private, no-store");
    expect(useCases.login).toHaveBeenCalledWith(login);
    for (const change of [
      { "x-admin-access-key": "b".repeat(64) },
      { origin: "https://other.example.invalid" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      const denied = await post(
        app,
        "/api/v1/admin/local-access/login",
        { ...accessHeaders, ...change },
        login,
      );
      expect(denied.statusCode).toBe(403);
    }
    const extra = await post(
      app,
      "/api/v1/admin/local-access/login",
      accessHeaders,
      { ...login, roles: ["owner"] },
    );
    expect(extra.statusCode).toBe(400);
    expect(useCases.login).toHaveBeenCalledTimes(1);
    const step = await post(
      app,
      "/api/v1/admin/local-access/step",
      accessHeaders,
      {
        schemaVersion: 1,
        requestId,
        challengeToken: token,
        step: { kind: "NEW_PASSWORD", newPassword: "a brand new passphrase" },
      },
    );
    expect(step.statusCode).toBe(200);
    expect(step.json()).toMatchObject({
      kind: "STEP_REQUIRED",
      step: "NEW_PASSWORD",
    });
    const logout = await post(
      app,
      "/api/v1/admin/local-access/logout",
      accessHeaders,
      {
        schemaVersion: 1,
        requestId,
        sessionToken: token,
        csrfToken: token,
        revokeAll: false,
      },
    );
    expect(logout.json()).toEqual({ ...success, kind: "LOGGED_OUT" });
    useCases.login.mockResolvedValueOnce(fail("ACCESS_UNAVAILABLE"));
    expect(
      (
        await post(
          app,
          "/api/v1/admin/local-access/login",
          accessHeaders,
          login,
        )
      ).statusCode,
    ).toBe(503);
  } finally {
    await app.close();
  }
});

test("account settings take the action from the path and need the session cookie and CSRF", async () => {
  const { app, useCases } = setup();
  try {
    const read = await post(
      app,
      "/api/v1/admin/account/context",
      sessionHeaders,
      {},
    );
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ ...success, kind: "ACCOUNT", account: view });
    expect(useCases.account).toHaveBeenCalledWith({
      schemaVersion: 1,
      requestId: expect.any(String),
      sessionToken: token,
      csrfToken: token,
      command: { action: "READ" },
    });
    const noCookie = await post(
      app,
      "/api/v1/admin/account/context",
      without(sessionHeaders, "cookie"),
      {},
    );
    expect(noCookie.statusCode).toBe(401);
    const noCsrf = await post(
      app,
      "/api/v1/admin/account/context",
      without(sessionHeaders, "x-csrf-token"),
      {},
    );
    expect(noCsrf.statusCode).toBe(403);
    for (const body of [
      { action: "DISABLE_TOTP" },
      { sessionToken: token },
      { requestId },
    ])
      expect(
        (await post(app, "/api/v1/admin/account/context", sessionHeaders, body))
          .statusCode,
      ).toBe(400);
    expect(useCases.account).toHaveBeenCalledTimes(1);
    useCases.account.mockResolvedValueOnce({
      ...success,
      kind: "PASSWORD_CHANGED",
      account: view,
    });
    const changed = await post(
      app,
      "/api/v1/admin/account/change-password",
      sessionHeaders,
      {
        currentPassword: "correct horse battery",
        newPassword: "a brand new passphrase",
      },
    );
    expect(changed.statusCode).toBe(200);
    expect((useCases.account.mock.calls.at(-1) as unknown[])[0]).toMatchObject({
      command: {
        action: "CHANGE_PASSWORD",
        currentPassword: "correct horse battery",
      },
    });
    // A response for another action never reaches the browser.
    useCases.account.mockResolvedValueOnce({
      ...success,
      kind: "PASSWORD_CHANGED",
      account: view,
    });
    expect(
      (
        await post(app, "/api/v1/admin/account/totp-disable", sessionHeaders, {
          currentPassword: "x",
          code: "123456",
        })
      ).statusCode,
    ).toBe(503);
    useCases.account.mockResolvedValueOnce({ ...success, kind: "NOT_LOCAL" });
    expect(
      (
        await post(app, "/api/v1/admin/account/totp-begin", sessionHeaders, {
          currentPassword: "x",
        })
      ).json(),
    ).toEqual({ ...success, kind: "NOT_LOCAL" });
    useCases.account.mockResolvedValueOnce({ ...fail("ACCOUNT_LOCKED") });
    expect(
      (
        await post(
          app,
          "/api/v1/admin/account/recovery-codes",
          sessionHeaders,
          { currentPassword: "x", code: "123456" },
        )
      ).statusCode,
    ).toBe(409);
  } finally {
    await app.close();
  }
});

test("staff endpoints map one path to one command and check the result kind", async () => {
  const { app, useCases } = setup();
  try {
    expect(
      (
        await post(app, "/api/v1/admin/staff/context", sessionHeaders, {})
      ).json(),
    ).toEqual({ ...success, kind: "STAFF_CONTEXT" });
    useCases.staff.mockResolvedValueOnce({
      ...success,
      kind: "STAFF_CREATED",
      member,
      temporaryPassword: "ABCD-EFGH-JKMN-PQRS",
    });
    const created = await post(
      app,
      "/api/v1/admin/staff/create",
      sessionHeaders,
      {
        loginName: "night.shift",
        displayName: "Night shift",
        roleKeys: ["studio:operator"],
      },
    );
    expect(created.statusCode).toBe(200);
    expect(created.headers["cache-control"]).toBe("private, no-store");
    expect((useCases.staff.mock.calls.at(-1) as unknown[])[0]).toMatchObject({
      command: { action: "CREATE", loginName: "night.shift" },
    });
    useCases.staff.mockResolvedValueOnce({
      ...success,
      kind: "STAFF_UPDATED",
      member,
    });
    expect(
      (
        await post(app, "/api/v1/admin/staff/set-status", sessionHeaders, {
          accountId,
          expectedVersion: 1,
          status: "SUSPENDED",
        })
      ).statusCode,
    ).toBe(200);
    useCases.staff.mockResolvedValueOnce({
      ...success,
      kind: "STAFF_UPDATED",
      member,
    });
    expect(
      (
        await post(app, "/api/v1/admin/staff/reset-password", sessionHeaders, {
          accountId,
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(503);
    useCases.staff.mockResolvedValueOnce(fail("SELF_LOCKOUT"));
    expect(
      (
        await post(app, "/api/v1/admin/staff/clear-totp", sessionHeaders, {
          accountId,
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(409);
    useCases.staff.mockResolvedValueOnce({
      ...success,
      kind: "STAFF_DELETED",
      accountId,
      transferredArtists: 2,
    });
    const deleted = await post(
      app,
      "/api/v1/admin/staff/delete",
      sessionHeaders,
      {
        accountId,
        expectedVersion: 1,
        loginName: "night.shift",
      },
    );
    expect(deleted.statusCode).toBe(200);
    expect((useCases.staff.mock.calls.at(-1) as unknown[])[0]).toMatchObject({
      command: { action: "DELETE", loginName: "night.shift" },
    });
    useCases.staff.mockResolvedValueOnce({
      ...success,
      kind: "STAFF_UPDATED",
      member,
    });
    expect(
      (
        await post(app, "/api/v1/admin/staff/delete", sessionHeaders, {
          accountId,
          expectedVersion: 1,
          loginName: "night.shift",
        })
      ).statusCode,
    ).toBe(503);
    useCases.staff.mockResolvedValueOnce(fail("FORBIDDEN"));
    expect(
      (await post(app, "/api/v1/admin/staff/list", sessionHeaders, {}))
        .statusCode,
    ).toBe(403);
    expect(
      (await post(app, "/api/v1/admin/staff/roles", sessionHeaders, {}))
        .statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
