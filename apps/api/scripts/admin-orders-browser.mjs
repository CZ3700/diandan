import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { URL } from "node:url";
import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";
import { chromium, expect } from "@playwright/test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";

const require = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const { default: AxeBuilder } = require("@axe-core/playwright");

function safeFailure(error) {
  const text =
    error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : "";
  const categories = [
    ["DNS_NOT_FOUND", /\bENOTFOUND\b/u],
    ["CONNECTION_REFUSED", /\bECONNREFUSED\b/u],
    ["CONNECTION_RESET", /\bECONNRESET\b/u],
    ["TIMEOUT", /\b(?:ETIMEDOUT|TimeoutError)\b|[Tt]imeout/u],
    ["TARGET_CLOSED", /Target.*closed|context.*closed|browser.*closed/iu],
  ];
  return {
    category:
      categories.find(([, pattern]) => pattern.test(text))?.[0] ??
      "UNEXPECTED_FAILURE",
    frames: [
      ...new Set(text.match(/admin-orders-browser\.mjs:[0-9]+:[0-9]+/gu) ?? []),
    ],
  };
}

/** Every event-side promise settles safely and remains visible to teardown. */
export function createAdminOrdersBrowserTasks(onFailure) {
  const pending = new Set();
  return {
    run(work, metadata) {
      const promise = Promise.resolve()
        .then(work)
        .then(
          () => true,
          (error) => {
            onFailure({ ...metadata, ...safeFailure(error) });
            return false;
          },
        )
        .finally(() => pending.delete(promise));
      pending.add(promise);
      return promise;
    },
    async drain() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}

/** Search completion is a rendered result, including a reused identical query. */
export function adminOrdersSearchReady(snapshot, target) {
  return (
    snapshot.busy === false &&
    snapshot.failed === false &&
    snapshot.query === target.publicId &&
    snapshot.rows.length === 1 &&
    snapshot.rows[0].orderId === target.orderId &&
    snapshot.rows[0].publicId === target.publicId
  );
}

/** No HAR, traces, raw responses or private-panel screenshots are recorded. */
export async function verifyAdminOrdersBrowser({
  adminOrigin,
  issuer,
  output,
  check,
  registerSecret = () => {},
  authenticate,
  fixture,
  flushNotifications = async () => {},
  readFacts = async () => ({}),
}) {
  const directory = path.join(output, "browser-orders");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    assertions: [],
    screenshots: [],
    axe: [],
    cases: [],
    errors: [],
    observations: [],
    searches: [],
    limitations: [
      "Local PostgreSQL, TLS OIDC and test notification provider only",
      "Emulated phone viewport, not a physical phone",
      "No screenshot or accessibility snapshot includes private panels",
      "Automated seven-language checks do not replace human translation or screen-reader review",
    ],
  };
  const secretValues = [
    fixture.privateMessage,
    fixture.privateDisplayName,
  ].filter(Boolean);
  for (const value of secretValues) registerSecret(value);
  const assert = (value, label) => {
    report.assertions.push({ label, passed: Boolean(value) });
    check(Boolean(value), label);
  };
  const origins = [
    adminOrigin,
    new URL(issuer).origin,
    ...(fixture.mediaOrigins ?? []),
  ];
  let browser,
    context,
    stage = "start";
  let evidencePrivate;
  const releases = new Set();
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
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    const ordinaryRequests = new Set();
    const isOrdinaryOrderUrl = (value) => {
      const url = new URL(value);
      return (
        url.origin === adminOrigin &&
        [
          "/api/admin/orders-list",
          "/api/admin/orders-detail",
          "/api/admin/orders-context",
        ].includes(url.pathname)
      );
    };
    page.on("request", (request) => {
      if (isOrdinaryOrderUrl(request.url())) ordinaryRequests.add(request);
    });
    page.on("requestfinished", (request) => ordinaryRequests.delete(request));
    page.on("requestfailed", (request) => ordinaryRequests.delete(request));
    page.on("pageerror", () =>
      report.errors.push({ stage, kind: "PAGE_ERROR" }),
    );
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (!isOrdinaryOrderUrl(response.url())) return;
      void tasks.run(
        async () => {
          const text = await response.text();
          assert(
            secretValues.every((value) => !text.includes(value)),
            "ordinary order response excludes private canaries",
          );
          const headers = response.headers();
          assert(
            headers["cache-control"]?.includes("no-store"),
            "order response forbids shared caching",
          );
          report.observations.push({
            operation: url.pathname.split("/").at(-1),
            status: response.status(),
            private: false,
          });
        },
        { stage, kind: "RESPONSE_OBSERVATION_FAILED" },
      );
    });
    async function settleOrdinaryRequests() {
      await expect
        .poll(() => ordinaryRequests.size, { timeout: 35_000 })
        .toBe(0);
      await tasks.drain();
    }
    async function navigate(url) {
      await settleOrdinaryRequests();
      await page.goto(url);
    }
    async function intercept(pattern, handler) {
      await page.route(
        pattern,
        (route) =>
          tasks.run(
            async () => {
              try {
                await handler(route);
              } catch (error) {
                await tasks.run(() => route.abort("failed"), {
                  stage,
                  kind: "ROUTE_ABORT_FAILED",
                });
                throw error;
              }
            },
            { stage, kind: "ROUTE_HANDLER_FAILED" },
          ),
        { times: 1 },
      );
    }
    async function enter(role, locale = "en") {
      await settleOrdinaryRequests();
      await authenticate(page, role, locale);
      const orders = page.locator('[data-management-section="ORDERS"]');
      await orders.waitFor({ timeout: 60_000 });
      if (!(await page.locator("[data-orders-list]").count()))
        await orders.click();
      await page.locator("[data-orders-list]").waitFor({ timeout: 60_000 });
    }
    async function selectOrder(
      publicId = fixture.reviewPublicOrderId,
      orderId = fixture.reviewOrderId,
    ) {
      await settleOrdinaryRequests();
      await expect(page.locator("[data-orders-workspace]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      const searchReady = async () =>
        adminOrdersSearchReady(
          await page.evaluate(() => ({
            busy:
              globalThis.document
                .querySelector("[data-orders-workspace]")
                ?.getAttribute("aria-busy") !== "false",
            failed: Boolean(
              globalThis.document.querySelector(
                '[data-orders-workspace] [role="alert"]',
              ),
            ),
            query:
              globalThis.document.querySelector("[data-orders-search]")
                ?.value ?? "",
            rows: [
              ...globalThis.document.querySelectorAll(
                "[data-orders-list] [data-order-id]",
              ),
            ].map((row) => ({
              orderId: row.getAttribute("data-order-id"),
              publicId: row.querySelector("strong")?.textContent?.trim(),
            })),
          })),
          { publicId, orderId },
        );
      const previouslyReady = await searchReady();
      const responses = [];
      const observeSearch = (response) => {
        if (new URL(response.url()).pathname !== "/api/admin/orders-list")
          return;
        let payloadValid = false,
          queryMatchesExpected = false;
        try {
          const command = response.request().postDataJSON();
          payloadValid = typeof command?.query === "string";
          queryMatchesExpected = command?.query === publicId;
        } catch {
          // Record only the shape failure; raw request bodies and errors stay private.
        }
        responses.push({
          status: response.status(),
          payloadValid,
          queryMatchesExpected,
        });
      };
      page.on("response", observeSearch);
      try {
        await page.locator("[data-orders-search]").fill(publicId);
        await expect(page.locator("[data-orders-search]")).toHaveValue(
          publicId,
        );
        await page.locator("[data-orders-apply]").click();
        await expect.poll(searchReady, { timeout: 35_000 }).toBe(true);
        await settleOrdinaryRequests();
        assert(
          await searchReady(),
          "search returns exactly the selected order and retains its query",
        );
        assert(
          previouslyReady ||
            responses.some(
              (response) =>
                response.status === 200 &&
                response.payloadValid &&
                response.queryMatchesExpected,
            ),
          "changed search receives a successful matching HTTP response",
        );
        await page.locator(`[data-order-id="${orderId}"]`).click();
        await page.locator(`[data-orders-detail="${orderId}"]`).waitFor();
      } finally {
        page.off("response", observeSearch);
        report.searches.push({ stage, previouslyReady, responses });
      }
    }
    async function capture(name) {
      assert(
        (await page.locator("[data-private-panel]").count()) === 0,
        `${name} has no open private panel`,
      );
      const visible = await page.locator("body").innerText();
      assert(
        secretValues.every((value) => !visible.includes(value)),
        `${name} excludes private canaries before capture`,
      );
      if (fixture.mediaOrigins?.length) {
        await expect
          .poll(() =>
            page
              .locator(".mo-gift-image img")
              .evaluateAll((images) =>
                images.every(
                  (image) => image.complete && image.naturalWidth > 0,
                ),
              ),
          )
          .toBe(true);
      }
      const file = `${name}.png`;
      await page.screenshot({
        path: path.join(directory, file),
        fullPage: true,
      });
      report.screenshots.push(file);
      const results = await new AxeBuilder({ page }).analyze();
      report.axe.push({
        name,
        violations: results.violations,
        incomplete: results.incomplete,
      });
      assert(
        results.violations.length === 0,
        `${name} accessibility scan has no violations`,
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
    stage = "language-matrix";
    await enter("ORDER_OPERATOR");
    assert(
      (await page.locator('[data-management-section="ARTISTS"]').count()) === 0,
      "order operator does not receive content editing navigation",
    );
    if (fixture.totalOrders > 12) {
      await page.locator("[data-orders-next]").click();
      await expect(page.locator("[data-orders-previous]")).toBeEnabled();
      await page.locator("[data-orders-previous]").click();
      await expect(page.locator("[data-orders-previous]")).toBeDisabled();
      await settleOrdinaryRequests();
      report.cases.push("pagination");
    }
    for (const locale of SUPPORTED_LOCALES)
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ]) {
        stage = `matrix-${locale}-${viewport.width}`;
        await page.setViewportSize(viewport);
        await navigate(`${adminOrigin}/${locale}`);
        await page.locator("[data-orders-list]").waitFor({ timeout: 60_000 });
        if (viewport.width === 390)
          assert(
            await page.locator(".mo-filters select").evaluateAll((selects) => {
              const canvas = globalThis.document.createElement("canvas");
              const painter = canvas.getContext("2d");
              return selects.every((select) => {
                const style = globalThis.getComputedStyle(select);
                painter.font = style.font;
                return (
                  painter.measureText(select.selectedOptions[0].label).width +
                    parseFloat(style.paddingLeft) +
                    parseFloat(style.paddingRight) +
                    24 <=
                  select.clientWidth
                );
              });
            }),
            `${locale} mobile selected filters remain fully readable`,
          );
        await capture(`${locale}-${viewport.width}-list`);
        await selectOrder();
        await capture(`${locale}-${viewport.width}-detail`);
        assert(
          (await page.locator("html").getAttribute("lang")) === locale,
          `${locale} declares its interface language`,
        );
      }
    report.cases.push("seven-language-two-viewport");
    stage = "keyboard-error-retry";
    await navigate(`${adminOrigin}/en`);
    await page.locator("[data-orders-search]").waitFor();
    await page.locator("[data-orders-search]").focus();
    await page.keyboard.press("Tab");
    assert(
      await page
        .locator("[data-orders-fulfillment]")
        .evaluate((node) => globalThis.document.activeElement === node),
      "keyboard advances from search to fulfillment filter",
    );
    assert(
      await page.evaluate(
        () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "reduced-motion is active",
    );
    await intercept("**/api/admin/orders-list", (route) =>
      route.abort("failed"),
    );
    await page.locator("[data-orders-reload]").click();
    await page.locator('[data-orders-workspace] [role="alert"]').waitFor();
    await capture("en-1440-list-error");
    const reloaded = tasks.run(
      async () => {
        const response = await page.waitForResponse(
          (value) => new URL(value.url()).pathname === "/api/admin/orders-list",
        );
        await response.finished();
        if (response.status() !== 200)
          throw new Error("Order reload response failed");
      },
      { stage, kind: "LIST_RELOAD_WAIT_FAILED" },
    );
    await page.locator('[data-orders-workspace] [role="alert"] button').click();
    if (!(await reloaded))
      throw new Error("Order reload response not completed");
    await page.locator("[data-orders-search]").waitFor();
    await expect(page.locator("[data-orders-workspace]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(
      page.locator('[data-orders-workspace] [role="alert"]'),
    ).toHaveCount(0);
    await settleOrdinaryRequests();
    report.cases.push("keyboard-reduced-motion-error-retry");
    stage = "private-late-response";
    await selectOrder();
    await page
      .locator("[data-review-language]")
      .first()
      .selectOption(fixture.reviewLocale);
    let release, received;
    const held = new Promise((resolve) => {
      release = resolve;
      releases.add(resolve);
    });
    const arrived = new Promise((resolve) => {
      received = resolve;
    });
    const arrivalTimeout = setTimeout(() => received(false), 35_000);
    const stopArrival = () => {
      clearTimeout(arrivalTimeout);
      received(false);
    };
    releases.add(stopArrival);
    await intercept("**/api/admin/orders-message-read", async (route) => {
      try {
        const response = await route.fetch({ timeout: 30_000 });
        received(true);
        await held;
        await route.fulfill({ response });
      } finally {
        received(false);
      }
    });
    await page.locator("[data-message-open]").first().click();
    const privateReadArrived = await arrived;
    stopArrival();
    releases.delete(stopArrival);
    if (!privateReadArrived) throw new Error("Private delayed fetch failed");
    await page.locator("[data-private-close]").click();
    await expect(page.locator("[data-message-open]").first()).toBeFocused();
    const lateResponse = tasks.run(
      () =>
        page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
            "/api/admin/orders-message-read",
        ),
      { stage, kind: "PRIVATE_RESPONSE_WAIT_FAILED" },
    );
    release();
    releases.delete(release);
    if (!(await lateResponse))
      throw new Error("Private delayed response not completed");
    assert(
      (await page.locator("[data-private-content]").count()) === 0,
      "closed private panel ignores a late response",
    );
    report.cases.push("private-close-late-response");
    stage = "review-prepare-deliver";
    const started = performance.now();
    await page.locator("[data-message-open]").first().click();
    await page.locator("[data-private-content]").waitFor();
    const privateText = await page
      .locator("[data-private-content]")
      .innerText();
    assert(
      privateText.includes(fixture.privateMessage),
      "authorized reviewer receives the selected synthetic message",
    );
    if (fixture.privateDisplayName)
      assert(
        privateText.includes(fixture.privateDisplayName),
        "authorized reviewer receives the synthetic name",
      );
    await expect(page.locator("[data-message-approve]")).toBeDisabled();
    await page.locator("[data-message-confirm]").check();
    await page.locator("[data-message-approve]").click();
    await page.locator("[data-order-prepare]").first().waitFor();
    assert(
      (await page.locator("[data-private-content]").count()) === 0,
      "successful review removes private content",
    );
    const prepareKeys = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/admin/orders-prepare")
        prepareKeys.push(request.headers()["idempotency-key"]);
    });
    await intercept("**/api/admin/orders-prepare", async (route) => {
      await route.fetch({ timeout: 30_000 });
      await route.abort("failed");
    });
    await page.locator("[data-order-prepare]").first().click();
    await page.locator('[data-orders-workspace] [role="alert"]').waitFor();
    await page.locator("[data-order-prepare]").first().click();
    await page.locator("[data-order-deliver]").first().waitFor();
    assert(
      prepareKeys.length === 2 && prepareKeys[0] === prepareKeys[1],
      "lost preparation response retries with the same idempotency key",
    );
    // Delivery opens the photo panel; confirming without photos delivers directly (V2 §4-6).
    await page.locator("[data-order-deliver]").first().click();
    await page.locator('[data-proof-panel="DELIVER"]').waitFor();
    await page.locator('[data-proof-submit="DELIVER"]').click();
    await expect(page.locator("[data-proof-panel]")).toHaveCount(0);
    await expect(page.locator("[data-order-deliver]")).toHaveCount(0);
    report.operationSeconds = (performance.now() - started) / 1000;
    assert(
      report.operationSeconds < 120,
      "review and fulfillment operation completes within two minutes",
    );
    await capture("en-1440-delivered");
    report.cases.push("human-review-preparing-delivered-idempotent-retry");
    stage = "notes";
    const note = `Synthetic operational note ${randomUUID()}`;
    secretValues.push(note);
    registerSecret(note);
    await page.locator("[data-notes-open]").click();
    await page.locator("[data-order-note]").fill(note);
    await page.locator("[data-private-close]").click();
    await expect(page.locator("[data-notes-open]")).toBeFocused();
    await page.locator("[data-notes-open]").click();
    assert(
      (await page.locator("[data-order-note]").inputValue()) === "",
      "closing notes discards the unsaved draft",
    );
    await page.locator("[data-order-note]").fill(note);
    await page.locator("[data-order-note-save]").click();
    await page.locator("[data-notes-open]").waitFor();
    await page.locator("[data-notes-open]").click();
    await page
      .locator('[data-private-panel="notes"] [data-private-content]')
      .waitFor();
    await expect
      .poll(async () =>
        (
          await page
            .locator('[data-private-panel="notes"] [data-private-content]')
            .innerText()
        ).includes(note),
      )
      .toBe(true);
    await page.locator("[data-private-close]").click();
    await expect(page.locator("[data-notes-open]")).toBeFocused();
    await capture("en-1440-notes-closed");
    report.cases.push("encrypted-notes-explicit-read-and-clear");
    stage = "notification-resend";
    await flushNotifications();
    await page.locator("[data-orders-reload]").click();
    await page.locator("[data-order-resend]").waitFor();
    await page.locator("[data-order-resend]").click();
    await page.locator("[data-orders-success]").waitFor();
    await flushNotifications();
    report.cases.push("audited-latest-notification-resend");
    if (fixture.holdOrderId && fixture.holdPublicOrderId) {
      stage = "manager-exception";
      await enter("MANAGER");
      await selectOrder(fixture.holdPublicOrderId, fixture.holdOrderId);
      await page.locator("[data-manager-actions] summary").first().click();
      await expect(page.locator("[data-order-hold]").first()).toBeDisabled();
      await page.locator("[data-manager-confirm]").first().check();
      await page.locator("[data-order-hold]").first().click();
      await expect(page.locator(".mo-line-status").first()).toHaveText(
        "On hold",
      );
      await page.locator("[data-manager-actions] summary").first().click();
      await page
        .locator("[data-manager-reason]")
        .first()
        .selectOption("ISSUE_RESOLVED");
      await page.locator("[data-manager-confirm]").first().check();
      await page.locator("[data-order-resume]").first().click();
      await expect(page.locator(".mo-line-status").first()).not.toHaveText(
        "On hold",
      );
      await capture("en-1440-manager-restored");
      report.cases.push("manager-confirmed-hold-resume");
    }
    stage = "content-role";
    await settleOrdinaryRequests();
    await authenticate(page, "CONTENT_EDITOR", "en");
    await page.locator("[data-management-center]").waitFor();
    await expect(page.locator(".mc-empty [role='status']")).toHaveCount(0);
    assert(
      (await page.locator('[data-management-section="ORDERS"]').count()) === 0,
      "content editor has no order navigation",
    );
    report.safeFacts = await readFacts();
    await settleOrdinaryRequests();
    assert(
      report.errors.length === 0,
      "browser has no unexpected page or observation errors",
    );
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.failure = { stage, ...safeFailure(error) };
  } finally {
    for (const release of releases) release();
    releases.clear();
    await tasks.drain();
    if (context)
      await tasks.run(() => context.unrouteAll({ behavior: "wait" }), {
        stage,
        kind: "ROUTE_CLEANUP_FAILED",
      });
    report.browserClosed =
      !browser ||
      (await tasks.run(() => browser.close(), {
        stage,
        kind: "BROWSER_CLOSE_FAILED",
      }));
    await tasks.drain();
    if (report.errors.length) report.status = "FAIL";
    report.finishedAt = new Date().toISOString();
    const serialized = JSON.stringify(report, null, 2);
    evidencePrivate = secretValues.every(
      (value) => !serialized.includes(value),
    );
    await writeFile(
      path.join(directory, "results.json"),
      `${evidencePrivate ? serialized : JSON.stringify({ schemaVersion: 1, status: "FAIL", failure: { stage, detail: "Evidence privacy check failed" } })}\n`,
    );
  }
  if (!evidencePrivate)
    throw new Error("Administrative order evidence privacy check failed");
  if (report.status !== "PASS")
    throw new Error(`Administrative order browser failed at ${stage}`);
  return report;
}
