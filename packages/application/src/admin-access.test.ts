import { expect, test, vi } from "vitest";
import { adminAccessSettingsSchema } from "@fan-support/contracts";
import type { AdminAccessRepositories } from "@fan-support/persistence-port";
import { createAdminAccessUseCases } from "./admin-access.js";
import { digestAdminIdentitySubject } from "./admin-access-tokens.js";
const id = "10000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-18T01:00:00.000Z");
const settings = adminAccessSettingsSchema.parse({
  schemaVersion: 1 as const,
  issuer: "https://identity.example",
  clientId: "admin",
  redirectUri: "https://admin.example/api/admin/auth/callback",
  policyVersion: "v1",
  loginTtlSeconds: 300,
  sessionTtlSeconds: 3600,
  maxAuthenticationAgeSeconds: 300,
});
const success = { schemaVersion: 1 as const, outcome: "SUCCESS" as const };
function setup() {
  let inside = false;
  const repository = {
    create: vi.fn(async () => ({
      ...success,
      kind: "LOGIN_CREATED",
      expiresAt: "2026-09-18T01:05:00.000Z",
    })),
    claim: vi.fn(async () => ({
      ...success,
      kind: "LOGIN_CLAIMED",
      challengeId: id,
    })),
    complete: vi.fn(async () => ({
      ...success,
      kind: "SESSION_SAVED",
      expiresAt: "2026-09-18T02:00:00.000Z",
      locale: "ja",
    })),
    reject: vi.fn(async () => ({ ...success, kind: "LOGIN_REJECTED" })),
    revoke: vi.fn(async () => ({ ...success, kind: "LOGGED_OUT" })),
  };
  const provider = {
    createAuthorizationRequest: vi.fn(async (c: Record<string, unknown>) => ({
      ...success,
      operation: "CREATE_AUTHORIZATION_REQUEST",
      value: {
        authorizationUrl: `https://identity.example/authorize?state=${String(c["state"])}`,
        state: c["state"],
        expiresAt: "2026-09-18T01:05:00.000Z",
      },
    })),
    exchangeAuthorizationCode: vi.fn(async () => {
      expect(inside).toBe(false);
      return {
        ...success,
        operation: "EXCHANGE_AUTHORIZATION_CODE",
        value: {
          principal: {
            issuer: settings.issuer,
            subject: "staff-subject",
            authenticatedAt: now.toISOString(),
            mfa: true,
          },
        },
      };
    }),
  };
  const run = vi.fn(
    async (work: (r: AdminAccessRepositories) => Promise<unknown>) => {
      inside = true;
      try {
        return await work({ adminAccess: repository } as never);
      } finally {
        inside = false;
      }
    },
  );
  const app = createAdminAccessUseCases({
    settings,
    identityProvider: provider as never,
    transactions: { runInAdminAccessTransaction: run } as never,
    tokenPepper: "a".repeat(64),
    subjectPepper: "b".repeat(64),
    now: () => now,
  });
  return { app, repository, provider, run };
}
async function login(s: ReturnType<typeof setup>) {
  const start = await s.app.begin({
    schemaVersion: 1,
    requestId: id,
    locale: "ja",
  });
  if (start.outcome !== "SUCCESS") throw Error("failed begin");
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  return {
    schemaVersion: 1,
    requestId: id,
    browserToken: start.browserToken,
    state,
    code: "one-time-code",
  };
}
test("one-time callback claims before exchange and atomically issues fresh credential digests", async () => {
  const s = setup(),
    input = await login(s),
    result = await s.app.callback(input);
  expect(result).toMatchObject({
    ...success,
    kind: "SESSION_CREATED",
    locale: "ja",
  });
  expect(s.repository.claim).toHaveBeenCalledTimes(1);
  expect(s.provider.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
  expect(s.repository.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      mfa: true,
      subjectDigest: digestAdminIdentitySubject({
        subjectPepper: "b".repeat(64),
        issuer: settings.issuer,
        subject: "staff-subject",
      }),
    }),
  );
  expect(JSON.stringify(s.repository.complete.mock.calls)).not.toContain(
    "staff-subject",
  );
  if (result.outcome === "SUCCESS") {
    expect(result.sessionToken).not.toBe(input.browserToken);
    expect(result.csrfToken).not.toBe(result.sessionToken);
  }
  expect(s.repository.claim.mock.invocationCallOrder[0]).toBeLessThan(
    s.provider.exchangeAuthorizationCode.mock.invocationCallOrder[0]!,
  );
});
test("cross-browser state fails before persistence and exchange", async () => {
  const s = setup(),
    input = await login(s);
  expect(
    await s.app.callback({ ...input, browserToken: "c".repeat(42) + "A" }),
  ).toMatchObject({ code: "LOGIN_RESTART_REQUIRED" });
  expect(s.repository.claim).not.toHaveBeenCalled();
  expect(s.provider.exchangeAuthorizationCode).not.toHaveBeenCalled();
});
test("replay or unavailable claim never exchanges a second authorization code", async () => {
  const s = setup(),
    input = await login(s);
  s.repository.claim.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "LOGIN_RESTART_REQUIRED",
  } as never);
  expect(await s.app.callback(input)).toMatchObject({
    code: "LOGIN_RESTART_REQUIRED",
  });
  expect(s.provider.exchangeAuthorizationCode).not.toHaveBeenCalled();
});
test("missing MFA consumes and audits the challenge without issuing a session", async () => {
  const s = setup(),
    input = await login(s);
  s.provider.exchangeAuthorizationCode.mockResolvedValueOnce({
    ...success,
    operation: "EXCHANGE_AUTHORIZATION_CODE",
    value: {
      principal: {
        issuer: settings.issuer,
        subject: "staff-subject",
        authenticatedAt: now.toISOString(),
        mfa: false,
      },
    },
  });
  expect(await s.app.callback(input)).toMatchObject({ code: "MFA_REQUIRED" });
  expect(s.repository.complete).not.toHaveBeenCalled();
  expect(s.repository.reject).toHaveBeenCalledWith(
    expect.objectContaining({ reasonCode: "MFA_REQUIRED" }),
  );
});
test("unknown exchange outcome is never retried and no provider diagnostics escape", async () => {
  const s = setup(),
    input = await login(s);
  s.provider.exchangeAuthorizationCode.mockRejectedValueOnce(
    Error("private-token"),
  );
  expect(await s.app.callback(input)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "LOGIN_RESTART_REQUIRED",
  });
  expect(s.provider.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
  expect(s.repository.reject).toHaveBeenCalledTimes(1);
});
test("logout preserves session and CSRF digest domains and rejects caller authority", async () => {
  const s = setup();
  const request = {
    schemaVersion: 1,
    requestId: id,
    sessionToken: "c".repeat(42) + "A",
    csrfToken: "d".repeat(42) + "A",
    revokeAll: true,
  };
  expect(await s.app.logout(request)).toMatchObject({ kind: "LOGGED_OUT" });
  expect(JSON.stringify(s.repository.revoke.mock.calls)).not.toContain(
    request.sessionToken,
  );
  expect(await s.app.logout({ ...request, actorId: id })).toMatchObject({
    code: "INVALID_COMMAND",
  });
  expect(s.repository.revoke).toHaveBeenCalledTimes(1);
});

