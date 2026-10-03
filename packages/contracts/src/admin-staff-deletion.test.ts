import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  adminStaffCommandSchema,
  adminStaffMemberSchema,
  adminStaffResponseSchema,
} from "./admin-local-access.js";
import {
  adminLocalStaffChangeSchema,
  adminLocalStaffResultSchema,
} from "./admin-local-access-persistence.js";

// L3-14: deleting a staff account; a deleted broker's artists go back to the studio.
const accountId = "00000000-0000-4000-8000-000000000001";
const member = {
  accountId,
  version: 3,
  loginName: "mina.park",
  displayName: "Mina Park",
  status: "ACTIVE",
  twoFactorEnabled: false,
  mustChangePassword: false,
  roleKeys: ["studio:broker"],
  lastLoginAt: null,
  self: false,
  assignedArtists: 2,
};

test("a deletion names the account, the version the page saw and the typed login name", () => {
  const command = {
    action: "DELETE",
    accountId,
    expectedVersion: 3,
    loginName: "mina.park",
  };
  expect(adminStaffCommandSchema.safeParse(command).success).toBe(true);
  expect(adminLocalStaffChangeSchema.safeParse(command).success).toBe(true);
  for (const bad of [
    { loginName: undefined },
    { loginName: "Mina Park" },
    { expectedVersion: 0 },
    { transferTo: accountId },
  ])
    expect(
      adminStaffCommandSchema.safeParse({ ...command, ...bad }).success,
    ).toBe(false);
});

test("members carry how many current artists a deletion would hand back", () => {
  expect(adminStaffMemberSchema.safeParse(member).success).toBe(true);
  const without: Record<string, unknown> = { ...member };
  delete without["assignedArtists"];
  expect(adminStaffMemberSchema.safeParse(without).success).toBe(false);
  expect(
    adminStaffMemberSchema.safeParse({ ...member, assignedArtists: -1 })
      .success,
  ).toBe(false);
});

test("a deletion answers with the account and the artists handed back, never a member", () => {
  const deleted = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STAFF_DELETED",
    accountId,
    transferredArtists: 4,
  };
  expect(adminStaffResponseSchema.safeParse(deleted).success).toBe(true);
  expect(adminLocalStaffResultSchema.safeParse(deleted).success).toBe(true);
  expect(
    adminStaffResponseSchema.safeParse({ ...deleted, member }).success,
  ).toBe(false);
  expect(
    adminStaffResponseSchema.safeParse({
      ...deleted,
      kind: "STAFF_UPDATED",
    }).success,
  ).toBe(false);
});

test("migration 0063 adds the deletion reason and keeps deleted identities deleted", () => {
  const up = readFileSync(
    new URL(
      "../../../database/migrations/0063_staff-account-deletion.up.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(up).toContain("'ACCOUNT_DELETED'");
  expect(up).toContain("a deleted admin identity stays deleted");
  expect(up).toContain("a deleted admin identity holds no role");
  expect(up).not.toMatch(/INSERT INTO\s+(public\.)?permissions/iu);
});
