#!/usr/bin/env node
// L3-10 ④: the built-in sign-in page in a real browser — Admin Next (LOCAL_ACCOUNT, development mode
// over local HTTPS) in front of the production API composition on a real PostgreSQL.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { chromium } from "@playwright/test";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { decodeBase32, totpCode } from "@fan-support/application";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import { createApiApplication } from "../dist/bootstrap.js";
import { createProductionAdminComposition } from "../dist/production-admin-composition.js";
import { resolveAdminApiRuntimeConfig } from "../dist/admin-runtime-config.js";
import { createLocalExperienceKms } from "./local-experience-kms.mjs";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import {
  localAccountComposition,
  provisionFirstAdministrator,
} from "./admin-local-fixtures.mjs";
import {
  reserveAdminAccessOrigin,
  startAdminAccessNext,
} from "./admin-access-next.mjs";

const requireFromRoot = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const { default: AxeBuilder } = requireFromRoot("@axe-core/playwright");
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.join(
  workspaceRoot,
  "output/checks/l3-10",
  `browser-${new Date().toISOString().replaceAll(":", "-")}`,
);
await mkdir(output, { recursive: true });
const checks = [];
const axe = [];
let stage = "initialization";
let innerError;
function check(value, label) {
  checks.push({ stage, label, passed: Boolean(value) });
  assert.ok(value, `${stage}: ${label}`);
}
const secrets = new Set();
const secret = (value) => {
  secrets.add(value);
  return value;
};
const apiLogs = [];
const nextLogs = [];
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};
const currentStep = () => Math.floor(Date.now() / 30_000);
async function freshCode(key, lastStep) {
  for (;;) {
    const now = currentStep();
    const target = Math.max(lastStep + 1, now - 1);
    if (target <= now + 1) return { code: totpCode(key, target), step: target };
    await delay(Math.min(30_000, (target - 1) * 30_000 - Date.now() + 50));
  }
}