test.each(["2026-09-18T00:54:59.000Z", "2026-09-18T01:00:01.000Z"])(
  "stale or future authenticated time %s cannot issue a session",
  async (authenticatedAt) => {
    const s = setup(),
      input = await login(s);
    s.provider.exchangeAuthorizationCode.mockResolvedValueOnce({
      ...success,
      operation: "EXCHANGE_AUTHORIZATION_CODE",
      value: {
        principal: {
          issuer: settings.issuer,
          subject: "staff-subject",
          authenticatedAt,
          mfa: true,
        },
      },
    });
    expect(await s.app.callback(input)).toMatchObject({
      code: "LOGIN_RESTART_REQUIRED",
    });
    expect(s.repository.complete).not.toHaveBeenCalled();
    expect(s.repository.reject).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "AUTHENTICATION_EXPIRED" }),
    );
  },
);
test("a principal from a different verified issuer cannot bind to the platform identity", async () => {
  const s = setup(),
    input = await login(s);
  s.provider.exchangeAuthorizationCode.mockResolvedValueOnce({
    ...success,
    operation: "EXCHANGE_AUTHORIZATION_CODE",
    value: {
      principal: {
        issuer: "https://other.example" as typeof settings.issuer,
        subject: "staff-subject",
        authenticatedAt: now.toISOString(),
        mfa: true,
      },
    },
  });
  expect(await s.app.callback(input)).toMatchObject({
    code: "LOGIN_RESTART_REQUIRED",
  });
  expect(s.repository.complete).not.toHaveBeenCalled();
});
test("uncertain session commit never triggers a second authorization exchange or exposes credentials", async () => {
  const s = setup(),
    input = await login(s);
  s.repository.complete.mockRejectedValueOnce(
    Error("private-database-diagnostic"),
  );
  expect(await s.app.callback(input)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "LOGIN_RESTART_REQUIRED",
  });
  expect(s.provider.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
});
test("malformed credential-bearing repository output cannot escape the application", async () => {
  const s = setup(),
    input = await login(s);
  s.repository.complete.mockResolvedValueOnce({
    ...success,
    kind: "SESSION_SAVED",
    expiresAt: "2026-09-18T02:00:00.000Z",
    locale: "ja",
    privateToken: "secret",
  } as never);
  expect(await s.app.callback(input)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "LOGIN_RESTART_REQUIRED",
  });
});
test("subject identity mapping is exact and independently keyed", () => {
  const value = {
    subjectPepper: "b".repeat(64),
    issuer: settings.issuer,
    subject: "Case-Sensitive",
  };
  const digest = digestAdminIdentitySubject(value);
  expect(digest).toMatch(/^[a-f0-9]{64}$/u);
  for (const patch of [
    { subject: "case-sensitive" },
    { issuer: "https://other.example" },
    { subjectPepper: "c".repeat(64) },
  ])
    expect(digestAdminIdentitySubject({ ...value, ...patch })).not.toBe(digest);
});
