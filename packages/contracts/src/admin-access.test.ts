import { expect, test } from "vitest";
import {
  adminAccessBeginRequestSchema,
  adminAccessCallbackRequestSchema,
  adminAccessLogoutRequestSchema,
  adminAccessBeginResponseSchema,
  adminAccessBeginBrowserResponseSchema,
  adminAccessCallbackResponseSchema,
  adminAccessClaimCommandSchema,
} from "./admin-access.js";
const id = "10000000-0000-4000-8000-000000000001";
const token = "a".repeat(42) + "A";
test("browser login redirect exposes no binding or session credentials", () => {
  const value = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LOGIN_REDIRECT",
    authorizationUrl: "https://identity.example/authorize?state=one-time-proof",
  };
  expect(adminAccessBeginBrowserResponseSchema.parse(value)).toEqual(value);
  for (const extra of [
    { browserToken: token },
    { sessionToken: token },
    { csrfToken: token },
    { authorizationUrl: "javascript:alert(1)" },
    { authorizationUrl: "http://identity.example/authorize" },
  ])
    expect(
      adminAccessBeginBrowserResponseSchema.safeParse({ ...value, ...extra })
        .success,
    ).toBe(false);
});
test("login accepts locale but never caller-supplied identity or role", () => {
  expect(
    adminAccessBeginRequestSchema.safeParse({
      schemaVersion: 1,
      requestId: id,
      locale: "ja",
    }).success,
  ).toBe(true);
  for (const extra of [
    { actorId: id },
    { roles: ["manager"] },
    { returnTo: "https://attacker.example" },
  ])
    expect(
      adminAccessBeginRequestSchema.safeParse({
        schemaVersion: 1,
        requestId: id,
        locale: "en",
        ...extra,
      }).success,
    ).toBe(false);
});
test("callbacks require browser binding and bounded one-time code", () => {
  const input = {
    schemaVersion: 1,
    requestId: id,
    browserToken: token,
    state: "s".repeat(64),
    code: "one-time-code",
  };
  expect(adminAccessCallbackRequestSchema.safeParse(input).success).toBe(true);
  for (const update of [
    { browserToken: undefined },
    { code: "x".repeat(1025) },
    { code: "private\ncode" },
    { state: "short" },
    { mfa: true },
  ])
    expect(
      adminAccessCallbackRequestSchema.safeParse({ ...input, ...update })
        .success,
    ).toBe(false);
});
test("credential-bearing responses are strict private transport envelopes", () => {
  expect(
    adminAccessBeginResponseSchema.safeParse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "LOGIN_REDIRECT",
      authorizationUrl: "https://identity.example/authorize",
      browserToken: token,
      expiresAt: "2026-09-18T01:00:00.000Z",
    }).success,
  ).toBe(true);
  const value = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "SESSION_CREATED",
    sessionToken: token,
    csrfToken: token,
    expiresAt: "2026-09-18T01:00:00.000Z",
    locale: "en",
  };
  expect(adminAccessCallbackResponseSchema.safeParse(value).success).toBe(true);
  expect(
    adminAccessCallbackResponseSchema.safeParse({ ...value, idToken: "secret" })
      .success,
  ).toBe(false);
});
test("logout requires CSRF and persistence receives only digests", () => {
  expect(
    adminAccessLogoutRequestSchema.safeParse({
      schemaVersion: 1,
      requestId: id,
      sessionToken: token,
      csrfToken: token,
      revokeAll: false,
    }).success,
  ).toBe(true);
  expect(
    adminAccessLogoutRequestSchema.safeParse({
      schemaVersion: 1,
      requestId: id,
      sessionToken: token,
      revokeAll: false,
    }).success,
  ).toBe(false);
  const command = {
    schemaVersion: 1,
    requestId: id,
    stateDigest: "a".repeat(64),
    bindingDigest: "b".repeat(64),
    configurationDigest: "c".repeat(64),
    claimDigest: "d".repeat(64),
  };
  expect(adminAccessClaimCommandSchema.safeParse(command).success).toBe(true);
  expect(
    adminAccessClaimCommandSchema.safeParse({ ...command, browserToken: token })
      .success,
  ).toBe(false);
});
