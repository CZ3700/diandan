import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { withAcceptanceBrowser } from "./storefront-acceptance-browser.mjs";
import { createAcceptanceLighthouseConfig } from "./storefront-acceptance-content.mjs";
import { aggregateAcceptanceLighthouse } from "./storefront-acceptance-performance.mjs";
import {
  acceptancePages,
  acceptanceViewports,
} from "./storefront-acceptance-pages.mjs";

const prefix = "STOREFRONT_TEST_FETCH_DIAGNOSTIC ";
const targets = new Set([
  "HOMEPAGE",
  "IDOL",
  "GIFT_CONTENT",
  "STOREFRONT_GIFT",
]);

/** Native logs contain no URL, handle, query, headers or body; sequence windows isolate navigations. */
export function summarizeGiftReadWindow(log, afterSequence) {
  assert.ok(Number.isSafeInteger(afterSequence) && afterSequence >= 0);
  const all = log
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => JSON.parse(line.slice(prefix.length)))
    // The TEST child logger appends stdout chunks asynchronously. Its file order
    // can differ from this observer's monotonic native emission sequence.
    .sort((left, right) => left.sequence - right.sequence);
  let previous = 0;
  for (const event of all) {
    assert.equal(event.schemaVersion, 1);
    assert.ok(
      Number.isSafeInteger(event.sequence) && event.sequence === previous + 1,
      "native sequence must be unique and contiguous from one",
    );
    assert.notEqual(
      event.stage,
      "TRUNCATED",
      "truncated observation cannot prove read counts",
    );
    previous = event.sequence;
  }
  assert.ok(
    afterSequence <= previous,
    "sequence window must refer to observed events",
  );
  const records = all.filter((event) => event.sequence > afterSequence);
  const groups = new Map();
  for (const event of records) {
    assert.ok(targets.has(event.target));
    assert.ok(
      Number.isSafeInteger(event.requestSequence) && event.requestSequence > 0,
    );
    assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0);
    const group = groups.get(event.requestSequence) ?? [];
    group.push(event);
    groups.set(event.requestSequence, group);
  }
  const requests = [];
  const counts = { GIFT_CONTENT: 0, STOREFRONT_GIFT: 0 };
  for (const [requestSequence, group] of groups) {
    assert.deepEqual(
      group.map(({ stage }) => stage),
      ["CREATE", "HEADERS", "COMPLETE"],
      "each counted native request must complete exactly once",
    );
    assert.ok(group.every((event) => event.target === group[0].target));
    assert.ok(
      Number.isInteger(group[1].status) &&
        group[1].status >= 100 &&
        group[1].status <= 599,
    );
    const { target } = group[0];
    if (target in counts) counts[target]++;
    requests.push({
      requestSequence,
      target,
      status: group[1].status,
      durationMs: group[2].durationMs,
    });
  }
  return { afterSequence, lastSequence: previous, counts, requests, records };
}

function readMetadata() {
  return {
    title: globalThis.document.title,
    heading:
      globalThis.document
        .querySelector("[data-gift-detail] h1")
        ?.textContent?.trim() ?? null,
    description:
      globalThis.document.querySelector('meta[name="description"]')?.content ??
      null,
    canonical: [
      ...globalThis.document.querySelectorAll('link[rel="canonical"]'),
    ].map((link) => link.href),
    robots: [...globalThis.document.querySelectorAll('meta[name="robots"]')]
      .map((meta) => meta.content)
      .join(","),
    alternates: [
      ...globalThis.document.querySelectorAll(
        'link[rel="alternate"][hreflang]',
      ),
    ].map((link) => ({ locale: link.hreflang, href: link.href })),
    ogUrl:
      globalThis.document.querySelector('meta[property="og:url"]')?.content ??
      null,
    ogTitle:
      globalThis.document.querySelector('meta[property="og:title"]')?.content ??
      null,
    structured: [
      ...globalThis.document.querySelectorAll(
        'script[type="application/ld+json"]',
      ),
    ].map((script) => JSON.parse(script.textContent)),
    detailVisible: [
      ...globalThis.document.querySelectorAll("[data-gift-detail]"),
    ].some((element) =>
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
    ),
    errorVisible: [
      ...globalThis.document.querySelectorAll(".storefront-state"),
    ].some((element) =>
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
    ),
  };
}

