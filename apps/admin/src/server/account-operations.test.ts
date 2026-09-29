import { expect, test, vi } from "vitest";
import { getAdminOperation } from "./admin-operations";
import { callAdminApi } from "./admin-api-client";
vi.mock("server-only", () => ({}));

const view = {
  loginName: "studio.owner",
  displayName: "Studio Owner",
  twoFactorEnabled: false,
  recoveryCodesRemaining: 0,
  passwordChangedAt: "2026-09-29T12:00:00.000000Z",
};
const success = { schemaVersion: 1, outcome: "SUCCESS" } as const;

test("account settings map one browser operation to one API route and command", () => {
  for (const [key, path, action, body] of [
    ["account-context", "context", "READ", {}],
    [
      "account-change-password",
      "change-password",
      "CHANGE_PASSWORD",
      { currentPassword: "old", newPassword: "a long new passphrase" },
    ],
    [
      "account-totp-begin",
      "totp-begin",
      "BEGIN_TOTP",
      { currentPassword: "x" },
    ],
    [
      "account-totp-confirm",
      "totp-confirm",
      "CONFIRM_TOTP",
      { code: "123456" },
    ],
    [
      "account-totp-disable",
      "totp-disable",
      "DISABLE_TOTP",
      { currentPassword: "x", code: "123456" },
    ],
    [
      "account-recovery-codes",
      "recovery-codes",
      "REGENERATE_RECOVERY_CODES",
      { currentPassword: "x", code: "123456" },
    ],
  ] as const) {
    const operation = getAdminOperation(key)!;
    expect(operation.path).toBe(`/api/v1/admin/account/${path}`);
    expect(operation.credentials).toBe("SESSION");
    expect(operation.readOnly).toBe(action === "READ");
    const command = operation.parseCommand(body);
    expect(command).toEqual({ action, ...body });
    expect(operation.apiBody(command)).toEqual(body);
    for (const extra of [
      { action: "READ" },
      { sessionToken: "x" },
      { requestId: "x" },
      { schemaVersion: 1 },
    ])
      expect(() => operation.parseCommand({ ...body, ...extra })).toThrow();
  }
});

test("an OIDC session may answer NOT_LOCAL; any other kind is refused", () => {
  const operation = getAdminOperation("account-change-password")!;
  expect(
    operation.parseResponse({
      ...success,
      kind: "PASSWORD_CHANGED",
      account: view,
    }),
  ).toMatchObject({ kind: "PASSWORD_CHANGED" });
  expect(operation.parseResponse({ ...success, kind: "NOT_LOCAL" })).toEqual({
    ...success,
    kind: "NOT_LOCAL",
  });
  expect(() =>
    operation.parseResponse({
      ...success,
      kind: "TOTP_DISABLED",
      account: view,
    }),
  ).toThrow();
  expect(
    operation.parseResponse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "PASSWORD_REJECTED",
      passwordProblem: "SAME_AS_LOGIN",
    }),
  ).toMatchObject({ passwordProblem: "SAME_AS_LOGIN" });
});

test("an API without built-in accounts reports the section as absent, not broken", async () => {
  const response = await callAdminApi({
    config: {
      schemaVersion: 1,
      mode: "LOCAL_OIDC",
      siteOrigin: "https://admin.example.invalid",
      internalApiOrigin: "http://127.0.0.1:3200",
      adminAccessKey: "a".repeat(64),
      oidcIssuer: "https://identity.example.invalid",
    },
    operation: getAdminOperation("account-context")!,
    credentials: {
      sessionToken: "s".repeat(42) + "A",
      csrfToken: "c".repeat(42) + "A",
    },
    command: { action: "READ" },
    fetch: async () =>
      Response.json({ statusCode: 404, error: "Not Found" }, { status: 404 }),
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
});
