import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import {
  adminAccountResponseSchema,
  adminLocalAccessResponseSchema,
  adminStaffResponseSchema,
} from "@fan-support/contracts";
import type { AdminLocalAccessRepositories } from "@fan-support/persistence-port";
import { createAdminLocalAccessUseCases } from "./admin-local-access.js";
import {
  decodeBase32,
  digestAdminLocalChallenge,
  digestAdminLocalIdentitySubject,
  digestAdminRecoveryCode,
  hashAdminPassword,
  totpCode,
  verifyAdminPassword,
} from "./admin-local-credentials.js";
import { digestAdminContentToken } from "./admin-content-tokens.js";

const tokenPepper = "a".repeat(64);
const subjectPepper = "b".repeat(64);
const accountId = "3f2c9a1e-0000-4000-8000-000000000001";
const loginId = "3f2c9a1e-0000-4000-8000-000000000002";
const token = () => randomBytes(32).toString("base64url");
const at = "2026-09-29T12:00:00.000000Z";
const success = { schemaVersion: 1, outcome: "SUCCESS" } as const;
const fail = (code: string) => ({ schemaVersion: 1, outcome: "FAILURE", code });
const view = {
  loginName: "studio.owner",
  displayName: "Studio Owner",
  twoFactorEnabled: false,
  recoveryCodesRemaining: 0,
  passwordChangedAt: at,
};
const PASSWORD = "correct horse battery staple";
const hashed = await hashAdminPassword(PASSWORD);
const NOW = new Date("2026-09-29T12:00:00Z");
const currentStep = Math.floor(NOW.getTime() / 30_000);
/** A six-digit code that is not valid for the current step (nor either neighbour). */
const wrongCode = (secret: Buffer) =>
  ["000000", "111111", "222222", "333333"].find(
    (code) =>
      ![-1, 0, 1].some(
        (drift) => totpCode(secret, currentStep + drift) === code,
      ),
  )!;

/** In-memory envelope KMS that enforces purpose and subject binding. */
function fakeKeys() {
  const store = new Map<
    string,
    { plaintext: string; purpose: string; subjectId: string }
  >();
  const keys = {
    encryptEnvelope: vi.fn(
      async (command: {
        purpose: string;
        subjectId: string;
        plaintextBase64: string;
      }) => {
        const ciphertext = `enc:v1:${randomBytes(48).toString("base64url")}`;
        store.set(ciphertext, {
          plaintext: command.plaintextBase64,
          purpose: command.purpose,
          subjectId: command.subjectId,
        });
        return {
          schemaVersion: 1,
          operation: "ENCRYPT_ENVELOPE",
          outcome: "SUCCESS",
          value: {
            ciphertext,
            encryptedDataKey: `enc:v1:${randomBytes(48).toString("base64url")}`,
            keyVersion: "test-envelope",
            algorithm: "AES_256_GCM",
          },
        };
      },
    ),
    decryptEnvelope: vi.fn(
      async (command: {
        purpose: string;
        subjectId: string;
        ciphertext: string;
      }) => {
        const entry = store.get(command.ciphertext);
        if (
          !entry ||
          entry.purpose !== command.purpose ||
          entry.subjectId !== command.subjectId
        )
          return {
            schemaVersion: 1,
            operation: "DECRYPT_ENVELOPE",
            outcome: "FAILURE",
            error: {
              schemaVersion: 1,
              code: "DECRYPTION_FAILED",
              retryable: false,
              message: "cannot decrypt",
            },
          };
        return {
          schemaVersion: 1,
          operation: "DECRYPT_ENVELOPE",
          outcome: "SUCCESS",
          value: { plaintextBase64: entry.plaintext },
        };
      },
    ),
  };
  const seal = async (secret: Buffer, subjectId = accountId) => {
    const response = await keys.encryptEnvelope({
      purpose: "ADMIN_TOTP_SECRET",
      subjectId,
      plaintextBase64: secret.toString("base64url"),
    });
    return {
      ciphertext: response.value.ciphertext,
      encryptedDataKey: response.value.encryptedDataKey,
      keyVersion: response.value.keyVersion,
    };
  };
  return { keys, seal };
}

type Overrides = Partial<
  Record<keyof AdminLocalAccessRepositories, Record<string, unknown>>