function verifyNormalMetadata(metadata, target, origin, check) {
  const canonical = new globalThis.URL(target.path, origin);
  check(
    Boolean(metadata.title && metadata.heading && metadata.description),
    "gift document contains title, heading and description",
  );
  assert.deepEqual(metadata.canonical, [canonical.href]);
  check(
    metadata.ogUrl === canonical.href && Boolean(metadata.ogTitle),
    "gift Open Graph agrees with actual canonical",
  );
  check(metadata.robots.includes("noindex"), "TEST remains noindex");
  const expected = [
    ...SUPPORTED_LOCALES.map((locale) => {
      const alternate = new globalThis.URL(canonical);
      alternate.pathname = `/${locale}${canonical.pathname.slice(target.locale.length + 1)}`;
      return `${locale}:${alternate.href}`;
    }),
    `x-default:${origin}/en${canonical.pathname.slice(target.locale.length + 1)}${canonical.search}`,
  ].sort();
  assert.deepEqual(
    metadata.alternates.map(({ locale, href }) => `${locale}:${href}`).sort(),
    expected,
  );
  check(
    metadata.structured.some((value) => value["@type"] === "Product"),
    "gift has actual Product JSON-LD",
  );
  check(
    metadata.structured.some((value) => Array.isArray(value["@graph"])),
    "gift has page JSON-LD graph",
  );
}

