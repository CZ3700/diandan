import type { FastifyInstance } from "fastify";
import type { AdminLocalAccessUseCases } from "@fan-support/application";
import {
  adminAccountCommandSchema,
  adminAccountRequestSchema,
  adminAccountResponseSchema,
  adminStaffCommandSchema,
  adminStaffRequestSchema,
  adminStaffResponseSchema,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";

// L3-10 ③: the signed-in account's settings and staff accounts (ADR-021). One path, one command.
export type AdminAccountRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Pick<AdminLocalAccessUseCases, "account" | "staff">;
}>;

const ACCOUNT = [
  ["context", "READ", "ACCOUNT"],
  ["change-password", "CHANGE_PASSWORD", "PASSWORD_CHANGED"],
  ["totp-begin", "BEGIN_TOTP", "TOTP_ENROLLMENT"],
  ["totp-confirm", "CONFIRM_TOTP", "TOTP_ENABLED"],
  ["totp-disable", "DISABLE_TOTP", "TOTP_DISABLED"],
  ["recovery-codes", "REGENERATE_RECOVERY_CODES", "RECOVERY_CODES"],
] as const;
const STAFF = [
  ["context", "CONTEXT", "STAFF_CONTEXT"],
  ["list", "LIST", "STAFF"],
  ["create", "CREATE", "STAFF_CREATED"],
  ["update-roles", "UPDATE_ROLES", "STAFF_UPDATED"],
  ["reset-password", "RESET_PASSWORD", "PASSWORD_RESET"],
  ["clear-totp", "CLEAR_TOTP", "STAFF_UPDATED"],
  ["set-status", "SET_STATUS", "STAFF_UPDATED"],
] as const;
const RESERVED = [
  "action",
  "requestId",
  "sessionToken",
  "csrfToken",
  "schemaVersion",
];

function commandBody(body: unknown): Record<string, unknown> {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    RESERVED.some((name) => Object.hasOwn(body, name))
  )
    throw new TypeError("Invalid account body");
  return body as Record<string, unknown>;
}

export function registerAdminAccountRoutes(
  instance: FastifyInstance,
  options: AdminAccountRouteDependencies,
): void {
  for (const [path, action, kind] of ACCOUNT)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/account/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 4096,
      parseRequest: (body, envelope) =>
        adminAccountRequestSchema.parse({
          ...envelope,
          command: adminAccountCommandSchema.parse({
            ...commandBody(body),
            action,
          }),
        }),
      execute: (input) => options.useCases.account(input),
      parseResponse(input) {
        const response = adminAccountResponseSchema.parse(input);
        if (
          response.outcome === "SUCCESS" &&
          response.kind !== kind &&
          response.kind !== "NOT_LOCAL"
        )
          throw new TypeError("Mismatched account response");
        return response;
      },
    });
  for (const [path, action, kind] of STAFF)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/staff/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 4096,
      parseRequest: (body, envelope) =>
        adminStaffRequestSchema.parse({
          ...envelope,
          command: adminStaffCommandSchema.parse({
            ...commandBody(body),
            action,
          }),
        }),
      execute: (input) => options.useCases.staff(input),
      parseResponse(input) {
        const response = adminStaffResponseSchema.parse(input);
        if (response.outcome === "SUCCESS" && response.kind !== kind)
          throw new TypeError("Mismatched staff response");
        return response;
      },
    });
}
