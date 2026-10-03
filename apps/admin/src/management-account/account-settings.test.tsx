import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { AccountSettings, type TwoFactorMode } from "./account-settings";
import { accountCopy } from "./copy";
import { createAccountApi, type AccountView } from "./api";
import { accountFailure, groupedKey, recoveryCodesFile } from "./model";
import { qrModules } from "./qr-code";
import { AdminClientError } from "../workspace/client";
import { signInCopy } from "../management-center/local-sign-in-copy";
import { ManagementShell } from "../management-center/shell";

const view: AccountView = {
  loginName: "studio.owner",
  displayName: "Studio Owner",
  twoFactorEnabled: false,
  recoveryCodesRemaining: 0,
  passwordChangedAt: "2026-09-29T12:00:00.000000Z",
};
const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const enrollment = {
  schemaVersion: 1 as const,
  outcome: "SUCCESS" as const,
  kind: "TOTP_ENROLLMENT" as const,
  otpauthUri: `otpauth://totp/Studio%20Admin:studio.owner?secret=${secret}&issuer=Studio%20Admin&algorithm=SHA1&digits=6&period=30`,
  secret,
  expiresAt: "2026-09-29T12:10:00.000000Z",
};
const codes = Array.from(
  { length: 10 },
  (_, index) => `ABCD-EFGH-JK${String.fromCharCode(65 + index)}${index + 2}`,
);
const api = createAccountApi({ call: vi.fn(), clear: vi.fn() } as never);
function render(
  mode: TwoFactorMode,
  account: AccountView = view,
  locale: (typeof SUPPORTED_LOCALES)[number] = "en",
) {
  return renderToStaticMarkup(
    <AccountSettings
      api={api}
      locale={locale}
      account={account}
      onAccount={() => {}}
      onReload={() => {}}
      initial={{ mode, enrollment, codes }}
    />,
  );
}

test("every language has the full account vocabulary", () => {
  const keys = Object.keys(accountCopy("en")).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const copy = accountCopy(locale);
    expect(Object.keys(copy).sort()).toEqual(keys);
    expect(Object.values(copy).every((value) => value.trim().length > 0)).toBe(
      true,
    );
    expect(copy.loginName).toContain("{account}");
    expect(copy.remaining).toContain("{count}");
    expect(copy.setUpExpires).toContain("{time}");
  }
});

test.each(SUPPORTED_LOCALES)(
  "%s warns while two-step verification is off and offers to set it up",
  (locale) => {
    const copy = accountCopy(locale);
    const html = render("IDLE", view, locale);
    expect(html).toContain(copy.warningBanner);
    expect(html).toContain('data-two-factor="off"');
    expect(html).toContain(copy.setUp);
    expect(html).not.toContain(
      `<span class="fs-button__label">${copy.turnOff}</span>`,
    );
    expect(html.match(/autoComplete="new-password"/gu)).toHaveLength(2);
    expect(html).toContain('autoComplete="current-password"');
  },
);

test("with two-step verification on there is no warning, and codes left are counted", () => {
  const copy = accountCopy("zh-CN");
  const html = render(
    "IDLE",
    { ...view, twoFactorEnabled: true, recoveryCodesRemaining: 7 },
    "zh-CN",
  );
  expect(html).not.toContain(copy.warningBanner);
  expect(html).toContain('data-two-factor="on"');
  expect(html).toContain(copy.remaining.replace("{count}", "7"));
  expect(html).toContain(copy.newCodes);
  expect(html).toContain(copy.turnOff);
});

test("setup shows a QR drawn from the enrollment URI, the grouped key and a code field", () => {
  const copy = accountCopy("ja");
  const html = render("SCAN", view, "ja");
  expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="[^"]+"/u);
  expect(html).toContain(`aria-label="${copy.qrLabel}"`);
  expect(html).toContain(
    `data-qr-modules="${qrModules(enrollment.otpauthUri).length}"`,
  );
  expect(html).toContain(groupedKey(secret));
  expect(html).toContain('autoComplete="one-time-code"');
  expect(html).toContain(copy.turnOn);
  expect(html).not.toContain("<img");
});

