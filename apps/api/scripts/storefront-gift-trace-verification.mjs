import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { storefrontGiftResponseSchema } from "@fan-support/contracts";
import { createAcceptanceLighthouseConfig } from "./storefront-acceptance-content.mjs";
import { aggregateAcceptanceLighthouse } from "./storefront-acceptance-performance.mjs";
import { acceptancePages } from "./storefront-acceptance-pages.mjs";
import { summarizeGiftReadWindow } from "./storefront-gift-read-verification.mjs";

const json = (value) => JSON.stringify(value ?? null, null, 2) + "\n";
const safeFailure = (error) => ({
  name: error?.name ?? "UnknownFailure",
  assertion: error?.name === "AssertionError" ? error.message : null,
});
const compositorTraceCategories = [
  "cc",
  "disabled-by-default-cc.debug",
  "renderer.scheduler",
  "disabled-by-default-renderer.scheduler",
  "blink",
  "viz",
];

function traceCategoriesFor(profile) {
  assert.ok(
    ["standard", "compositor-diagnostic"].includes(profile),
    "Unknown gift trace profile",
  );
  return profile === "compositor-diagnostic" ? compositorTraceCategories : [];
}

/** Keep the original comparison launcher unchanged; no renderer experiment flags. */
export function giftTraceChromeOptions(pin) {
  return {
    chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    handleSIGINT: false,
    logLevel: "silent",
    chromeFlags: [
      "--headless=new",
      `--ignore-certificate-errors-spki-list=${pin}`,
      "--host-resolver-rules=MAP media.example.invalid 127.0.0.1",
      "--no-proxy-server",
    ],
  };
}

function optionsFor(port, traceProfile = "standard") {
  const categories = traceCategoriesFor(traceProfile);
  return {
    port,
    logLevel: "error",
    output: ["json", "html"],
    onlyCategories: [
      "performance",
      "accessibility",
      "best-practices",
      "seo",
      "storefront",
    ],
    formFactor: "mobile",
    throttlingMethod: "simulate",
    ...(categories.length > 0
      ? { additionalTraceCategories: categories.join(",") }
      : {}),
  };
}

async function retainAttempt({
  directory,
  name,
  raw,
  failure,
  options,
  launchOptions,
  target,
  url,
  config,
  nativeLog,
  before,
}) {
  const html = Array.isArray(raw?.report)
    ? raw.report.find(
        (value) =>
          typeof value === "string" && value.trimStart().startsWith("<!"),
      )
    : raw?.report;
  const configuration = {
    schemaVersion: 1,
    target,
    url,
    options,
    launchOptions,
    internalLanternUseTracePresent: Object.hasOwn(
      process.env,
      "INTERNAL_LANTERN_USE_TRACE",
    ),
    inputConfig: {
      extends: config.extends,
      categories: config.categories,
      artifacts: config.artifacts.map(({ id, gatherer }) => ({
        id,
        className: gatherer.constructor.name,
        meta: gatherer.meta,
      })),
      audits: config.audits.map((audit) => ({
        className: audit.name,
        meta: audit.meta,
      })),
    },
    lhrSettings: raw?.lhr?.configSettings ?? null,
    artifactSettings: raw?.artifacts?.settings ?? null,
  };
  const records = [
    [".json", json(raw?.lhr)],
    ["-trace.json", json(raw?.artifacts?.Trace)],
    ["-devtools.json", json(raw?.artifacts?.DevtoolsLog)],
    ["-artifacts.json", json(raw?.artifacts)],
    ["-config.json", json(configuration)],
    ["-lighthouse.html", typeof html === "string" ? html : ""],
    [
      "-document.html",
      typeof raw?.artifacts?.MainDocumentContent === "string"
        ? raw.artifacts.MainDocumentContent
        : "",
    ],
    ["-native.log", nativeLog],
    [
      "-capture.json",
      json({
        schemaVersion: 1,
        afterSequence: before,
        runnerReturned: Boolean(raw),
        failure: failure ?? null,
      }),
    ],
  ];
  const files = {};
  for (const [suffix, value] of records) {
    const file = name + suffix;
    await writeFile(path.join(directory, file), value);
    files[suffix] = {
      file,
      bytes: Buffer.byteLength(value),
      sha256: createHash("sha256").update(value).digest("hex"),
    };
  }
  return files;
}

