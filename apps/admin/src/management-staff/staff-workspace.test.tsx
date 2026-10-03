import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { StaffWorkspace } from "./staff-workspace";
import { staffCopy } from "./copy";
import { createStaffApi, type StaffMember, type StaffRole } from "./api";
import {
  displayNameFromInput,
  loginNameFromInput,
  roleLabel,
  staffFailure,
} from "./model";
import { AdminClientError } from "../workspace/client";

const member = (patch: Partial<StaffMember>): StaffMember => ({
  accountId: "10000000-0000-4000-8000-000000000001",
  version: 3,
  loginName: "studio.owner",
  displayName: "Studio Owner",
  status: "ACTIVE",
  twoFactorEnabled: true,
  mustChangePassword: false,
  roleKeys: ["studio:owner"],
  lastLoginAt: "2026-09-29T12:00:00.000000Z",
  self: true,
  assignedArtists: 0,
  ...patch,
});
const members = [
  member({}),
  member({
    accountId: "10000000-0000-4000-8000-000000000002",
    loginName: "night.shift",
    displayName: "Night shift",
    roleKeys: ["studio:operator"],
    twoFactorEnabled: false,
    mustChangePassword: true,
    lastLoginAt: null,
    self: false,
    assignedArtists: 2,
  }),
  member({
    accountId: "10000000-0000-4000-8000-000000000003",
    loginName: "day.shift",
    displayName: "Day shift",
    roleKeys: ["studio:operator"],
    status: "SUSPENDED",
    self: false,
  }),
];
const roles: StaffRole[] = [
  {
    roleKey: "studio:operator",
    description: "Daily operations",
    permissions: ["content.read"],
  },
  {
    roleKey: "studio:owner",
    description: "Studio administrator",
    permissions: ["staff.manage"],
  },
];
const api = createStaffApi({ call: vi.fn(), clear: vi.fn() } as never);
const render = (
  locale: (typeof SUPPORTED_LOCALES)[number],
  panel?: Parameters<typeof StaffWorkspace>[0]["initial"] extends infer I
    ? I extends { panel?: infer P }
      ? P
      : never
    : never,
) =>
  renderToStaticMarkup(
    <StaffWorkspace
      api={api}
      locale={locale}
      initial={{ listing: { members, roles }, ...(panel ? { panel } : {}) }}
    />,
  );
/** The markup of one person's row: from its marker to the next row's. */
function row(html: string, loginName: string): string {
  const from = html.indexOf(`data-staff-member="${loginName}"`);
  const next = html.indexOf("data-staff-member=", from + 1);
  return html.slice(from, next < 0 ? undefined : next);
}

test("every language has the full staff vocabulary", () => {
  const keys = Object.keys(staffCopy("en")).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const copy = staffCopy(locale);
    expect(Object.keys(copy).sort()).toEqual(keys);
    expect(Object.values(copy).every((value) => value.trim().length > 0)).toBe(
      true,
    );
    for (const key of [
      "temporaryTitle",
      "confirmReset",
      "confirmClear",
      "confirmSuspend",
      "confirmDelete",
      "deleteTypeName",
      "deleted",
      "deletedArtists",
    ] as const)
      expect(copy[key]).toContain("{account}");
    expect(copy.confirmDeleteArtists).toContain("{count}");
    expect(copy.deletedArtists).toContain("{count}");
    expect(copy.lastSignIn).toContain("{date}");
  }
});

test.each(SUPPORTED_LOCALES)(
  "%s lists each person with status, verification, roles and only the actions allowed",
  (locale) => {
    const copy = staffCopy(locale);
    const html = render(locale);
    expect(html).toContain(copy.title);
    expect(html).toContain(copy.create);
    const self = row(html, "studio.owner");
    expect(self).toContain(copy.you);
    expect(self).toContain(copy.changeRoles);
    for (const blocked of [
      copy.resetPassword,
      copy.suspend,
      copy.clearTwoFactor,
      copy.deleteAccount,
    ])
      expect(self).not.toContain(`>${blocked}<`);
    const night = row(html, "night.shift");
    expect(night).toContain(copy.mustChange);
    expect(night).toContain(copy.never);
    expect(night).toContain(`>${copy.resetPassword}<`);
    expect(night).toContain(`>${copy.suspend}<`);
    expect(night).not.toContain(`>${copy.clearTwoFactor}<`);
    expect(night).toContain(`>${copy.deleteAccount}<`);
    expect(night).toContain(roleLabel(roles[0]!, locale).name);
    const day = row(html, "day.shift");
    expect(day).toContain('data-status="SUSPENDED"');
    expect(day).toContain(`>${copy.reactivate}<`);
    expect(day).toContain(`>${copy.clearTwoFactor}<`);
  },
);

test("creating asks for a login name, a display name and roles, defaulting to daily operations", () => {
  const copy = staffCopy("zh-CN");
  const html = render("zh-CN", { kind: "CREATE" });
  expect(html).toContain(copy.loginNameHint);
  expect(html).toContain('id="staff-login-name"');
  expect(html).toContain('id="staff-display-name"');
  expect(html).toContain(copy.roleOwnerDetail);
  expect(html).toMatch(/id="staff-role-studio-operator"[^>]*checked=""/u);
  expect(html).not.toMatch(/id="staff-role-studio-owner"[^>]*checked=""/u);
});

