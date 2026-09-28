import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { certificatePin } from "./production-admin-oidc-fixture.mjs";

/** Real production Next BFF in a strict TLS browser. No trace, HAR or secret-bearing screenshot. */
export async function verifyProductionAdminBrowser({
  adminOrigin,
  issuer,
  adminPin,
  idpCa,
  idp,
  output,
  check,
  registerSecret,
  revokeSessions,
  review = {},
}) {
  const origins = [adminOrigin, new URL(issuer).origin];
  const browserArgs = [
    `--host-resolver-rules=${origins.map((value) => `MAP ${new URL(value).hostname} 127.0.0.1`).join(",")}`,
    "--no-proxy-server",
    `--ignore-certificate-errors-spki-list=${adminPin},${certificatePin(idpCa)}`,
  ];
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: browserArgs,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const violations = [],
    errors = [],
    pending = new Set();
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    environment: "OIDC_STAGING_PRODUCTION_NEXT_OWNED_TLS",
    cases: [],
    screenshots: [],
    pageErrors: errors,
    privacy: [],
    transport: [],
    browserVersion: browser.version(),
  };
  const directory = path.join(output, "browser");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const login = 'form[action="/api/admin/auth/begin"] button';
  const workspace = '[data-management-list="ARTISTS"]';
  const logout = ".mc-account button";
  const cookieNames = ["__Host-fan-admin-session", "__Host-fan-admin-csrf"];
  let stage = "initial";
  await context.route("**/*", async (route) => {
    if (origins.includes(new URL(route.request().url()).origin))
      await route.continue();
    else {
      violations.push("NON_FIXTURE_ORIGIN");
      await route.abort("blockedbyclient");
    }
  });
  page.on("pageerror", () =>
    errors.push({ stage, detail: "Runtime message omitted" }),
  );
  page.on("request", (request) => {
    const url = new URL(request.url());
    for (const key of ["code", "state", "nonce", "code_challenge"])
      registerSecret(url.searchParams.get(key));
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === adminOrigin && url.pathname.startsWith("/api/admin/"))
      report.transport.push({ path: url.pathname, status: response.status() });
    if (
      url.origin !== adminOrigin ||
      !url.pathname.startsWith("/api/admin/auth/")
    )
      return;
    const work = (async () => {
      const headers = await response.allHeaders();
      for (const match of (headers["set-cookie"] ?? "").matchAll(
        /__Host-fan-admin-(?:login|session|csrf)=([^;\s,]+)/gu,
      ))
        registerSecret(match[1]);
      const safe = {
        action: url.pathname.split("/").at(-1),
        status: response.status(),
        noStore: headers["cache-control"]?.includes("no-store"),
        noReferrer: headers["referrer-policy"] === "no-referrer",
      };
      report.privacy.push(safe);
      check(
        safe.noStore && safe.noReferrer,
        `browser ${safe.action} response is private`,
      );
    })().catch(() => violations.push("AUTH_OBSERVATION_FAILED"));
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });
  async function inspect(locale, screen) {
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const current = new URL(page.url());
    check(
      current.origin === adminOrigin &&
        current.pathname === `/${locale}` &&
        !current.search &&
        !current.hash,
      `${locale} ${screen} has a clean canonical URL`,
    );
    await page.evaluate(() => globalThis.document.fonts.ready);
    const width = await page.evaluate(() => ({
      body: globalThis.document.body.scrollWidth,
      document: globalThis.document.documentElement.scrollWidth,
      viewport: globalThis.innerWidth,
    }));
    check(
      width.body <= width.viewport + 1 && width.document <= width.viewport + 1,
      `${locale} ${screen} has no horizontal overflow at ${width.viewport}`,
    );
    check(
      await page.evaluate(
        () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      `${locale} ${screen} respects reduced-motion environment`,
    );
    await review.auditScreen?.({
      page,
      context,
      adminOrigin,
      locale,
      screen,
      check,
      registerSecret,
    });
    const name = `${locale}-${width.viewport}-${screen}.png`;
    await page.screenshot({ path: path.join(directory, name), fullPage: true });
    report.screenshots.push(name);
  }
  async function signIn() {
    await page.locator(login).click();
    await page.locator(workspace).waitFor({ timeout: 30000 });
  }
  async function signOut() {
    await page.locator(logout).click();
    await page.locator(login).waitFor({ timeout: 15000 });
  }
  try {
    idp.setMode("valid");
    idp.setClaims({});
    for (const locale of SUPPORTED_LOCALES)
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ]) {
        stage = `${locale}-${viewport.width}`;
        await page.setViewportSize(viewport);
        const response = await page.goto(`${adminOrigin}/${locale}`, {
          waitUntil: "domcontentloaded",
        });
        check(
          response.status() === 200,
          `${stage} production entry returns 200`,
        );
        await page.locator(login).waitFor();
        await inspect(locale, "login");
        await signIn();
        await inspect(locale, "workspace");
        const cookies = await context.cookies(adminOrigin);
        for (const name of cookieNames) {
          const cookie = cookies.find((item) => item.name === name);
          check(
            cookie?.httpOnly &&
              cookie.secure &&
              cookie.sameSite === "Strict" &&
              cookie.path === "/",
            `${name} browser cookie is private and strict`,
          );
          registerSecret(cookie?.value);
        }
        check(
          !cookies.some((item) => item.name === "__Host-fan-admin-login"),
          "callback clears one-time browser binding",
        );
        const storage = await page.evaluate(() => ({
          local: Object.keys(globalThis.localStorage),
          session: Object.keys(globalThis.sessionStorage),
        }));
        check(
          storage.local.length === 0 && storage.session.length === 0,
          "authentication stores nothing in browser storage",
        );
        if (locale === "en" && viewport.width === 1440) {
          await page.reload();
          await page.locator(workspace).waitFor();
          check(
            true,
            "production session survives refresh through PG bootstrap",
          );
        }
        await signOut();
        check(
          !(await context.cookies(adminOrigin)).some((item) =>
            cookieNames.includes(item.name),
          ),
          "successful logout removes both session cookies",
        );
        report.cases.push({ locale, ...viewport, status: "PASS" });
      }
    stage = "review";
    await review.auditAdminOidcBrowser?.({
      page,
      context,
      adminOrigin,
      issuer,
      browserArgs,
      idp,
      output,
      check,
      registerSecret,
    });
    idp.setMode("valid");
    idp.setClaims({});
    stage = "external-session-revocation";
    await page.goto(`${adminOrigin}/en`, { waitUntil: "domcontentloaded" });
    await page.locator(login).waitFor();
    await signIn();
    await revokeSessions();
    await page.reload();
    await page.locator(login).waitFor();
    check(true, "revoked session cannot reopen production management UI");
    await Promise.all([...pending]);
    check(
      violations.length === 0,
      "browser stayed within exact owned origins and observed all auth responses",
    );
    check(errors.length === 0, "production browser has no page errors");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.stage = stage;
    report.errorName = error?.name ?? "Error";
    const current = new URL(page.url());
    if (current.origin === adminOrigin && !current.search && !current.hash)
      await page.screenshot({
        path: path.join(directory, "failure.png"),
        fullPage: true,
      });
    throw error;
  } finally {
    await Promise.all([...pending]);
    await writeFile(
      path.join(directory, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    await browser.close();
  }
}
