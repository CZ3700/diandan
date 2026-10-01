import {
  ADMIN_STAFF_ROLE_KEYS,
  type SupportedLocale,
} from "@fan-support/contracts";
import { AdminClientError } from "../workspace/client";
import { staffCopy } from "./copy";
import type { StaffRole } from "./api";

// ADR-021 staff accounts: role names people understand, input checks, and failure messages.
export const [OWNER_ROLE, OPERATOR_ROLE, BROKER_ROLE] = ADMIN_STAFF_ROLE_KEYS;

export function roleLabel(
  role: Pick<StaffRole, "roleKey" | "description">,
  locale: SupportedLocale,
): Readonly<{ name: string; detail: string }> {
  const copy = staffCopy(locale);
  if (role.roleKey === OWNER_ROLE)
    return { name: copy.roleOwner, detail: copy.roleOwnerDetail };
  if (role.roleKey === OPERATOR_ROLE)
    return { name: copy.roleOperator, detail: copy.roleOperatorDetail };
  if (role.roleKey === BROKER_ROLE)
    return { name: copy.roleBroker, detail: copy.roleBrokerDetail };
  return { name: role.roleKey, detail: role.description };
}

/** The login-name rule of the database, applied after the same lowercasing. */
export function loginNameFromInput(input: string): string | null {
  const value = input.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,63}$/u.test(value) ? value : null;
}
export function displayNameFromInput(input: string): string | null {
  const value = input.trim();
  const length = [...value].length;
  return length >= 1 && length <= 80 && !/\p{Cc}/u.test(value) ? value : null;
}

export type StaffAction =
  | "CREATE"
  | "UPDATE_ROLES"
  | "RESET_PASSWORD"
  | "CLEAR_TOTP"
  | "SET_STATUS"
  | "DELETE";
export function staffFailure(
  error: unknown,
  locale: SupportedLocale,
  action: StaffAction,
): Readonly<{ message: string; reload: boolean }> {
  const copy = staffCopy(locale);
  const code = error instanceof AdminClientError ? error.code : "";
  switch (code) {
    case "LOGIN_NAME_TAKEN":
      return { message: copy.loginNameTaken, reload: false };
    case "UNKNOWN_ROLE":
      return { message: copy.unknownRole, reload: true };
    case "STALE_VERSION":
    case "NOT_FOUND":
      return { message: copy.stale, reload: true };
    case "SELF_LOCKOUT":
      return {
        message:
          action === "UPDATE_ROLES"
            ? copy.keepStaffManagement
            : copy.selfLockout,
        reload: false,
      };
    case "FORBIDDEN":
      return { message: copy.forbidden, reload: false };
    default:
      return { message: copy.failed, reload: false };
  }
}
