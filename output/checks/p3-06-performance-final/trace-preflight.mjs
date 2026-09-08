import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** This deliberately limited diagnostic is not the seven-locale acceptance gate. */
export function parseDiagnosticOptions(args) {
  const options = { locales: ["en", "ja"], kinds: ["gift"], repeats: 3 };
  const seen = new Set();
  for (const argument of args) {
    const match = /^--(locales|kinds|repeats)=(.+)$/.exec(argument);
    assert.ok(
      match && !seen.has(match[1]),
      "invalid or duplicate diagnostic option",
    );
    const [, key, value] = match;
    seen.add(key);
    if (key === "repeats") {
      assert.match(value, /^[1-3]$/, "retain one to three diagnostic repeats");
      options.repeats = Number(value);
    } else {
      const values = value.split(",");
      const allowed =
        key === "locales" ? ["en", "ja"] : ["home", "artist", "gift"];
      assert.ok(
        values.every((item) => allowed.includes(item)) &&
          new Set(values).size === values.length,
        "unsupported or duplicated diagnostic target",
      );
      options[key] = values;
    }
  }
  return options;
}

/** Preserve the two original artifacts, without selecting or rewriting their events. */
export async function writeLighthouseEvidence(output, name, result) {
  const files = {};
  const save = async (kind, suffix, value) => {
    if (value === undefined) return;
    const body =
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
    const filename = `${name}${suffix}`;
    await writeFile(path.join(output, filename), body, { flag: "wx" });
    files[kind] = {
      path: filename,
      bytes: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
    };
  };
  await save("json", ".json", result?.lhr);
  const html = Array.isArray(result?.report)
    ? result.report.find((value) => value.trimStart().startsWith("<!"))
    : result?.report;
  await save("html", ".html", html);
  await save("trace", ".trace.json", result?.artifacts?.Trace);
  await save(
    "devtoolsLog",
    ".devtoolslog.json",
    result?.artifacts?.DevtoolsLog,
  );
  const artifacts = result?.artifacts;
  await save("lanternInputs", ".lantern-inputs.json", {
    schemaVersion: 1,
    URL: artifacts?.URL,
    GatherContext: artifacts?.GatherContext,
    HostDPR: artifacts?.HostDPR,
    HostFormFactor: artifacts?.HostFormFactor,
    HostProduct: artifacts?.HostProduct,
    settings: result?.lhr?.configSettings,
    SourceMaps:
      Array.isArray(artifacts?.SourceMaps) && artifacts.SourceMaps.length === 0
        ? []
        : undefined,
    sourceMapsSummary: {
      present: Array.isArray(artifacts?.SourceMaps),
      count: artifacts?.SourceMaps?.length ?? null,
      entries:
        artifacts?.SourceMaps?.map((entry) => ({
          scriptId: entry.scriptId,
          scriptUrl: entry.scriptUrl,
          sourceMapUrl: entry.sourceMapUrl,
          hasMap: Boolean(entry.map),
        })) ?? [],
      rawMapContentSaved: false,
    },
  });
  assert.ok(
    Array.isArray(result?.artifacts?.Trace?.traceEvents) &&
      result.artifacts.Trace.traceEvents.length > 0,
    "Lighthouse trace missing or empty",
  );
  assert.ok(
    Array.isArray(result?.artifacts?.DevtoolsLog) &&
      result.artifacts.DevtoolsLog.length > 0,
    "Lighthouse devtools log missing or empty",
  );
  files.trace.events = result.artifacts.Trace.traceEvents.length;
  files.devtoolsLog.events = result.artifacts.DevtoolsLog.length;
  return files;
}

function safeFailure(error) {
  return {
    code:
      error?.code === "ERR_ASSERTION"
        ? "DIAGNOSTIC_ASSERTION"
        : "DIAGNOSTIC_COLLECTION_FAILED",
    name: error?.name === "AssertionError" ? "AssertionError" : "Error",
  };
}

