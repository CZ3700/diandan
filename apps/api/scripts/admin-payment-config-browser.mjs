import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { URL } from "node:url";
import { chromium, expect } from "@playwright/test";
import {
  SUPPORTED_LOCALES,
  adminPaymentConfigurationResponseSchema,
} from "@fan-support/contracts";
import { createAdminOrdersBrowserTasks } from "./admin-orders-browser.mjs";
const require = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const { default: AxeBuilder } = require("@axe-core/playwright");
/** Real UI→BFF→API commands. Reports never include cookies, CSRF, merchant credentials or raw response bodies. */
export async function verifyAdminPaymentConfigurationBrowser({
  adminOrigin,
  issuer,
  output,
  check,
  authenticate,
  fixture,
  mediaOrigins = [],
  observePublication,
}) {
  const directory = path.join(output, "browser-payment-configuration");
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
      "Next development server, real isolated PostgreSQL, TLS OIDC and TEST PSP only",
      "390×844 is browser emulation, not a physical phone",
      "Seven source UI translations remain DRAFT pending human review",
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
    stage = "start",
    workspace = null,
    lastReceipt = null;
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
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", () =>
      report.errors.push({ stage, kind: "PAGE_ERROR" }),
    );
    page.on("response", (response) =>
      tasks.run(
        async () => {
          const pathname = new URL(response.url()).pathname;
          if (
            /^\/api\/admin\/(?:auth\/(?:begin|callback)|session|payment-config-[a-z]+)$/u.test(
              pathname,
            )
          )
            report.transport.push({
              stage,
              path: pathname,
              status: response.status(),
            });
          if (
            pathname.startsWith("/api/admin/payment-config-") &&
            response.ok()
          ) {
            const parsed = adminPaymentConfigurationResponseSchema.safeParse(
              await response.json(),
            );
            if (parsed.success && parsed.data.outcome === "SUCCESS") {
              if (parsed.data.kind === "WORKSPACE") workspace = parsed.data;
              if (parsed.data.kind === "MUTATION") lastReceipt = parsed.data;
            }
          }
        },
        { stage, kind: "SAFE_RESPONSE_OBSERVATION" },
      ),
    );
    async function idle() {
      await expect(page.locator("[data-payment-workspace]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await tasks.drain();
    }
    async function openPayments() {
      const refreshed = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/admin/payment-config-read",
      );
      await page.locator('[data-management-section="PAYMENTS"]').click();
      await refreshed;
      await idle();
    }
    async function returnToPayments() {
      await page.locator('[data-management-section="ORDERS"]').click();
      await page.locator("[data-orders-workspace]").waitFor();
      await openPayments();
    }
    async function enter(
      role = "PAYMENT_MANAGER",
      locale = "en",
      revisionId = null,
    ) {
      workspace = null;
      await authenticate(page, role, locale);
      await openPayments();
      assert(!!workspace, `${stage} authenticated workspace returned`);
      if (revisionId && workspace.selected?.revisionId !== revisionId) {
        const item = workspace.history.find(
          (item) => item.revisionId === revisionId,
        );
        assert(!!item, `${stage} requested revision is listed`);
        await page
          .locator(`[data-payment-open-version="${item.version}"]`)
          .click();
        await idle();
        assert(
          workspace.selected?.revisionId === revisionId,
          `${stage} opens exact managed revision`,
        );
      }
    }
    async function capture(name) {
      await idle();
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
        `${name} keeps navigation labels inside their buttons`,
      );
      assert(
        (await page.locator("[data-private-panel]").count()) === 0,
        `${name} has no private fan panel`,
      );
    }
    async function fillDocument(document) {
      await page.locator("[data-payment-edit]").click();
      for (const kind of ["channel", "rule"])
        while (await page.locator(`[data-payment-${kind}]`).count())
          await page
            .locator(`[data-payment-${kind}]`)
            .last()
            .locator("button")
            .last()
            .click();
      for (const [index, channel] of document.channels.entries()) {
        await page.locator("[data-payment-add-channel]").click();
        const prefix = `c${index}`;
        await page
          .locator(`[name="${prefix}.account"]`)
          .selectOption(channel.providerAccountId);
        await page
          .locator(`[name="${prefix}.enabled"]`)
          .setChecked(channel.enabled);
        await page
          .locator(`[name="${prefix}.order"]`)
          .fill(String(channel.displayOrder));
        await page
          .locator(`[name="${prefix}.rollout"]`)
          .fill(String(channel.rolloutBasisPoints / 100));
        const health = page
          .locator("[data-payment-channel]")
          .nth(index)
          .locator("details");
        if (!(await health.evaluate((node) => node.open)))
          await health.locator("summary").click();
        for (const [key, value] of Object.entries(channel.healthPolicy))
          await page
            .locator(`[name="${prefix}.${key}"]`)
            .fill(String(key === "failureThreshold" ? value : value / 1000));
        for (const text of channel.translations) {
          await page
            .locator("[data-payment-channel]")
            .nth(index)
            .locator(".mp-copy-editor > label select")
            .selectOption(text.locale);
          await page
            .locator(`[name="${prefix}.${text.locale}.name"]`)
            .fill(text.displayName);
          await page
            .locator(`[name="${prefix}.${text.locale}.hint"]`)
            .fill(text.customerHint);
        }
      }
      for (const [index, rule] of document.routes.entries()) {
        await page.locator("[data-payment-add-rule]").click();
        const p = `r${index}`;
        await page
          .locator(`[name="${p}.account"]`)
          .selectOption(rule.providerAccountId);
        await page
          .locator(`[name="${p}.method"]`)
          .selectOption(rule.paymentMethod);
        await page.locator(`[name="${p}.enabled"]`).setChecked(rule.enabled);
        for (const key of ["countries", "markets", "currencies"])
          await page.locator(`[name="${p}.${key}"]`).fill(rule[key].join(", "));
        for (const [key, value] of Object.entries({
          minimum: rule.minimumAmountMinor,
          maximum: rule.maximumAmountMinor,
          priority: rule.priority,
          rollout: rule.rolloutBasisPoints / 100,
        }))
          await page.locator(`[name="${p}.${key}"]`).fill(String(value));
        for (const capability of rule.requiredDeviceCapabilities)
          await page
            .locator(`[name="${p}.devices"][value="${capability}"]`)
            .check();
      }
    }
    async function save() {
      lastReceipt = null;
      await page.locator("[data-payment-save]").click();
      await expect(page.locator("[data-payment-editor]")).toHaveCount(0);
      await idle();
      assert(lastReceipt?.action === "SAVE", `${stage} persisted a real draft`);
      return lastReceipt.revisionId;
    }
    async function checkFor(mode) {
      await page.locator(`[data-payment-check-${mode.toLowerCase()}]`).click();
      await page.locator("[data-payment-validation]").waitFor();
      await idle();
      await expect(page.locator("[data-payment-validation]")).toBeFocused();
    }
    async function confirm() {
      await page
        .locator('[data-payment-confirm-publication] input[type="checkbox"]')
        .check();
      await page
        .locator('[data-payment-confirm-publication] button[type="submit"]')
        .click();
    }
    async function lostPublication(mode) {
      await checkFor(mode);
      const form = page.locator("[data-payment-confirm-publication]");
      await expect(form).toHaveCount(1);
      await expect(form.locator('button[type="submit"]')).toBeDisabled();
      await capture(`en-390-${mode.toLowerCase()}-confirmation`);
      const requests = [];
      let first = true;
      const pattern = `**/api/admin/payment-config-${mode.toLowerCase()}`;
      const intercept = (route) =>
        tasks.run(
          async () => {
            requests.push({
              key: route.request().headers()["idempotency-key"],
              body: route.request().postDataJSON(),
            });
            if (first) {
              first = false;
              const accepted = await route.fetch({ timeout: 30000 });
              const receipt = adminPaymentConfigurationResponseSchema.parse(
                await accepted.json(),
              );
              assert(
                receipt.outcome === "SUCCESS" && receipt.kind === "MUTATION",
                `${mode} response lost after real accepted commit`,
              );
              await route.abort("failed");
            } else await route.continue();
          },
          { stage, kind: "LOST_PUBLICATION_RESPONSE" },
        );
      await page.route(pattern, intercept);
      await confirm();
      await page.locator("[data-payment-recover]").waitFor();
      await idle();
      await capture(`en-390-${mode.toLowerCase()}-uncertain`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await openPayments();
      await page.locator("[data-payment-recover]").waitFor();
      await idle();
      await expect(page.locator("[data-payment-edit]")).toBeDisabled();
      await page.locator("[data-payment-recover]").click();
      await expect(page.locator("[data-payment-pending]")).toHaveCount(0);
      await idle();
      await page.unroute(pattern, intercept);
      assert(
        requests.length === 2 &&
          requests[0].key === requests[1].key &&
          JSON.stringify(requests[0].body) === JSON.stringify(requests[1].body),
        `${mode} reload replays exactly the original key and payload`,
      );
      assert(
        lastReceipt?.action === mode && lastReceipt.replayed,
        `${mode} recovery returns original receipt`,
      );
      const observation = await observePublication(lastReceipt.generation);
      report.publications ??= [];
      report.publications.push({ action: mode, ...observation });
      assert(
        observation.observations.length === 2 &&
          observation.observations.every(
            (node) => node.generation === lastReceipt.generation,
          ) &&
          observation.elapsedMs <= 60000,
        `${mode} reaches two independent nodes within 60 seconds`,
      );
      await capture(`en-390-${mode.toLowerCase()}-recovered`);
    }
    stage = "author-draft";
    await enter();
    const document = globalThis.structuredClone(fixture.configuration);
    document.channels = document.channels.map((channel) => ({
      ...channel,
      translations: channel.translations.map((text) => ({
        ...text,
        displayName: `${text.displayName.slice(0, 72)} UI`,
        translatedFromSourceHash: null,
      })),
    }));
    await fillDocument(document);
    await capture("en-390-draft-complete");
    const firstRevision = await save();
    await returnToPayments();
    assert(
      workspace.history.some((item) => item.revisionId === firstRevision),
      "returning to payment settings reads the newly saved draft history",
    );
    for (const locale of SUPPORTED_LOCALES)
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ]) {
        stage = `matrix-${locale}-${viewport.width}`;
        await page.setViewportSize(viewport);
        await enter("PAYMENT_MANAGER", locale, firstRevision);
        await capture(`${locale}-${viewport.width}-settings`);
        await checkFor("PUBLISH");
        await expect(
          page.locator("[data-payment-confirm-publication]"),
        ).toHaveCount(0);
        await capture(`${locale}-${viewport.width}-validation-blocked`);
        await page.locator("[data-payment-edit]").click();
        await capture(`${locale}-${viewport.width}-editor`);
        assert(
          (await page.locator("html").getAttribute("lang")) === locale,
          `${locale} preserves document language`,
        );
      }
    report.cases.push(
      "seven-languages-two-viewports-settings-validation-editor",
    );
    stage = "readonly-boundary";
    await page.setViewportSize({ width: 390, height: 844 });
    for (const locale of SUPPORTED_LOCALES) {
      await enter("READONLY", locale, firstRevision);
      assert(
        (await page
          .locator(
            "[data-payment-edit], [data-payment-check-publish], [data-payment-check-rollback], [data-payment-submit], [data-payment-approve]",
          )
          .count()) === 0,
        `${locale} read-only role has no mutation controls`,
      );
      await capture(`${locale}-390-readonly`);
    }
    report.cases.push("seven-language-readonly-server-authority");
    stage = "keyboard-error-recovery";
    await enter("PAYMENT_MANAGER", "en", firstRevision);
    await page.locator("[data-payment-refresh]").focus();
    await page.keyboard.press("Tab");
    assert(
      await page
        .locator("[data-payment-edit]")
        .evaluate((node) => globalThis.document.activeElement === node),
      "keyboard moves from refresh to edit",
    );
    assert(
      await page.evaluate(
        () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "reduced motion remains enabled",
    );
    const failRead = (route) => route.abort("failed");
    await page.route("**/api/admin/payment-config-read", failRead);
    await page.locator("[data-payment-refresh]").click();
    await page.getByRole("alert").last().waitFor();
    await capture("en-390-read-error");
    await page.unroute("**/api/admin/payment-config-read", failRead);
    await page.locator("[data-payment-refresh]").click();
    await idle();
    report.cases.push("keyboard-reduced-motion-network-error-recovery");
    stage = "independent-language-review";
    assert(
      (await page.locator("[data-payment-approve]").count()) === 0,
      "author cannot approve own copy",
    );
    while (await page.locator("[data-payment-submit]").count()) {
      await page.locator("[data-payment-submit]").first().click();
      await idle();
    }
    for (const locale of SUPPORTED_LOCALES) {
      await enter("PAYMENT_REVIEWER", locale, firstRevision);
      assert(
        (await page
          .locator(
            `[data-payment-locale]:not([data-payment-locale="${locale}"]) [data-payment-approve]`,
          )
          .count()) === 0,
        `${locale} reviewer cannot approve another locale`,
      );
      while (await page.locator("[data-payment-approve]").count()) {
        await page
          .locator(`[data-payment-locale="${locale}"] [data-payment-approve]`)
          .first()
          .click();
        await idle();
      }
      await capture(`${locale}-390-reviewed`);
    }
    report.cases.push("independent-seven-language-review-including-english");
    stage = "publish-lost-response";
    await enter("PAYMENT_MANAGER", "en", firstRevision);
    await lostPublication("PUBLISH");
    report.cases.push("publish-lost-response-reload-two-node-convergence");
    const publishedGeneration = workspace.generation;
    await returnToPayments();
    assert(
      workspace.currentRevisionId === firstRevision &&
        workspace.generation === publishedGeneration,
      "returning to payment settings reads the current published head",
    );
    report.cases.push("return-navigation-refreshes-drafts-and-publication");
    stage = "routing-only-copy";
    await page.locator("[data-payment-edit]").click();
    const share = page.locator('[name="r0.rollout"]');
    const nextShare = (await share.inputValue()) === "50" ? "25" : "50";
    await share.fill(nextShare);
    const secondRevision = await save();
    assert(
      workspace.selected?.reviews.every(
        (review) => review.status === "APPROVED",
      ),
      "unchanged approved text from published source retains server-reviewed approval",
    );
    await checkFor("PUBLISH");
    await expect(
      page.locator("[data-payment-confirm-publication]"),
    ).toHaveCount(1);
    await confirm();
    await idle();
    assert(
      lastReceipt?.action === "PUBLISH" &&
        lastReceipt.revisionId === secondRevision,
      "routing-only change publishes without duplicate translation review",
    );
    await observePublication(lastReceipt.generation);
    await capture("en-390-routing-only-published");
    report.cases.push("routing-only-edit-reuses-real-approval");
    stage = "rollback-lost-response";
    await enter("PAYMENT_MANAGER", "en", firstRevision);
    await lostPublication("ROLLBACK");
    assert(
      workspace.currentRevisionId === firstRevision,
      "rollback restores original managed version",
    );
    report.cases.push("rollback-lost-response-reload-two-node-convergence");
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
          /admin-payment-config-browser\.mjs:[0-9]+:[0-9]+/gu,
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
