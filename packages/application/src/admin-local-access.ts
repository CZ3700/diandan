/// <reference types="node" />
import { randomBytes, randomUUID } from "node:crypto";
import {
  adminAccessLogoutRequestSchema,
  adminAccessLogoutResponseSchema,
  adminAccessRevokeCommandSchema,
  adminAccountRequestSchema,
  adminAccountResponseSchema,
  adminLocalAccessResponseSchema,
  adminLocalAccountChangeSchema,
  adminLocalAccountFailureCommandSchema,
  adminLocalAccountFailureResponseSchema,
  adminLocalAccountReadCommandSchema,
  adminLocalAccountReadResponseSchema,
  adminLocalAccountUpdateCommandSchema,
  adminLocalAccountUpdateResponseSchema,
  adminLocalLoginFailureCommandSchema,
  adminLocalLoginFailureResponseSchema,
  adminLocalLoginProgressSchema,
  adminLocalLoginReadCommandSchema,
  adminLocalLoginReadResponseSchema,
  adminLocalLoginRequestSchema,
  adminLocalLoginStartCommandSchema,
  adminLocalStaffCommandSchema,
  adminLocalStaffResultSchema,
  adminLocalStepCompleteCommandSchema,
  adminLocalStepOutcomeSchema,
  adminLocalStepReadCommandSchema,
  adminLocalStepReadResponseSchema,
  adminLocalStepRequestSchema,
  adminLoginNameSchema,
  adminStaffRequestSchema,
  adminStaffResponseSchema,
  keyManagementPortResponseSchema,
  type AdminAccessLogoutResponse,
  type AdminAccountCommand,
  type AdminAccountFailure,
  type AdminAccountResponse,
  type AdminLocalAccessFailure,
  type AdminLocalAccessResponse,
  type AdminLocalAccountState,
  type AdminLocalLoginProgress,
  type AdminLocalStepOutcome,
  type AdminLocalStepReadResponse,
  type AdminLocalStepRequest,
  type AdminStaffFailure,
  type AdminStaffResponse,
} from "@fan-support/contracts";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type {
  AdminLocalAccessRepositories,
  AdminLocalAccessTransactionManager,
} from "@fan-support/persistence-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import {
  adminPasswordProblem,
  adminTotpUri,
  digestAdminLocalChallenge,
  digestAdminLocalIdentitySubject,
  digestAdminRecoveryCode,
  encodeBase32,
  generateAdminRecoveryCodes,
  generateAdminTemporaryPassword,
  generateAdminTotpSecret,
  hashAdminPassword,
  normalizeAdminRecoveryCode,
  verifyAdminPassword,
  verifyAdminTotp,
} from "./admin-local-credentials.js";

// L3-10 ③ (ADR-021): built-in sign-in, own account settings and staff accounts.
// Hashing and KMS calls happen here, outside every database transaction; repositories compare-and-set.

export type AdminLocalAccessDependencies = Readonly<{
  transactions: AdminLocalAccessTransactionManager;
  keys: Pick<KeyManagementPort, "encryptEnvelope" | "decryptEnvelope">;
  tokenPepper: string;
  subjectPepper: string;
  /** Name shown by authenticator apps. */
  totpIssuer: string;
  /** At most the eight-hour database limit. */
  sessionTtlSeconds?: number;
  now?: () => Date;
}>;
export type AdminLocalAccessUseCases = Readonly<{
  login(input: unknown): Promise<AdminLocalAccessResponse>;
  step(input: unknown): Promise<AdminLocalAccessResponse>;
  logout(input: unknown): Promise<AdminAccessLogoutResponse>;
  account(input: unknown): Promise<AdminAccountResponse>;
  staff(input: unknown): Promise<AdminStaffResponse>;
}>;

const success = { schemaVersion: 1, outcome: "SUCCESS" } as const;
type AdminPasswordProblem = NonNullable<
  AdminLocalAccessFailure["passwordProblem"]
