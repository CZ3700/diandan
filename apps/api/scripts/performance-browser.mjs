import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { FONT_PROFILE_BY_LOCALE } from "../../../packages/design-tokens/dist/index.js";
import { readFontCascade } from "../../../scripts/font-ui-subset-support.mjs";
import {
  performancePlan,
  assertPerformanceCollection,
} from "../../../scripts/performance-plan.mjs";
import { acceptancePages } from "./storefront-acceptance-pages.mjs";
import {
  readPerformanceContent,
  performanceRequiredContent,
  createPerformanceLighthouseConfig,
} from "./performance-content.mjs";
import { withAcceptanceBrowser } from "./storefront-acceptance-browser.mjs";
import { verifyAcceptancePerformance } from "./storefront-acceptance-performance.mjs";
import {
  observePerformanceTraffic,
  assessPerformanceResources,
  messageFingerprints,
} from "./performance-resources.mjs";
import { collectPerformanceDiagnostics } from "./performance-diagnostics.mjs";

async function fontHashes(workspaceRoot) {
  const root = path.join(workspaceRoot, "packages/design-tokens");
  const profiles = new Map();
  for (const profile of Object.values(FONT_PROFILE_BY_LOCALE)) {
    if (profiles.has(profile.id)) continue;
    const { faces } = await readFontCascade(
      path.join(root, "styles/fonts", `${profile.id}.css`),
      root,
    );
    const hashes = new Set();
    for (const resource of new Set(faces.map((face) => face.resource)))
      hashes.add(
        createHash("sha256")
          .update(await readFile(resource))
          .digest("hex"),
      );
    profiles.set(profile.id, hashes);
  }
  return new Map(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      profiles.get(FONT_PROFILE_BY_LOCALE[locale].id),
    ]),
  );
}

function observeMetrics() {
  const values = { lcpMs: null, cls: 0, supported: false };
  let windowValue = 0,
    firstShift = 0,
    lastShift = 0;
  globalThis.__performanceLab = values;
  if (
    globalThis.PerformanceObserver?.supportedEntryTypes.includes(
      "largest-contentful-paint",
    ) &&
    globalThis.PerformanceObserver.supportedEntryTypes.includes("layout-shift")
  ) {
    values.supported = true;
    new globalThis.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) values.lcpMs = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new globalThis.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        if (
          windowValue > 0 &&
          entry.startTime - lastShift < 1000 &&
          entry.startTime - firstShift < 5000
        )
          windowValue += entry.value;
        else {
          windowValue = entry.value;
          firstShift = entry.startTime;
        }
        lastShift = entry.startTime;
        values.cls = Math.max(values.cls, windowValue);
      }
    }).observe({ type: "layout-shift", buffered: true });
  }
}

