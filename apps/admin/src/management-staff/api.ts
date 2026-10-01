import {
  adminStaffResponseSchema,
  type AdminStaffMember,
  type AdminStaffResponse,
  type AdminStaffRole,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";

// ADR-021: staff accounts for holders of staff.manage. The API re-authorizes every command.
export type StaffMember = AdminStaffMember;
export type StaffRole = AdminStaffRole;
type Success = Extract<AdminStaffResponse, { outcome: "SUCCESS" }>;
type Listing = Extract<Success, { kind: "STAFF" }>;
type WithMember = Extract<Success, { member: StaffMember }>;
export type WithTemporaryPassword = Readonly<{
  member: StaffMember;
  temporaryPassword: string;
}>;

export function createStaffApi(client: AdminClient) {
  async function send(
    operation: string,
    body: Readonly<Record<string, unknown>>,
    kind: Success["kind"],
  ): Promise<Success> {
    const result = await client.call(operation, body, adminStaffResponseSchema);
    if (result.kind !== kind) throw new AdminClientError("INVALID_RESPONSE");
    return result;
  }
  const member = async (...args: Parameters<typeof send>) =>
    ((await send(...args)) as WithMember).member;
  const withPassword = async (
    ...args: Parameters<typeof send>
  ): Promise<WithTemporaryPassword> => {
    const result = (await send(...args)) as WithMember & {
      temporaryPassword: string;
    };
    return {
      member: result.member,
      temporaryPassword: result.temporaryPassword,
    };
  };
  const target = (value: StaffMember) => ({
    accountId: value.accountId,
    expectedVersion: value.version,
  });
  return {
    /** False without staff.manage, and when the API has no built-in accounts. */
    async available(): Promise<boolean> {
      try {
        await send("staff-context", {}, "STAFF_CONTEXT");
        return true;
      } catch (error) {
        if (
          error instanceof AdminClientError &&
          ["FORBIDDEN", "NOT_FOUND"].includes(error.code)
        )
          return false;
        throw error;
      }
    },
    async list(): Promise<
      Readonly<{
        members: readonly StaffMember[];
        roles: readonly StaffRole[];
      }>
    > {
      const result = (await send("staff-list", {}, "STAFF")) as Listing;
      return { members: result.members, roles: result.roles };
    },
    create: (
      input: Readonly<{
        loginName: string;
        displayName: string;
        roleKeys: readonly string[];
      }>,
    ) =>
      withPassword(
        "staff-create",
        { ...input, roleKeys: [...input.roleKeys] },
        "STAFF_CREATED",
      ),
    updateRoles: (value: StaffMember, roleKeys: readonly string[]) =>
      member(
        "staff-update-roles",
        { ...target(value), roleKeys: [...roleKeys] },
        "STAFF_UPDATED",
      ),
    resetPassword: (value: StaffMember) =>
      withPassword("staff-reset-password", target(value), "PASSWORD_RESET"),
    clearTwoFactor: (value: StaffMember) =>
      member("staff-clear-totp", target(value), "STAFF_UPDATED"),
    setStatus: (value: StaffMember, status: "ACTIVE" | "SUSPENDED") =>
      member("staff-set-status", { ...target(value), status }, "STAFF_UPDATED"),
    /** L3-14: permanent; resolves to the number of artists that went back to the studio. */
    async remove(value: StaffMember): Promise<number> {
      const result = (await send(
        "staff-delete",
        { ...target(value), loginName: value.loginName },
        "STAFF_DELETED",
      )) as Extract<Success, { kind: "STAFF_DELETED" }>;
      if (result.accountId !== value.accountId)
        throw new AdminClientError("INVALID_RESPONSE");
      return result.transferredArtists;
    },
  };
}
export type StaffApi = ReturnType<typeof createStaffApi>;