>;
function harness(overrides: Overrides = {}) {
  const repositories = {
    adminAccess: {
      revoke: vi.fn(async () => ({ ...success, kind: "LOGGED_OUT" })),
      ...overrides.adminAccess,
    },
    localLogin: {
      read: vi.fn(async () => ({ ...success, kind: "NO_ACCOUNT" })),
      recordFailure: vi.fn(async () => ({
        ...success,
        kind: "FAILURE_RECORDED",
        locked: false,
      })),
      start: vi.fn(async () => ({
        ...success,
        kind: "SESSION_SAVED",
        expiresAt: at,
        locale: "en",
      })),
      readStep: vi.fn(async () => fail("LOGIN_RESTART_REQUIRED")),
      completeStep: vi.fn(async () => ({
        ...success,
        kind: "SESSION_SAVED",
        expiresAt: at,
        locale: "en",
      })),
      ...overrides.localLogin,
    },
    localAccount: {
      read: vi.fn(async () => ({ ...success, kind: "NOT_LOCAL" })),
      recordFailure: vi.fn(async () => ({
        ...success,
        kind: "FAILURE_RECORDED",
        locked: false,
      })),
      update: vi.fn(async () => ({
        ...success,
        kind: "ACCOUNT_UPDATED",
        account: view,
      })),
      ...overrides.localAccount,
    },
    localStaff: {
      execute: vi.fn(async () => ({ ...success, kind: "STAFF_CONTEXT" })),
      ...overrides.localStaff,
    },
  };
  const { keys, seal } = fakeKeys();
  const useCases = createAdminLocalAccessUseCases({
    transactions: {
      runInAdminLocalAccessTransaction: (work) =>
        work(repositories as unknown as AdminLocalAccessRepositories),
    },
    keys: keys as never,
    tokenPepper,
    subjectPepper,
    totpIssuer: "Studio Admin",
    now: () => NOW,
  });
  return { repositories, keys, seal, useCases };
}
const login = (loginName = "studio.owner", password = PASSWORD) => ({
  schemaVersion: 1,
  requestId: randomUUID(),
  locale: "ja",
  loginName,
  password,
});
const loginAccount = (patch = {}) => ({
  ...success,
  kind: "LOGIN_ACCOUNT",
  accountId,
  passwordHash: hashed,
  active: true,
  locked: false,
  ...patch,
});