export async function runTracePreflight(args) {
  const [
    origin,
    manifestPath,
    certificatePath,
    outputRoot,
    sourcePath,
    ...flags
  ] = args;
  assert.match(origin ?? "", /^http:\/\/localhost:\d+$/);
  assert.ok(
    manifestPath && certificatePath && outputRoot && sourcePath,
    "five positional inputs are required",
  );
  const options = parseDiagnosticOptions(flags);
  const fixtures = JSON.parse(await readFile(manifestPath, "utf8"));
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  assert.match(source.sha256 ?? "", /^[a-f0-9]{64}$/);
  const { acceptancePages } =
    await import("../../../apps/api/scripts/storefront-acceptance-pages.mjs");
  const { withAcceptanceBrowser } =
    await import("../../../apps/api/scripts/storefront-acceptance-browser.mjs");
  const {
    aggregateAcceptanceLighthouse,
    observeAcceptanceResourceTraffic,
    summarizeAcceptanceResources,
  } =
    await import("../../../apps/api/scripts/storefront-acceptance-performance.mjs");
  const targets = acceptancePages(fixtures).filter(
    (target) =>
      options.locales.includes(target.locale) &&
      options.kinds.includes(target.kind),
  );
  assert.equal(targets.length, options.locales.length * options.kinds.length);
  await mkdir(outputRoot, { recursive: true });
  const output = path.join(
    outputRoot,
    `attempt-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(output);
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    sourceSha256: source.sha256,
    scope:
      "Finite diagnostic of the production-compiled artifact under TEST runtime. Not the complete 63-run acceptance gate, RUM or production release evidence. Every requested attempt is retained, including errors and budget failures.",
    options,
    expectedRuns: targets.length * options.repeats,
    conditions: {
      sourcePath,
      sourceVerifiedByCollector: false,
      fixtureManifest: manifestPath,
      lighthouseVersion: "13.4.1",
      lighthouseThrottling:
        "default mobile simulate, identical explicit flags to the formal collector",
      browserStorageReset: "Lighthouse default disableStorageReset=false",
      serverOptimizerMayBeWarm: true,
      resourceThrottling: "none",
      resourceViewport: { width: 390, height: 844 },
      initialNavigationOnly: true,
      resourceWindow:
        "networkidle plus document.fonts.ready, before scrolling or eager forcing",
      execution:
        "Serial diagnostics; operator must ensure no concurrent task build or sampling. Existing user desktop applications remain untouched.",
      authentication:
        "Fresh dedicated browser without supplied cookies or authorization; public TEST routes only",
    },
    resources: [],
    lighthouse: [],
    aggregates: [],
    failures: [],
    chromeClosed: false,
  };
  const save = () =>
    writeFile(
      path.join(output, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await save();
  console.log(`Trace diagnostic output: ${output}`);
  try {
    await withAcceptanceBrowser(
      { gateway: { certificatePath } },
      async (browser) => {
        report.browserVersion = browser.version();
        for (const target of targets) {
          const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            reducedMotion: "no-preference",
          });
          let traffic;
          try {
            const page = await context.newPage();
            const cdp = await context.newCDPSession(page);
            await cdp.send("Network.enable");
            await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
            traffic = observeAcceptanceResourceTraffic(page);
            const response = await page.goto(origin + target.path, {
              waitUntil: "networkidle",
              timeout: 60_000,
            });
            assert.equal(response?.status(), 200);
            await page.locator(target.selector).waitFor();
            await page.evaluate(async () => {
              await globalThis.document.fonts.ready;
            });
            await Promise.all(traffic.pending);
            const hero = await page.evaluate(
              () =>
                globalThis.document.querySelector(".storefront-hero-image img")
                  ?.currentSrc ?? null,
            );
            const budget = summarizeAcceptanceResources(
              traffic.resources,
              hero,
            );
            report.resources.push({
              ...target,
              ...budget,
              failures: traffic.failures,
            });
            assert.equal(traffic.failures.length, 0);
            assert.ok(budget.scriptCount > 0 && budget.javascriptGzipBytes > 0);
          } catch (error) {
            report.failures.push({
              stage: "RESOURCES",
              locale: target.locale,
              kind: target.kind,
              ...safeFailure(error),
              resourceFailures: traffic?.failures ?? [],
            });
          } finally {
            await context.close();
            await save();
          }
        }
      },
    );
    const { default: lighthouse } = await import("lighthouse");
    const require = createRequire(import.meta.url);
    const lighthouseRequire = createRequire(require.resolve("lighthouse"));
    const launcher = await import(lighthouseRequire.resolve("chrome-launcher"));
    const certificate = new X509Certificate(await readFile(certificatePath));
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
      for (const target of targets) {
        const runs = [];
        for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
          const name = `${target.locale}-${target.kind}-mobile-${repeat}`;
          try {
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
            const files = await writeLighthouseEvidence(output, name, result);
            const lhr = result.lhr;
            const entry = {
              ...target,
              repeat,
              files,
              score: lhr.categories.performance.score,
              lcpMs: lhr.audits["largest-contentful-paint"].numericValue,
              cls: lhr.audits["cumulative-layout-shift"].numericValue,
              tbtMs: lhr.audits["total-blocking-time"].numericValue,
              runtimeError: lhr.runtimeError ?? null,
              runWarnings: lhr.runWarnings,
              configSettings: lhr.configSettings,
              observedMetrics: lhr.audits.metrics?.details?.items?.[0] ?? null,
              observedLcpBreakdown:
                lhr.audits["lcp-breakdown-insight"]?.details ?? null,
            };
            report.lighthouse.push(entry);
            assert.equal(lhr.lighthouseVersion, "13.4.1");
            assert.equal(entry.runtimeError, null);
            assert.ok(
              Number.isFinite(entry.score) &&
                entry.score >= 0 &&
                entry.score <= 1 &&
                Number.isFinite(entry.lcpMs) &&
                Number.isFinite(entry.cls),
            );
            runs.push(lhr);
            console.log(
              `Lighthouse ${name}: score ${entry.score}, LCP ${entry.lcpMs.toFixed(1)} ms`,
            );
          } catch (error) {
            report.failures.push({
              stage: "LIGHTHOUSE",
              locale: target.locale,
              kind: target.kind,
              repeat,
              ...safeFailure(error),
            });
          }
          await save();
        }
        if (options.repeats === 3 && runs.length === 3) {
          report.aggregates.push({
            locale: target.locale,
            kind: target.kind,
            ...aggregateAcceptanceLighthouse(runs),
          });
          await save();
        }
      }
    } finally {
      await chrome.kill();
      report.chromeClosed = true;
    }
    report.partialLabTargetsMet =
      options.repeats === 3 && report.aggregates.length === targets.length
        ? report.aggregates.every(
            (item) =>
              item.performanceScoreTargetMet &&
              item.lcpLabTargetMet &&
              item.clsLabTargetMet,
          )
        : null;
    report.javascriptShouldMet =
      report.resources.length === targets.length &&
      report.resources.every((item) => item.javascriptRecommendationMet);
    report.imagesShouldMet =
      report.resources.length === targets.length &&
      report.resources.every(
        (item) =>
          item.images.length > 0 &&
          item.images.every((image) => image.shouldBudgetMet),
      );
    report.status =
      report.failures.length > 0
        ? "DIAGNOSTIC_COLLECTION_FAILED"
        : report.partialLabTargetsMet === false
          ? "COLLECTED_DIAGNOSTIC_BUDGET_FAILED"
          : "DIAGNOSTIC_COMPLETE";
  } catch (error) {
    report.status = "DIAGNOSTIC_COLLECTION_FAILED";
    report.failures.push({ stage: "ENVIRONMENT", ...safeFailure(error) });
  } finally {
    report.completedAt = new Date().toISOString();
    await save();
  }
  return { output, report };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const { report } = await runTracePreflight(process.argv.slice(2));
  if (
    report.status === "DIAGNOSTIC_COLLECTION_FAILED" ||
    report.status === "COLLECTED_DIAGNOSTIC_BUDGET_FAILED"
  )
    process.exitCode = 1;
}
