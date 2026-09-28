import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  adminLocalStepRequestSchema,
  adminLoginNameSchema,
  adminPermissionKeySchema,
  adminRecoveryCodeSchema,
  adminStaffCommandSchema,
  adminTemporaryPasswordSchema,
} from "./admin-local-access.js";

test("the permission catalog is exactly what migration 0052 seeds", () => {
  const sql = readFileSync(
    new URL(
      "../../../database/migrations/0052_admin-local-accounts.up.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const catalog = sql.slice(0, sql.indexOf("INSERT INTO roles"));
  const seeded = [...catalog.matchAll(/'([a-z][a-z0-9.:-]+)'/gu)]
    .map((match) => match[1])
    .filter((key) => key !== "Platform permission");
  expect(new Set(seeded)).toEqual(new Set(adminPermissionKeySchema.options));
  expect(adminPermissionKeySchema.options).toContain("staff.manage");
});

test("login names are lowercase handles and codes use the unambiguous alphabet", () => {
  expect(adminLoginNameSchema.safeParse("studio.owner").success).toBe(true);
  expect(adminLoginNameSchema.safeParse("Studio").success).toBe(false);
  expect(adminLoginNameSchema.safeParse("ab").success).toBe(false);
  expect(adminRecoveryCodeSchema.safeParse("ABCD-EFGH-JKLM").success).toBe(
    true,
  );
  expect(adminRecoveryCodeSchema.safeParse("ABCD-EFGH-IJKL").success).toBe(
    false,
  );
  expect(
    adminTemporaryPasswordSchema.safeParse("ABCD-EFGH-JKLM-NPQR").success,
  ).toBe(true);
});

test("sign-in steps and staff commands reject unknown or extra fields", () => {
  const base = {
    schemaVersion: 1,
    requestId: "00000000-0000-4000-8000-000000000001",
    challengeToken: "A".repeat(42) + "A",
  };
  expect(
    adminLocalStepRequestSchema.safeParse({
      ...base,
      step: { kind: "TOTP", code: "123456" },
    }).success,
  ).toBe(true);
  expect(
    adminLocalStepRequestSchema.safeParse({
      ...base,
      step: { kind: "TOTP", code: "12345" },
    }).success,
  ).toBe(false);
  expect(
    adminStaffCommandSchema.safeParse({
      action: "CREATE",
      loginName: "night.shift",
      displayName: "Night shift",
      roleKeys: ["studio:operator"],
    }).success,
  ).toBe(true);
  expect(
    adminStaffCommandSchema.safeParse({
      action: "CREATE",
      loginName: "night.shift",
      displayName: "Night shift",
      roleKeys: [],
    }).success,
  ).toBe(false);
});
