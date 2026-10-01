import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { URL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createAdminOrdersBrowserTasks } from "./admin-orders-browser.mjs";

const require = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const { default: AxeBuilder } = require("@axe-core/playwright");

/** Actual browser/BFF/API records only. No credential bodies, private panels, traces or HAR are persisted. */
export async function verifyAdminFinanceBrowser({
  adminOrigin,
  issuer,
  output,
  check,
  authenticate,
  registerSecret = () => {},
  fixture,
  readFacts,
  prepareReconcile = async () => {},
}) {
  const directory = path.join(output, "browser-finance");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    cases: [],
    assertions: [],
    screenshots: [],
    axe: [],
    errors: [],
    transport: [],
    limitations: [
      "Local PostgreSQL, TLS OIDC and TEST PSP only; no real merchant refund",
      "390×844 is browser emulation, not a physical phone",
      "Draft translations require independent human approval",
    ],
  };
  const assert = (value, label) => {
    report.assertions.push({ label, passed: Boolean(value) });
    check(Boolean(value), label);
  };
  const origins = [
    adminOrigin,
    new URL(issuer).origin,
    ...(fixture.mediaOrigins ?? []),
  ];
  const privateValues = [
    fixture.privateMessage,
    fixture.privateDisplayName,
  ].filter(Boolean);
  privateValues.forEach(registerSecret);
  let browser,
    stage = "start";
  const tasks = createAdminOrdersBrowserTasks((failure) =>
    report.errors.push(failure),
  );
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
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const outstandingReads = new Set();
    const isRead = (request) =>
      /\/api\/admin\/(?:orders-(?:list|detail|context)|finance-(?:list|detail))$/u.test(
        new URL(request.url()).pathname,
      );
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (
        /^\/api\/admin\/(?:auth\/(?:begin|callback)|session|(?:orders|finance)-(?:context|list|detail))$/u.test(
          pathname,
        )
      )
        report.transport.push({
          stage,
          path: pathname,
          status: response.status(),
        });
    });
    page.on("request", (request) => {
      if (isRead(request)) outstandingReads.add(request);
    });
    page.on("requestfinished", (request) => outstandingReads.delete(request));
    page.on("requestfailed", (request) => outstandingReads.delete(request));
    page.on("pageerror", () =>
      report.errors.push({ stage, kind: "PAGE_ERROR" }),
    );
    async function enter(role = "MANAGER", locale = "en") {
      try {
        await authenticate(page, role, locale);
      } catch (error) {
        report.loginState = {
          loginFailed:
            new URL(page.url()).searchParams.get("login") === "failed",
          loginForm: await page
            .locator('form[action="/api/admin/auth/begin"]')
            .count(),
          accountAction: await page.locator(".mc-account button").count(),
          nextError: await page.locator("nextjs-portal").count(),
          alert: await page.getByRole("alert").count(),
        };
        throw error;
      }
      await page.locator('[data-management-section="ORDERS"]').click();
      await page.locator("[data-orders-search]").waitFor({ timeout: 60000 });
    }
    // Payments and refunds sit folded at the bottom of the order page (L2-12).
    async function unfoldFinance() {
      const toggle = page.locator("[data-finance-toggle]");
      await toggle.waitFor({ timeout: 60000 });
      // The panel opens by itself once loaded when something needs a person; deciding
      // before it loads can fold it straight back.
      await expect(page.locator("[data-finance-panel]")).toHaveAttribute(
        "aria-busy",
        "false",
        { timeout: 60000 },
      );
      if ((await toggle.getAttribute("aria-expanded")) === "false")
        await toggle.click();
    }
    async function select(publicId, orderId) {
      await expect(page.locator("[data-orders-workspace]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await page.locator("[data-orders-search]").fill(publicId);
      await page.locator("[data-orders-apply]").click();
      await page.locator(`[data-order-id="${orderId}"]`).click();
      await unfoldFinance();
      await page
        .locator(`[data-finance-detail="${orderId}"]`)
        .waitFor({ timeout: 60000 });
      await expect(page.locator("[data-finance-panel]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    }
    async function capture(name) {
      await expect.poll(() => outstandingReads.size).toBe(0);
      await expect(
        page.locator('[data-orders-workspace] [aria-busy="true"]'),
      ).toHaveCount(0);
      await expect(page.locator("[data-orders-workspace]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      assert(
        (await page.locator("[data-private-panel]").count()) === 0,
        `${name} excludes private panels`,
      );
      assert(
        privateValues.every((value) => !page.url().includes(value)),
        `${name} URL excludes private values`,
      );
      const body = await page.locator("body").innerText();
      assert(
        privateValues.every((value) => !body.includes(value)),
        `${name} excludes private canaries`,
      );
      const file = `${name}.png`;
      await page.screenshot({
        path: path.join(directory, file),
        fullPage: true,
      });
      report.screenshots.push(file);
      const axe = await new AxeBuilder({ page }).analyze();
      report.axe.push({
        name,
        violations: axe.violations,
        incomplete: axe.incomplete,
      });
      assert(
        axe.violations.length === 0,
        `${name} has no accessibility violations`,
      );
      assert(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth + 1,
        ),
        `${name} has no horizontal overflow`,
      );
    }
    for (const locale of SUPPORTED_LOCALES)
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ]) {
        stage = `matrix-${locale}-${viewport.width}`;
        await page.setViewportSize(viewport);
        await enter("MANAGER", locale);
        await page.locator("[data-finance-navigation]").click();
        await expect(page.locator("[data-finance-list]")).toHaveAttribute(
          "aria-busy",
          "false",
        );
        await capture(`${locale}-${viewport.width}-reconciliation`);
        await page
          .locator("[data-finance-search]")
          .fill(fixture.paidPublicOrderId);
        await page
          .locator("[data-finance-list] form button[type=submit]")
          .click();
        await page
          .locator(`[data-finance-order="${fixture.paidOrderId}"]`)
          .click();
        await unfoldFinance();
        await page.locator("[data-finance-mode]").waitFor();
        await expect(page.locator("[data-finance-submit]")).toBeDisabled();
        await capture(`${locale}-${viewport.width}-refund-full`);
        await page.locator("[data-finance-mode]").selectOption("PARTIAL");
        await expect(page.locator("[data-finance-submit]")).toBeDisabled();
        await capture(`${locale}-${viewport.width}-refund-partial`);
        assert(
          (await page.locator("html").getAttribute("lang")) === locale,
          `${locale} retains HTML language`,
        );
      }
    report.cases.push(
      "seven-language-two-viewport-reconciliation-full-partial",
    );
    stage = "keyboard-and-read-error";
    await page.setViewportSize({ width: 390, height: 844 });
    await enter();
    await select(fixture.paidPublicOrderId, fixture.paidOrderId);
    await page.locator("[data-finance-mode]").focus();
    await page.keyboard.press("Tab");
    assert(
      await page
        .locator("[data-finance-reason]")
        .evaluate((node) => globalThis.document.activeElement === node),
      "keyboard reaches reason after refund mode",
    );
    assert(
      await page.evaluate(
        () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "reduced motion remains enabled",
    );
    const failDetail = (route) => route.abort("failed");
    await page.route("**/api/admin/finance-detail", failDetail);
    await page.locator("[data-finance-refresh]").click();
    await page.locator("[data-finance-error]").waitFor();
    await capture("en-390-finance-read-error");
    await page.unroute("**/api/admin/finance-detail", failDetail);
    await page.locator("[data-finance-refresh]").click();
    await page.locator("[data-finance-mode]").waitFor();
    report.cases.push("keyboard-reduced-motion-read-error-recovery");
    stage = "role-boundary";
    for (const locale of SUPPORTED_LOCALES) {
      await enter("ORDER_OPERATOR", locale);
      await select(fixture.paidPublicOrderId, fixture.paidOrderId);
      assert(
        (await page.locator("[data-finance-form]").count()) === 0,
        `${locale} order operator cannot submit financial commands`,
      );
      assert(
        (await page.locator("[data-finance-refund]").count()) === 0,
        `${locale} order operator cannot request refund`,
      );
      await capture(`${locale}-390-finance-read-only`);
    }
    report.cases.push("seven-language-server-driven-financial-role-boundary");
    stage = "refund-lost-response";
    await enter();
    await select(fixture.paidPublicOrderId, fixture.paidOrderId);
    await page.locator("[data-finance-mode]").selectOption("PARTIAL");
    const amounts = page.locator("[data-finance-item]");
    assert(
      (await amounts.count()) >= 2,
      "refund fixture exposes multiple independent gift allocations",
    );
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency: fixture.currency ?? "USD",
    }).resolvedOptions().maximumFractionDigits;
    const oneMinorUnit = digits === 0 ? "1" : `0.${"0".repeat(digits - 1)}1`;
    const allocationLabels = await amounts.evaluateAll((inputs) =>
      inputs.map((input) => input.getAttribute("aria-label")),
    );
    assert(
      allocationLabels.length === 2 &&
        allocationLabels.every(Boolean) &&
        new Set(allocationLabels).size === allocationLabels.length,
      "same gift for different artists has distinct refund input labels",
    );
    await amounts.nth(0).fill(oneMinorUnit);
    await amounts.nth(1).fill(oneMinorUnit);
    await expect(amounts.nth(0)).toHaveValue(oneMinorUnit);
    await expect(amounts.nth(1)).toHaveValue(oneMinorUnit);
    await page.locator("[data-finance-confirm]").check();
    await expect(page.locator("[data-finance-submit]")).toBeEnabled();
    const requests = [];
    let loseResponse = true;
    const lost = (route) =>
      tasks.run(
        async () => {
          requests.push({
            key: route.request().headers()["idempotency-key"],
            command: route.request().postDataJSON(),
          });
          if (loseResponse) {
            loseResponse = false;
            await route.fetch({ timeout: 30000 });
            await route.abort("failed");
          } else await route.continue();
        },
        { stage, kind: "REFUND_INTERCEPTION" },
      );
    await page.route("**/api/admin/finance-refund", lost);
    const before = readFacts ? await readFacts(fixture.paidOrderId) : null;
    await page.locator("[data-finance-submit]").click();
    await page.locator("[data-finance-retry]").waitFor();
    await expect(page.locator("[data-finance-submit]")).toBeDisabled();
    await capture("en-390-refund-unconfirmed-response");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-management-section="ORDERS"]').click();
    await page.locator("[data-orders-search]").waitFor();
    await select(fixture.paidPublicOrderId, fixture.paidOrderId);
    await page.locator("[data-finance-retry]").waitFor();
    assert(
      (await page.locator("[data-finance-submit]:enabled").count()) === 0,
      "browser reload restores unresolved request and blocks a new financial command",
    );
    await page.locator("[data-finance-retry]").click();
    await page.locator("[data-finance-refund-record]").first().waitFor();
    await expect(page.locator("[data-finance-panel]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page.unroute("**/api/admin/finance-refund", lost);
    assert(
      requests.length === 2 &&
        requests[0].key === requests[1].key &&
        JSON.stringify(requests[0].command) ===
          JSON.stringify(requests[1].command),
      "lost refund response recovers the exact same key and payload",
    );
    if (readFacts) {
      const after = await readFacts(fixture.paidOrderId);
      assert(
        after.refundCount === before.refundCount + 1,
        "retry creates exactly one refund record",
      );
    }
    await capture("en-390-partial-refund-recorded");
    report.cases.push("partial-allocation-lost-response-idempotent-recovery");
    stage = "remaining-full-refund";
    const pendingRefund = page.locator("[data-finance-reconcile-refund]");
    if (await pendingRefund.count()) {
      await prepareReconcile(
        await pendingRefund
          .first()
          .getAttribute("data-finance-reconcile-refund"),
      );
      await pendingRefund.first().click();
      await expect(page.locator("[data-finance-form]")).toBeFocused();
      await page.locator("[data-finance-confirm]").check();
      await page.locator("[data-finance-submit]").click();
      await page.locator("[data-finance-mode]").waitFor();
    }
    await page.locator("[data-finance-mode]").selectOption("FULL");
    await page.locator("[data-finance-confirm]").check();
    await page.locator("[data-finance-submit]").click();
    await expect(page.locator("[data-finance-refund-record]")).toHaveCount(2);
    await capture("en-390-full-remaining-refund");
    report.cases.push("refund-full-remaining-balance");
    stage = "unknown-recovery";
    await enter();
    await select(fixture.unknownPublicOrderId, fixture.unknownOrderId);
    await page.locator("[data-finance-pending]").waitFor();
    assert(
      (await page.locator("[data-finance-refund]").count()) === 0,
      "UNKNOWN retains capacity and withholds a new refund action",
    );
    await capture("en-390-unknown-refund");
    await prepareReconcile(
      await page
        .locator("[data-finance-reconcile-refund]")
        .first()
        .getAttribute("data-finance-reconcile-refund"),
    );
    await page
      .locator(
        "[data-finance-reconcile-refund], [data-finance-reconcile-payment]",
      )
      .first()
      .click();
    await expect(page.locator("[data-finance-form]")).toBeFocused();
    await expect(page.locator("[data-finance-submit]")).toBeDisabled();
    await page.locator("[data-finance-confirm]").check();
    await page.locator("[data-finance-submit]").click();
    await expect(page.locator("[data-finance-panel]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator("[data-finance-pending]")).toHaveCount(0);
    await capture("en-390-unknown-reconciled");
    report.cases.push("unknown-reservation-and-confirmed-reconciliation");
    stage = "cancel-unpaid";
    await enter();
    await select(fixture.cancelPublicOrderId, fixture.cancelOrderId);
    await page.locator("[data-finance-cancel]").click();
    await expect(page.locator("[data-finance-submit]")).toBeDisabled();
    await page.locator("[data-finance-confirm]").check();
    await page.locator("[data-finance-submit]").click();
    await expect(page.locator("[data-finance-panel]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator("[data-finance-cancel]")).toHaveCount(0);
    await capture("en-390-cancel-result");
    report.cases.push("cancel-unpaid-confirmation");
    stage = "cancel-without-attempt";
    assert(
      Boolean(fixture.noAttemptOrderId && fixture.noAttemptPublicOrderId),
      "browser fixture includes order before payment creation",
    );
    await enter();
    await select(fixture.noAttemptPublicOrderId, fixture.noAttemptOrderId);
    await page.locator("[data-finance-cancel]").click();
    await expect(page.locator("[data-finance-form]")).toBeFocused();
    await expect(page.locator("[data-finance-submit]")).toBeDisabled();
    await page.locator("[data-finance-confirm]").check();
    await page.locator("[data-finance-submit]").click();
    await expect(page.locator("[data-finance-cancel]")).toHaveCount(0);
    await capture("en-390-cancel-without-attempt");
    report.cases.push("cancel-before-provider-attempt");
    stage = "dispute-refund-hold";
    assert(
      Boolean(fixture.disputeOrderId && fixture.disputePublicOrderId),
      "browser fixture includes trusted provider dispute",
    );
    await enter();
    await select(fixture.disputePublicOrderId, fixture.disputeOrderId);
    await page.locator("[data-finance-dispute-hold]").waitFor();
    assert(
      (await page.locator("[data-finance-refund]").count()) === 0,
      "disputed payment provides explanation without new refund action",
    );
    await capture("en-390-dispute-refund-hold");
    report.cases.push("dispute-refund-hold");
    await tasks.drain();
    assert(report.errors.length === 0, "browser has no page errors");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      stage,
      category:
        error?.name === "TimeoutError" ? "TIMEOUT" : "ASSERTION_OR_RUNTIME",
      frames:
        String(error?.stack ?? "").match(
          /admin-finance-browser\.mjs:[0-9]+:[0-9]+/gu,
        ) ?? [],
    };
    throw error;
  } finally {
    await tasks.drain();
    await browser?.close();
    report.finishedAt = new Date().toISOString();
    await writeFile(
      path.join(directory, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}