try {
  await withEphemeralPostgres(async (database) => {
    await runMigrations({
      clientConfig: database,
      workspaceRoot,
      command: { direction: "up" },
    });
    const client = new Client(database);
    await client.connect();
    const close = [];
    const own = (stop) => close.unshift(stop);
    own(() => client.end());
    let browser;
    try {
      stage = "services";
      const tokenPepper = secret(randomBytes(32).toString("hex")),
        subjectPepper = secret(randomBytes(32).toString("hex")),
        accessKey = secret(randomBytes(32).toString("hex"));
      const ownerPassword = secret(
        `owner ${randomBytes(9).toString("base64url")}`,
      );
      await provisionFirstAdministrator(client, {
        subjectPepper,
        password: ownerPassword,
      });
      const kms = createLocalExperienceKms({
        environment: "TEST",
        masterKey: randomBytes(32).toString("base64url"),
        macKey: randomBytes(32).toString("base64url"),
      });
      own(() => kms.close());
      const adminOrigin = await reserveAdminAccessOrigin();
      const { composition } = localAccountComposition({
        createProductionAdminComposition,
        resolveAdminApiRuntimeConfig,
        createPostgresPersistence,
        database,
        keyManagement: kms.adapter,
        adminOrigin,
        accessKey,
        tokenPepper,
        subjectPepper,
        own,
      });
      const app = await createApiApplication(preflightEnvironment(database), {
        ...composition,
        logger: createStructuredLogger({
          service: "api",
          write: (line) => apiLogs.push(line),
        }),
      });
      own(() => app.close());
      await app.listen(0, "127.0.0.1");
      const apiOrigin = new URL(await app.getUrl()).origin;
      const next = await startAdminAccessNext({
        workspaceRoot,
        adminOrigin,
        apiOrigin,
        accessKey,
        logs: nextLogs,
        mode: "LOCAL_ACCOUNT",
      });
      own(() => next.stop());

      stage = "seed accounts through the API";
      async function api(route, body, headers = {}) {
        const response = await globalThis.fetch(
          `${apiOrigin}/api/v1/admin/${route}`,
          {
            method: "POST",
            headers: {
              origin: adminOrigin,
              "content-type": "application/json",
              ...headers,
            },
            body: JSON.stringify(body),
          },
        );
        return response.json();
      }
      const access = (action, body) =>
        api(
          `local-access/${action}`,
          { schemaVersion: 1, requestId: randomUUID(), ...body },
          {
            "x-admin-access-key": accessKey,
          },
        );
      const as = (session) => ({
        cookie: `__Host-fan-admin-session=${session.sessionToken}`,
        "x-csrf-token": session.csrfToken,
      });
      const owner = await access("login", {
        locale: "en",
        loginName: "studio.owner",
        password: ownerPassword,
      });
      check(owner.kind === "SESSION_CREATED", "owner session for seeding");
      async function createStaff(loginName) {
        const created = await api(
          "staff/create",
          { loginName, displayName: loginName, roleKeys: ["studio:operator"] },
          as(owner),
        );
        check(created.kind === "STAFF_CREATED", `${loginName} created`);
        return secret(created.temporaryPassword);
      }
      const nightTemporary = await createStaff("night.shift");
      const lockTemporary = await createStaff("lock.test");
      const totpTemporary = await createStaff("totp.user");
      const totpPassword = secret(
        `totp ${randomBytes(9).toString("base64url")}`,
      );
      const totpLogin = await access("login", {
        locale: "en",
        loginName: "totp.user",
        password: totpTemporary,
      });
      const totpSession = await access("step", {
        challengeToken: totpLogin.challengeToken,
        step: { kind: "NEW_PASSWORD", newPassword: totpPassword },
      });
      const enrollment = await api(
        "account/totp-begin",
        { currentPassword: totpPassword },
        as(totpSession),
      );
      const key = decodeBase32(secret(enrollment.secret));
      const first = await freshCode(key, -1);
      const enabled = await api(
        "account/totp-confirm",
        { code: first.code },
        as(totpSession),
      );
      check(enabled.kind === "TOTP_ENABLED", "second factor for totp.user");
      const recoveryCodes = enabled.recoveryCodes.map(secret);
      let lastStep = first.step;
      for (const value of [
        owner.sessionToken,
        owner.csrfToken,
        totpSession.sessionToken,
        totpSession.csrfToken,
      ])
        secret(value);

      stage = "browser";
      browser = await chromium.launch({
        channel: "chrome",
        headless: true,
        args: [
          `--host-resolver-rules=MAP ${new URL(adminOrigin).hostname} 127.0.0.1`,
          "--no-proxy-server",
        ],
      });
      const unexpected = [];
      async function open(locale, viewport, reducedMotion = "no-preference") {
        const context = await browser.newContext({
          viewport: VIEWPORTS[viewport],
          reducedMotion,
          ignoreHTTPSErrors: true,
        });
        await context.route("**/*", async (route) => {
          const target = new URL(route.request().url());
          if (target.origin !== adminOrigin) {
            unexpected.push(target.origin);
            await route.abort("blockedbyclient");
          } else if (target.pathname.startsWith("/api/admin/auth/begin")) {
            unexpected.push("OIDC_BEGIN");
            await route.abort("blockedbyclient");
          } else await route.continue();
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) =>
          errors.push(String(error.message).slice(0, 200)),
        );
        await page.goto(`${adminOrigin}/${locale}`, {
          waitUntil: "domcontentloaded",
          timeout: 180_000,
        });
        await page
          .locator('[data-local-sign-in="PASSWORD"]')
          .waitFor({ timeout: 180_000 });
        return { context, page, errors };
      }
      async function audit(page, label) {
        const scan = await new AxeBuilder({ page }).analyze();
        const serious = scan.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact),
        );
        axe.push({
          label,
          violations: scan.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.length,
          })),
        });
        check(
          serious.length === 0,
          `${label}: no serious or critical axe violations`,
        );
      }
      const fitsWidth = (page) =>
        page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.document.documentElement.clientWidth,
        );
      const shot = (page, name) =>
        page.screenshot({
          path: path.join(output, `${name}.png`),
          fullPage: true,
        });
      const signedIn = (page) =>
        page.locator(".mc-account button").waitFor({ timeout: 120_000 });
      const alertText = async (page) =>
        (await page.locator("#si-message").innerText()).trim();

      stage = "seven languages on phone and desktop";
      const titles = new Set();
      for (const viewport of ["phone", "desktop"])
        for (const locale of SUPPORTED_LOCALES) {
          const { context, page, errors } = await open(locale, viewport);
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

      stage = "keyboard sign-in and sign-out (zh-CN, phone, reduced motion)";
      {
        const { context, page } = await open("zh-CN", "phone", "reduce");
        check(
          await page.evaluate(
            () => globalThis.document.activeElement?.id === "si-login-name",
          ),
          "the cursor starts in the login name",
        );
        const order = [];
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press("Tab");
          order.push(
            await page.evaluate(
              () =>
                globalThis.document.activeElement?.id ||
                globalThis.document.activeElement?.className ||
                globalThis.document.activeElement?.tagName,
            ),
          );
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
        await page.locator("#si-password").fill(ownerPassword);
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
          (await page.locator("#si-password").getAttribute("type")) ===
            "password",
          "and hides it again",
        );
        const transition = await page
          .locator(".si-submit")
          .evaluate(
            (node) => globalThis.getComputedStyle(node).transitionDuration,
          );
        check(
          transition
            .split(",")
            .every((value) => Number.parseFloat(value) === 0),
          "no transitions with reduced motion",
        );
        await page.locator("#si-password").focus();
        await page.keyboard.press("Enter");
        await signedIn(page);
        const cookies = await context.cookies();
        const session = cookies.find(
          (c) => c.name === "__Host-fan-admin-session",
        );
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
        await page
          .locator('[data-local-sign-in="PASSWORD"]')
          .waitFor({ timeout: 60_000 });
        check(
          !(await context.cookies()).some(
            (c) => c.name === "__Host-fan-admin-session" && c.value,
          ),
          "signed out",
        );
        await context.close();
      }

      stage = "authenticator code (ja, desktop)";
      {
        const { context, page } = await open("ja", "desktop");
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
        await page.keyboard.type(
          "000000" === totpCode(key, currentStep()) ? "111111" : "000000",
        );
        await page.keyboard.press("Enter");
        await page.locator("#si-message").waitFor();
        await shot(page, "code-error-desktop-ja");
        const fresh = await freshCode(key, lastStep);
        await page.locator("#si-code").fill(fresh.code);
        await page.keyboard.press("Enter");
        await signedIn(page);
        lastStep = fresh.step;
        await context.close();
      }

      stage = "recovery code (vi, phone)";
      {
        const { context, page } = await open("vi", "phone");
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

      stage = "temporary password (th, phone)";
      {
        const { context, page } = await open("th", "phone");
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
        check(
          await fitsWidth(page),
          "new-password step fits the phone in Thai",
        );
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

      stage = "lockout (es, desktop)";
      {
        const { context, page } = await open("es", "desktop");
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
        check(
          messages[4] !== messages[3],
          "the fifth failure explains the lock",
        );
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

      stage = "evidence";
      check(
        unexpected.length === 0,
        "no request left the fixture origin or reached OIDC",
      );
      const logText = `${apiLogs.join("\n")}\n${nextLogs.join("\n")}`;
      for (const value of secrets)
        check(!logText.includes(value), "no secret in API or Next logs");
    } catch (error) {
      innerError = error;
      throw error;
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      for (const stop of close)
        await Promise.resolve()
          .then(stop)
          .catch(() => undefined);
    }
  });
  const report = JSON.stringify(
    { result: "PASS", checks: checks.length, axe, detail: checks },
    null,
    2,
  );
  for (const value of secrets)
    assert.ok(!report.includes(value), "no secret in the report");
  await writeFile(path.join(output, "report.json"), report);
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: checks.length,
      output: path.relative(workspaceRoot, output),
    }),
  );
} catch (error) {
  let message = String((innerError ?? error)?.message);
  for (const value of secrets) message = message.replaceAll(value, "<secret>");
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      { result: "FAIL", stage, message, axe, detail: checks },
      null,
      2,
    ),
  );
  console.error(
    JSON.stringify({
      result: "FAIL",
      stage,
      checks: checks.length,
      message: message.slice(0, 1500),
    }),
  );
  process.exitCode = 1;
}