describe("sign-in with a password", () => {
  test("unknown or malformed names fail like a wrong password and create nothing", async () => {
    const { repositories, useCases } = harness();
    for (const name of ["nobody.here", "x", "Studio Owner!"]) {
      const response = await useCases.login(login(name));
      expect(response).toEqual(fail("INVALID_CREDENTIALS"));
    }
    expect(repositories.localLogin.read).toHaveBeenCalledTimes(1);
    expect(repositories.localLogin.recordFailure).not.toHaveBeenCalled();
    expect(repositories.localLogin.start).not.toHaveBeenCalled();
  });
  test("login names are trimmed and lowercased before lookup", async () => {
    const { repositories, useCases } = harness();
    await useCases.login(login("  Studio.Owner "));
    expect(repositories.localLogin.read).toHaveBeenCalledWith({
      schemaVersion: 1,
      loginName: "studio.owner",
    });
  });
  test("a locked account answers ACCOUNT_LOCKED without checking or counting", async () => {
    const { repositories, useCases } = harness({
      localLogin: { read: vi.fn(async () => loginAccount({ locked: true })) },
    });
    expect(
      await useCases.login(login("studio.owner", "wrong password")),
    ).toEqual(fail("ACCOUNT_LOCKED"));
    expect(repositories.localLogin.recordFailure).not.toHaveBeenCalled();
    expect(repositories.localLogin.start).not.toHaveBeenCalled();
  });
  test("a wrong password is counted, and the locking failure says so", async () => {
    const recordFailure = vi
      .fn()
      .mockResolvedValueOnce({
        ...success,
        kind: "FAILURE_RECORDED",
        locked: false,
      })
      .mockResolvedValueOnce({
        ...success,
        kind: "FAILURE_RECORDED",
        locked: true,
      });
    const { repositories, useCases } = harness({
      localLogin: { read: vi.fn(async () => loginAccount()), recordFailure },
    });
    expect(await useCases.login(login("studio.owner", "wrong"))).toEqual(
      fail("INVALID_CREDENTIALS"),
    );
    expect(await useCases.login(login("studio.owner", "wrong"))).toEqual(
      fail("ACCOUNT_LOCKED"),
    );
    expect(recordFailure.mock.calls[0]![0]).toMatchObject({ accountId });
    expect(repositories.localLogin.start).not.toHaveBeenCalled();
  });
  test("a suspended account never reveals itself and is not counted", async () => {
    const { repositories, useCases } = harness({
      localLogin: { read: vi.fn(async () => loginAccount({ active: false })) },
    });
    expect(await useCases.login(login())).toEqual(fail("INVALID_CREDENTIALS"));
    expect(await useCases.login(login("studio.owner", "wrong"))).toEqual(
      fail("INVALID_CREDENTIALS"),
    );
    expect(repositories.localLogin.recordFailure).not.toHaveBeenCalled();
    expect(repositories.localLogin.start).not.toHaveBeenCalled();
  });
  test("the right password starts a login bound to the verified hash and fresh tokens", async () => {
    const { repositories, useCases } = harness({
      localLogin: { read: vi.fn(async () => loginAccount()) },
    });
    const response = adminLocalAccessResponseSchema.parse(
      await useCases.login(login()),
    );
    expect(response).toMatchObject({
      kind: "SESSION_CREATED",
      expiresAt: at,
      locale: "en",
    });
    if (response.outcome !== "SUCCESS" || response.kind !== "SESSION_CREATED")
      throw new Error();
    const command = (
      repositories.localLogin.start.mock.calls[0] as unknown[]
    )[0] as Record<string, unknown>;
    expect(command).toMatchObject({
      accountId,
      verifiedPasswordHash: hashed,
      locale: "ja",
      sessionTtlSeconds: 28_800,
    });
    expect(command["sessionTokenDigest"]).toBe(
      digestAdminContentToken({
        tokenPepper,
        purpose: "admin-session",
        token: response.sessionToken,
      }),
    );
    expect(command["csrfTokenDigest"]).toBe(
      digestAdminContentToken({
        tokenPepper,
        purpose: "admin-csrf",
        token: response.csrfToken,
      }),
    );
  });
  test("a required step returns the challenge whose digest was stored", async () => {
    const { repositories, useCases } = harness({
      localLogin: {
        read: vi.fn(async () => loginAccount()),
        start: vi.fn(async () => ({
          ...success,
          kind: "STEP_SAVED",
          step: "SECOND_FACTOR",
          expiresAt: at,
        })),
      },
    });
    const response = adminLocalAccessResponseSchema.parse(
      await useCases.login(login()),
    );
    if (response.outcome !== "SUCCESS" || response.kind !== "STEP_REQUIRED")
      throw new Error();
    expect(response.step).toBe("SECOND_FACTOR");
    const command = (
      repositories.localLogin.start.mock.calls[0] as unknown[]
    )[0] as Record<string, unknown>;
    expect(command["challengeDigest"]).toBe(
      digestAdminLocalChallenge(tokenPepper, response.challengeToken),
    );
  });
  test("storage failures become ACCESS_UNAVAILABLE", async () => {
    const { useCases } = harness({
      localLogin: {
        read: vi.fn(async () => {
          throw new Error("down");
        }),
      },
    });
    expect(await useCases.login(login())).toEqual(fail("ACCESS_UNAVAILABLE"));
    expect(await useCases.login({ schemaVersion: 1 })).toEqual(
      fail("INVALID_COMMAND"),
    );
  });
});

