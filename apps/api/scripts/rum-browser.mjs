import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { expect } from "@playwright/test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  RUM_ENDPOINT,
  rumIntakeSchema,
  rumObservationSchema,
} from "@fan-support/contracts/rum";
import { aggregateRumV2 } from "@fan-support/observability/rum";
import {
  hideRumDocument,
  withNativeRumContext,
  assertNativeHiddenEvidence,
} from "./rum-browser-lifecycle.mjs";
import { withAcceptanceBrowser } from "./storefront-acceptance-browser.mjs";
import { observePerformanceTraffic } from "./performance-resources.mjs";
import { summarizeAcceptanceResources } from "./storefront-acceptance-performance.mjs";

export function validateRumExchange(exchange, origin) {
  assert.equal(
    exchange.endpoint,
    origin + RUM_ENDPOINT,
    "Telemetry endpoint has no query or fragment",
  );
  assert.equal(exchange.method, "POST");
  assert.equal(
    exchange.status,
    204,
    "Actual intake must acknowledge the browser metric",
  );
  assert.equal(
    exchange.headers.cookie,
    undefined,
    "Telemetry must omit cookies",
  );
  assert.equal(
    exchange.headers.referer,
    undefined,
    "Telemetry must omit referrer",
  );
  assert.equal(
    exchange.headers.authorization,
    undefined,
    "Telemetry must omit credentials",
  );
  assert.equal(exchange.headers.origin, origin);
  assert.equal(exchange.headers["sec-fetch-site"], "same-origin");
  const measurement = rumIntakeSchema.parse(exchange.body);
  assert.equal(measurement.context.automation, "automated");
  return measurement;
}

export function readRumLogRecords(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.includes("performance.web_vital")) continue;
    const candidate = JSON.parse(line);
    rows.push(rumObservationSchema.parse(candidate));
  }
  return rows;
}

export function assertRumCells(cells) {
  assert.equal(
    cells.length,
    SUPPORTED_LOCALES.length * 2,
    "All seven languages and both actual viewports are required",
  );
  for (const locale of SUPPORTED_LOCALES)
    for (const width of [390, 1440]) {
      const found = cells.filter(
        (cell) => cell.locale === locale && cell.width === width,
      );
      assert.equal(found.length, 1, "Each RUM cell is unique");
      const cell = found[0];
      assert.equal(cell.status, "PASS");
      assert.deepEqual([...new Set(cell.metrics)].sort(), [
        "CLS",
        "INP",
        "LCP",
      ]);
      assert.equal(
        cell.orderAccessPosts,
        0,
        "Credential exchange page is excluded from collection",
      );
      assert.equal(cell.orderAccessRequestAttempts, 0);
      assert.equal(cell.requestAttempts, cell.exchanges.length);
      assert.equal(cell.excludedErrors.length, 0);
      assertNativeHiddenEvidence(cell.lifecycle);
      assertNativeHiddenEvidence(cell.excludedLifecycle);
      assert.deepEqual(cell.actualViewport, {
        width: cell.width,
        height: cell.height,
      });
      assert.deepEqual(cell.excludedActualViewport, cell.actualViewport);
      assert.equal(cell.pageErrors.length, 0);
      assert.ok(
        cell.initialResources.scriptCount > 0,
        "Enabled-mode script overhead must be measured",
      );
    }
}

export function assertRumDashboardRows(
  actual,
  report,
  { locale = "all", viewport = "all" } = {},
) {
  const expected = report.rows
    .filter(
      (row) =>
        (locale === "all" || row.context.locale === locale) &&
        (viewport === "all" || row.context.viewport === viewport),
    )
    .map((row) => [
      `${row.mode} / ${row.context.automation} / ${row.samplePermille}‰`,
      row.context.locale,
      row.context.page,
      row.context.viewport,
      row.metric,
      String(row.count),
      `${Number(row.p75.toFixed(4))}${row.metric === "CLS" ? "" : " ms"}`,
      `${row.budgetExclusive}${row.metric === "CLS" ? "" : " ms"}`,
      row.assessment,
    ]);
  assert.deepEqual(
    actual.map((row) => JSON.stringify(row)).sort(),
    expected.map((row) => JSON.stringify(row)).sort(),
    "Visible dashboard cells must match the actual CLI report and filters",
  );
}