function validateAttempt(raw, reads, mode, url, traceProfile) {
  assert.ok(
    raw?.lhr && raw.artifacts,
    "Lighthouse must return its LHR and original artifacts",
  );
  assert.equal(
    raw.lhr.lighthouseVersion,
    "13.4.1",
    "pinned Lighthouse version is unchanged",
  );
  assert.equal(
    raw.lhr.requestedUrl,
    url,
    "report must belong to the requested fixed navigation",
  );
  assert.ok(
    !raw.lhr.runtimeError,
    "Lighthouse runtime failure remains a failed sample",
  );
  assert.ok(
    Array.isArray(raw.artifacts.Trace?.traceEvents) &&
      raw.artifacts.Trace.traceEvents.length > 0,
    "original RunnerResult.artifacts.Trace is required",
  );
  assert.ok(
    Array.isArray(raw.artifacts.DevtoolsLog) &&
      raw.artifacts.DevtoolsLog.length > 0,
    "original RunnerResult.artifacts.DevtoolsLog is required",
  );
  assert.ok(
    typeof raw.artifacts.MainDocumentContent === "string" &&
      raw.artifacts.MainDocumentContent.includes("</html>"),
    "same-navigation complete HTML must be retained",
  );
  const htmlReports = Array.isArray(raw.report) ? raw.report : [raw.report];
  assert.ok(
    htmlReports.some(
      (value) =>
        typeof value === "string" && value.trimStart().startsWith("<!"),
    ),
    "Lighthouse HTML report must be retained",
  );
  const content = raw.lhr.audits?.["storefront-content"];
  assert.ok(
    content?.score === 1 && !content.errorMessage,
    "same-navigation visible gift content is required",
  );
  assert.equal(raw.lhr.configSettings?.formFactor, "mobile");
  assert.equal(raw.lhr.configSettings?.throttlingMethod, "simulate");
  if (traceProfile === "compositor-diagnostic") {
    const categories = traceCategoriesFor(traceProfile).join(",");
    assert.equal(
      raw.lhr.configSettings?.additionalTraceCategories,
      categories,
      "LHR trace categories must match the diagnostic profile",
    );
    assert.equal(
      raw.artifacts.settings?.additionalTraceCategories,
      categories,
      "artifact trace categories must match the diagnostic profile",
    );
  }
  assert.deepEqual(
    reads.counts,
    { GIFT_CONTENT: mode === "baseline" ? 1 : 0, STOREFRONT_GIFT: 1 },
    "native read counts must match declared source mode",
  );
  assert.ok(
    reads.requests.every(({ status }) => status === 200),
    "all native content reads must succeed",
  );
}

/** Exactly three measured navigations; collect every scheduled result before final rejection. */
export async function collectGiftTraceAttempts(
  {
    directory,
    mode,
    traceProfile = "standard",
    target,
    url,
    options,
    launchOptions,
    readNativeLog,
    progress,
  },
  runLighthouse,
) {
  const additionalTraceCategories = traceCategoriesFor(traceProfile);
  assert.ok(["baseline", "candidate"].includes(mode));
  assert.equal(target.locale, "zh-CN");
  assert.equal(target.kind, "gift");
  await mkdir(directory, { recursive: true });
  const flags = optionsFor(options.port, traceProfile);
  const config = createAcceptanceLighthouseConfig(target, url);
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    mode,
    target,
    url,
    generatedAt: new Date().toISOString(),
    conditions: {
      formalPerformanceAcceptance: false,
      diagnosticsEnabled: true,
      scheduledNavigations: 3,
      additionalBrowserNavigations: 0,
      publicApiPublicationReadsBeforeGroup: 1,
      browserPrewarming: false,
      allScheduledAttemptsRetained: true,
      traceProfile,
      defaultTraceCategories: traceProfile === "standard",
      additionalTraceCategories,
      serverAndImageCacheMayBeWarm: true,
    },
    attempts: [],
    aggregate: null,
  };
  const save = () =>
    writeFile(path.join(directory, "results.json"), json(report));
  await save();
  const runs = [];
  const failures = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const name = `zh-CN-gift-mobile-${attempt}`;
    progress(`gift render trace ${mode}/${name} ${attempt}/3`);
    let before = 0,
      raw,
      runFailure,
      nativeLog = "",
      captureFailure;
    try {
      nativeLog = await readNativeLog();
      before = summarizeGiftReadWindow(nativeLog, 0).lastSequence;
    } catch (error) {
      captureFailure = error;
    }
    try {
      raw = await runLighthouse(url, flags, config);
    } catch (error) {
      runFailure = error;
    }
    try {
      nativeLog = await readNativeLog();
    } catch (error) {
      captureFailure ??= error;
    }
    const files = await retainAttempt({
      directory,
      name,
      raw,
      failure: runFailure ? safeFailure(runFailure) : null,
      options: flags,
      launchOptions,
      target,
      url,
      config,
      nativeLog,
      before,
    });
    const entry = {
      attempt,
      name,
      files,
      reads: null,
      contentValidity: raw?.lhr?.audits?.["storefront-content"] ?? null,
      failure: null,
    };
    report.attempts.push(entry);
    await save();
    try {
      if (runFailure) throw runFailure;
      if (captureFailure) throw captureFailure;
      entry.reads = summarizeGiftReadWindow(nativeLog, before);
      await writeFile(
        path.join(directory, name + "-reads.json"),
        json(entry.reads),
      );
      validateAttempt(raw, entry.reads, mode, url, traceProfile);
      runs.push(raw.lhr);
    } catch (error) {
      entry.failure = safeFailure(error);
      failures.push(error);
    }
    await save();
  }
  if (failures.length > 0) {
    report.status = "FAIL";
    await save();
    throw new AggregateError(
      failures,
      "Fixed gift trace group contains invalid retained samples",
    );
  }
  try {
    report.aggregate = aggregateAcceptanceLighthouse(runs);
    const aggregate = report.aggregate;
    report.status =
      aggregate.performanceScoreTargetMet &&
      aggregate.lcpLabTargetMet &&
      aggregate.clsLabTargetMet
        ? "COLLECTED_DIAGNOSTIC_BUDGET_PASSED"
        : "COLLECTED_DIAGNOSTIC_BUDGET_FAILED";
    await save();
    return report;
  } catch (error) {
    report.status = "FAIL";
    report.failure = safeFailure(error);
    await save();
    throw error;
  }
}