describe("sign-in steps", () => {
  const stepRequest = (step: unknown, challengeToken = token()) => ({
    schemaVersion: 1,
    requestId: randomUUID(),
    challengeToken,
    step,
  });
  async function stepHarness(
    patch: Record<string, unknown>,
    lastStep = currentStep - 5,
  ) {
    const secret = randomBytes(20);
    const built = harness();
    const sealed = await built.seal(secret);
    built.repositories.localLogin.readStep = vi.fn(async () => ({
      ...success,
      kind: "LOGIN_STEP",
      loginId,
      accountId,
      loginName: "studio.owner",
      step: "SECOND_FACTOR",
      expired: false,
      passwordHash: hashed,
      totp: { ...sealed, lastStep },
      ...patch,
    })) as never;
    return { ...built, secret, sealed };
  }
  const outcome = (h: {
    repositories: {
      localLogin: { completeStep: { mock: { calls: unknown[][] } } };
    };
  }) =>
    (
      h.repositories.localLogin.completeStep.mock.calls[0]![0] as {
        outcome: unknown;
      }
    ).outcome;
  test("a current TOTP code is decrypted under its account and submitted with its step", async () => {
    const h = await stepHarness({});
    const challenge = token();
    await h.useCases.step(
      stepRequest(
        { kind: "TOTP", code: totpCode(h.secret, currentStep) },
        challenge,
      ),
    );
    expect(h.keys.decryptEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "ADMIN_TOTP_SECRET",
        subjectId: accountId,
      }),
    );
    expect(h.repositories.localLogin.readStep).toHaveBeenCalledWith({
      schemaVersion: 1,
      challengeDigest: digestAdminLocalChallenge(tokenPepper, challenge),
    });
    expect(outcome(h)).toEqual({
      kind: "TOTP",
      ciphertext: h.sealed.ciphertext,
      step: currentStep,
    });
  });
  test("wrong and replayed codes are submitted as rejected attempts", async () => {
    const h = await stepHarness({});
    await h.useCases.step(
      stepRequest({ kind: "TOTP", code: wrongCode(h.secret) }),
    );
    expect(outcome(h)).toEqual({ kind: "CODE_REJECTED" });
    const replay = await stepHarness({}, currentStep);
    await replay.useCases.step(
      stepRequest({ kind: "TOTP", code: totpCode(replay.secret, currentStep) }),
    );
    expect(outcome(replay)).toEqual({ kind: "CODE_REJECTED" });
  });
  test("a key service failure stops before any attempt is recorded", async () => {
    const h = await stepHarness({});
    h.keys.decryptEnvelope.mockResolvedValueOnce({
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        retryable: true,
        message: "later",
      },
    } as never);
    expect(
      await h.useCases.step(stepRequest({ kind: "TOTP", code: "123456" })),
    ).toEqual(fail("ACCESS_UNAVAILABLE"));
    expect(h.repositories.localLogin.completeStep).not.toHaveBeenCalled();
  });
  test("recovery codes are compared only by digest; malformed ones count as wrong", async () => {
    const h = await stepHarness({});
    await h.useCases.step(
      stepRequest({ kind: "RECOVERY_CODE", code: "abcd-efgh-jkmn" }),
    );
    expect(outcome(h)).toEqual({
      kind: "RECOVERY_CODE",
      codeDigest: digestAdminRecoveryCode(tokenPepper, "ABCD-EFGH-JKMN"),
    });
    const bad = await stepHarness({});
    await bad.useCases.step(
      stepRequest({ kind: "RECOVERY_CODE", code: "not-a-code-at-all" }),
    );
    expect(outcome(bad)).toEqual({ kind: "CODE_REJECTED" });
  });
  test("a new password must pass the policy, differ from the current one and is hashed", async () => {
    const h = await stepHarness({ step: "NEW_PASSWORD", totp: null });
    expect(
      await h.useCases.step(
        stepRequest({ kind: "NEW_PASSWORD", newPassword: "short" }),
      ),
    ).toEqual({
      ...fail("PASSWORD_REJECTED"),
      passwordProblem: "TOO_SHORT",
    });
    expect(
      await h.useCases.step(
        stepRequest({ kind: "NEW_PASSWORD", newPassword: PASSWORD }),
      ),
    ).toEqual({
      ...fail("PASSWORD_REJECTED"),
      passwordProblem: "SAME_AS_CURRENT",
    });
    expect(h.repositories.localLogin.completeStep).not.toHaveBeenCalled();
    await h.useCases.step(
      stepRequest({
        kind: "NEW_PASSWORD",
        newPassword: "a brand new passphrase",
      }),
    );
    const submitted = outcome(h) as {
      previousPasswordHash: string;
      newPasswordHash: string;
    };
    expect(submitted.previousPasswordHash).toBe(hashed);
    expect(
      await verifyAdminPassword(
        "a brand new passphrase",
        submitted.newPasswordHash,
      ),
    ).toBe(true);
  });
  test("a step the login does not need is refused; expired or unsatisfiable logins restart", async () => {
    const h = await stepHarness({ step: "NEW_PASSWORD", totp: null });
    expect(
      await h.useCases.step(stepRequest({ kind: "TOTP", code: "123456" })),
    ).toEqual(fail("INVALID_COMMAND"));
    const expired = await stepHarness({ expired: true });
    await expired.useCases.step(stepRequest({ kind: "TOTP", code: "123456" }));
    expect(outcome(expired)).toEqual({ kind: "EXPIRED" });
    const cleared = await stepHarness({ totp: null });
    await cleared.useCases.step(stepRequest({ kind: "TOTP", code: "123456" }));
    expect(outcome(cleared)).toEqual({ kind: "RESTART" });
  });
  test("a further step keeps the same challenge token", async () => {
    const h = await stepHarness({});
    h.repositories.localLogin.completeStep = vi.fn(async () => ({
      ...success,
      kind: "STEP_SAVED",
      step: "NEW_PASSWORD",
      expiresAt: at,
    })) as never;
    const challenge = token();
    expect(
      await h.useCases.step(
        stepRequest(
          { kind: "TOTP", code: totpCode(h.secret, currentStep) },
          challenge,
        ),
      ),
    ).toEqual({
      ...success,
      kind: "STEP_REQUIRED",
      step: "NEW_PASSWORD",
      challengeToken: challenge,
      expiresAt: at,
    });
  });
});