test("new recovery codes are listed once with download and dismissal", () => {
  const copy = accountCopy("th");
  const html = render("CODES", { ...view, twoFactorEnabled: true }, "th");
  for (const code of codes) expect(html).toContain(`<li>${code}</li>`);
  expect(html).toContain(copy.download);
  expect(html).toContain(copy.saved);
});

test("changing recovery codes or turning off asks for the password and a code", () => {
  const copy = accountCopy("es");
  for (const [mode, intro, action] of [
    ["REGENERATE", copy.newCodesIntro, copy.getNewCodes],
    ["DISABLE", copy.turnOffIntro, copy.turnOff],
  ] as const) {
    const html = render(mode, { ...view, twoFactorEnabled: true }, "es");
    expect(html).toContain(intro);
    expect(html).toContain('id="account-2fa-password"');
    expect(html).toContain('id="account-2fa-code"');
    expect(html).toContain(action);
    expect(html).toContain(copy.cancel);
  }
  expect(render("DISABLE", { ...view, twoFactorEnabled: true })).toContain(
    "fs-button--danger",
  );
});

describe("failures and helpers", () => {
  test("each refusal reads as the page expects", () => {
    const en = accountCopy("en"),
      signIn = signInCopy("en");
    expect(
      accountFailure(new AdminClientError("INVALID_PASSWORD"), "en"),
    ).toEqual({
      message: en.invalidPassword,
      reload: false,
      restartSetup: false,
    });
    expect(
      accountFailure(
        new AdminClientError("PASSWORD_REJECTED", [], "SAME_AS_LOGIN"),
        "en",
      ).message,
    ).toBe(signIn.sameAsLogin);
    expect(
      accountFailure(new AdminClientError("ENROLLMENT_EXPIRED"), "en"),
    ).toMatchObject({
      message: en.setUpExpired,
      restartSetup: true,
    });
    expect(
      accountFailure(new AdminClientError("TOTP_NOT_ENABLED"), "en"),
    ).toMatchObject({
      reload: true,
    });
    expect(accountFailure(new TypeError("offline"), "en").message).toBe(
      signIn.unavailable,
    );
  });
  test("the key is grouped for typing and the codes file names the account", () => {
    expect(groupedKey(secret)).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
    const file = recoveryCodesFile(
      "en",
      "studio.owner",
      codes,
      new Date("2026-09-29T12:00:00Z"),
    );
    expect(file.split("\n")[0]).toContain("studio.owner");
    expect(file).toContain(codes.join("\n"));
  });
  test("the QR has the three finder patterns of a real symbol", () => {
    const modules = qrModules(enrollment.otpauthUri);
    const size = modules.length;
    expect(size % 4).toBe(1);
    const corners: readonly (readonly [number, number])[] = [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ];
    for (const [row, column] of corners) {
      for (let offset = 0; offset < 7; offset++) {
        expect(modules[row]![column + offset]).toBe(true);
        expect(modules[row + offset]![column]).toBe(true);
      }
      expect(modules[row + 1]![column + 1]).toBe(false);
      expect(modules[row + 3]![column + 3]).toBe(true);
    }
  });
  test("an identity-provider session has no settings; other kinds are refused", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "NOT_LOCAL",
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "TOTP_DISABLED",
        account: view,
      });
    const client = createAccountApi({ call, clear: vi.fn() } as never);
    expect(await client.context()).toBe(null);
    await expect(client.changePassword("old", "new one")).rejects.toMatchObject(
      {
        code: "INVALID_RESPONSE",
      },
    );
    expect(call.mock.calls[1]![0]).toBe("account-change-password");
    expect(call.mock.calls[1]![1]).toEqual({
      currentPassword: "old",
      newPassword: "new one",
    });
  });
});

test("the sidebar shows the settings entry with its warning under it", () => {
  const warning = accountCopy("vi").warningBadge;
  const html = renderToStaticMarkup(
    <ManagementShell
      locale="vi"
      section="ACCOUNT"
      onSection={() => {}}
      accountAvailable
      accountWarning={warning}
    >
      <div />
    </ManagementShell>,
  );
  expect(html).toMatch(
    /data-management-section="ACCOUNT"[^>]*aria-current="page"[^>]*aria-describedby="mc-account-warning"/u,
  );
  expect(html).toContain(
    `<span id="mc-account-warning" class="mc-nav-warning">${warning}</span>`,
  );
});