export async function verifyPerformanceMatrix({
  workspaceRoot,
  diagnostic = false,
  ...context
}) {
  const { origin, fixtures, gateway, output, progress } = context;
  const plan = performancePlan({ diagnostic });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    plan,
    cells: [],
    original: null,
    conditions: {
      artifact: "Production-compiled local TEST",
      transport: "Owned H2 viewer over loopback HTTP upstream",
      resourceCache: "New context and disabled browser cache per cell",
      resourceThrottling: "none",
      serverCache: "Shared fixture; image optimizer can be warm",
      concurrency: "serial only",
      noEagerImageMutation: true,
      sourceAssets:
        "Synthetic authorized TEST fixtures, not approved production photography",
    },
    realUserEvidence: false,
    physicalDeviceEvidence: false,
  };
  const directory = path.join(output, "six-screen");
  await mkdir(directory, { recursive: true });
  const save = () =>
    writeFile(
      path.join(directory, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const targets = [
    ...acceptancePages(fixtures),
    ...SUPPORTED_LOCALES.map((locale) => ({
      locale,
      kind: "gift-browse",
      path: `/${locale}/gifts`,
      selector: "[data-gift-browse]",
    })),
  ];
  await save();
  try {
    if (!diagnostic) {
      try {
        report.original = await verifyAcceptancePerformance({
          ...context,
          createLighthouseConfig: createPerformanceLighthouseConfig,
        });
      } catch (error) {
        report.originalFailure = {
          name: error?.name,
          assertion: error?.name === "AssertionError" ? error.message : null,
        };
        report.original = JSON.parse(
          await readFile(path.join(output, "performance/results.json"), "utf8"),
        );
      }
      report.currentContentSamples = [];
      for (const sample of report.original.lighthouse) {
        const result = JSON.parse(
          await readFile(path.join(output, "performance", sample.file), "utf8"),
        );
        report.currentContentSamples.push({
          file: sample.file,
          score: result.audits?.["performance-current-content"]?.score ?? null,
        });
      }
      await save();
    }
    const hashes = await fontHashes(workspaceRoot);
    const catalogs = {};
    for (const locale of SUPPORTED_LOCALES)
      catalogs[locale] = await loadStorefrontCopy(locale);
    const probes = messageFingerprints(catalogs);
    await withAcceptanceBrowser({ gateway }, async (browser) => {
      report.browserVersion = browser.version();
      for (const cell of plan.resources) {
        const target = targets.find(
          (value) => value.locale === cell.locale && value.kind === cell.kind,
        );
        assert.ok(target, "Every planned resource target resolves");
        progress(`six-screen resource ${cell.id}`);
        const entry = { ...cell, status: "RUNNING" };
        report.cells.push(entry);
        const browserContext = await browser.newContext({
          viewport: { width: cell.width, height: cell.height },
          reducedMotion: "no-preference",
        });
        try {
          const page = await browserContext.newPage();
          const errors = [];
          page.on("pageerror", () => errors.push({ kind: "PAGE_ERROR" }));
          await page.addInitScript(observeMetrics);
          const session = await browserContext.newCDPSession(page);
          await session.send("Network.enable");
          await session.send("Network.setCacheDisabled", {
            cacheDisabled: true,
          });
          let currentLocaleMatches = 0;
          const foreignLocaleMatches = new Set();
          const traffic = observePerformanceTraffic(page, (text) => {
            const observed = probes.inspect(cell.locale, text);
            currentLocaleMatches += observed.currentLocaleMatches;
            for (const locale of observed.foreignLocaleMatches)
              foreignLocaleMatches.add(locale);
          });
          const response = await page.goto(origin + target.path, {
            waitUntil: "networkidle",
            timeout: 60_000,
          });
          assert.equal(
            response?.status(),
            200,
            "A successful actual page is required",
          );
          await page.locator(target.selector).waitFor();
          await page.evaluate(async () => {
            await globalThis.document.fonts.ready;
          });
          await traffic.settle();
          entry.content = await page.evaluate(readPerformanceContent, {
            selector: target.selector,
            expectedUrl: origin + target.path,
            locale: cell.locale,
            requiredSelectors: performanceRequiredContent(cell.kind),
          });
          entry.measurement = await page.evaluate(() => ({
            width: globalThis.innerWidth,
            height: globalThis.innerHeight,
            documentWidth: globalThis.document.documentElement.scrollWidth,
            locale: globalThis.document.documentElement.lang,
            metrics: globalThis.__performanceLab ?? null,
            hero:
              globalThis.document.querySelector(".storefront-hero-image img")
                ?.currentSrc ?? null,
            fontFamily: globalThis.getComputedStyle(globalThis.document.body)
              .fontFamily,
            images: [...globalThis.document.images]
              .filter((image) => image.complete && image.naturalWidth > 0)
              .map((image) => ({
                width: image.width,
                height: image.height,
                loading: image.loading,
                hasSrcset: Boolean(image.srcset),
                currentSrc: image.currentSrc,
              })),
            timing: globalThis.performance
              .getEntriesByType("resource")
              .map((entry) => ({
                name: entry.name,
                initiatorType: entry.initiatorType,
                transferSize: entry.transferSize,
                encodedBodySize: entry.encodedBodySize,
                decodedBodySize: entry.decodedBodySize,
                nextHopProtocol: entry.nextHopProtocol,
              })),
          }));
          entry.resourceAssessment = assessPerformanceResources({
            origin,
            locale: cell.locale,
            resources: traffic.resources,
            failures: traffic.failures,
            allowedFontHashes: hashes.get(cell.locale),
            messageEvidence: {
              currentLocaleMatches,
              foreignLocaleMatches: [...foreignLocaleMatches],
            },
            heroUrl: entry.measurement.hero,
          });
          entry.pageErrors = errors;
          assert.equal(
            entry.content.valid,
            true,
            "Same navigation must contain its actual current content",
          );
          assert.equal(entry.measurement.width, cell.width);
          assert.equal(entry.measurement.height, cell.height);
          assert.ok(
            entry.measurement.documentWidth <= cell.width + 1,
            "Rendered layout must fit the requested viewport",
          );
          assert.equal(
            entry.measurement.metrics?.supported,
            true,
            "Lab metric observer must be supported",
          );
          assert.ok(
            Number.isFinite(entry.measurement.metrics.lcpMs) &&
              entry.measurement.metrics.lcpMs > 0,
            "Unknown LCP cannot pass collection",
          );
          assert.ok(
            Number.isFinite(entry.measurement.metrics.cls) &&
              entry.measurement.metrics.cls >= 0,
            "Unknown CLS cannot pass collection",
          );
          assert.equal(
            entry.resourceAssessment.passed,
            true,
            "Resource/font/message/third-party checks must all pass",
          );
          assert.equal(errors.length, 0, "Page errors cannot be omitted");
          entry.status = "PASS";
        } catch (error) {
          entry.status = "FAIL";
          entry.failure = {
            name: error?.name,
            assertion: error?.name === "AssertionError" ? error.message : null,
          };
          throw error;
        } finally {
          await browserContext.close();
          await save();
        }
      }
    });
    if (diagnostic) {
      report.diagnostic = await collectPerformanceDiagnostics({
        ...context,
        targets: plan.resources.map((cell) =>
          targets.find(
            (target) =>
              target.locale === cell.locale && target.kind === cell.kind,
          ),
        ),
        output: path.join(output, "diagnostic-lighthouse"),
      });
      report.status = "DIAGNOSTIC_COLLECTED";
    } else {
      assertPerformanceCollection(plan, report.cells, report.original);
      assert.ok(
        report.currentContentSamples.length === 63 &&
          report.currentContentSamples.every((sample) => sample.score === 1),
        "Every original Lighthouse navigation must also contain current homepage/gift content",
      );
      report.status = "PASS";
    }
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