>;
const localFailure = (
  code: AdminLocalAccessFailure["code"],
  passwordProblem?: AdminPasswordProblem,
): AdminLocalAccessFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
  ...(passwordProblem ? { passwordProblem } : {}),
});
const accountFailure = (
  code: AdminAccountFailure["code"],
  passwordProblem?: AdminPasswordProblem,
): AdminAccountFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
  ...(passwordProblem ? { passwordProblem } : {}),
});
const staffFailure = (code: AdminStaffFailure["code"]): AdminStaffFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const token = () => randomBytes(32).toString("base64url");
type EncryptedSecret = Readonly<{
  ciphertext: string;
  encryptedDataKey: string;
  keyVersion: string;
}>;
type Tokens = Readonly<{
  sessionToken: string;
  csrfToken: string;
  challengeToken: string;
}>;

export function createAdminLocalAccessUseCases(
  dependencies: AdminLocalAccessDependencies,
): AdminLocalAccessUseCases {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  validateAdminContentTokenPepper(dependencies.subjectPepper);
  const sessionTtlSeconds = dependencies.sessionTtlSeconds ?? 28_800;
  if (
    typeof dependencies.transactions?.runInAdminLocalAccessTransaction !==
      "function" ||
    typeof dependencies.keys?.encryptEnvelope !== "function" ||
    typeof dependencies.keys?.decryptEnvelope !== "function" ||
    !/^[\p{L}\p{N} ._-]{1,64}$/u.test(dependencies.totpIssuer) ||
    !Number.isInteger(sessionTtlSeconds) ||
    sessionTtlSeconds < 60 ||
    sessionTtlSeconds > 28_800
  )
    throw new TypeError("Invalid built-in admin access configuration");
  const { tokenPepper } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const inTransaction = <Result>(
    work: (repositories: AdminLocalAccessRepositories) => Promise<unknown>,
  ) =>
    dependencies.transactions.runInAdminLocalAccessTransaction(
      work as never,
    ) as Promise<Result>;
  const sessionDigest = (
    purpose: "admin-session" | "admin-csrf",
    value: string,
  ) => digestAdminContentToken({ tokenPepper, purpose, token: value });
  const credentials = (
    request: Readonly<{ sessionToken: string; csrfToken: string }>,
  ) => ({
    sessionTokenDigest: sessionDigest("admin-session", request.sessionToken),
    csrfTokenDigest: sessionDigest("admin-csrf", request.csrfToken),
  });
  function newSession(requestId: string) {
    const tokens: Tokens = {
      sessionToken: token(),
      csrfToken: token(),
      challengeToken: token(),
    };
    return {
      tokens,
      material: {
        schemaVersion: 1 as const,
        requestId,
        sessionId: randomUUID(),
        sessionTokenDigest: sessionDigest("admin-session", tokens.sessionToken),
        csrfTokenDigest: sessionDigest("admin-csrf", tokens.csrfToken),
        sessionTtlSeconds,
      },
    };
  }
  function present(
    progress: AdminLocalLoginProgress,
    tokens: Tokens,
  ): AdminLocalAccessResponse {
    if (progress.outcome === "FAILURE") return progress;
    return adminLocalAccessResponseSchema.parse(
      progress.kind === "SESSION_SAVED"
        ? {
            ...success,
            kind: "SESSION_CREATED",
            sessionToken: tokens.sessionToken,
            csrfToken: tokens.csrfToken,
            expiresAt: progress.expiresAt,
            locale: progress.locale,
          }
        : {
            ...success,
            kind: "STEP_REQUIRED",
            step: progress.step,
            challengeToken: tokens.challengeToken,
            expiresAt: progress.expiresAt,
          },
    );
  }
  async function encrypt(
    secret: Buffer,
    accountId: string,
  ): Promise<EncryptedSecret> {
    const response = keyManagementPortResponseSchema.parse(
      await dependencies.keys.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "ADMIN_TOTP_SECRET",
        subjectId: accountId,
        plaintextBase64: secret.toString("base64url"),
      }),
    );
    if (
      response.operation !== "ENCRYPT_ENVELOPE" ||
      response.outcome !== "SUCCESS"
    )
      throw new Error("second factor could not be sealed");
    return {
      ciphertext: response.value.ciphertext,
      encryptedDataKey: response.value.encryptedDataKey,
      keyVersion: response.value.keyVersion,
    };
  }
  async function decrypt(
    sealed: EncryptedSecret,
    accountId: string,
  ): Promise<Buffer> {
    const response = keyManagementPortResponseSchema.parse(
      await dependencies.keys.decryptEnvelope({
        schemaVersion: 1,
        operation: "DECRYPT_ENVELOPE",
        purpose: "ADMIN_TOTP_SECRET",
        subjectId: accountId,
        ciphertext: sealed.ciphertext,
        encryptedDataKey: sealed.encryptedDataKey,
        keyVersion: sealed.keyVersion,
        algorithm: "AES_256_GCM",
      } as never),
    );
    if (
      response.operation !== "DECRYPT_ENVELOPE" ||
      response.outcome !== "SUCCESS"
    )
      throw new Error("second factor could not be opened");
    const secret = Buffer.from(response.value.plaintextBase64, "base64url");
    if (secret.length !== 20) throw new Error("unexpected second factor");
    return secret;
  }
  /** Checks a code against a sealed secret; the plaintext never outlives the check. */
  async function checkCode(
    sealed: EncryptedSecret,
    accountId: string,
    code: string,
    lastStep: number | null,
  ): Promise<number | null> {
    const secret = await decrypt(sealed, accountId);
    try {
      return verifyAdminTotp(secret, code, now(), lastStep);
    } finally {
      secret.fill(0);
    }
  }
  async function decideStep(
    state: Extract<AdminLocalStepReadResponse, { kind: "LOGIN_STEP" }>,
    step: AdminLocalStepRequest["step"],
  ): Promise<AdminLocalStepOutcome | AdminLocalAccessFailure> {
    if (state.expired) return { kind: "EXPIRED" };
    if (state.step === "NONE") return { kind: "RESTART" };
    if ((step.kind === "NEW_PASSWORD") !== (state.step === "NEW_PASSWORD"))
      return localFailure("INVALID_COMMAND");
    switch (step.kind) {
      case "TOTP": {
        if (state.totp === null) return { kind: "RESTART" };
        const matched = await checkCode(
          state.totp,
          state.accountId,
          step.code,
          state.totp.lastStep,
        );
        return matched === null
          ? { kind: "CODE_REJECTED" }
          : adminLocalStepOutcomeSchema.parse({
              kind: "TOTP",
              ciphertext: state.totp.ciphertext,
              step: matched,
            });
      }
      case "RECOVERY_CODE":
        return normalizeAdminRecoveryCode(step.code) === null
          ? { kind: "CODE_REJECTED" }
          : adminLocalStepOutcomeSchema.parse({
              kind: "RECOVERY_CODE",
              codeDigest: digestAdminRecoveryCode(tokenPepper, step.code),
            });
      case "NEW_PASSWORD": {
        const problem = adminPasswordProblem(step.newPassword, state.loginName);
        if (problem) return localFailure("PASSWORD_REJECTED", problem);
        if (await verifyAdminPassword(step.newPassword, state.passwordHash))
          return localFailure("PASSWORD_REJECTED", "SAME_AS_CURRENT");
        return adminLocalStepOutcomeSchema.parse({
          kind: "NEW_PASSWORD",
          previousPasswordHash: state.passwordHash,
          newPasswordHash: await hashAdminPassword(step.newPassword),
        });
      }
    }
  }

  return Object.freeze({
    async login(input: unknown): Promise<AdminLocalAccessResponse> {
      const parsed = adminLocalLoginRequestSchema.safeParse(input);
      if (!parsed.success) return localFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        const loginName = adminLoginNameSchema.safeParse(
          request.loginName.trim().toLowerCase(),
        );
        const found = loginName.success
          ? adminLocalLoginReadResponseSchema.parse(
              await inTransaction(({ localLogin }) =>
                localLogin.read(
                  adminLocalLoginReadCommandSchema.parse({
                    schemaVersion: 1,
                    loginName: loginName.data,
                  }),
                ),
              ),
            )
          : ({ ...success, kind: "NO_ACCOUNT" } as const);
        if (found.outcome === "FAILURE")
          return localFailure("ACCESS_UNAVAILABLE");
        if (found.kind === "NO_ACCOUNT") {
          // Pays for one full hash so an unknown name is not faster than a wrong password.
          await verifyAdminPassword(request.password, null);
          return localFailure("INVALID_CREDENTIALS");
        }
        if (found.locked) return localFailure("ACCOUNT_LOCKED");
        const verified = await verifyAdminPassword(
          request.password,
          found.passwordHash,
        );
        if (!found.active) return localFailure("INVALID_CREDENTIALS");
        if (!verified) {
          const recorded = adminLocalLoginFailureResponseSchema.parse(
            await inTransaction(({ localLogin }) =>
              localLogin.recordFailure(
                adminLocalLoginFailureCommandSchema.parse({
                  schemaVersion: 1,
                  requestId: request.requestId,
                  accountId: found.accountId,
                }),
              ),
            ),
          );
          return localFailure(
            recorded.outcome === "SUCCESS" && recorded.locked
              ? "ACCOUNT_LOCKED"
              : "INVALID_CREDENTIALS",
          );
        }
        const { tokens, material } = newSession(request.requestId);
        const progress = adminLocalLoginProgressSchema.parse(
          await inTransaction(({ localLogin }) =>
            localLogin.start(
              adminLocalLoginStartCommandSchema.parse({
                ...material,
                loginId: randomUUID(),
                accountId: found.accountId,
                verifiedPasswordHash: found.passwordHash,
                locale: request.locale,
                challengeDigest: digestAdminLocalChallenge(
                  tokenPepper,
                  tokens.challengeToken,
                ),
              }),
            ),
          ),
        );
        return present(progress, tokens);
      } catch {
        return localFailure("ACCESS_UNAVAILABLE");
      }
    },
    async step(input: unknown): Promise<AdminLocalAccessResponse> {
      const parsed = adminLocalStepRequestSchema.safeParse(input);
      if (!parsed.success) return localFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        const challengeDigest = digestAdminLocalChallenge(
          tokenPepper,
          request.challengeToken,
        );
        const state = adminLocalStepReadResponseSchema.parse(
          await inTransaction(({ localLogin }) =>
            localLogin.readStep(
              adminLocalStepReadCommandSchema.parse({
                schemaVersion: 1,
                challengeDigest,
              }),
            ),
          ),
        );
        if (state.outcome === "FAILURE") return state;
        const outcome = await decideStep(state, request.step);
        if ("outcome" in outcome) return outcome;
        const { tokens, material } = newSession(request.requestId);
        const progress = adminLocalLoginProgressSchema.parse(
          await inTransaction(({ localLogin }) =>
            localLogin.completeStep(
              adminLocalStepCompleteCommandSchema.parse({
                ...material,
                challengeDigest,
                loginId: state.loginId,
                outcome,
              }),
            ),
          ),
        );
        return present(progress, {
          ...tokens,
          challengeToken: request.challengeToken,
        });
      } catch {
        return localFailure("ACCESS_UNAVAILABLE");
      }
    },
    async logout(input: unknown): Promise<AdminAccessLogoutResponse> {
      const parsed = adminAccessLogoutRequestSchema.safeParse(input);
      if (!parsed.success)
        return {
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "INVALID_COMMAND",
        };
      const request = parsed.data;
      try {
        return adminAccessLogoutResponseSchema.parse(
          await inTransaction(({ adminAccess }) =>
            adminAccess.revoke(
              adminAccessRevokeCommandSchema.parse({
                schemaVersion: 1,
                requestId: request.requestId,
                ...credentials(request),
                revokeAll: request.revokeAll,
              }),
            ),
          ),
        );
      } catch {
        return {
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "ACCESS_UNAVAILABLE",
        };
      }
    },
    async account(input: unknown): Promise<AdminAccountResponse> {
      const parsed = adminAccountRequestSchema.safeParse(input);
      if (!parsed.success) return accountFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        const digests = credentials(request);
        const state = adminLocalAccountReadResponseSchema.parse(
          await inTransaction(({ localAccount }) =>
            localAccount.read(
              adminLocalAccountReadCommandSchema.parse({
                schemaVersion: 1,
                ...digests,
              }),
            ),
          ),
        );
        if (state.outcome === "FAILURE" || state.kind === "NOT_LOCAL")
          return state;
        return adminAccountResponseSchema.parse(
          await changeAccount(
            state,
            request.command,
            request.requestId,
            digests,
          ),
        );
      } catch {
        return accountFailure("ACCESS_UNAVAILABLE");
      }
    },
    async staff(input: unknown): Promise<AdminStaffResponse> {
      const parsed = adminStaffRequestSchema.safeParse(input);
      if (!parsed.success) return staffFailure("INVALID_COMMAND");
      const request = parsed.data,
        command = request.command;
      try {
        const execute = async (change: unknown) =>
          adminLocalStaffResultSchema.parse(
            await inTransaction(({ localStaff }) =>
              localStaff.execute(
                adminLocalStaffCommandSchema.parse({
                  schemaVersion: 1,
                  requestId: request.requestId,
                  ...credentials(request),
                  change,
                }),
              ),
            ),
          );
        if (command.action === "CONTEXT" || command.action === "LIST")
          return adminStaffResponseSchema.parse(await execute(command));
        if (
          command.action === "CREATE" ||
          command.action === "RESET_PASSWORD"
        ) {
          // Authorize before paying for a hash, so anonymous requests cannot buy scrypt work.
          const context = await execute({ action: "CONTEXT" });
          if (context.outcome === "FAILURE") return context;
          const temporaryPassword = generateAdminTemporaryPassword();
          const passwordHash = await hashAdminPassword(temporaryPassword);
          const accountId =
            command.action === "CREATE" ? randomUUID() : command.accountId;
          const saved = await execute(
            command.action === "CREATE"
              ? {
                  ...command,
                  accountId,
                  identityId: randomUUID(),
                  subjectDigest: digestAdminLocalIdentitySubject(
                    dependencies.subjectPepper,
                    accountId,
                  ),
                  passwordHash,
                }
              : { ...command, passwordHash },
          );
          if (saved.outcome === "FAILURE") return saved;
          if (saved.kind !== "STAFF_SAVED")
            return staffFailure("ACCESS_UNAVAILABLE");
          return adminStaffResponseSchema.parse({
            ...success,
            kind:
              command.action === "CREATE" ? "STAFF_CREATED" : "PASSWORD_RESET",
            member: saved.member,
            temporaryPassword,
          });
        }
        const saved = await execute(command);
        if (saved.outcome === "FAILURE") return saved;
        if (command.action === "DELETE")
          return saved.kind === "STAFF_DELETED" &&
            saved.accountId === command.accountId
            ? adminStaffResponseSchema.parse(saved)
            : staffFailure("ACCESS_UNAVAILABLE");
        if (saved.kind !== "STAFF_SAVED")
          return staffFailure("ACCESS_UNAVAILABLE");
        return adminStaffResponseSchema.parse({
          ...success,
          kind: "STAFF_UPDATED",
          member: saved.member,
        });
      } catch {
        return staffFailure("ACCESS_UNAVAILABLE");
      }
    },
  });

  async function changeAccount(
    state: AdminLocalAccountState,
    command: AdminAccountCommand,
    requestId: string,
    digests: ReturnType<typeof credentials>,
  ): Promise<AdminAccountResponse> {
    const accountId = state.accountId;
    const update = async (change: unknown) =>
      adminLocalAccountUpdateResponseSchema.parse(
        await inTransaction(({ localAccount }) =>
          localAccount.update(
            adminLocalAccountUpdateCommandSchema.parse({
              schemaVersion: 1,
              requestId,
              ...digests,
              accountId,
              change: adminLocalAccountChangeSchema.parse(change),
            }),
          ),
        ),
      );
    /** Counts a wrong password or code against the same lockout as sign-in. */
    const counted = async (code: "INVALID_PASSWORD" | "INVALID_CODE") => {
      const recorded = adminLocalAccountFailureResponseSchema.parse(
        await inTransaction(({ localAccount }) =>
          localAccount.recordFailure(
            adminLocalAccountFailureCommandSchema.parse({
              schemaVersion: 1,
              requestId,
              ...digests,
              accountId,
            }),
          ),
        ),
      );
      if (recorded.outcome === "FAILURE") return recorded;
      return accountFailure(recorded.locked ? "ACCOUNT_LOCKED" : code);
    };
    const passwordDenied = async (password: string) => {
      if (state.locked) return accountFailure("ACCOUNT_LOCKED");
      return (await verifyAdminPassword(password, state.passwordHash))
        ? undefined
        : counted("INVALID_PASSWORD");
    };
    const withAccount = (
      kind: "PASSWORD_CHANGED" | "TOTP_DISABLED",
      saved: Awaited<ReturnType<typeof update>>,
    ): AdminAccountResponse =>
      saved.outcome === "FAILURE"
        ? saved
        : saved.kind === "ACCOUNT_UPDATED"
          ? { ...success, kind, account: saved.account }
          : accountFailure("ACCESS_UNAVAILABLE");
    const withCodes = async (
      kind: "TOTP_ENABLED" | "RECOVERY_CODES",
      change: (digests: string[]) => unknown,
    ): Promise<AdminAccountResponse> => {
      const codes = generateAdminRecoveryCodes();
      const saved = await update(
        change(codes.map((code) => digestAdminRecoveryCode(tokenPepper, code))),
      );
      if (saved.outcome === "FAILURE") return saved;
      if (saved.kind !== "ACCOUNT_UPDATED")
        return accountFailure("ACCESS_UNAVAILABLE");
      return { ...success, kind, account: saved.account, recoveryCodes: codes };
    };
    switch (command.action) {
      case "READ":
        return { ...success, kind: "ACCOUNT", account: state.account };
      case "CHANGE_PASSWORD": {
        const denied = await passwordDenied(command.currentPassword);
        if (denied) return denied;
        const problem =
          adminPasswordProblem(command.newPassword, state.account.loginName) ??
          (command.newPassword.normalize("NFC") ===
          command.currentPassword.normalize("NFC")
            ? "SAME_AS_CURRENT"
            : null);
        if (problem) return accountFailure("PASSWORD_REJECTED", problem);
        return withAccount(
          "PASSWORD_CHANGED",
          await update({
            kind: "CHANGE_PASSWORD",
            previousPasswordHash: state.passwordHash,
            newPasswordHash: await hashAdminPassword(command.newPassword),
          }),
        );
      }
      case "BEGIN_TOTP": {
        if (state.totp) return accountFailure("TOTP_ALREADY_ENABLED");
        const denied = await passwordDenied(command.currentPassword);
        if (denied) return denied;
        const secret = generateAdminTotpSecret();
        try {
          const saved = await update({
            kind: "BEGIN_TOTP",
            previousPasswordHash: state.passwordHash,
            pending: await encrypt(secret, accountId),
          });
          if (saved.outcome === "FAILURE") return saved;
          if (saved.kind !== "ENROLLMENT_SAVED")
            return accountFailure("ACCESS_UNAVAILABLE");
          return {
            ...success,
            kind: "TOTP_ENROLLMENT",
            otpauthUri: adminTotpUri({
              issuer: dependencies.totpIssuer,
              account: state.account.loginName,
              secret,
            }),
            secret: encodeBase32(secret),
            expiresAt: saved.expiresAt,
          };
        } finally {
          secret.fill(0);
        }
      }
      case "CONFIRM_TOTP": {
        if (state.totp) return accountFailure("TOTP_ALREADY_ENABLED");
        const pending = state.pending;
        if (pending === null || pending.expired)
          return accountFailure("ENROLLMENT_EXPIRED");
        // Only the enrolling person has seen this secret, so a mistyped code is not counted.
        const step = await checkCode(pending, accountId, command.code, null);
        if (step === null) return accountFailure("INVALID_CODE");
        return withCodes("TOTP_ENABLED", (recoveryCodeDigests) => ({
          kind: "CONFIRM_TOTP",
          pendingCiphertext: pending.ciphertext,
          step,
          batchId: randomUUID(),
          recoveryCodeDigests,
        }));
      }
      case "DISABLE_TOTP":
      case "REGENERATE_RECOVERY_CODES": {
        const totp = state.totp;
        if (totp === null) return accountFailure("TOTP_NOT_ENABLED");
        const denied = await passwordDenied(command.currentPassword);
        if (denied) return denied;
        const step = await checkCode(
          totp,
          accountId,
          command.code,
          totp.lastStep,
        );
        if (step === null) return counted("INVALID_CODE");
        const verified = {
          previousPasswordHash: state.passwordHash,
          ciphertext: totp.ciphertext,
          step,
        };
        if (command.action === "DISABLE_TOTP")
          return withAccount(
            "TOTP_DISABLED",
            await update({ kind: "DISABLE_TOTP", ...verified }),
          );
        return withCodes("RECOVERY_CODES", (recoveryCodeDigests) => ({
          kind: "REGENERATE_RECOVERY_CODES",
          ...verified,
          batchId: randomUUID(),
          recoveryCodeDigests,
        }));
      }
    }
  }
}
