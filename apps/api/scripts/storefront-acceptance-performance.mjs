import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { withAcceptanceBrowser } from "./storefront-acceptance-browser.mjs";
import {
  acceptancePages,
  acceptanceViewports,
} from "./storefront-acceptance-pages.mjs";

/** Decimal KB, matching the written budget. These recommendations remain distinct from field CWV. */
export function summarizeAcceptanceResources(resources, heroUrl) {
  const unique = [
    ...new Map(resources.map((resource) => [resource.url, resource])).values(),
  ];
  const scripts = unique.filter((resource) => resource.type === "script");
  const javascriptGzipBytes = scripts.reduce(
    (sum, resource) => sum + resource.gzipBytes,
    0,
  );
  return {
    javascriptGzipBytes,
    javascriptRecommendationBytes: 150_000,
    javascriptRecommendationMet: javascriptGzipBytes < 150_000,
    scriptCount: scripts.length,
    images: unique
      .filter((resource) => resource.type === "image")
      .map((resource) => ({
        ...resource,
        role:
          resource.url === heroUrl ? "FIRST_VIEWPORT_HERO" : "REGULAR_IMAGE",
        shouldBudgetBytes: resource.url === heroUrl ? 600_000 : 400_000,
        shouldBudgetMet:
          resource.bodyBytes < (resource.url === heroUrl ? 600_000 : 400_000),
      })),
    resources: unique,
    measurement:
      "Actual initial navigation responses through network idle and fonts ready, before scrolling or forcing eager; decompressed JS response bodies recompressed with Node gzip for comparable budget, independent from actual wire encoding",
    realUserEvidence: false,
  };
}

export function aggregateAcceptanceLighthouse(runs) {
  assert.equal(
    runs.length,
    3,
    "exactly three Lighthouse attempts must be retained",
  );
  for (const run of runs)
    assert.ok(
      !run.runtimeError &&
        Number.isFinite(
          run.audits?.["largest-contentful-paint"]?.numericValue,
        ) &&
        Number.isFinite(run.audits?.["cumulative-layout-shift"]?.numericValue),
      "failed Lighthouse run cannot be excluded from aggregation",
    );
  for (const run of runs)
    assert.ok(
      Number.isFinite(run.categories?.performance?.score) &&
        run.categories.performance.score >= 0 &&
        run.categories.performance.score <= 1,
      "each retained Lighthouse run must have a finite performance score between zero and one",
    );
  const metric = (values) => {
    const sorted = [...values].sort((left, right) => left - right);
    return { min: sorted[0], median: sorted[1], max: sorted[2] };
  };
  const lcpMs = metric(
    runs.map((run) => run.audits["largest-contentful-paint"].numericValue),
  );
  const cls = metric(
    runs.map((run) => run.audits["cumulative-layout-shift"].numericValue),
  );
  const performanceScore = metric(
    runs.map((run) => run.categories.performance.score),
  );
  return {
    runs: 3,
    lcpMs,
    cls,
    performanceScore,
    performanceScoreTargetMet: performanceScore.median >= 0.9,
    lcpLabTargetMet: lcpMs.median < 2500,
    clsLabTargetMet: cls.median < 0.1,
    realUserEvidence: false,
    fieldInpEvidence: false,
    selection:
      "All three attempts retained; median, minimum and maximum, never best-only",
  };
}

export function summarizeAcceptancePerformanceBudget(aggregates, resources) {
  assert.ok(
    aggregates.length > 0 && resources.length > 0,
    "performance budget cannot pass an empty collection",
  );
  return {
    labTargetsMet: aggregates.every(
      (value) =>
        value.performanceScoreTargetMet &&
        value.lcpLabTargetMet &&
        value.clsLabTargetMet,
    ),
    scoreMedianMinimum: 0.9,
    lcpLabMedianExclusiveMaximumMs: 2500,
    clsLabMedianExclusiveMaximum: 0.1,
    javascriptShouldMet: resources.every(
      (value) => value.javascriptRecommendationMet,
    ),
    imagesShouldMet: resources.every((value) =>
      value.images.every((image) => image.shouldBudgetMet),
    ),
    javascriptPagesExceedingRecommendation: resources.filter(
      (value) => !value.javascriptRecommendationMet,
    ).length,
    imagesExceedingRecommendation: resources
      .flatMap((value) => value.images)
      .filter((image) => !image.shouldBudgetMet).length,
    fieldCwvEvidence: false,
  };
}

