import type { AdminLocalAccessFailure } from "@fan-support/contracts";

// ADR-021 sign-in: which message a failure shows, and the checks made before a request is sent.
export type SignInFactor = "TOTP" | "RECOVERY_CODE";
export type SignInMessage =
  | "invalidCredentials"
  | "locked"
  | "invalidCode"
  | "invalidRecovery"
  | "restart"
  | "unavailable"
  | "mismatch"
  | "tooShort"
  | "tooLong"
  | "sameAsLogin"
  | "sameAsCurrent"
  | "codeFormat";

const PROBLEMS = {
  TOO_SHORT: "tooShort",
  TOO_LONG: "tooLong",
  SAME_AS_LOGIN: "sameAsLogin",
  SAME_AS_CURRENT: "sameAsCurrent",
} as const;

/** `restart` means the stored challenge is gone and the person begins again with the password. */
export function failureMessage(
  failure: AdminLocalAccessFailure,
  factor: SignInFactor,
): Readonly<{ message: SignInMessage; restart: boolean }> {
  switch (failure.code) {
    case "INVALID_CREDENTIALS":
      return { message: "invalidCredentials", restart: false };
    case "ACCOUNT_LOCKED":
      return { message: "locked", restart: true };
    case "LOGIN_RESTART_REQUIRED":
      return { message: "restart", restart: true };
    case "INVALID_CODE":
      return {
        message: factor === "TOTP" ? "invalidCode" : "invalidRecovery",
        restart: false,
      };
    case "PASSWORD_REJECTED":
      return {
        message: PROBLEMS[failure.passwordProblem ?? "TOO_SHORT"],
        restart: false,
      };
    default:
      return { message: "unavailable", restart: false };
  }
}

export function codeFromInput(
  factor: SignInFactor,
  input: string,
): string | null {
  if (factor === "TOTP") {
    const digits = input.replace(/\s/gu, "");
    return /^\d{6}$/u.test(digits) ? digits : null;
  }
  const code = input.trim().toUpperCase();
  return code.replace(/[\s-]/gu, "").length === 12 ? code : null;
}

/** Mirrors the server policy (length in characters, not bytes) and adds the confirmation. */
export function newPasswordProblem(
  password: string,
  confirmation: string,
  loginName: string,
): SignInMessage | null {
  const length = [...password.normalize("NFC")].length;
  if (length < 12) return "tooShort";
  if (length > 128) return "tooLong";
  if (password.trim().toLowerCase() === loginName.trim().toLowerCase())
    return "sameAsLogin";
  if (password !== confirmation) return "mismatch";
  return null;
}
