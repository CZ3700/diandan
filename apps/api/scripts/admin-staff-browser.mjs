#!/usr/bin/env node
// L3-10 ⑥: the staff accounts page in a real browser.
import { randomBytes } from "node:crypto";
import { decodeBase32 } from "@fan-support/application";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  freshCode,
  runLocalAccountBrowserAcceptance,
} from "./admin-local-browser-harness.mjs";

await runLocalAccountBrowserAcceptance("staff-browser", async (t) => {
  const {
    check,
    secret,
    stage,
    api,
    as,
    signIn,
    open,
    audit,
    fitsWidth,
    shot,
  } = t;
  const owner = await signIn("studio.owner", t.ownerPassword);
  async function createStaff(loginName) {
    const created = (
      await api(
        "staff/create",
        { loginName, displayName: loginName, roleKeys: ["studio:operator"] },
        as(owner),
      )
    ).data;
    check(created.kind === "STAFF_CREATED", `${loginName} created`);
    return {
      member: created.member,
      temporary: secret(created.temporaryPassword),
    };
  }
  /** Signs a staff member in for the first time and returns their session. */
  async function firstSession(loginName, temporary) {
    const password = secret(
      `${loginName} ${randomBytes(9).toString("base64url")}`,
    );
    const started = await signIn(loginName, temporary);
    const done = await t.access("step", {
      challengeToken: started.challengeToken,
      step: { kind: "NEW_PASSWORD", newPassword: password },
    });
    secret(done.sessionToken);
    secret(done.csrfToken);
    return { session: done, password };
  }
  stage("seed");
  const night = await createStaff("night.shift");
  const day = await createStaff("day.shift");
  const listed = (await api("staff/list", {}, as(owner))).data;
  const dayMember = listed.members.find((m) => m.loginName === "day.shift");
  await api(
    "staff/set-status",
    {
      accountId: dayMember.accountId,
      expectedVersion: dayMember.version,
      status: "SUSPENDED",
    },
    as(owner),
  );
  check(
    day.member.mustChangePassword,
    "new staff must change the temporary password",
  );
  async function openStaff(locale, viewport, session = owner) {
    const opened = await open(locale, viewport, { session });
    await opened.page
      .locator('[data-management-section="STAFF"]')
      .click({ timeout: 180_000 });
    await opened.page.locator(".staff-list").waitFor();
    return opened;
  }
  const rowOf = (page, loginName) =>
    page.locator(`[data-staff-member="${loginName}"]`);

  stage("seven languages on phone and desktop");
  for (const viewport of ["phone", "desktop"])
    for (const locale of SUPPORTED_LOCALES) {
      const { context, page, errors } = await openStaff(locale, viewport);
      check(
        (await page.locator(".staff-row").count()) === 3,
        `${locale} ${viewport}: three people`,
      );
      check(
        await fitsWidth(page),
        `${locale} ${viewport}: no horizontal overflow`,
      );
      await audit(page, `${locale} ${viewport}`);
      await shot(page, `staff-${viewport}-${locale}`);
      check(errors.length === 0, `${locale} ${viewport}: no page errors`);
      await context.close();
    }

  stage("create and copy a temporary password (en, desktop)");
  let evening;
  {
    const { context, page } = await openStaff("en", "desktop");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "New staff account" }).click();
    check(
      await page.evaluate(
        () => globalThis.document.activeElement?.id === "staff-login-name",
      ),
      "the login name takes focus",
    );
    await page.locator("#staff-login-name").fill("ab");
    await page.locator("#staff-display-name").fill("Evening shift");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.locator(".staff-notice--error").waitFor();
    await page.locator("#staff-login-name").fill("Night.Shift");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText("That login name is already in use.").waitFor();
    await page.locator("#staff-login-name").fill("Evening.Shift");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.locator("[data-temporary-password]").waitFor();
    const temporary = secret(
      (await page.locator("[data-temporary-password]").innerText()).trim(),
    );
    check(
      /^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/u.test(temporary),
      "a grouped temporary password",
    );
    check(
      await page.evaluate(
        () => globalThis.document.activeElement?.id === "staff-temporary",
      ),
      "focus moves to the password",
    );
    await page.getByRole("button", { name: "Copy" }).click();
    await page.getByRole("button", { name: "Copied" }).waitFor();
    check(
      (await page.evaluate(() => globalThis.navigator.clipboard.readText())) ===
        temporary,
      "copy puts it on the clipboard",
    );
    await shot(page, "temporary-desktop-en");
    await page.getByRole("button", { name: "Done" }).click();
    check(
      (await page.locator("[data-temporary-password]").count()) === 0,
      "shown only once",
    );
    check(
      await rowOf(page, "evening.shift").isVisible(),
      "the new person is listed",
    );
    const first = await signIn("evening.shift", temporary);
    check(
      first.kind === "STEP_REQUIRED" && first.step === "NEW_PASSWORD",
      "the temporary password leads to choosing a new one",
    );
    evening = await firstSession("evening.shift", temporary);
    await context.close();
  }

  stage("reset a password (zh-CN, desktop)");
  {
    const nightSession = await firstSession("night.shift", night.temporary);
    const { context, page } = await openStaff("zh-CN", "desktop");
    const row = rowOf(page, "night.shift");
    await row.getByRole("button", { name: "重置密码" }).click();
    check(
      (await row.innerText()).includes("night.shift"),
      "the confirmation names the account",
    );
    await row.getByRole("button", { name: "确认" }).click();
    await page.locator("[data-temporary-password]").waitFor();
    const temporary = secret(
      (await page.locator("[data-temporary-password]").innerText()).trim(),
    );
    check(
      (await api("account/context", {}, as(nightSession.session))).status ===
        401,
      "their sessions were signed out",
    );
    check(
      (await signIn("night.shift", nightSession.password)).code ===
        "INVALID_CREDENTIALS",
      "the old password stops working",
    );
    night.temporary = temporary;
    await context.close();
  }

  stage("clear two-step verification (ja, phone)");
  {
    const totp = await createStaff("totp.shift");
    const { session, password } = await firstSession(
      "totp.shift",
      totp.temporary,
    );
    const begun = (
      await api(
        "account/totp-begin",
        { currentPassword: password },
        as(session),
      )
    ).data;
    const code = await freshCode(decodeBase32(secret(begun.secret)), -1);
    check(
      (await api("account/totp-confirm", { code: code.code }, as(session))).data
        .kind === "TOTP_ENABLED",
      "totp.shift has two-step verification",
    );
    const { context, page } = await openStaff("ja", "phone");
    const row = rowOf(page, "totp.shift");
    check(
      (await row.locator('[data-two-factor="on"]').count()) === 1,
      "shown as on",
    );
    await row.getByRole("button", { name: "2 段階認証を解除" }).click();
    await row.getByRole("button", { name: "確認" }).click();
    await row.locator('[data-two-factor="off"]').waitFor();
    check(
      (await api("account/context", {}, as(session))).status === 401,
      "their sessions were signed out",
    );
    check(await fitsWidth(page), "fits the phone");
    await shot(page, "cleared-phone-ja");
    await context.close();
  }

  stage("suspend and reactivate (th, phone)");
  {
    const { context, page } = await openStaff("th", "phone");
    const row = rowOf(page, "evening.shift");
    await row.getByRole("button", { name: "ระงับ" }).click();
    await shot(page, "confirm-suspend-phone-th");
    await row.getByRole("button", { name: "ยืนยัน" }).click();
    await row.locator('[data-status="SUSPENDED"]').waitFor();
    check(
      (await api("account/context", {}, as(evening.session))).status === 401,
      "suspension signs them out",
    );
    check(
      (await signIn("evening.shift", evening.password)).code ===
        "INVALID_CREDENTIALS",
      "and they cannot sign in",
    );
    await row.getByRole("button", { name: "เปิดใช้อีกครั้ง" }).click();
    await row.locator('[data-status="ACTIVE"]').waitFor();
    check(
      (await signIn("evening.shift", evening.password)).kind ===
        "SESSION_CREATED",
      "reactivated accounts sign in again",
    );
    await context.close();
  }

  stage("change roles (vi, desktop)");
  {
    const { context, page } = await openStaff("vi", "desktop");
    const self = rowOf(page, "studio.owner");
    check(
      (await self.getByRole("button", { name: "Tạm ngưng" }).count()) === 0 &&
        (await self
          .getByRole("button", { name: "Đặt lại mật khẩu" })
          .count()) === 0,
      "your own row offers no lockout actions",
    );
    await self.getByRole("button", { name: "Đổi vai trò" }).click();
    await self.getByLabel("Quản trị viên studio").uncheck();
    await self.getByLabel("Vận hành hằng ngày").check();
    await self.getByRole("button", { name: "Lưu vai trò" }).click();
    await page
      .getByText(
        "Tài khoản của bạn phải giữ ít nhất một vai trò quản lý nhân viên.",
      )
      .waitFor();
    await self.getByRole("button", { name: "Hủy" }).click();
    const row = rowOf(page, "evening.shift");
    await row.getByRole("button", { name: "Đổi vai trò" }).click();
    await row.getByLabel("Quản trị viên studio").check();
    await row.getByRole("button", { name: "Lưu vai trò" }).click();
    await page.locator(".staff-notice--done").waitFor();
    check(
      (await row.innerText()).includes("Quản trị viên studio"),
      "the new role is listed",
    );
    const promoted = await signIn("evening.shift", evening.password);
    check(
      (await api("staff/context", {}, as(promoted))).status === 200,
      "the new role takes effect",
    );
    await context.close();
  }

  stage("a change made elsewhere (es, desktop)");
  {
    const { context, page } = await openStaff("es", "desktop");
    const row = rowOf(page, "day.shift");
    await row.getByRole("button", { name: "Restablecer contraseña" }).click();
    const current = (await api("staff/list", {}, as(owner))).data.members.find(
      (m) => m.loginName === "day.shift",
    );
    await api(
      "staff/set-status",
      {
        accountId: current.accountId,
        expectedVersion: current.version,
        status: "ACTIVE",
      },
      as(owner),
    );
    await row.getByRole("button", { name: "Confirmar" }).click();
    await page
      .getByText(
        "Esta cuenta cambió en otra ventana. La lista ya muestra el estado actual.",
      )
      .waitFor();
    await row.locator('[data-status="ACTIVE"]').waitFor();
    check(true, "a stale action is refused and the list reloads");
    await context.close();
  }

  stage("daily operations see no staff page (pt, desktop)");
  {
    const operator = await firstSession("night.shift", night.temporary);
    const { context, page } = await open("pt", "desktop", {
      session: operator.session,
    });
    await page
      .locator('[data-management-section="ACCOUNT"]')
      .waitFor({ timeout: 180_000 });
    check(
      (await page.locator('[data-management-section="STAFF"]').count()) === 0,
      "no staff entry without staff.manage",
    );
    await context.close();
  }
});
