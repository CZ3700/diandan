import {
  adminAccountResponseSchema,
  type AdminAccountResponse,
  type AdminAccountView,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";

// ADR-021: the signed-in built-in account. OIDC identities read NOT_LOCAL and never see this page.
export type AccountView = AdminAccountView;
type Success = Extract<AdminAccountResponse, { outcome: "SUCCESS" }>;
export type TotpEnrollment = Extract<Success, { kind: "TOTP_ENROLLMENT" }>;
type WithAccount = Extract<Success, { account: AccountView }>;
type WithCodes = Extract<Success, { recoveryCodes: readonly string[] }>;
export type AccountWithCodes = Readonly<{
  account: AccountView;
  recoveryCodes: readonly string[];
}>;

export function createAccountApi(client: AdminClient) {
  async function send(
    operation: string,
    body: Readonly<Record<string, unknown>>,
    kind: Success["kind"],
  ): Promise<Success> {
    const result = await client.call(
      operation,
      body,
      adminAccountResponseSchema,
    );
    if (result.kind === "NOT_LOCAL") throw new AdminClientError("NOT_LOCAL");
    if (result.kind !== kind) throw new AdminClientError("INVALID_RESPONSE");
    return result;
  }
  const account = async (...args: Parameters<typeof send>) =>
    ((await send(...args)) as WithAccount).account;
  const withCodes = async (
    ...args: Parameters<typeof send>
  ): Promise<AccountWithCodes> => {
    const result = (await send(...args)) as WithCodes;
    return { account: result.account, recoveryCodes: result.recoveryCodes };
  };
  return {
    /** Null for an identity-provider session; built-in accounts get their settings. */
    async context(): Promise<AccountView | null> {
      try {
        return await account("account-context", {}, "ACCOUNT");
      } catch (error) {
        if (error instanceof AdminClientError && error.code === "NOT_LOCAL")
          return null;
        throw error;
      }
    },
    changePassword: (currentPassword: string, newPassword: string) =>
      account(
        "account-change-password",
        { currentPassword, newPassword },
        "PASSWORD_CHANGED",
      ),
    async beginTotp(currentPassword: string): Promise<TotpEnrollment> {
      return (await send(
        "account-totp-begin",
        { currentPassword },
        "TOTP_ENROLLMENT",
      )) as TotpEnrollment;
    },
    confirmTotp: (code: string) =>
      withCodes("account-totp-confirm", { code }, "TOTP_ENABLED"),
    disableTotp: (currentPassword: string, code: string) =>
      account(
        "account-totp-disable",
        { currentPassword, code },
        "TOTP_DISABLED",
      ),
    regenerateRecoveryCodes: (currentPassword: string, code: string) =>
      withCodes(
        "account-recovery-codes",
        { currentPassword, code },
        "RECOVERY_CODES",
      ),
  };
}
export type AccountApi = ReturnType<typeof createAccountApi>;