test("a temporary password is shown with copy and done, and confirmations name the account", () => {
  const copy = staffCopy("ja");
  const html = render("ja", {
    kind: "TEMPORARY",
    loginName: "night.shift",
    password: "ABCD-EFGH-JKMN-PQRS",
  });
  expect(html).toContain(
    copy.temporaryTitle.replace("{account}", "night.shift"),
  );
  expect(html).toContain('data-temporary-password="true">ABCD-EFGH-JKMN-PQRS<');
  expect(html).toContain(copy.copy);
  expect(html).toContain(copy.done);
  const confirm = render("ja", {
    kind: "CONFIRM",
    accountId: members[1]!.accountId,
    action: "SUSPEND",
  });
  expect(confirm).toContain(
    copy.confirmSuspend.replace("{account}", "night.shift"),
  );
  expect(confirm).toContain("fs-button--danger");
});

test("deleting asks for the typed login name and says what happens to the artists", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = staffCopy(locale);
    const html = row(
      render(locale, { kind: "DELETE", accountId: members[1]!.accountId }),
      "night.shift",
    );
    expect(html).toContain(
      copy.confirmDelete.replace("{account}", "night.shift"),
    );
    expect(html).toContain(copy.confirmDeleteArtists.replace("{count}", "2"));
    expect(html).toContain(
      copy.deleteTypeName.replace("{account}", "night.shift"),
    );
    expect(html).toMatch(/<button[^>]*data-staff-delete-confirm[^>]*disabled/u);
    expect(html).toContain("fs-button--danger");
  }
  const quiet = row(
    render("en", { kind: "DELETE", accountId: members[2]!.accountId }),
    "day.shift",
  );
  expect(quiet).not.toContain("data-staff-delete-artists");
});

test("input checks follow the database rules and failures read plainly", () => {
  expect(loginNameFromInput("  Night.Shift ")).toBe("night.shift");
  expect(loginNameFromInput("ab")).toBe(null);
  expect(loginNameFromInput("-night")).toBe(null);
  expect(displayNameFromInput("  夜班  ")).toBe("夜班");
  expect(displayNameFromInput("x".repeat(81))).toBe(null);
  const copy = staffCopy("en");
  expect(
    staffFailure(new AdminClientError("SELF_LOCKOUT"), "en", "UPDATE_ROLES"),
  ).toEqual({ message: copy.keepStaffManagement, reload: false });
  expect(
    staffFailure(new AdminClientError("SELF_LOCKOUT"), "en", "RESET_PASSWORD")
      .message,
  ).toBe(copy.selfLockout);
  expect(
    staffFailure(new AdminClientError("STALE_VERSION"), "en", "SET_STATUS"),
  ).toEqual({ message: copy.stale, reload: true });
  expect(staffFailure(new TypeError("x"), "en", "CREATE").message).toBe(
    copy.failed,
  );
  expect(
    roleLabel({ roleKey: "local:manager", description: "Local" }, "en"),
  ).toEqual({
    name: "local:manager",
    detail: "Local",
  });
});

test("availability is false without the permission or without built-in accounts", async () => {
  for (const code of ["FORBIDDEN", "NOT_FOUND"]) {
    const client = createStaffApi({
      call: vi.fn(async () => {
        throw new AdminClientError(code);
      }),
      clear: vi.fn(),
    } as never);
    expect(await client.available()).toBe(false);
  }
  const call = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STAFF_UPDATED",
    member: members[1],
  }));
  const client = createStaffApi({ call, clear: vi.fn() } as never);
  await client.setStatus(members[1]!, "SUSPENDED");
  expect(call).toHaveBeenCalledWith(
    "staff-set-status",
    {
      accountId: members[1]!.accountId,
      expectedVersion: 3,
      status: "SUSPENDED",
    },
    expect.anything(),
  );
});

test.each(SUPPORTED_LOCALES)(
  "%s names the broker role in its own words and says what it is limited to",
  (locale) => {
    const copy = staffCopy(locale);
    const broker = {
      roleKey: "studio:broker",
      description: "Broker",
      permissions: ["management.assigned"],
    };
    expect(roleLabel(broker, locale)).toEqual({
      name: copy.roleBroker,
      detail: copy.roleBrokerDetail,
    });
    expect(copy.roleBroker).not.toBe(copy.roleOperator);
    const html = renderToStaticMarkup(
      <StaffWorkspace
        api={api}
        locale={locale}
        initial={{
          listing: {
            members: [
              ...members,
              member({
                accountId: "10000000-0000-4000-8000-000000000004",
                loginName: "mina.park",
                displayName: "Mina Park",
                roleKeys: ["studio:broker"],
                self: false,
              }),
            ],
            roles: [...roles, broker],
          },
        }}
      />,
    );
    expect(row(html, "mina.park")).toContain(copy.roleBroker);
    expect(row(html, "mina.park")).not.toContain("studio:broker");
  },
);
