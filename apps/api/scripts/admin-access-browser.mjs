import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { URL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { diagnoseAdminAccessConsole } from "./admin-access-browser-diagnostics.mjs";

const requireFromRoot = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const { default: AxeBuilder } = requireFromRoot("@axe-core/playwright");
const loginForm = 'form[action="/api/admin/auth/begin"]';
const logoutButton = ".mc-account button";
const list = '[data-management-list="ARTISTS"]';
const sessionCookieNames = [
  "__Host-fan-admin-session",
  "__Host-fan-admin-csrf",
];

/** Local TLS IdP + actual PG sessions. No credential, URL query, HAR or trace is persisted. */
export async function verifyAdminAccessBrowser({
  adminOrigin,
  issuer,
  output,
  idp,
  revokeSessions,
  check,
  registerSecret = () => {},
}) {
  const directory = path.join(output, "browser-access");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    environment: "LOCAL_OIDC_TLS_POSTGRES",
    startedAt: new Date().toISOString(),
    assertions: [],
    cases: [],
    screenshots: [],
    axe: [],
    reflow: [],
    keyboard: [],
    responses: [],
    pageErrors: [],
    diagnostics: { network: [], console: [], bootstrap: [], authRequests: [] },
    limitations: [
      "Owned HTTPS identity fixture; no real operator identity or production identity provider",
      "Desktop Chrome with emulated phone viewport, not a physical phone",
      "Automated accessibility does not replace screen-reader or human translation review",
      "Only authentication and existing empty management views; upload/publication uses the separate management regression",
      "Logout failure is an explicitly injected browser transport failure",
    ],
  };
  function assert(value, label) {
    report.assertions.push({ label, passed: Boolean(value) });
    check(value, label);
  }
  const origins = [adminOrigin, new URL(issuer).origin];
  assert(
    origins.every(
      (value) =>
        new URL(value).protocol === "https:" &&
        new URL(value).hostname.endsWith(".example.invalid"),
    ),
    "browser only accepts owned local HTTPS fixture origins",
  );
  let browser;
  let stage = "browser-start";
  let page;
  let authenticationStarted = false;
  const pending = new Set();
  const unexpectedRequests = [];
  const observationFailures = [];
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [
        `--host-resolver-rules=${origins.map((value) => `MAP ${new URL(value).hostname} 127.0.0.1`).join(",")}`,
        "--no-proxy-server",
      ],
    });
    report.browserVersion = browser.version();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
      ignoreHTTPSErrors: true,
    });
    await context.route("**/*", async (route) => {
      const target = new URL(route.request().url());
      if (origins.includes(target.origin)) await route.continue();
      else {
        unexpectedRequests.push({ kind: "NON_FIXTURE_ORIGIN" });
        await route.abort("blockedbyclient");
      }
    });
    page = await context.newPage();
    function requestKind(request) {
      const target = new URL(request.url());
      if (target.origin !== adminOrigin) return "OTHER_ORIGIN";
      if (target.pathname === "/api/admin/session") return "SESSION_BOOTSTRAP";
      if (target.pathname.startsWith("/_next/"))
        return request.resourceType() === "script"
          ? "NEXT_SCRIPT"
          : "NEXT_ASSET";
      if (target.pathname.startsWith("/api/admin/auth/")) return "AUTH";
      return request.resourceType() === "document" ? "DOCUMENT" : "OTHER";
    }
    page.on("request", (request) => {
      const target = new URL(request.url());
      if (
        target.origin === new URL(issuer).origin &&
        request.isNavigationRequest()
      ) {
        // Observe the actual provider navigation synchronously. The UI has already
        // validated the public response; its previous document may now be gone.
        for (const key of ["state", "nonce", "code_challenge"])
          if (target.searchParams.has(key))
            registerSecret(target.searchParams.get(key));
      }
      if (
        target.origin === adminOrigin &&
        target.pathname === "/api/admin/auth/begin"
      ) {
        authenticationStarted = true;
        const work = request
          .allHeaders()
          .then((headers) => {
            report.diagnostics.authRequests.push({
              operation: "begin",
              method: request.method(),
              originMatches: headers.origin === adminOrigin,
              originOpaque: headers.origin === "null",
              fetchSite: [
                "same-origin",
                "same-site",
                "cross-site",
                "none",
              ].includes(headers["sec-fetch-site"])
                ? headers["sec-fetch-site"]
                : "OMITTED",
              refererAbsent: headers.referer === undefined,
            });
          })
          .catch(() =>
            observationFailures.push({
              operation: "begin",
              detail: "REQUEST_HEADER_OBSERVATION_FAILED",
            }),
          );
        pending.add(work);
        void work.finally(() => pending.delete(work));
      }
      if (
        target.origin === adminOrigin &&
        target.pathname === "/api/admin/auth/callback"
      )
        for (const key of ["code", "state"])
          if (target.searchParams.has(key))
            registerSecret(target.searchParams.get(key));
    });
    page.on("requestfailed", (request) =>
      report.diagnostics.network.push({
        kind: requestKind(request),
        event: "FAILED",
      }),
    );
    page.on("console", (message) => {
      if (!["error", "warning"].includes(message.type())) return;
      const current = new URL(page.url());
      report.diagnostics.console.push({
        type: message.type(),
        ...diagnoseAdminAccessConsole({
          message: message.text(),
          initialCleanDocument:
            stage === "matrix-en-390" &&
            current.origin === adminOrigin &&
            current.pathname === "/en" &&
            !current.search &&
            !current.hash,
          authenticationStarted,
        }),
      });
    });
    page.on("pageerror", () =>
      report.pageErrors.push({ stage, detail: "Runtime message omitted" }),
    );
    page.on("response", (response) => {
      const target = new URL(response.url());
      const kind = requestKind(response.request());
      if (
        ["NEXT_SCRIPT", "NEXT_ASSET", "DOCUMENT", "SESSION_BOOTSTRAP"].includes(
          kind,
        )
      )
        report.diagnostics.network.push({
          kind,
          event: "RESPONSE",
          status: response.status(),
          mime: (() => {
            const mime = (response.headers()["content-type"] ?? "")
              .split(";")[0]
              .trim()
              .toLowerCase();
            return [
              "application/javascript",
              "text/javascript",
              "text/html",
              "text/css",
              "application/json",
              "text/plain",
            ].includes(mime)
              ? mime
              : "OTHER";
          })(),
        });
      if (kind === "SESSION_BOOTSTRAP") {
        const work = response
          .json()
          .then((value) => {
            const knownCodes = [
              "FORBIDDEN",
              "UNAUTHENTICATED",
              "CSRF_INVALID",
              "CONTENT_UNAVAILABLE",
              "ACCESS_UNAVAILABLE",
            ];
            report.diagnostics.bootstrap.push({
              status: response.status(),
              outcome: value?.outcome === "SUCCESS" ? "SUCCESS" : "FAILURE",
              code: knownCodes.includes(value?.code) ? value.code : "OMITTED",
            });
            if (
              value?.outcome === "SUCCESS" &&
              typeof value.csrfToken === "string"
            )
              registerSecret(value.csrfToken);
          })
          .catch(() =>
            report.diagnostics.bootstrap.push({
              status: response.status(),
              code: "INVALID_JSON",
            }),
          );
        pending.add(work);
        void work.finally(() => pending.delete(work));
      }
      if (
        target.origin !== adminOrigin ||
        !/^\/api\/admin\/auth\/(begin|callback|logout)$/u.test(target.pathname)
      )
        return;
      const operation = target.pathname.split("/").at(-1);
      const work = (async () => {
        const headers = await response.allHeaders();
        for (const match of (headers["set-cookie"] ?? "").matchAll(
          /__Host-fan-admin-(?:login|session|csrf)=([^;\s,]+)/gu,
        ))
          registerSecret(match[1]);
        const result = {
          operation,
          status: response.status(),
          noStore: (headers["cache-control"] ?? "").includes("no-store"),
          noReferrer: headers["referrer-policy"] === "no-referrer",
        };
        report.responses.push(result);
        assert(
          result.noStore && result.noReferrer,
          `${operation} browser response keeps authentication private`,
        );
        if (operation === "begin" && response.status() === 200) {
          const setCookie = headers["set-cookie"] ?? "";
          assert(
            setCookie.includes("__Host-fan-admin-login=") &&
              /; Secure/iu.test(setCookie) &&
              /; HttpOnly/iu.test(setCookie) &&
              /; Path=\//iu.test(setCookie) &&
              /; SameSite=Lax/iu.test(setCookie),
            "same-origin login installs a secure HttpOnly browser binding",
          );
        }
      })().catch(() =>
        observationFailures.push({
          operation,
          detail: "AUTH_RESPONSE_OBSERVATION_FAILED",
        }),
      );
      pending.add(work);
      void work.finally(() => pending.delete(work));
    });
    async function settled() {
      await Promise.all([...pending]);
      assert(
        observationFailures.length === 0,
        "authentication response observations completed",
      );
    }
    function cleanLocation(locale) {
      const location = new URL(page.url());
      return (
        location.origin === adminOrigin &&
        location.pathname === `/${locale}` &&
        !location.search &&
        !location.hash
      );
    }
    async function cleanPage(locale) {
      await expect
        .poll(() => cleanLocation(locale), { timeout: 45_000 })
        .toBe(true);
      assert(
        (await page.locator("html").getAttribute("lang")) === locale,
        `${locale} document language is correct`,
      );
      assert(
        await page.evaluate(
          () =>
            globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
        `${locale} reduced-motion preference is active`,
      );
    }
    async function navigate(locale) {
      const response = await page.goto(`${adminOrigin}/${locale}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      assert(
        response?.status() === 200,
        `${locale} management entry responds HTTP 200`,
      );
      await page.locator(`${loginForm} button`).waitFor({ timeout: 45_000 });
      await cleanPage(locale);
    }
    async function keyboardTo(locator, label) {
      let reached = false;
      for (let index = 0; index < 24; index++) {
        await page.keyboard.press("Tab");
        reached = await locator.evaluate(
          (element) => element === globalThis.document.activeElement,
        );
        if (reached) break;
      }
      const focus = reached
        ? await locator.evaluate((element) => {
            const style = globalThis.getComputedStyle(element),
              rect = element.getBoundingClientRect();
            return {
              visible: element.matches(":focus-visible"),
              outlineWidth: Number.parseFloat(style.outlineWidth),
              outlineStyle: style.outlineStyle,
              inViewport:
                rect.right > 0 &&
                rect.left < globalThis.innerWidth &&
                rect.bottom > 0 &&
                rect.top < globalThis.innerHeight,
            };
          })
        : null;
      report.keyboard.push({ label, reached, focus });
      assert(
        reached &&
          focus?.visible &&
          focus.outlineWidth > 0 &&
          focus.outlineStyle !== "none" &&
          focus.inViewport,
        `${label} is keyboard reachable with visible focus`,
      );
    }
    async function inspect(locale, screen, viewport) {
      await cleanPage(locale);
      await page.evaluate(async () => {
        await globalThis.document.fonts.ready;
        await new Promise((resolve) =>
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(resolve),
          ),
        );
      });
      const widths = await page.evaluate(() => ({
        document: globalThis.document.documentElement.scrollWidth,
        body: globalThis.document.body.scrollWidth,
        viewport: globalThis.innerWidth,
      }));
      report.reflow.push({ locale, screen, ...viewport, ...widths });
      assert(
        widths.viewport === viewport.width &&
          widths.document <= viewport.width + 1 &&
          widths.body <= viewport.width + 1,
        `${locale} ${screen} fits ${viewport.width} CSS pixels`,
      );
      const scan = await new AxeBuilder({ page }).analyze();
      const rules = (values) =>
        values.map(({ id, impact, nodes }) => ({
          id,
          impact,
          nodeCount: nodes.length,
        }));
      const violations = rules(scan.violations);
      report.axe.push({
        locale,
        screen,
        ...viewport,
        engineVersion: scan.testEngine.version,
        violations,
        incomplete: rules(scan.incomplete),
        passes: scan.passes.length,
      });
      assert(
        violations.length === 0,
        `${locale} ${screen} has no automated axe violations`,
      );
      const filename = `${locale}-${viewport.width}-${screen}.png`;
      await page.screenshot({
        path: path.join(directory, filename),
        fullPage: true,
      });
      report.screenshots.push({
        locale,
        screen,
        ...viewport,
        file: filename,
        cleanLocation: true,
      });
    }
    async function assertCookies() {
      const cookies = await context.cookies(adminOrigin);
      assert(
        cookies.filter((cookie) => sessionCookieNames.includes(cookie.name))
          .length === 2 &&
          cookies
            .filter((cookie) => sessionCookieNames.includes(cookie.name))
            .every(
              (cookie) =>
                cookie.httpOnly &&
                cookie.secure &&
                cookie.path === "/" &&
                cookie.sameSite === "Strict" &&
                cookie.expires > Date.now() / 1000,
            ),
        "authenticated browser has only valid secure HttpOnly session credentials",
      );
      assert(
        !cookies.some((cookie) => cookie.name === "__Host-fan-admin-login"),
        "completed login clears its one-use browser binding",
      );
      assert(
        await page.evaluate(() => globalThis.document.cookie === ""),
        "browser JavaScript cannot read administrative cookies",
      );
    }
    async function signIn(locale, keyboard = false) {
      const button = page.locator(`${loginForm} button`);
      if (keyboard) {
        await keyboardTo(button, `${locale} login`);
        await page.keyboard.press("Enter");
      } else await button.click();
      await page.locator(list).waitFor({ timeout: 60_000 });
      await cleanPage(locale);
      await assertCookies();
      await settled();
    }
    async function signOut(locale, keyboard = false) {
      const button = page.locator(logoutButton);
      if (keyboard) {
        await keyboardTo(button, `${locale} logout`);
        await page.keyboard.press("Enter");
      } else await button.click();
      await page.locator(`${loginForm} button`).waitFor({ timeout: 45_000 });
      assert(
        !(await context.cookies(adminOrigin)).some(
          (cookie) =>
            sessionCookieNames.includes(cookie.name) ||
            cookie.name === "__Host-fan-admin-login",
        ),
        "confirmed logout clears authentication cookies",
      );
      await cleanPage(locale);
      await settled();
    }

    idp.setMode("valid");
    for (const locale of SUPPORTED_LOCALES) {
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ]) {
        stage = `matrix-${locale}-${viewport.width}`;
        await page.setViewportSize(viewport);
        await navigate(locale);
        await expect(
          page.locator(`${loginForm} input[name="locale"]`),
        ).toHaveValue(locale);
        assert(
          (await page
            .locator(`${loginForm} input[type="password"]`)
            .count()) === 0,
          `${locale} uses one identity login action without local password fields`,
        );
        await inspect(locale, "login", viewport);
        await signIn(locale, true);
        await inspect(locale, "workspace", viewport);
        await page.locator("[data-management-new]").click();
        await page.locator("[data-management-form]").waitFor();
        assert(
          (await page.locator('[data-management-field="image"]').count()) ===
            1 &&
            (await page.locator('[data-management-field="name"]').count()) ===
              1 &&
            (await page
              .locator('[data-management-field="description"]')
              .count()) === 1,
          `${locale} authenticated operator retains the simple artist form`,
        );
        await page.locator(".mc-back").click();
        await page.locator(list).waitFor();
        await signOut(locale, true);
        report.cases.push({
          kind: "LOCALE_LOGIN_WORKSPACE_LOGOUT",
          locale,
          ...viewport,
          status: "PASS",
        });
      }
    }

    stage = "login-rejections";
    await page.setViewportSize({ width: 390, height: 844 });
    for (const mode of ["no-mfa", "wrong-signature", "disconnect"]) {
      idp.setMode(mode);
      await navigate("en");
      await page.locator(`${loginForm} button`).click();
      await expect(page.locator(".mc-empty [role='alert']")).toHaveText(
        "We could not sign you in. Please try again.",
        { timeout: 60_000 },
      );
      await cleanPage("en");
      assert(
        !(await context.cookies(adminOrigin)).some(
          (cookie) =>
            sessionCookieNames.includes(cookie.name) ||
            cookie.name === "__Host-fan-admin-login",
        ),
        `${mode} never installs a session or retains login binding`,
      );
      await inspect("en", `login-${mode}`, { width: 390, height: 844 });
      await settled();
      idp.setMode("valid");
      await signIn("en");
      await signOut("en");
      report.cases.push({
        kind: "LOGIN_REJECTED_AND_RETRIED",
        mode,
        status: "PASS",
      });
    }

    stage = "callback-log-canary";
    const canary = new URL(`${adminOrigin}/api/admin/auth/callback`);
    canary.searchParams.set("code", `synthetic-${randomUUID()}`);
    canary.searchParams.set("state", randomBytes(32).toString("base64url"));
    await page.goto(canary.href, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await expect(page.locator(".mc-empty [role='alert']")).toHaveText(
      "We could not sign you in. Please try again.",
    );
    await cleanPage("en");
    await settled();
    report.cases.push({
      kind: "PRIVATE_CALLBACK_QUERY_CANARY_SENT",
      status: "PASS",
      requiresParentLogAbsenceCheck: true,
    });

    stage = "session-unavailable";
    const sessionUrl = `${adminOrigin}/api/admin/session`;
    await context.route(sessionUrl, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "CONTENT_UNAVAILABLE",
        }),
      }),
    );
    await page.goto(`${adminOrigin}/en`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".mc-empty [role='alert']")).toHaveText(
      "We could not check your session. Please try again.",
    );
    assert(
      (await page.locator(loginForm).count()) === 0,
      "session outage is not presented as a successful logout or ordinary login prompt",
    );
    await inspect("en", "session-unavailable", { width: 390, height: 844 });
    await context.unroute(sessionUrl);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.locator(`${loginForm} button`).waitFor();
    await signIn("en");
    report.cases.push({
      kind: "SESSION_UNAVAILABLE_RETRY",
      injectedBrowserResponse: true,
      status: "PASS",
    });

    stage = "session-revocation";
    await revokeSessions();
    await page.locator('[data-management-section="GIFTS"]').click();
    await expect(page.locator(".mc-empty [role='alert']")).toHaveText(
      "Your session has ended. Sign in again to continue.",
    );
    await inspect("en", "session-revoked", { width: 390, height: 844 });
    await signIn("en");
    report.cases.push({
      kind: "REAL_PG_REVOCATION_REQUIRES_LOGIN",
      status: "PASS",
    });

    stage = "logout-failure-retry";
    const before = await context.cookies(adminOrigin);
    const logoutUrl = `${adminOrigin}/api/admin/auth/logout`;
    await context.route(logoutUrl, (route) => route.abort("failed"));
    await page.locator(logoutButton).click();
    await expect(page.locator(".mc-account [role='alert']")).toHaveText(
      "We could not confirm sign-out. Please try again.",
    );
    assert(
      await page.locator(list).isVisible(),
      "unconfirmed logout retains its active workspace",
    );
    const after = await context.cookies(adminOrigin);
    assert(
      sessionCookieNames.every(
        (name) =>
          before.find((cookie) => cookie.name === name)?.value ===
          after.find((cookie) => cookie.name === name)?.value,
      ),
      "unconfirmed logout keeps current session credentials",
    );
    await inspect("en", "logout-failed", { width: 390, height: 844 });
    await context.unroute(logoutUrl);
    await signOut("en", true);
    report.cases.push({
      kind: "LOGOUT_TRANSPORT_FAILURE_AND_RETRY",
      injectedBrowserFailure: true,
      status: "PASS",
    });

    await settled();
    assert(
      unexpectedRequests.length === 0,
      "browser made no requests outside the two owned local HTTPS origins",
    );
    assert(
      report.pageErrors.length === 0,
      "authentication UI has no browser runtime errors",
    );
    report.status = "PASS";
    return report;
  } catch {
    report.status = "FAIL";
    report.failure = {
      stage,
      detail: "Details omitted to protect authentication responses",
    };
    if (page) {
      const current = new URL(page.url());
      const clean =
        current.origin === adminOrigin &&
        SUPPORTED_LOCALES.some((locale) => current.pathname === `/${locale}`) &&
        !current.search &&
        !current.hash;
      report.failure.cleanDocument = clean;
      if (clean) {
        try {
          report.failure.document = await page.evaluate(() => {
            const safeText = (value) =>
              typeof value === "string" &&
              value.length < 120 &&
              !/[A-Za-z0-9_-]{32}|https?:|token|csrf|code=|state=/iu.test(value)
                ? value
                : "OMITTED";
            return {
              readyState: globalThis.document.readyState,
              managementCenters: globalThis.document.querySelectorAll(
                "[data-management-center]",
              ).length,
              loginForms: globalThis.document.querySelectorAll(
                'form[action="/api/admin/auth/begin"]',
              ).length,
              scripts:
                globalThis.document.querySelectorAll("script[src]").length,
              buttons: [...globalThis.document.querySelectorAll("button")]
                .slice(0, 20)
                .map((button) => ({
                  text: safeText(button.textContent?.trim()),
                  disabled: button.disabled,
                })),
              statuses: [
                ...globalThis.document.querySelectorAll(
                  ".mc-empty [role='alert'],.mc-empty [role='status']",
                ),
              ].map((node) => safeText(node.textContent?.trim())),
            };
          });
        } catch {
          report.failure.document = { detail: "DOCUMENT_UNAVAILABLE" };
        }
      }
    }
    throw new Error("ADMIN_ACCESS_BROWSER_FAILED");
  } finally {
    idp.setMode("valid");
    await Promise.all([...pending]);
    try {
      await browser?.close();
    } finally {
      report.completedAt = new Date().toISOString();
      report.observationFailures = observationFailures;
      report.unexpectedRequests = unexpectedRequests;
      await writeFile(
        path.join(directory, "results.json"),
        JSON.stringify(report, null, 2) + "\n",
        { mode: 0o600 },
      );
    }
  }
}