/** Diagnostic comparison only: same seed, rebuilt artifact per callback, fresh contexts per page. */
export async function verifyGiftReadComparison({
  origin,
  fixtures,
  gateway,
  output,
  check,
  progress,
  next,
  proxy,
  mode,
  fullMatrixRequested = false,
}) {
  const directory = path.join(output, "gift-read-comparison");
  await mkdir(directory, { recursive: true });
  const runtimeFile = path.join(
    path.dirname(output),
    `next-runtime-${next.generation()}.log`,
  );
  const readWindow = async (afterSequence) =>
    summarizeGiftReadWindow(await readFile(runtimeFile, "utf8"), afterSequence);
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    mode,
    generatedAt: new Date().toISOString(),
    conditions: {
      diagnosticsEnabled: true,
      formalPerformanceAcceptance: false,
      actualPostgres: true,
      actualTlsS3: true,
      sharedFixtureSeed: true,
      isolatedContextPerPage: true,
      browserCacheDisabled: true,
      serverAndImageCacheMayBeWarm: true,
      allLighthouseAttemptsRetained: true,
      fullMatrixRunsAfterComparison: fullMatrixRequested,
    },
    navigations: [],
    lighthouse: [],
    edgeCases: [],
  };
  const save = () =>
    writeFile(
      path.join(directory, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const giftTargets = acceptancePages(fixtures).filter(
    (target) => target.kind === "gift",
  );
  await save();
  try {
    await withAcceptanceBrowser({ gateway }, async (browser) => {
      report.browserVersion = browser.version();
      async function navigate(
        target,
        viewport,
        name,
        expectedCounts,
        expectedStatus = 200,
      ) {
        const before = (await readWindow(0)).lastSequence;
        const context = await browser.newContext({
          viewport,
          reducedMotion: "no-preference",
        });
        try {
          const page = await context.newPage();
          const failures = [];
          page.on("pageerror", (error) =>
            failures.push({ type: "pageerror", name: error.name }),
          );
          page.on("requestfailed", (request) =>
            failures.push({
              type: "requestfailed",
              resourceType: request.resourceType(),
            }),
          );
          const session = await context.newCDPSession(page);
          await session.send("Network.enable");
          await session.send("Network.setCacheDisabled", {
            cacheDisabled: true,
          });
          const response = await page.goto(origin + target.path, {
            waitUntil: "networkidle",
            timeout: 60_000,
          });
          const html = await response.text();
          await writeFile(path.join(directory, `${name}.html`), html);
          check(
            response.status() === expectedStatus,
            `${name}: expected actual document status`,
          );
          await page.evaluate(async () => {
            await globalThis.document.fonts.ready;
          });
          const metadata = await page.evaluate(readMetadata);
          const validity = await page.evaluate(
            ({ selector, expectedUrl, locale }) => {
              const visible = (element) =>
                element.checkVisibility({
                  checkOpacity: true,
                  checkVisibilityCSS: true,
                });
              return {
                urlMatches: globalThis.location.href === expectedUrl,
                localeMatches:
                  globalThis.document.documentElement.lang === locale,
                contentVisible: [
                  ...globalThis.document.querySelectorAll(selector),
                ].some(visible),
                errorVisible: [
                  ...globalThis.document.querySelectorAll(".storefront-state"),
                ].some(visible),
              };
            },
            {
              selector: target.selector,
              expectedUrl: origin + target.path,
              locale: target.locale,
            },
          );
          const reads = await readWindow(before);
          assert.deepEqual(
            reads.counts,
            expectedCounts,
            `${name}: actual native reads match declared mode`,
          );
          check(
            failures.length === 0,
            `${name}: no browser runtime or network failure`,
          );
          check(
            html.includes("</html>"),
            `${name}: complete document body retained`,
          );
          await page.screenshot({
            path: path.join(directory, `${name}.png`),
            fullPage: true,
          });
          return {
            name,
            ...target,
            viewport,
            documentStatus: response.status(),
            htmlFile: `${name}.html`,
            screenshot: `${name}.png`,
            htmlSha256: createHash("sha256").update(html).digest("hex"),
            metadata,
            validity,
            reads,
            browserFailures: failures,
          };
        } finally {
          await context.close();
        }
      }
      for (const viewport of acceptanceViewports)
        for (const target of giftTargets) {
          const name = `${target.locale}-gift-${viewport.width}`;
          progress(`gift read comparison ${mode}/${name}`);
          const entry = await navigate(target, viewport, name, {
            GIFT_CONTENT: mode === "baseline" ? 1 : 0,
            STOREFRONT_GIFT: 1,
          });
          report.navigations.push(entry);
          await save();
          check(
            entry.validity.urlMatches &&
              entry.validity.localeMatches &&
              entry.validity.contentVisible &&
              !entry.validity.errorVisible,
            `${name}: actual visible gift content is valid`,
          );
          check(
            entry.reads.requests.every(({ status }) => status === 200),
            `${name}: every measured read succeeds`,
          );
          verifyNormalMetadata(entry.metadata, target, origin, check);
        }
      if (mode === "candidate") {
        const target = giftTargets.find((entry) => entry.locale === "en");
        const viewport = acceptanceViewports[0];
        const scope = new globalThis.URLSearchParams(fixtures.markets[0]);
        const missing = {
          ...target,
          path: `/en/gifts/missing-comparison-gift?${scope}`,
        };
        const missingEntry = await navigate(
          missing,
          viewport,
          "missing-scoped-gift",
          { GIFT_CONTENT: 0, STOREFRONT_GIFT: 1 },
          404,
        );
        check(
          !missingEntry.metadata.detailVisible,
          "missing scoped gift exposes no detail",
        );
        report.edgeCases.push(missingEntry);
        await save();
        proxy.setFailure("/api/v1/storefront-gifts/");
        try {
          const failed = await navigate(
            target,
            viewport,
            "scoped-gift-unavailable",
            { GIFT_CONTENT: 0, STOREFRONT_GIFT: 1 },
          );
          check(
            !failed.metadata.detailVisible && failed.metadata.errorVisible,
            "scoped transport failure exposes no gift detail or price",
          );
          check(
            !JSON.stringify(failed.metadata.structured).includes('"offers"'),
            "failed scoped gift exposes no offer JSON-LD",
          );
          report.edgeCases.push(failed);
          await save();
        } finally {
          proxy.setFailure(null);
        }
        const unscoped = await navigate(
          { ...target, path: target.path.split("?")[0] },
          viewport,
          "unscoped-gift",
          { GIFT_CONTENT: 1, STOREFRONT_GIFT: 0 },
        );
        check(
          unscoped.metadata.detailVisible && !unscoped.metadata.errorVisible,
          "unscoped gift preserves introduction",
        );
        check(
          !JSON.stringify(unscoped.metadata.structured).includes('"offers"'),
          "unscoped gift invents no offer",
        );
        report.edgeCases.push(unscoped);
        await save();
        const unavailableScope = new globalThis.URLSearchParams({
          market: "UNCONFIGURED",
          currency: fixtures.markets[0].currency,
        });
        const unavailable = await navigate(
          {
            ...target,
            path: `${target.path.split("?")[0]}?${unavailableScope}`,
          },
          viewport,
          "unconfigured-market-gift",
          { GIFT_CONTENT: 1, STOREFRONT_GIFT: 1 },
        );
        check(
          unavailable.metadata.detailVisible &&
            unavailable.metadata.robots.includes("noindex"),
          "unconfigured fixture market preserves noindex introduction",
        );
        check(
          unavailable.reads.requests.some(
            ({ target: readTarget, status }) =>
              readTarget === "STOREFRONT_GIFT" && status === 409,
          ),
          "unconfigured fixture market returns actual MARKET_UNAVAILABLE HTTP mapping",
        );
        check(
          !JSON.stringify(unavailable.metadata.structured).includes('"offers"'),
          "unconfigured market invents no offer",
        );
        report.edgeCases.push(unavailable);
        await save();
      }
    });
    await measureLighthouse({
      origin,
      gateway,
      giftTargets,
      directory,
      report,
      save,
      check,
      progress,
      readWindow,
    });
    report.status = report.lighthouse.every(
      ({ aggregate }) =>
        aggregate.performanceScoreTargetMet &&
        aggregate.lcpLabTargetMet &&
        aggregate.clsLabTargetMet,
    )
      ? "COLLECTED_DIAGNOSTIC_BUDGET_PASSED"
      : "COLLECTED_DIAGNOSTIC_BUDGET_FAILED";
    await save();
    return report;
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    };
    await save();
    throw error;
  }
}

