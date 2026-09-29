#!/usr/bin/env node
// L3-10 ⑤: account settings in a real browser — password change, QR enrollment, recovery codes, removal.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { decodeBase32, totpCode } from "@fan-support/application";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  freshCode,
  runLocalAccountBrowserAcceptance,
} from "./admin-local-browser-harness.mjs";

const qrcode = createRequire(
  new URL("../../admin/package.json", import.meta.url),
)("qrcode-generator");
/** The same drawing as the Admin QR component, for comparing what the page encodes. */
function expectedQrPath(text) {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  let path = "";
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (qr.isDark(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
  return path;
}

await runLocalAccountBrowserAcceptance("account-browser", async (t) => {
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
  let password = t.ownerPassword;
  let key;
  let lastStep = -1;
  /** An owner session through the API, finishing the code step once two-step verification is on. */
  async function ownerSession() {
    const first = await signIn("studio.owner", password);
    if (first.kind === "SESSION_CREATED") return first;
    const code = await freshCode(key, lastStep);
    lastStep = code.step;
    const done = await t.access("step", {
      challengeToken: first.challengeToken,
      step: { kind: "TOTP", code: code.code },
    });
    secret(done.sessionToken);
    secret(done.csrfToken);
    return done;
  }
  async function openSettings(locale, viewport) {
    const session = await ownerSession();
    const opened = await open(locale, viewport, { session });
    await opened.page
      .locator('[data-management-section="ACCOUNT"]')
      .click({ timeout: 180_000 });
    await opened.page.locator("[data-account-settings]").waitFor();
    return { ...opened, session };
  }

  stage("seven languages on phone and desktop");
  for (const viewport of ["phone", "desktop"])
    for (const locale of SUPPORTED_LOCALES) {
      const { context, page, errors } = await openSettings(locale, viewport);
      check(
        await page.locator("#mc-account-warning").isVisible(),
        `${locale} ${viewport}: sidebar warns while two-step verification is off`,
      );
      check(
        await page.locator("[data-two-factor-warning]").isVisible(),
        `${locale} ${viewport}: page banner`,
      );
      check(
        await fitsWidth(page),
        `${locale} ${viewport}: no horizontal overflow`,
      );
      await audit(page, `${locale} ${viewport}`);
      await shot(page, `account-${viewport}-${locale}`);
      check(errors.length === 0, `${locale} ${viewport}: no page errors`);
      await context.close();
    }

  stage("change password (zh-CN, desktop)");
  {
    const other = await ownerSession();
    const { context, page } = await openSettings("zh-CN", "desktop");
    await page.locator("#account-current-password").fill("not the password");
    const next = secret(`owner ${randomBytes(9).toString("base64url")}`);
    await page.locator("#account-new-password").fill(next);
    await page.locator("#account-confirm-password").fill(next);
    await page.locator("#account-confirm-password").press("Enter");
    await page.locator(".account-message--error").waitFor();
    check(
      (await page.locator(".account-message--error").getAttribute("role")) ===
        "alert",
      "a wrong current password is announced",
    );
    let requests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/admin/account-")) requests++;
    });
    await page.locator("#account-current-password").fill(password);
    await page.locator("#account-confirm-password").fill(`${next}x`);
    await page.locator(".account-submit").click();
    await page.locator(".account-message--error").waitFor();
    check(requests === 0, "a mismatch is caught before sending");
    await page.locator("#account-confirm-password").fill(next);
    await page.locator(".account-submit").click();
    await page.locator(".account-message--done").waitFor();
    check(
      (await page.locator("#account-current-password").inputValue()) === "",
      "fields are cleared",
    );
    password = next;
    check(
      (await api("account/context", {}, as(other))).status === 401,
      "the other session was signed out",
    );
    check(
      (await page.locator("[data-account-settings]").isVisible()) &&
        (await api("account/context", {}, as(await ownerSession()))).status ===
          200,
      "the new password signs in",
    );
    await shot(page, "password-changed-desktop-zh-CN");
    await context.close();
  }

  stage("set up two-step verification (en, desktop)");
  let codes;
  {
    const { context, page } = await openSettings("en", "desktop");
    await page
      .getByRole("button", { name: "Set up two-step verification" })
      .click();
    check(
      await page.evaluate(
        () => globalThis.document.activeElement?.id === "account-2fa-password",
      ),
      "the password field takes focus",
    );
    await page.locator("#account-2fa-password").fill("wrong password");
    await page.keyboard.press("Enter");
    await page.locator(".account-message--error").waitFor();
    await page.locator("#account-2fa-password").fill(password);
    await page.keyboard.press("Enter");
    await page.locator(".account-qr").waitFor();
    const typed = (await page.locator("[data-totp-key]").innerText()).trim();
    const secretKey = secret(typed.replaceAll(" ", ""));
    check(
      /^[A-Z2-7]{32}$/u.test(secretKey),
      "a 160-bit key in four-letter groups",
    );
    key = decodeBase32(secretKey);
    const uri = `otpauth://totp/Studio%20Admin:studio.owner?secret=${secretKey}&issuer=Studio%20Admin&algorithm=SHA1&digits=6&period=30`;
    check(
      (await page.locator(".account-qr path").getAttribute("d")) ===
        expectedQrPath(uri),
      "the QR encodes exactly the authenticator URI",
    );
    check(
      (await page.locator(".account-qr").getAttribute("aria-label"))?.length >
        0,
      "the QR has a text alternative",
    );
    check(
      await page.evaluate(
        () => globalThis.document.activeElement?.id === "account-2fa-code",
      ),
      "the code field takes focus",
    );
    const qrWidth = async () =>
      (await page.locator(".account-qr").boundingBox())?.width ?? 0;
    check((await qrWidth()) >= 160, "the QR is drawn large enough to scan");
    await shot(page, "scan-desktop-en");
    await page.setViewportSize({ width: 390, height: 844 });
    check((await qrWidth()) >= 160, "and on a phone");
    check(await fitsWidth(page), "setup fits the phone");
    await shot(page, "scan-phone-en");
    await page.setViewportSize({ width: 1440, height: 900 });
    const now = Math.floor(Date.now() / 30_000);
    await page.keyboard.type(
      ["000000", "111111", "222222", "333333"].find(
        (code) => ![-1, 0, 1].some((d) => totpCode(key, now + d) === code),
      ),
    );
    await page.keyboard.press("Enter");
    await page.locator(".account-message--error").waitFor();
    const confirm = await freshCode(key, lastStep);
    lastStep = confirm.step;
    await page.locator("#account-2fa-code").fill(confirm.code);
    await page.keyboard.press("Enter");
    await page.locator(".account-code-list").waitFor();
    codes = (await page.locator(".account-code-list li").allInnerTexts()).map(
      (value) => secret(value.trim()),
    );
    check(
      codes.length === 10 && new Set(codes).size === 10,
      "ten distinct recovery codes",
    );
    check(
      await page.evaluate(
        () => globalThis.document.activeElement?.tagName === "H3",
      ),
      "focus moves to the codes",
    );
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download as a text file" }).click(),
    ]);
    check(
      download.suggestedFilename() === "recovery-codes-studio.owner.txt",
      "file named after the account",
    );
    const file = await readFile(await download.path(), "utf8");
    check(
      codes.every((code) => file.includes(code)),
      "the file holds every code",
    );
    await shot(page, "codes-desktop-en");
    await page
      .getByRole("button", { name: "I have saved these codes" })
      .click();
    await page.locator('[data-two-factor="on"]').waitFor();
    check(
      (await page.locator("#mc-account-warning").count()) === 0 &&
        (await page.locator("[data-two-factor-warning]").count()) === 0,
      "the warnings go away",
    );
    check(
      (await page.locator(".account-code-list").count()) === 0,
      "codes are not shown again",
    );
    await context.close();
  }

  stage("new recovery codes (ja, phone)");
  {
    const { context, page } = await openSettings("ja", "phone");
    await page.locator(".account-actions button").first().click();
    await page.locator("#account-2fa-password").fill(password);
    const code = await freshCode(key, lastStep);
    lastStep = code.step;
    await page.locator("#account-2fa-code").fill(code.code);
    await page.keyboard.press("Enter");
    await page.locator(".account-code-list").waitFor();
    const fresh = (
      await page.locator(".account-code-list li").allInnerTexts()
    ).map((value) => secret(value.trim()));
    check(
      fresh.length === 10 && fresh.every((value) => !codes.includes(value)),
      "an entirely new batch",
    );
    check(await fitsWidth(page), "codes fit the phone");
    await shot(page, "new-codes-phone-ja");
    await context.close();
  }

  stage("turn off two-step verification (es, desktop)");
  {
    const { context, page } = await openSettings("es", "desktop");
    const other = await ownerSession();
    await page.locator(".account-actions button").nth(1).click();
    await page.locator("#account-2fa-password").fill(password);
    const code = await freshCode(key, lastStep);
    lastStep = code.step;
    await page.locator("#account-2fa-code").fill(code.code);
    check(
      await page
        .locator('.account-form button[type="submit"].fs-button--danger')
        .isVisible(),
      "turning off is marked as dangerous",
    );
    await page.keyboard.press("Enter");
    await page.locator('[data-two-factor="off"]').waitFor();
    check(
      await page.locator("[data-two-factor-warning]").isVisible(),
      "the warning returns",
    );
    check(
      (await api("account/context", {}, as(other))).status === 401,
      "other sessions were signed out",
    );
    await shot(page, "turned-off-desktop-es");
    await context.close();
  }
});
