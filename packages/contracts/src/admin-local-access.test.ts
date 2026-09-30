import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  ADMIN_STAFF_ROLE_KEYS,
  adminStandardRolePermissions,
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
  // ADR-022 keys come after 0052; each is registered by the migration of its own item.
  expect(new Set([...seeded, ...ADR_022_KEYS])).toEqual(
    new Set(adminPermissionKeySchema.options),
  );
  expect(seeded.filter((key) => ADR_022_KEYS.includes(key!))).toEqual([]);
  expect(adminPermissionKeySchema.options).toContain("staff.manage");
});

const ADR_022_KEYS = [
  "idols.assign",
  "idols.private",
  "management.assigned",
  "ledger.read",
  "ledger.assigned",
  "ledger.messages",
];

test("migration 0057 registers the two keys its guards name", () => {
  const sql = readFileSync(
    new URL(
      "../../../database/migrations/0057_idol-assignments.up.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const registered = sql.slice(0, sql.indexOf("CREATE TABLE"));
  for (const key of ["idols.assign", "management.assigned"])
    expect(registered).toContain(`'${key}'`);
  for (const key of [
    "idols.private",
    "ledger.read",
    "ledger.assigned",
    "ledger.messages",
  ])
    expect(sql).not.toContain(key);
});

test("migration 0059 registers exactly the three ledger keys and tolerates rows sync-roles already made", () => {
  const sql = readFileSync(
    new URL(
      "../../../database/migrations/0059_artist-ledger.up.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const registered = sql.slice(0, sql.indexOf("CREATE INDEX"));
  const keys = [...registered.matchAll(/'([a-z]+\.[a-z.]+)'/gu)].map(
    (match) => match[1],
  );
  expect(keys).toEqual(["ledger.read", "ledger.assigned", "ledger.messages"]);
  expect(registered).toContain("ON CONFLICT(permission_key) DO NOTHING");
  expect(sql).not.toContain("idols.private");
});

test("there are three standard roles and the broker holds only its own scope", () => {
  expect(ADMIN_STAFF_ROLE_KEYS).toEqual([
    "studio:owner",
    "studio:operator",
    "studio:broker",
  ]);
  const catalog = adminPermissionKeySchema.options;
  const [owner, operator, broker] = ADMIN_STAFF_ROLE_KEYS.map(
    (role) => new Set(adminStandardRolePermissions(role)),
  ) as [Set<string>, Set<string>, Set<string>];
  const scoped = ["management.assigned", "ledger.assigned", "ledger.messages"];
  // The administrator holds everything except the keys that narrow an account to its own artists.
  expect([...owner].sort()).toEqual(
    catalog.filter((key) => !scoped.includes(key)).sort(),
  );
  for (const key of [
    "idols.assign",
    "idols.private",
    "staff.manage",
    "finance.manage",
    "orders.manage",
    "payments.configure",
    "payments.review",
    "payments.publish",
    "exceptions.replay",
    ...scoped,
  ])
    expect(operator.has(key), key).toBe(false);
  for (const key of ["management.direct", "ledger.read", "orders.read"])
    expect(operator.has(key), key).toBe(true);
  // Photos of their own artists need the media pipeline; nothing else is granted.
  expect([...broker].sort()).toEqual(
    [
      "content.media.process",
      "content.media.read",
      "content.media.rights",
      "content.media.upload",
      "ledger.assigned",
      "ledger.messages",
      "management.assigned",
    ].sort(),
  );
  for (const role of ADMIN_STAFF_ROLE_KEYS)
    for (const key of adminStandardRolePermissions(role))
      expect(catalog).toContain(key);
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