describe("own account settings", () => {
  const request = (command: unknown) => ({
    schemaVersion: 1,
    requestId: randomUUID(),
    sessionToken: token(),
    csrfToken: token(),
    command,
  });
  async function accountHarness(patch: Record<string, unknown> = {}) {
    const built = harness();
    built.repositories.localAccount.read = vi.fn(async () => ({
      ...success,
      kind: "ACCOUNT_STATE",
      accountId,
      account: view,
      passwordHash: hashed,
      locked: false,
      totp: null,
      pending: null,
      ...patch,
    })) as never;
    return built;
  }
  const change = (h: {
    repositories: {
      localAccount: { update: { mock: { calls: unknown[][] } } };
    };
  }) =>
    (
      h.repositories.localAccount.update.mock.calls[0]![0] as {
        change: Record<string, unknown>;
      }
    ).change;
  test("OIDC identities see NOT_LOCAL", async () => {
    const { useCases } = harness();
    expect(await useCases.account(request({ action: "READ" }))).toEqual({
      ...success,
      kind: "NOT_LOCAL",
    });
  });
  test("a wrong current password is counted; a locked account is not checked", async () => {
    const h = await accountHarness();
    expect(
      await h.useCases.account(
        request({
          action: "CHANGE_PASSWORD",
          currentPassword: "wrong",
          newPassword: "another long passphrase",
        }),
      ),
    ).toEqual(fail("INVALID_PASSWORD"));
    expect(h.repositories.localAccount.recordFailure).toHaveBeenCalledTimes(1);
    const locked = await accountHarness({ locked: true });
    expect(
      await locked.useCases.account(
        request({
          action: "CHANGE_PASSWORD",
          currentPassword: PASSWORD,
          newPassword: "another long passphrase",
        }),
      ),
    ).toEqual(fail("ACCOUNT_LOCKED"));
    expect(locked.repositories.localAccount.update).not.toHaveBeenCalled();
  });
  test("a new password is checked before hashing and replaces only the verified hash", async () => {
    const h = await accountHarness();
    expect(
      await h.useCases.account(
        request({
          action: "CHANGE_PASSWORD",
          currentPassword: PASSWORD,
          newPassword: PASSWORD,
        }),
      ),
    ).toEqual({
      ...fail("PASSWORD_REJECTED"),
      passwordProblem: "SAME_AS_CURRENT",
    });
    const response = await h.useCases.account(
      request({
        action: "CHANGE_PASSWORD",
        currentPassword: PASSWORD,
        newPassword: "another long passphrase",
      }),
    );
    expect(response).toEqual({
      ...success,
      kind: "PASSWORD_CHANGED",
      account: view,
    });
    const submitted = change(h);
    expect(submitted["previousPasswordHash"]).toBe(hashed);
    expect(
      await verifyAdminPassword(
        "another long passphrase",
        String(submitted["newPasswordHash"]),
      ),
    ).toBe(true);
  });
  test("enrollment encrypts a fresh secret and shows it only in the response", async () => {
    const h = await accountHarness();
    h.repositories.localAccount.update = vi.fn(async () => ({
      ...success,
      kind: "ENROLLMENT_SAVED",
      expiresAt: at,
    })) as never;
    const response = adminAccountResponseSchema.parse(
      await h.useCases.account(
        request({ action: "BEGIN_TOTP", currentPassword: PASSWORD }),
      ),
    );
    if (response.outcome !== "SUCCESS" || response.kind !== "TOTP_ENROLLMENT")
      throw new Error();
    expect(response.otpauthUri).toBe(
      `otpauth://totp/Studio%20Admin:studio.owner?secret=${response.secret}&issuer=Studio%20Admin&algorithm=SHA1&digits=6&period=30`,
    );
    expect(h.keys.encryptEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "ADMIN_TOTP_SECRET",
        subjectId: accountId,
      }),
    );
    const pending = change(h)["pending"] as { ciphertext: string };
    expect(JSON.stringify(change(h))).not.toContain(response.secret);
    const decrypted = await h.keys.decryptEnvelope({
      purpose: "ADMIN_TOTP_SECRET",
      subjectId: accountId,
      ciphertext: pending.ciphertext,
    });
    expect(
      Buffer.from(
        (decrypted as { value: { plaintextBase64: string } }).value
          .plaintextBase64,
        "base64url",
      ),
    ).toEqual(decodeBase32(response.secret));
  });
  test("confirmation needs a current code; ten codes go out once, digests are stored", async () => {
    const secret = randomBytes(20);
    const built = await accountHarness();
    const pending = await built.seal(secret);
    const h = await accountHarness({ pending: { ...pending, expired: false } });
    h.keys.decryptEnvelope.mockImplementation(built.keys.decryptEnvelope);
    expect(
      await h.useCases.account(
        request({ action: "CONFIRM_TOTP", code: wrongCode(secret) }),
      ),
    ).toEqual(fail("INVALID_CODE"));
    expect(h.repositories.localAccount.recordFailure).not.toHaveBeenCalled();
    h.repositories.localAccount.update = vi.fn(async () => ({
      ...success,
      kind: "ACCOUNT_UPDATED",
      account: { ...view, twoFactorEnabled: true, recoveryCodesRemaining: 10 },
    })) as never;
    const response = adminAccountResponseSchema.parse(
      await h.useCases.account(
        request({
          action: "CONFIRM_TOTP",
          code: totpCode(secret, currentStep),
        }),
      ),
    );
    if (response.outcome !== "SUCCESS" || response.kind !== "TOTP_ENABLED")
      throw new Error();
    const submitted = change(h);
    expect(submitted).toMatchObject({
      kind: "CONFIRM_TOTP",
      pendingCiphertext: pending.ciphertext,
      step: currentStep,
    });
    expect(submitted["recoveryCodeDigests"]).toEqual(
      response.recoveryCodes.map((code) =>
        digestAdminRecoveryCode(tokenPepper, code),
      ),
    );
    const expired = await accountHarness({
      pending: { ...pending, expired: true },
    });
    expect(
      await expired.useCases.account(
        request({ action: "CONFIRM_TOTP", code: "123456" }),
      ),
    ).toEqual(fail("ENROLLMENT_EXPIRED"));
  });
  test("removing the second factor needs the password and a fresh code, both counted", async () => {
    const secret = randomBytes(20);
    const built = await accountHarness();
    const sealed = await built.seal(secret);
    const h = await accountHarness({
      totp: { ...sealed, lastStep: currentStep - 1 },
    });
    h.keys.decryptEnvelope.mockImplementation(built.keys.decryptEnvelope);
    expect(
      await h.useCases.account(
        request({
          action: "DISABLE_TOTP",
          currentPassword: PASSWORD,
          code: wrongCode(secret),
        }),
      ),
    ).toEqual(fail("INVALID_CODE"));
    expect(
      await h.useCases.account(
        request({
          action: "DISABLE_TOTP",
          currentPassword: "nope",
          code: totpCode(secret, currentStep),
        }),
      ),
    ).toEqual(fail("INVALID_PASSWORD"));
    expect(h.repositories.localAccount.recordFailure).toHaveBeenCalledTimes(2);
    expect(h.repositories.localAccount.update).not.toHaveBeenCalled();
    expect(
      await h.useCases.account(
        request({
          action: "DISABLE_TOTP",
          currentPassword: PASSWORD,
          code: totpCode(secret, currentStep),
        }),
      ),
    ).toEqual({ ...success, kind: "TOTP_DISABLED", account: view });
    expect(change(h)).toEqual({
      kind: "DISABLE_TOTP",
      previousPasswordHash: hashed,
      ciphertext: sealed.ciphertext,
      step: currentStep,
    });
    const none = await accountHarness();
    expect(
      await none.useCases.account(
        request({
          action: "REGENERATE_RECOVERY_CODES",
          currentPassword: PASSWORD,
          code: "123456",
        }),
      ),
    ).toEqual(fail("TOTP_NOT_ENABLED"));
  });
});

