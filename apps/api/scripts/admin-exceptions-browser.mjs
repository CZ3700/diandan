import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { URL } from "node:url";
import { chromium, expect } from "@playwright/test";
import {
  SUPPORTED_LOCALES,
  adminExceptionsResponseSchema,
} from "@fan-support/contracts";
import { createAdminOrdersBrowserTasks } from "./admin-orders-browser.mjs";
const require = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const { default: AxeBuilder } = require("@axe-core/playwright");
/** Real UI → BFF → API. Reports contain only safe projections and transport status. */
export async function verifyAdminExceptionsBrowser({
  adminOrigin,
  issuer,
  output,
  check,
  authenticate,
  fixture,
  mediaOrigins = [],
  revokeAccess,
  restoreAccess,
  armApiResponseLoss,
  assertEffects,
}) {
  const directory = path.join(output, "browser-exceptions");
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
      "Local isolated PostgreSQL, TLS OIDC and TEST payment/notification providers only",
      "Phone viewport is browser emulation, not a physical device",
      "Seven-language source copy remains DRAFT pending human review",
    ],
  };
  const assert = (value, label) => {
    report.assertions.push({ label, passed: Boolean(value) });
    check(Boolean(value), label);
  };
  const tasks = createAdminOrdersBrowserTasks((failure) =>
    report.errors.push(failure),
  );
  let browser,
    page,
    stage = "start",
    lastDetail = null,
    lastReceipt = null,
    lastList = null;
  try {
    const origins = [adminOrigin, new URL(issuer).origin, ...mediaOrigins];
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
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", () =>
      report.errors.push({ stage, kind: "PAGE_ERROR" }),
    );
    page.on("response", (response) =>
      tasks.run(
        async () => {
          const pathname = new URL(response.url()).pathname;
          if (!pathname.startsWith("/api/admin/exceptions-")) return;
          report.transport.push({
            stage,
            path: pathname,
            status: response.status(),
          });
          if (response.ok()) {
            const value = adminExceptionsResponseSchema.safeParse(
              await response.json(),
            );
            if (value.success && value.data.outcome === "SUCCESS") {
              if (value.data.kind === "DETAIL") lastDetail = value.data;
              if (value.data.kind === "LIST") lastList = value.data;
              if (value.data.kind === "MUTATION") lastReceipt = value.data;
            }
          }
        },
        { stage, kind: "SAFE_RESPONSE_OBSERVATION" },
      ),
    );
    async function idle() {
      await expect(page.locator("[data-exceptions-workspace]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await tasks.drain();
    }
    async function clickAndRead(locator, kind) {
      await Promise.all([
        page.waitForResponse(
          (r) => new URL(r.url()).pathname === `/api/admin/exceptions-${kind}`,
        ),
        locator.click(),
      ]);
      await idle();
    }
    async function open() {
      await clickAndRead(
        page.locator('[data-management-section="EXCEPTIONS"]'),
        "list",
      );
    }
    async function refreshRead() {
      await clickAndRead(
        page.locator("[data-exceptions-reload]"),
        (await page.locator("[data-exceptions-back]").count())
          ? "detail"
          : "list",
      );
    }
    async function enter(role = "manager", locale = "en") {
      lastDetail = null;
      lastReceipt = null;
      lastList = null;
      await authenticate(page, role, locale);
      await open();
    }
    async function filter(category = "ALL", status = "ALL") {
      if (await page.locator("[data-exceptions-back]").count()) {
        await clickAndRead(page.locator("[data-exceptions-back]"), "list");
      }
      await page.locator("[data-exceptions-category]").selectOption(category);
      await page.locator("[data-exceptions-status]").selectOption(status);
      await clickAndRead(page.locator("[data-exceptions-filter]"), "list");
      assert(
        lastList.items.every(
          (item) => category === "ALL" || item.target.kind === category,
        ),
        `${stage} filter returns the requested source category`,
      );
    }
    async function select(target) {
      await filter(target.kind, "ALL");
      while (
        !(await page
          .locator(
            `[data-exceptions-row="${target.id}"][data-exceptions-kind="${target.kind}"]`,
          )
          .count()) &&
        (await page.locator("[data-exceptions-next]").isEnabled())
      ) {
        await clickAndRead(page.locator("[data-exceptions-next]"), "list");
      }
      await clickAndRead(
        page
          .locator(
            `[data-exceptions-row="${target.id}"][data-exceptions-kind="${target.kind}"]`,
          )
          .first(),
        "detail",
      );
      assert(
        lastDetail?.item.target.id === target.id,
        `${stage} opens the exact source`,
      );
    }
    async function capture(name) {
      await idle();
      if (
        !name.includes("error") &&
        !name.includes("uncertain") &&
        !name.includes("revoked")
      ) {
        assert(
          (await page.locator("[data-workspace-access-retry]").count()) === 0,
          `${name} healthy workspace has no unrelated discovery error`,
        );
      }
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
        axe.incomplete.length === 0,
        `${name} has no unresolved accessibility checks`,
      );
      assert(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth + 1,
        ),
        `${name} has no horizontal overflow`,
      );
      assert(
        await page.locator("[data-management-section]").evaluateAll((buttons) =>
          buttons.every((button) => {
            const box = button.getBoundingClientRect();
            const text = globalThis.document.createRange();
            text.selectNodeContents(button);
            return [...text.getClientRects()].every(
              (line) =>
                line.left >= box.left &&
                line.right <= box.right &&
                line.top >= box.top &&
                line.bottom <= box.bottom,
            );
          }),
        ),
        `${name} navigation text remains inside controls`,
      );
      assert(
        (await page.locator("[data-private-panel]").count()) === 0,
        `${name} contains no private fan panel`,
      );
    }
    async function confirm() {
      await page
        .locator("[data-exceptions-reason]")
        .selectOption("OPERATOR_REVIEW");
      await page.locator("[data-exceptions-confirm]").check();
      await page.locator("[data-exceptions-submit]").click();
    }
    const targets = [
      fixture.webhookTarget,
      fixture.deadLetterTarget,
      fixture.paymentTarget,
      fixture.notificationTarget,
    ];
    for (const locale of SUPPORTED_LOCALES)
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ]) {
        stage = `matrix-${locale}-${viewport.width}`;
        await page.setViewportSize(viewport);
        await enter("manager", locale);
        await capture(`${stage}-list`);
        for (const target of targets) {
          await select(target);
          await capture(`${stage}-${target.kind.toLowerCase()}`);
        }
        assert(
          (await page.locator("html").getAttribute("lang")) === locale,
          `${stage} preserves document language`,
        );
      }
    report.cases.push("seven-languages-two-viewports-four-source-types");
    stage = "readonly";
    await page.setViewportSize({ width: 390, height: 844 });
    for (const locale of SUPPORTED_LOCALES) {
      await enter("order", locale);
      await select(fixture.webhookTarget);
      assert(
        (await page.locator("[data-exceptions-submit]").count()) === 0,
        `${locale} readonly has no mutation`,
      );
      await capture(`${locale}-390-readonly`);
    }
    report.cases.push("seven-language-webhook-mutation-readonly");
    stage = "no-access";
    await authenticate(page, "editor", "en");
    await expect(
      page.locator('[data-management-section="EXCEPTIONS"]'),
    ).toHaveCount(0);
    assert(
      (await page.locator("[data-exceptions-detail]").count()) === 0,
      "unauthorized role has no exception details",
    );
    report.cases.push("no-access");
    stage = "blocked-notification";
    await enter();
    await select(fixture.blockedNotificationTarget);
    await expect(page.locator("[data-exceptions-submit]")).toHaveCount(0);
    assert(
      lastDetail?.item.blockedReason !== "NONE",
      "uncertain notification exposes a next-step restriction",
    );
    await capture("en-390-notification-blocked");
    report.cases.push("uncertain-notification-not-resendable");
    stage = "keyboard-network";
    await filter();
    await page.locator("[data-exceptions-reload]").focus();
    await page.keyboard.press("Tab");
    assert(
      await page
        .locator("[data-exceptions-category]")
        .evaluate((node) => globalThis.document.activeElement === node),
      "keyboard reaches category filter",
    );
    assert(
      await page.evaluate(
        () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "reduced motion is active",
    );
    const failRead = (route) => route.abort("failed");
    await page.route("**/api/admin/exceptions-list", failRead);
    await page.locator("[data-exceptions-reload]").click();
    await page.getByRole("alert").last().waitFor();
    await capture("en-390-read-error");
    await page.unroute("**/api/admin/exceptions-list", failRead);
    await refreshRead();
    report.cases.push("keyboard-reduced-motion-network-recovery");
    await filter("ALL", "ALL");
    if (lastList?.totalItems > lastList?.pageSize) {
      const first = lastList.items.map(
        (item) =>
          `${item.target.kind}:${item.target.id}:${item.target.consumerKey}`,
      );
      await clickAndRead(page.locator("[data-exceptions-next]"), "list");
      assert(lastList.page === 2, "server pagination advances");
      assert(
        lastList.items.every(
          (item) =>
            !first.includes(
              `${item.target.kind}:${item.target.id}:${item.target.consumerKey}`,
            ),
        ),
        "pages have distinct stable rows",
      );
      await clickAndRead(page.locator("[data-exceptions-previous]"), "list");
      report.cases.push("server-pagination");
    }
    async function lostResponse(target, layer) {
      stage = `${layer}-lost-response`;
      await select(target);
      assert(
        lastDetail.item.allowedAction !== null,
        `${layer} fixture action is available`,
      );
      const action = lastDetail.item.allowedAction,
        pattern = `**/api/admin/exceptions-${action.toLowerCase().replaceAll("_", "-")}`;
      const requests = [];
      let first = true;
      if (layer === "upstream") await armApiResponseLoss(action);
      const intercept = (route) =>
        tasks.run(
          async () => {
            requests.push({
              key: route.request().headers()["idempotency-key"],
              body: route.request().postDataJSON(),
            });
            if (first && layer === "browser") {
              first = false;
              const accepted = await route.fetch({ timeout: 30000 });
              const receipt = adminExceptionsResponseSchema.parse(
                await accepted.json(),
              );
              assert(
                receipt.outcome === "SUCCESS" && receipt.kind === "MUTATION",
                "real command accepted before browser response loss",
              );
              await route.abort("failed");
            } else await route.continue();
          },
          { stage, kind: "LOST_RESPONSE" },
        );
      await page.route(pattern, intercept);
      await confirm();
      await page.locator("[data-exceptions-recover]").waitFor();
      await idle();
      await capture(`en-390-${layer}-uncertain`);
      if (layer === "browser") {
        if (!revokeAccess || !restoreAccess)
          throw new Error("Revocation hooks are required");
        await revokeAccess();
        await clickAndRead(
          page.locator("[data-exceptions-recover]"),
          action.toLowerCase().replaceAll("_", "-"),
        );
        await expect(page.locator("[data-exceptions-detail]")).toHaveCount(0);
        await expect(page.locator("[data-exceptions-recover]")).toHaveCount(0);
        await expect(page.locator("[data-exceptions-pending]")).toHaveCount(1);
        await capture("en-390-uncertain-access-revoked");
        await restoreAccess();
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      await open();
      await page.locator("[data-exceptions-recover]").waitFor();
      await idle();
      await clickAndRead(
        page.locator("[data-exceptions-recover]"),
        action.toLowerCase().replaceAll("_", "-"),
      );
      await expect(page.locator("[data-exceptions-pending]")).toHaveCount(0);
      await idle();
      await page.unroute(pattern, intercept);
      assert(
        requests.length === (layer === "browser" ? 3 : 2) &&
          requests.every(
            (request) =>
              request.key === requests[0].key &&
              JSON.stringify(request.body) === JSON.stringify(requests[0].body),
          ),
        `${layer} refresh recovery preserves original key and body`,
      );
      assert(
        lastReceipt?.replayed === true,
        `${layer} recovery returns the original receipt`,
      );
      await assertEffects?.(target, layer);
      await refreshRead();
      await capture(`en-390-${layer}-recovered`);
      report.cases.push(`${layer}-lost-response-refresh-original-request`);
    }
    await lostResponse(fixture.webhookTarget, "browser");
    if (!armApiResponseLoss)
      throw new Error("Upstream response-loss hook is required");
    await lostResponse(fixture.deadLetterTarget, "upstream");
    for (const target of [fixture.paymentTarget, fixture.notificationTarget]) {
      stage = `action-${target.kind.toLowerCase()}`;
      await select(target);
      assert(
        lastDetail.item.allowedAction !== null,
        `${target.kind} action is available`,
      );
      const mutationPath = `/api/admin/exceptions-${lastDetail.item.allowedAction.toLowerCase().replaceAll("_", "-")}`;
      await Promise.all([
        page.waitForResponse(
          (response) => new URL(response.url()).pathname === mutationPath,
        ),
        confirm(),
      ]);
      await idle();
      await expect(page.locator("[data-exceptions-pending]")).toHaveCount(0);
      await assertEffects?.(target, "direct");
      await refreshRead();
      await capture(`en-390-${target.kind.toLowerCase()}-recorded`);
    }
    report.cases.push(
      "original-payment-reconcile-and-controlled-notification-retry",
    );
    stage = "post-recovery-open-payments";
    await filter("PAYMENT", "OPEN");
    if (lastList?.totalItems === 0) {
      await expect(page.locator("[data-exceptions-empty]")).toBeVisible();
      await capture("en-390-empty-payments");
      report.cases.push("real-empty-open-payment-list");
    }
    if (!revokeAccess || !restoreAccess)
      throw new Error("Revocation hooks are required");
    stage = "revocation";
    await select(fixture.webhookTarget);
    await revokeAccess();
    await clickAndRead(page.locator("[data-exceptions-reload]"), "context");
    await expect(page.locator("[data-exceptions-detail]")).toHaveCount(0);
    await expect(page.locator("[data-exceptions-submit]")).toHaveCount(0);
    await capture("en-390-access-revoked");
    await restoreAccess();
    await refreshRead();
    await expect(page.locator("[data-exceptions-detail]")).toBeVisible();
    assert(
      (await page.locator("[data-exceptions-detail]").count()) === 1 &&
        lastDetail?.item.target.id === fixture.webhookTarget.id,
      "restored authority reads fresh detail",
    );
    await capture("en-390-access-restored");
    report.cases.push("live-access-revocation-and-recovery");
    await tasks.drain();
    assert(
      report.errors.length === 0,
      "browser has no page or asynchronous errors",
    );
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      stage,
      category:
        error?.name === "TimeoutError" ? "TIMEOUT" : "ASSERTION_OR_RUNTIME",
      frames:
        String(error?.stack ?? "").match(
          /admin-exceptions-browser\.mjs:[0-9]+:[0-9]+/gu,
        ) ?? [],
      lastList: lastList
        ? {
            page: lastList.page,
            totalItems: lastList.totalItems,
            targets: lastList.items.map((item) => item.target),
          }
        : null,
    };
    if (page && (await page.locator("[data-exceptions-workspace]").count())) {
      try {
        await page.screenshot({
          path: path.join(directory, "failure.png"),
          fullPage: true,
        });
        report.screenshots.push("failure.png");
      } catch {
        /* The sanitized failure report remains available if the page closed. */
      }
    }
    throw error;
  } finally {
    await tasks.drain();
    await browser?.close();
    report.finishedAt = new Date().toISOString();
    await writeFile(
      path.join(directory, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
  return report;
}