export async function verifyRumDashboard(
  browser,
  directory,
  cliOutput,
  cliReport,
) {
  const { renderRumDashboard } =
    await import("../../../scripts/render-rum-dashboard.mjs");
  const empty = aggregateRumV2([], {
    windowStart: cliReport.windowStart,
    windowEnd: cliReport.windowEnd,
    minimumSamples: cliReport.minimumSamples,
  });
  const emptyPath = path.join(directory, "dashboard-empty-window.html");
  await writeFile(emptyPath, renderRumDashboard(empty), { flag: "wx" });
  const result = {
    status: "RUNNING",
    source: "ACTUAL_CLI_HTML_WITH_EMPTY_WINDOW_DISPLAY_FIXTURE",
    metricsInjected: false,
    cells: [],
  };
  const save = () =>
    writeFile(
      path.join(directory, "dashboard-browser.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
  await save();
  try {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      const cell = {
        ...viewport,
        status: "RUNNING",
        pageErrors: [],
        networkRequests: [],
        filters: [],
        screenshots: [],
      };
      result.cells.push(cell);
      const context = await browser.newContext({ viewport });
      try {
        // A fresh context has no storefront cookies, sessions or telemetry collector.
        const page = await context.newPage();
        page.on("pageerror", () => cell.pageErrors.push("PAGE_ERROR"));
        page.on("request", (request) => {
          if (/^https?:/u.test(request.url()))
            cell.networkRequests.push("UNEXPECTED_NETWORK_REQUEST");
        });
        const readRows = () =>
          page
            .locator("#rows tr")
            .evaluateAll((rows) =>
              rows.map((row) =>
                [...row.querySelectorAll("td")].map((td) => td.textContent),
              ),
            );
        const capture = async (name) => {
          const filename = `dashboard-${viewport.width}-${name}.png`;
          await page.screenshot({
            path: path.join(directory, filename),
            fullPage: true,
          });
          cell.screenshots.push(filename);
        };
        await page.goto(
          pathToFileURL(path.resolve(cliOutput, "rum-dashboard.html")).href,
          { waitUntil: "load" },
        );
        await expect(
          page.getByRole("heading", {
            name: "Storefront performance observations",
          }),
        ).toBeVisible();
        await expect(page.locator("#rows tr")).toHaveCount(42);
        assertRumDashboardRows(await readRows(), cliReport);
        assert.ok(
          cliReport.rows.every(
            (row) =>
              row.mode === "local" &&
              row.context.automation === "automated" &&
              row.assessment === "LOCAL_ONLY",
          ),
        );
        await expect(page.locator("#summary")).toContainText(
          "42 metric groups",
        );
        await expect(page.locator("#integrity")).toContainText(
          "CLEAN — no conflicting measurement keys; 42 records retained.",
        );
        await capture("all");
        for (const locale of SUPPORTED_LOCALES) {
          await page
            .getByRole("combobox", { name: "locale", exact: true })
            .selectOption(locale);
          await expect(page.locator("#rows tr")).toHaveCount(6);
          assertRumDashboardRows(await readRows(), cliReport, { locale });
          cell.filters.push({ locale, viewport: "all", rows: 6 });
          for (const bucket of ["mobile", "desktop"]) {
            await page
              .getByRole("combobox", { name: "viewport", exact: true })
              .selectOption(bucket);
            await expect(page.locator("#rows tr")).toHaveCount(3);
            assertRumDashboardRows(await readRows(), cliReport, {
              locale,
              viewport: bucket,
            });
            cell.filters.push({ locale, viewport: bucket, rows: 3 });
          }
          await page
            .getByRole("combobox", { name: "viewport", exact: true })
            .selectOption("all");
        }
        await page
          .getByRole("combobox", { name: "locale", exact: true })
          .selectOption("all");
        for (const bucket of ["mobile", "desktop"]) {
          await page
            .getByRole("combobox", { name: "viewport", exact: true })
            .selectOption(bucket);
          await expect(page.locator("#rows tr")).toHaveCount(21);
          assertRumDashboardRows(await readRows(), cliReport, {
            viewport: bucket,
          });
          cell.filters.push({ locale: "all", viewport: bucket, rows: 21 });
        }
        await capture("desktop-filter");
        await page
          .getByRole("combobox", { name: "viewport", exact: true })
          .selectOption("all");
        await expect(page.locator("#rows tr")).toHaveCount(42);
        assertRumDashboardRows(await readRows(), cliReport);
        await page.goto(pathToFileURL(emptyPath).href, { waitUntil: "load" });
        await expect(
          page.getByRole("combobox", { name: "locale", exact: true }),
        ).toBeVisible();
        await expect(page.locator("#rows tr")).toHaveCount(0);
        await expect(page.locator("#summary")).toHaveText(
          "No observations — INSUFFICIENT",
        );
        await expect(
          page.locator(".notice").filter({
            hasText:
              "Local and automated observations verify instrumentation only.",
          }),
        ).toContainText("missing INP is never filled with zero");
        await expect(page.locator("#integrity")).toContainText(
          "CLEAN — no conflicting measurement keys; 0 records retained.",
        );
        await capture("empty-window");
        cell.emptyWindow = "INSUFFICIENT";
        assert.equal(cell.pageErrors.length, 0);
        assert.equal(cell.networkRequests.length, 0);
        cell.status = "PASS";
      } finally {
        await context.close();
        await save();
      }
    }
    result.status = "PASS";
    return result;
  } catch (error) {
    result.status = "FAIL";
    throw error;
  } finally {
    await save();
  }
}

async function boundedObservation(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error("RUM observation timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export function observeRum(page, origin, observationTimeoutMs = 10_000) {
  const exchanges = [],
    pending = [],
    errors = [],
    requests = [];
  const byRequest = new Map();
  let postAttempts = 0;
  const relevant = (request) =>
    new URL(request.url()).pathname === RUM_ENDPOINT;
  page.on("pageerror", () => errors.push({ kind: "PAGE_ERROR" }));
  page.on("request", (request) => {
    if (!relevant(request)) return;
    if (request.method() === "POST") postAttempts++;
    const record = {
      method: request.method() === "POST" ? "POST" : "OTHER",
      stage: "REQUEST",
      status: null,
    };
    if (requests.length < 256) requests.push(record);
    else errors.push({ kind: "RUM_REQUEST_LIMIT" });
    const headers = boundedObservation(
      request.allHeaders(),
      observationTimeoutMs,
    )
      .then((value) => {
        record.requestHeadersRead = true;
        return value;
      })
      .catch(() => {
        record.requestHeadersRead = false;
        errors.push({ kind: "RUM_REQUEST_HEADERS_FAILED" });
        return null;
      });
    pending.push(headers);
    byRequest.set(request, { record, headers });
  });
  page.on("response", (response) => {
    const request = response.request();
    if (!relevant(request)) return;
    pending.push(
      (async () => {
        const captured = byRequest.get(request);
        if (!captured) {
          errors.push({ kind: "RUM_RESPONSE_WITHOUT_REQUEST" });
          return;
        }
        const { record } = captured;
        record.status = response.status();
        record.stage = "RESPONSE";
        const headers = await captured.headers;
        if (!headers) return;
        let body;
        try {
          body = JSON.parse(request.postData() ?? "null");
        } catch {
          record.stage = "INVALID_JSON";
          errors.push({ kind: "RUM_INVALID_JSON" });
          return;
        }
        record.metric = ["LCP", "INP", "CLS"].includes(body?.metric?.name)
          ? body.metric.name
          : "UNKNOWN";
        let measurement;
        try {
          measurement = validateRumExchange(
            {
              endpoint: request.url(),
              method: request.method(),
              status: response.status(),
              headers,
              body,
            },
            origin,
          );
        } catch {
          record.stage = "INVALID_EXCHANGE";
          errors.push({ kind: "INVALID_RUM_EXCHANGE" });
          return;
        }
        record.stage = "HEADERS_VALIDATED";
        try {
          const completion = await boundedObservation(
            response.finished(),
            observationTimeoutMs,
          );
          if (completion) throw completion;
        } catch {
          record.stage = "RESPONSE_INCOMPLETE";
          errors.push({ kind: "RUM_RESPONSE_INCOMPLETE" });
          return;
        }
        record.stage = "VALIDATED";
        exchanges.push({
          measurement,
          status: response.status(),
          cookieAbsent: headers.cookie === undefined,
          referrerAbsent: headers.referer === undefined,
          authorizationAbsent: headers.authorization === undefined,
        });
      })().catch(() => errors.push({ kind: "RUM_OBSERVATION_FAILED" })),
    );
  });
  page.on("requestfailed", (request) => {
    if (relevant(request)) {
      const record = byRequest.get(request)?.record;
      const code = request.failure()?.errorText;
      if (record)
        record.failureCode = /^net::ERR_[A-Z_]+$/u.test(code ?? "")
          ? code
          : "NETWORK_FAILURE";
      errors.push({ kind: "RUM_REQUEST_FAILED" });
    }
  });
  return {
    exchanges,
    pending,
    errors,
    requests,
    get postAttempts() {
      return postAttempts;
    },
    settle: async () => {
      let length;
      do {
        length = pending.length;
        await Promise.all(pending);
      } while (length !== pending.length);
    },
  };
}

async function recordStep(cell, name, action) {
  const step = { name, status: "RUNNING" };
  cell.steps.push(step);
  try {
    const result = await action();
    step.status = "PASS";
    return result;
  } catch (error) {
    step.status = "FAIL";
    step.errorName = [
      "Error",
      "AssertionError",
      "TimeoutError",
      "AggregateError",
    ].includes(error?.name)
      ? error.name
      : "Error";
    throw error;
  }
}

async function actualInteractions(page, mobile, cell) {
  const step = (name, action) => recordStep(cell, name, action);
  const drawer = page.locator(".storefront-navigation-menu button").first();
  let language = page.locator(".storefront-desktop-language button");
  if (mobile) {
    await step("navigation-drawer-open", () => drawer.click());
    await expect(page.getByRole("dialog")).toBeVisible();
    language = page
      .getByRole("dialog")
      .locator("[data-storefront-language] button");
  }
  await step("language-menu-open", () => language.click());
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  if (mobile) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  const search = page.locator("[data-artist-search]").first();
  await step("artist-search-focus", () => search.click());
  await step("artist-search-input", () =>
    search.pressSequentially("Acceptance", { delay: 50 }),
  );
  await step("artist-search-results", () =>
    expect(page.getByRole("listbox")).toBeVisible(),
  );
  await page.keyboard.press("Escape");
}

/** Runs real web-vitals subscriptions through real trusted Chrome inputs; never calls a metric callback. */
export async function verifyRumBrowser({
  origin,
  gateway,
  output,
  next,
  progress,
}) {
  const directory = path.join(output, "rum");
  await mkdir(directory, { recursive: true });
  const startedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    startedAt,
    cells: [],
    mode: "local",
    realUserEvidence: false,
    metricsInjected: false,
    physicalDeviceEvidence: false,
    conditions:
      "Production-compiled owned TEST, same-origin loopback HTTP, normal CPU/network, fresh owned Chrome/profile/default context for every positive and excluded document; noDefaults removes Playwright focus emulation; native tab hiding and trusted automated inputs; not field evidence",
  };
  const save = () =>
    writeFile(
      path.join(directory, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await save();
  try {
    for (const locale of SUPPORTED_LOCALES)
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ]) {
        const mobile = viewport.width === 390;
        progress(`real local RUM ${locale}/${viewport.width}`);
        const cell = {
          locale,
          ...viewport,
          status: "RUNNING",
          metrics: [],
          pageErrors: [],
          orderAccessPosts: null,
          orderAccessRequestAttempts: null,
          steps: [],
        };
        report.cells.push(cell);
        await withNativeRumContext(
          { gateway },
          async (context, browser, launch) => {
            report.browserVersion = browser.version();
            cell.browserVersion = browser.version();
            cell.launch = launch;
            const page = await context.newPage();
            await page.setViewportSize(viewport);
            await page.emulateMedia({ reducedMotion: "no-preference" });
            const observed = observeRum(page, origin);
            cell.exchanges = observed.exchanges;
            cell.pageErrors = observed.errors;
            cell.requests = observed.requests;
            try {
              const session = await context.newCDPSession(page);
              await session.send("Network.enable");
              await session.send("Network.setCacheDisabled", {
                cacheDisabled: true,
              });
              const traffic = observePerformanceTraffic(page);
              const response = await page.goto(`${origin}/${locale}`, {
                waitUntil: "networkidle",
                timeout: 60_000,
              });
              assert.equal(response?.status(), 200);
              await expect(
                page.locator("[data-artist-card]").first(),
              ).toBeVisible();
              await page.evaluate(async () => {
                await globalThis.document.fonts.ready;
              });
              await traffic.settle();
              const hero = await page
                .locator(".storefront-hero-image img")
                .evaluate((image) => image.currentSrc);
              cell.initialResources = summarizeAcceptanceResources(
                [...traffic.resources],
                hero,
              );
              cell.initialResourceFailures = [...traffic.failures];
              assert.equal(
                traffic.failures.length,
                0,
                "Enabled collector must not introduce initial resource failures",
              );
              // A synthetic non-auth cookie makes omission observable without using any real identity.
              await context.addCookies([
                { name: "test_rum_privacy", value: "synthetic", url: origin },
              ]);
              cell.actualViewport = await page.evaluate(() => ({
                width: globalThis.innerWidth,
                height: globalThis.innerHeight,
              }));
              assert.deepEqual(cell.actualViewport, viewport);
              await recordStep(cell, "trusted-home-interactions", () =>
                actualInteractions(page, mobile, cell),
              );
              cell.lifecycle = await recordStep(
                cell,
                "native-home-tab-hidden",
                () => hideRumDocument(page),
              );
              await recordStep(cell, "metric-acknowledgements", () =>
                expect
                  .poll(
                    async () => {
                      await observed.settle();
                      return [
                        ...new Set(
                          observed.exchanges.map(
                            (entry) => entry.measurement.metric.name,
                          ),
                        ),
                      ].sort();
                    },
                    { timeout: 10_000 },
                  )
                  .toEqual(["CLS", "INP", "LCP"]),
              );
              await observed.settle();
              cell.exchanges = observed.exchanges;
              cell.metrics = observed.exchanges.map(
                (entry) => entry.measurement.metric.name,
              );
              cell.pageErrors = observed.errors;
              for (const entry of observed.exchanges)
                assert.deepEqual(entry.measurement.context, {
                  locale,
                  page: "home",
                  viewport: mobile ? "mobile" : "desktop",
                  automation: "automated",
                });
              assert.equal(observed.errors.length, 0);
            } finally {
              await observed.settle();
              cell.requestAttempts = observed.postAttempts;
              await save();
            }
          },
        );

        await withNativeRumContext(
          { gateway },
          async (excluded, browser, launch) => {
            cell.excludedBrowserVersion = browser.version();
            cell.excludedLaunch = launch;
            const page = await excluded.newPage();
            await page.setViewportSize(viewport);
            await page.emulateMedia({ reducedMotion: "no-preference" });
            const observed = observeRum(page, origin);
            cell.excludedRequests = observed.requests;
            cell.excludedErrors = observed.errors;
            try {
              await page.goto(`${origin}/${locale}/order-access`, {
                waitUntil: "networkidle",
                timeout: 60_000,
              });
              await page.getByRole("heading", { level: 1 }).first().click();
              await page.keyboard.press("Tab");
              cell.excludedActualViewport = await page.evaluate(() => ({
                width: globalThis.innerWidth,
                height: globalThis.innerHeight,
              }));
              assert.deepEqual(cell.excludedActualViewport, viewport);
              cell.excludedLifecycle = await recordStep(
                cell,
                "native-order-access-tab-hidden",
                () => hideRumDocument(page),
              );
              // Require a full ten-second negative observation, including rejected/failed requests.
              await delay(10_000);
              await observed.settle();
              cell.orderAccessRequestAttempts = observed.postAttempts;
              cell.orderAccessPosts = observed.exchanges.length;
              cell.pageErrors.push(...observed.errors);
              assert.equal(cell.orderAccessPosts, 0);
              assert.equal(cell.orderAccessRequestAttempts, 0);
              assert.equal(cell.pageErrors.length, 0);
              cell.status = "PASS";
            } finally {
              await observed.settle();
              cell.orderAccessRequestAttempts = observed.postAttempts;
              await save();
            }
          },
        );
      }
    assertRumCells(report.cells);
    const runtimeLog = path.join(
      path.dirname(output),
      `next-runtime-${next.generation()}.log`,
    );
    const exchanges = report.cells.flatMap((cell) => cell.exchanges);
    let records;
    const deadline = globalThis.performance.now() + 10_000;
    do {
      records = readRumLogRecords(await readFile(runtimeLog, "utf8"));
      if (records.length >= exchanges.length) break;
      await delay(100);
    } while (globalThis.performance.now() < deadline);
    assert.equal(
      records.length,
      exchanges.length,
      "Every browser acknowledgement has one server sink observation",
    );
    for (const exchange of exchanges) {
      const matches = records.filter(
        (record) =>
          record.measurement.metric.measurementKey ===
            exchange.measurement.metric.measurementKey &&
          record.measurement.metric.revision ===
            exchange.measurement.metric.revision,
      );
      assert.equal(matches.length, 1);
      assert.deepEqual(matches[0].measurement, exchange.measurement);
      assert.equal(matches[0].mode, "local");
      assert.equal(matches[0].samplePermille, 1000);
    }
    const completedAt = new Date().toISOString();
    await writeFile(
      path.join(directory, "observations.jsonl"),
      records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    );
    const dashboard = aggregateRumV2(records, {
      windowStart: startedAt,
      windowEnd: completedAt,
      minimumSamples: 100,
    });
    assert.equal(dashboard.rows.length, 42);
    assert.equal(dashboard.integrity.status, "CLEAN");
    assert.ok(dashboard.rows.every((row) => row.assessment === "LOCAL_ONLY"));
    await writeFile(
      path.join(directory, "dashboard-expected.json"),
      JSON.stringify(dashboard, null, 2) + "\n",
    );
    const workspaceRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    const cliOutput = path.join(directory, "dashboard-cli");
    await promisify(execFile)(
      process.execPath,
      [
        path.join(workspaceRoot, "scripts/render-rum-dashboard.mjs"),
        "--input",
        path.join(directory, "observations.jsonl"),
        "--output",
        cliOutput,
        "--from",
        startedAt,
        "--to",
        completedAt,
        "--minimum-samples",
        "100",
      ],
      { cwd: workspaceRoot, timeout: 30_000 },
    );
    const cliReport = JSON.parse(
      await readFile(path.join(cliOutput, "rum-report.json"), "utf8"),
    );
    assert.deepEqual(
      cliReport,
      dashboard,
      "Actual dashboard CLI must reproduce server observations exactly",
    );
    report.dashboard = {
      rows: dashboard.rows.length,
      records: records.length,
      uniqueMeasurements: dashboard.uniqueMeasurements,
      windowStart: startedAt,
      windowEnd: completedAt,
      fieldConclusion: "NOT_EVALUATED",
      cliMatches: true,
      browser: await withAcceptanceBrowser({ gateway }, (browser) =>
        verifyRumDashboard(browser, directory, cliOutput, cliReport),
      ),
    };
    report.status = "PASS";
    return report;
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    };
    throw error;
  } finally {
    await save();
  }
}