describe("staff accounts", () => {
  const request = (command: unknown) => ({
    schemaVersion: 1,
    requestId: randomUUID(),
    sessionToken: token(),
    csrfToken: token(),
    command,
  });
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
  };
  test("creation is authorized before a password is generated, then shown once", async () => {
    const denied = harness({
      localStaff: { execute: vi.fn(async () => fail("FORBIDDEN")) },
    });
    const create = {
      action: "CREATE",
      loginName: "night.shift",
      displayName: "Night shift",
      roleKeys: ["studio:operator"],
    };
    expect(await denied.useCases.staff(request(create))).toEqual(
      fail("FORBIDDEN"),
    );
    expect(denied.repositories.localStaff.execute).toHaveBeenCalledTimes(1);
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ...success, kind: "STAFF_CONTEXT" })
      .mockResolvedValueOnce({ ...success, kind: "STAFF_SAVED", member });
    const h = harness({ localStaff: { execute } });
    const response = adminStaffResponseSchema.parse(
      await h.useCases.staff(request(create)),
    );
    if (response.outcome !== "SUCCESS" || response.kind !== "STAFF_CREATED")
      throw new Error();
    const change = (
      execute.mock.calls[1]![0] as { change: Record<string, string> }
    ).change;
    expect(change).toMatchObject({
      action: "CREATE",
      loginName: "night.shift",
      roleKeys: ["studio:operator"],
    });
    expect(change["subjectDigest"]).toBe(
      digestAdminLocalIdentitySubject(subjectPepper, change["accountId"]!),
    );
    expect(
      await verifyAdminPassword(
        response.temporaryPassword,
        change["passwordHash"]!,
      ),
    ).toBe(true);
    expect(JSON.stringify(execute.mock.calls)).not.toContain(
      response.temporaryPassword,
    );
  });
  test("a reset returns a new temporary password; other changes pass through", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ...success, kind: "STAFF_CONTEXT" })
      .mockResolvedValueOnce({ ...success, kind: "STAFF_SAVED", member })
      .mockResolvedValueOnce({
        ...success,
        kind: "STAFF_SAVED",
        member: { ...member, status: "SUSPENDED" },
      });
    const h = harness({ localStaff: { execute } });
    const reset = adminStaffResponseSchema.parse(
      await h.useCases.staff(
        request({ action: "RESET_PASSWORD", accountId, expectedVersion: 1 }),
      ),
    );
    expect(reset).toMatchObject({ kind: "PASSWORD_RESET", member });
    expect(
      await h.useCases.staff(
        request({
          action: "SET_STATUS",
          accountId,
          expectedVersion: 2,
          status: "SUSPENDED",
        }),
      ),
    ).toEqual({
      ...success,
      kind: "STAFF_UPDATED",
      member: { ...member, status: "SUSPENDED" },
    });
    expect((execute.mock.calls[2]![0] as { change: unknown }).change).toEqual({
      action: "SET_STATUS",
      accountId,
      expectedVersion: 2,
      status: "SUSPENDED",
    });
  });
});

test("logout reuses the canonical revocation", async () => {
  const h = harness();
  const sessionToken = token(),
    csrfToken = token();
  expect(
    await h.useCases.logout({
      schemaVersion: 1,
      requestId: randomUUID(),
      sessionToken,
      csrfToken,
      revokeAll: false,
    }),
  ).toEqual({ ...success, kind: "LOGGED_OUT" });
  expect(h.repositories.adminAccess.revoke).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionTokenDigest: digestAdminContentToken({
        tokenPepper,
        purpose: "admin-session",
        token: sessionToken,
      }),
      revokeAll: false,
    }),
  );
});