/** HTTP errors and network failures are distinct events; both remain part of the resource evidence. */
export function observeAcceptanceResourceTraffic(page) {
  const pending = [],
    resources = [],
    failures = [];
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (!["script", "image"].includes(type)) return;
    pending.push(
      (async () => {
        try {
          const body = Buffer.from(await response.body());
          if (response.status() !== 200)
            failures.push({ type, status: response.status() });
          resources.push({
            url: response.url(),
            type,
            status: response.status(),
            bodyBytes: body.length,
            gzipBytes: type === "script" ? gzipSync(body).length : null,
            contentEncoding:
              response.headers()["content-encoding"] ?? "identity",
          });
        } catch {
          failures.push({
            type,
            status: response.status(),
            bodyUnavailable: true,
          });
        }
      })(),
    );
  });
  page.on("requestfailed", (request) => {
    const type = request.resourceType();
    if (["script", "image"].includes(type))
      failures.push({
        type,
        status: null,
        errorKind: "NETWORK_REQUEST_FAILED",
      });
  });
  return { pending, resources, failures };
}

export async function verifyAcceptancePerformance({
  origin,
  fixtures,
  gateway,
  output,
  check,
  progress,
}) {
  const directory = path.join(output, "performance");
  await mkdir(directory, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    resources: [],
    resourceFailures: [],
    lighthouse: [],
    conditions: {
      environment: "Production-compiled artifact in local TEST",
      sourceAssets:
        "Synthetic neutral-matte TEST compositions; repeat with final approved assets",
      browserCache: "New isolated context per resource page; disabled cache",
      serverCache: "Same seeded compiled service; image optimizer may be warm",
      concurrentBuildsPermitted: false,
      resourceNetworkThrottling: "none; byte budget only",
      lighthouseThrottling:
        "Pinned Lighthouse 13.4.1 default mobile simulated slow 4G and CPU settings, actual settings retained per raw report",
      noEagerImageMutation: true,
    },
    realUserEvidence: false,
    physicalDeviceEvidence: false,
  };
  const save = () =>
    writeFile(
      path.join(directory, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await save();
  try {
    await withAcceptanceBrowser({ gateway }, async (browser) => {
      report.browserVersion = browser.version();
      for (const viewport of acceptanceViewports)
        for (const target of acceptancePages(fixtures)) {
          progress(
            `initial navigation bytes ${target.locale}/${target.kind}/${viewport.width}`,
          );
          const context = await browser.newContext({
            viewport,
            reducedMotion: "no-preference",
          });
          try {
            const page = await context.newPage();
            const session = await context.newCDPSession(page);
            await session.send("Network.enable");
            await session.send("Network.setCacheDisabled", {
              cacheDisabled: true,
            });
            const { pending, resources, failures } =
              observeAcceptanceResourceTraffic(page);
            const response = await page.goto(origin + target.path, {
              waitUntil: "networkidle",
              timeout: 60_000,
            });
            check(
              response?.status() === 200,
              "resource budget measures a successful actual page",
            );
            await page.locator(target.selector).waitFor();
            await page.evaluate(async () => {
              await globalThis.document.fonts.ready;
            });
            await Promise.all(pending);
            if (failures.length > 0) {
              report.resourceFailures.push({
                locale: target.locale,
                kind: target.kind,
                viewport,
                failures,
              });
              await save();
            }
            check(
              failures.length === 0,
              "resource budget cannot omit failed script or image bodies",
            );
            const observed = await page.evaluate(() => ({
              hero:
                globalThis.document.querySelector(".storefront-hero-image img")
                  ?.currentSrc ?? null,
              resources: globalThis.performance
                .getEntriesByType("resource")
                .filter((entry) =>
                  ["script", "img", "link"].includes(entry.initiatorType),
                )
                .map((entry) => ({
                  name: entry.name,
                  initiatorType: entry.initiatorType,
                  transferSize: entry.transferSize,
                  encodedBodySize: entry.encodedBodySize,
                  decodedBodySize: entry.decodedBodySize,
                })),
            }));
            const budget = summarizeAcceptanceResources(
              resources,
              observed.hero,
            );
            check(
              budget.scriptCount > 0 && budget.javascriptGzipBytes > 0,
              "initial JS budget is non-vacuous actual network evidence",
            );
            report.resources.push({
              ...target,
              viewport,
              ...budget,
              resourceTiming: observed.resources,
            });
            await save();
          } finally {
            await context.close();
          }
        }
    });
    const { default: lighthouse } = await import("lighthouse");
    const require = createRequire(import.meta.url);
    const lighthouseRequire = createRequire(require.resolve("lighthouse"));
    const launcher = await import(lighthouseRequire.resolve("chrome-launcher"));
    const certificate = new X509Certificate(
      await readFile(gateway.certificatePath),
    );
    const pin = createHash("sha256")
      .update(certificate.publicKey.export({ type: "spki", format: "der" }))
      .digest("base64");
    const chrome = await launcher.launch({
      chromePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      handleSIGINT: false,
      logLevel: "silent",
      chromeFlags: [
        "--headless=new",
        `--ignore-certificate-errors-spki-list=${pin}`,
        "--host-resolver-rules=MAP media.example.invalid 127.0.0.1",
        "--no-proxy-server",
      ],
    });
    try {
      for (const target of acceptancePages(fixtures).filter((page) =>
        ["home", "artist", "gift"].includes(page.kind),
      )) {
        const runs = [];
        for (let attempt = 1; attempt <= 3; attempt++) {
          progress(
            `Lighthouse mobile ${target.locale}/${target.kind} attempt ${attempt}/3`,
          );
          const name = `${target.locale}-${target.kind}-mobile-${attempt}`;
          const result = await lighthouse(origin + target.path, {
            port: chrome.port,
            logLevel: "error",
            output: ["json", "html"],
            onlyCategories: [
              "performance",
              "accessibility",
              "best-practices",
              "seo",
            ],
            formFactor: "mobile",
            throttlingMethod: "simulate",
          });
          check(Boolean(result), "Lighthouse produces a real report");
          await writeFile(
            path.join(directory, `${name}.json`),
            JSON.stringify(result.lhr, null, 2) + "\n",
          );
          const html = Array.isArray(result.report)
            ? result.report.find((value) => value.trimStart().startsWith("<!"))
            : result.report;
          if (html) await writeFile(path.join(directory, `${name}.html`), html);
          const entry = {
            ...target,
            attempt,
            file: `${name}.json`,
            html: html ? `${name}.html` : null,
            lighthouseVersion: result.lhr.lighthouseVersion,
            runtimeError: result.lhr.runtimeError ?? null,
            runWarnings: result.lhr.runWarnings,
            configSettings: result.lhr.configSettings,
          };
          report.lighthouse.push(entry);
          await save();
          check(
            result.lhr.lighthouseVersion === "13.4.1",
            "Lighthouse engine matches the exact dependency lock",
          );
          check(
            !result.lhr.runtimeError,
            "failed Lighthouse navigation remains a failed attempt",
          );
          runs.push(result.lhr);
        }
        const aggregate = aggregateAcceptanceLighthouse(runs);
        await writeFile(
          path.join(
            directory,
            `${target.locale}-${target.kind}-aggregate.json`,
          ),
          JSON.stringify(aggregate, null, 2) + "\n",
        );
        report.lighthouse.at(-1).aggregate = aggregate;
        await save();
      }
    } finally {
      await chrome.kill();
    }
    report.budget = summarizeAcceptancePerformanceBudget(
      report.lighthouse.flatMap((entry) =>
        entry.aggregate ? [entry.aggregate] : [],
      ),
      report.resources,
    );
    report.status = report.budget.labTargetsMet
      ? "PASS"
      : "COLLECTED_BUDGET_FAILED";
    report.scope =
      "Complete laboratory collection and explicit laboratory budget verdict; JS/image SHOULD recommendations separate, not RUM or production approval";
    await save();
    check(
      report.budget.labTargetsMet,
      "all twenty-one three-run mobile lab medians meet score, LCP and CLS targets after retaining all sixty-three reports",
    );
    return report;
  } catch (error) {
    if (report.status !== "COLLECTED_BUDGET_FAILED") report.status = "FAIL";
    report.failure = {
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    };
    await save();
    throw error;
  }
}