async function retainPublication({ base, fixtures, target, directory }) {
  const scope = fixtures.markets[0];
  const gift = fixtures.gifts[0];
  const query = new globalThis.URLSearchParams({
    locale: target.locale,
    ...scope,
  });
  const url = `${base}/api/v1/storefront-gifts/${encodeURIComponent(gift.handle)}?${query}`;
  const response = await globalThis.fetch(url, {
    redirect: "manual",
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  await writeFile(
    path.join(directory, "fixture-publication-response.txt"),
    text,
  );
  const body = JSON.parse(text);
  await writeFile(
    path.join(directory, "fixture-publication.json"),
    json({
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      requestCount: 1,
      source: "Existing public API; no browser or Next navigation",
      url,
      status: response.status,
      etag: response.headers.get("etag"),
      body,
    }),
  );
  assert.equal(response.status, 200);
  const parsed = storefrontGiftResponseSchema.parse(body);
  assert.equal(parsed.outcome, "SUCCESS");
  assert.equal(parsed.content.view.id, gift.id);
  assert.equal(parsed.content.view.handle, gift.handle);
  assert.equal(
    parsed.content.view.localeContext.requestedLocale,
    target.locale,
  );
  assert.equal(parsed.market, scope.market);
  assert.equal(parsed.currency, scope.currency);
}

/** TEST-only fixture callback; one API proof, one owned Chrome, three Lighthouse navigations. */
export async function verifyGiftTraceComparison({
  origin,
  base,
  fixtures,
  manifest,
  gateway,
  output,
  next,
  mode,
  traceProfile = "standard",
  progress,
}) {
  assert.equal(
    process.env.FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS,
    "1",
    "trace callback requires explicit TEST diagnostics",
  );
  assert.equal(manifest.environment, "TEST");
  traceCategoriesFor(traceProfile);
  const directory = path.join(output, "gift-render-trace");
  await mkdir(directory, { recursive: true });
  const target = acceptancePages(fixtures).find(
    (page) => page.locale === "zh-CN" && page.kind === "gift",
  );
  assert.ok(target, "fixed Chinese gift fixture exists");
  await writeFile(
    path.join(directory, "fixture-manifest.json"),
    json(manifest),
  );
  await writeFile(
    path.join(directory, "acceptance-content-source.mjs"),
    await readFile(
      new globalThis.URL(
        "./storefront-acceptance-content.mjs",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await retainPublication({ base, fixtures, target, directory });
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
  const launchOptions = giftTraceChromeOptions(pin);
  const chrome = await launcher.launch(launchOptions);
  const runtimeFile = path.join(
    path.dirname(output),
    `next-runtime-${next.generation()}.log`,
  );
  try {
    return await collectGiftTraceAttempts(
      {
        directory,
        mode,
        traceProfile,
        target,
        url: origin + target.path,
        options: optionsFor(chrome.port, traceProfile),
        launchOptions,
        readNativeLog: () => readFile(runtimeFile, "utf8"),
        progress,
      },
      lighthouse,
    );
  } finally {
    await chrome.kill();
  }
}