async function measureLighthouse({
  origin,
  gateway,
  giftTargets,
  directory,
  report,
  save,
  check,
  progress,
  readWindow,
}) {
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
    chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
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
    for (const target of giftTargets.filter(({ locale }) =>
      ["en", "zh-CN", "ja"].includes(locale),
    )) {
      const runs = [],
        entries = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        progress(
          `diagnostic Lighthouse ${report.mode}/${target.locale}/gift ${attempt}/3`,
        );
        const before = (await readWindow(0)).lastSequence;
        const result = await lighthouse(
          origin + target.path,
          {
            port: chrome.port,
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
          },
          createAcceptanceLighthouseConfig(target, origin + target.path),
        );
        check(Boolean(result), "comparison Lighthouse produces actual report");
        const name = `${target.locale}-gift-mobile-${attempt}`;
        await writeFile(
          path.join(directory, `${name}.json`),
          JSON.stringify(result.lhr, null, 2) + "\n",
        );
        const html = Array.isArray(result.report)
          ? result.report.find((value) => value.trimStart().startsWith("<!"))
          : result.report;
        if (html)
          await writeFile(
            path.join(directory, `${name}-lighthouse.html`),
            html,
          );
        const reads = await readWindow(before);
        entries.push({
          attempt,
          file: `${name}.json`,
          reads,
          runtimeError: result.lhr.runtimeError ?? null,
          contentValidity: result.lhr.audits["storefront-content"] ?? null,
        });
        await writeFile(
          path.join(directory, `${target.locale}-lighthouse-attempts.json`),
          JSON.stringify(entries, null, 2) + "\n",
        );
        check(
          result.lhr.lighthouseVersion === "13.4.1",
          "pinned Lighthouse version is unchanged",
        );
        check(
          !result.lhr.runtimeError &&
            result.lhr.audits["storefront-content"]?.score === 1 &&
            !result.lhr.audits["storefront-content"].errorMessage,
          "every measured Lighthouse navigation retains actual visible content",
        );
        assert.deepEqual(reads.counts, {
          GIFT_CONTENT: report.mode === "baseline" ? 1 : 0,
          STOREFRONT_GIFT: 1,
        });
        check(
          reads.requests.every(({ status }) => status === 200),
          "all Lighthouse native content reads succeed",
        );
        runs.push(result.lhr);
      }
      report.lighthouse.push({
        ...target,
        attempts: entries,
        aggregate: aggregateAcceptanceLighthouse(runs),
      });
      await save();
    }
  } finally {
    await chrome.kill();
  }
}
