#!/usr/bin/env node
// L3-10 ④: the built-in sign-in page in a real browser.
import { randomBytes } from "node:crypto";
import { decodeBase32, totpCode } from "@fan-support/application";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  freshCode,
  runLocalAccountBrowserAcceptance,
} from "./admin-local-browser-harness.mjs";

await runLocalAccountBrowserAcceptance("browser", async (t) => {
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
  stage("seed accounts through the API");
  const owner = await signIn("studio.owner", t.ownerPassword);
  check(owner.kind === "SESSION_CREATED", "owner session for seeding");
  async function createStaff(loginName) {
    const created = (
      await api(
        "staff/create",
        { loginName, displayName: loginName, roleKeys: ["studio:operator"] },
        as(owner),
      )
    ).data;
    check(created.kind === "STAFF_CREATED", `${loginName} created`);
    return secret(created.temporaryPassword);
  }
  const nightTemporary = await createStaff("night.shift");
  const lockTemporary = await createStaff("lock.test");
  const totpTemporary = await createStaff("totp.user");
  const totpPassword = secret(`totp ${randomBytes(9).toString("base64url")}`);
  const totpLogin = await signIn("totp.user", totpTemporary);
  const totpSession = await t.access("step", {
    challengeToken: totpLogin.challengeToken,
    step: { kind: "NEW_PASSWORD", newPassword: totpPassword },
  });
  secret(totpSession.sessionToken);
  secret(totpSession.csrfToken);
  const enrollment = (
    await api(
      "account/totp-begin",
      { currentPassword: totpPassword },
      as(totpSession),
    )
  ).data;
  const key = decodeBase32(secret(enrollment.secret));
  const first = await freshCode(key, -1);
  const enabled = (
    await api("account/totp-confirm", { code: first.code }, as(totpSession))
  ).data;
  check(enabled.kind === "TOTP_ENABLED", "second factor for totp.user");
  const recoveryCodes = enabled.recoveryCodes.map(secret);
  const lastStep = first.step;
  const ready = (page) =>
    page
      .locator('[data-local-sign-in="PASSWORD"]')
      .waitFor({ timeout: 180_000 });
  const signedIn = (page) =>
    page.locator(".mc-account button").waitFor({ timeout: 120_000 });
  const alertText = async (page) =>
    (await page.locator("#si-message").innerText()).trim();

  stage("seven languages on phone and desktop");
  const titles = new Set();
  for (const viewport of ["phone", "desktop"])
    for (const locale of SUPPORTED_LOCALES) {
      const { context, page, errors } = await open(locale, viewport);
      await ready(page);
      check(
        (await page.getAttribute("html", "lang")) === locale,
        `${locale} ${viewport}: page language`,
      );
      const title = (await page.locator("h1").innerText()).trim();
      check(title.length > 0, `${locale} ${viewport}: heading`);
      titles.add(`${viewport}:${title}`);
      check(
        await fitsWidth(page),
        `${locale} ${viewport}: no horizontal overflow`,
      );
      check(
        await page.locator("#si-login-name").isVisible(),
        `${locale} ${viewport}: login name visible`,
      );
      check(
        (await page.locator("#si-password").getAttribute("type")) ===
          "password",
        `${locale} ${viewport}: password masked`,
      );
      await audit(page, `${locale} ${viewport}`);
      await shot(page, `password-${viewport}-${locale}`);
      check(errors.length === 0, `${locale} ${viewport}: no page errors`);
      await context.close();
    }
  check(titles.size === 14, "every language has its own heading");

  stage("keyboard sign-in and sign-out (zh-CN, phone, reduced motion)");
  {
    const { context, page } = await open("zh-CN", "phone", {
      reducedMotion: "reduce",
    });
    await ready(page);
    const focused = () =>
      page.evaluate(
        () =>
          globalThis.document.activeElement?.id ||
          globalThis.document.activeElement?.className ||
          globalThis.document.activeElement?.tagName,
      );
    check(
      (await focused()) === "si-login-name",
      "the cursor starts in the login name",
    );
    const order = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      order.push(await focused());
    }
    check(
      order[0] === "si-password" &&
        String(order[1]).includes("si-reveal") &&
        String(order[2]).includes("si-submit") &&
        order[3] === "SELECT",
      `tab order follows the form (${order.join(",")})`,
    );
    await page.locator("#si-login-name").focus();
    await page.keyboard.type("Studio.Owner");
    await page.keyboard.press("Tab");
    await page.keyboard.type("not the password");
    await page.keyboard.press("Enter");
    await page.locator("#si-message").waitFor();
    check(
      (await page.locator("#si-message").getAttribute("role")) === "alert",
      "failure announced",
    );
    check(
      (await page.locator("#si-password").getAttribute("aria-invalid")) ===
        "true",
      "fields marked invalid",
    );
    check(
      (
        await page.locator("#si-password").getAttribute("aria-describedby")
      )?.includes("si-message"),
      "fields point at the message",
    );
    await shot(page, "keyboard-error-phone-zh-CN");
    await page.locator("#si-password").fill(t.ownerPassword);
    await page.locator(".si-reveal").focus();
    await page.keyboard.press("Space");
    check(
      (await page.locator("#si-password").getAttribute("type")) === "text",
      "Space reveals the password",
    );
    check(
      (await page.locator(".si-reveal").getAttribute("aria-pressed")) ===
        "true",
      "toggle reports its state",
    );
    await page.keyboard.press("Space");
    check(
      (await page.locator("#si-password").getAttribute("type")) === "password",
      "and hides it again",
    );
    const transition = await page
      .locator(".si-submit")
      .evaluate((node) => globalThis.getComputedStyle(node).transitionDuration);
    check(
      transition.split(",").every((value) => Number.parseFloat(value) === 0),
      "no transitions with reduced motion",
    );
    await page.locator("#si-password").focus();
    await page.keyboard.press("Enter");
    await signedIn(page);
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === "__Host-fan-admin-session");
    check(
      session?.httpOnly && session.secure && session.sameSite === "Strict",
      "strict HttpOnly session cookie",
    );
    check(
      !cookies.some((c) => c.name === "__Host-fan-admin-local-login"),
      "no challenge left behind",
    );
    await shot(page, "signed-in-phone-zh-CN");
    await page.locator(".mc-account button").click();
    await ready(page);
    check(
      !(await context.cookies()).some(
        (c) => c.name === "__Host-fan-admin-session" && c.value,
      ),
      "signed out",
    );
    await context.close();
  }

  stage("authenticator code (ja, desktop)");
  {
    const { context, page } = await open("ja", "desktop");
    await ready(page);
    await page.locator("#si-login-name").fill("totp.user");
    await page.locator("#si-password").fill(totpPassword);
    await page.locator(".si-submit").click();
    await page.locator('[data-local-sign-in="SECOND_FACTOR"]').waitFor();
    check(
      await page.evaluate(
        () => globalThis.document.activeElement?.id === "si-code",
      ),
      "the code field takes focus",
    );
    check(
      (await page.locator("#si-code").getAttribute("autocomplete")) ===
        "one-time-code",
      "one-time-code autofill",
    );
    check(
      (await page.locator(".si-intro").innerText()).includes("totp.user"),
      "the account is named",
    );
    const challenge = (await context.cookies()).find(
      (c) => c.name === "__Host-fan-admin-local-login",
    );
    check(
      challenge?.httpOnly && challenge.sameSite === "Strict",
      "challenge only in a strict HttpOnly cookie",
    );
    const now = Math.floor(Date.now() / 30_000);
    await page.keyboard.type(
      ["000000", "111111", "222222", "333333"].find(
        (code) => ![-1, 0, 1].some((d) => totpCode(key, now + d) === code),
      ),
    );
    await page.keyboard.press("Enter");
    await page.locator("#si-message").waitFor();
    await shot(page, "code-error-desktop-ja");
    const fresh = await freshCode(key, lastStep);
    await page.locator("#si-code").fill(fresh.code);
    await page.keyboard.press("Enter");
    await signedIn(page);
    await context.close();
  }

  stage("recovery code (vi, phone)");
  {
    const { context, page } = await open("vi", "phone");
    await ready(page);
    await page.locator("#si-login-name").fill("totp.user");
    await page.locator("#si-password").fill(totpPassword);
    await page.keyboard.press("Enter");
    await page.locator('[data-local-sign-in="SECOND_FACTOR"]').waitFor();
    await page.locator(".si-switch").first().click();
    check(
      (await page.locator("#si-code").getAttribute("autocapitalize")) ===
        "characters",
      "recovery field for letters",
    );
    check(
      await page.evaluate(
        () => globalThis.document.activeElement?.id === "si-code",
      ),
      "focus follows the switch",
    );
    check(await fitsWidth(page), "recovery step fits the phone");
    await shot(page, "recovery-phone-vi");
    await page.keyboard.type(recoveryCodes[0].toLowerCase());
    await page.keyboard.press("Enter");
    await signedIn(page);
    await context.close();
  }

  stage("temporary password (th, phone)");
  {
    const { context, page } = await open("th", "phone");
    await ready(page);
    await page.locator("#si-login-name").fill("night.shift");
    await page.locator("#si-password").fill(nightTemporary);
    await page.keyboard.press("Enter");
    await page.locator('[data-local-sign-in="NEW_PASSWORD"]').waitFor();
    check(
      await page.evaluate(
        () => globalThis.document.activeElement?.id === "si-new-password",
      ),
      "new password takes focus",
    );
    check(await fitsWidth(page), "new-password step fits the phone in Thai");
    await audit(page, "new password th phone");
    const nightPassword = secret(
      `night ${randomBytes(9).toString("base64url")}`,
    );
    let requests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/admin/local-auth/")) requests++;
    });
    await page.locator("#si-new-password").fill(nightPassword);
    await page.locator("#si-confirm-password").fill(`${nightPassword}x`);
    await page.keyboard.press("Enter");
    await page.locator("#si-message").waitFor();
    check(requests === 0, "a mismatch is caught before sending");
    await shot(page, "new-password-mismatch-phone-th");
    await page.locator("#si-confirm-password").fill(nightPassword);
    await page.keyboard.press("Enter");
    await signedIn(page);
    await context.close();
  }

  stage("lockout (es, desktop)");
  {
    const { context, page } = await open("es", "desktop");
    await ready(page);
    await page.locator("#si-login-name").fill("lock.test");
    const messages = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      await page.locator("#si-password").fill(`wrong ${attempt}`);
      await page.locator(".si-submit").click();
      await page.locator(".si-submit:not([aria-busy])").waitFor();
      messages.push(await alertText(page));
    }
    check(
      new Set(messages.slice(0, 4)).size === 1,
      "the same message for every wrong password",
    );
    check(messages[4] !== messages[3], "the fifth failure explains the lock");
    await page.locator("#si-password").fill(lockTemporary);
    await page.locator(".si-submit").click();
    await page.locator(".si-submit:not([aria-busy])").waitFor();
    check(
      (await alertText(page)) === messages[4],
      "the right password waits too",
    );
    await shot(page, "locked-desktop-es");
    await context.close();
  }
});
