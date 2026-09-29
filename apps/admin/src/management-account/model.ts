import type { SupportedLocale } from "@fan-support/contracts";
import { AdminClientError } from "../workspace/client";
import { signInCopy } from "../management-center/local-sign-in-copy";
import { accountCopy } from "./copy";

// ADR-021 account settings: one message per failure, and what the page does next.
export type AccountFailure = Readonly<{
  message: string;
  /** The settings changed elsewhere; reread them before showing anything else. */
  reload: boolean;
  /** An unfinished setup can no longer complete. */
  restartSetup: boolean;
}>;

const PROBLEMS = {
  TOO_SHORT: "tooShort",
  TOO_LONG: "tooLong",
  SAME_AS_LOGIN: "sameAsLogin",
  SAME_AS_CURRENT: "sameAsCurrent",
} as const;

export function accountFailure(
  error: unknown,
  locale: SupportedLocale,
): AccountFailure {
  const copy = accountCopy(locale),
    signIn = signInCopy(locale);
  const plain = (message: string) => ({
    message,
    reload: false,
    restartSetup: false,
  });
  const code = error instanceof AdminClientError ? error.code : "";
  switch (code) {
    case "INVALID_PASSWORD":
      return plain(copy.invalidPassword);
    case "ACCOUNT_LOCKED":
      return plain(signIn.locked);
    case "INVALID_CODE":
      return plain(signIn.invalidCode);
    case "PASSWORD_REJECTED": {
      const problem = (error as AdminClientError).passwordProblem;
      return plain(
        signIn[
          PROBLEMS[
            problem !== undefined && problem in PROBLEMS
              ? (problem as keyof typeof PROBLEMS)
              : "TOO_SHORT"
          ]
        ],
      );
    }
    case "ENROLLMENT_EXPIRED":
      return { message: copy.setUpExpired, reload: false, restartSetup: true };
    case "TOTP_ALREADY_ENABLED":
    case "TOTP_NOT_ENABLED":
      return {
        message: copy.changedElsewhere,
        reload: true,
        restartSetup: true,
      };
    case "NOT_LOCAL":
      return plain(copy.notLocal);
    default:
      return plain(signIn.unavailable);
  }
}

/** The secret as authenticator apps accept it when typed: groups of four. */
export function groupedKey(secret: string): string {
  return secret.match(/.{1,4}/gu)?.join(" ") ?? secret;
}

export function recoveryCodesFile(
  locale: SupportedLocale,
  loginName: string,
  codes: readonly string[],
  now: Date,
): string {
  return [
    `${accountCopy(locale).recoveryTitle} (${loginName})`,
    now.toISOString(),
    "",
    ...codes,
    "",
  ].join("\n");
}
