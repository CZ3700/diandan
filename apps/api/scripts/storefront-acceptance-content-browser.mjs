import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import lighthouse from "lighthouse";
import { chromium } from "@playwright/test";
import { createAcceptanceLighthouseConfig } from "./storefront-acceptance-content.mjs";
import { aggregateAcceptanceLighthouse } from "./storefront-acceptance-performance.mjs";

// Isolated HTTP fixtures test the collector, not storefront performance or database behavior.
const output = path.resolve(
  "output/checks/p3-06-development-cadence",
  `content-browser-${new Date().toISOString().replaceAll(":", "-")}`,
);
await mkdir(output, { recursive: true });
let alternatingRequests = 0;
const html = (content, locale = "ja") =>
  `<!doctype html><html lang="${locale}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TEST collector</title></head><body><main>${content}</main></body></html>`;
const normal =
  '<section class="storefront-artist-hero"><h1 id="artist-title">TEST artist content</h1><p data-artist-description lang="ja">TEST published content for the measurement fixture.</p></section>';
const unavailable =
  '<section class="storefront-state"><h1>TEST temporarily unavailable</h1></section>';
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (request.url === "/ja/alternating") {
    alternatingRequests++;
    response.end(html(alternatingRequests === 1 ? normal : unavailable));
  } else if (request.url === "/ja/normal") response.end(html(normal));
  else {
    response.statusCode = 404;
    response.end("TEST not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(import.meta.url);
const lighthouseRequire = createRequire(require.resolve("lighthouse"));
const launcher = await import(lighthouseRequire.resolve("chrome-launcher"));
let chrome, browser;
const evidence = {
  schemaVersion: 1,
  status: "RUNNING",
  scope: "Collector-only HTTP fixtures; not product performance evidence",
  domCases: [],
  lighthouse: [],
};
try {
  chrome = await launcher.launch({
    handleSIGINT: false,
    logLevel: "silent",
    chromeFlags: ["--headless=new", "--no-proxy-server"],
  });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  const expectedUrl = origin + "/ja/normal";
  await page.goto(expectedUrl);
  for (const fixture of [
    { name: "normal", body: normal, valid: true },
    {
      name: "error-with-hidden-marker",
      body: unavailable + `<div hidden>${normal}</div>`,
      valid: false,
    },
    {
      name: "opacity-zero-marker",
      body: `<div style="opacity:0">${normal}</div>`,
      valid: false,
    },
    { name: "wrong-locale", body: normal, locale: "en", valid: false },
    {
      name: "wrong-route",
      body: normal,
      expectedUrl: origin + "/ja/other",
      valid: false,
    },
    { name: "missing-marker", body: "<h1>TEST empty</h1>", valid: false },
    {
      name: "empty-marker-box",
      body: '<h1 id="artist-title">TEST artist content</h1><p data-artist-description lang="ja" style="height:100px"></p>',
      valid: false,
    },
    {
      name: "description-without-language",
      body: '<h1 id="artist-title">TEST artist content</h1><p data-artist-description>TEST published content.</p>',
      valid: false,
    },
    {
      name: "directory-error",
      body:
        normal +
        '<div data-artist-directory-status data-error="UNAVAILABLE">TEST directory unavailable</div>',
      valid: false,
    },
    {
      name: "home-content",
      kind: "home",
      selector: "[data-artist-directory]",
      body: '<h1 id="hero-title">TEST hero</h1><div data-artist-directory><article data-artist-card>TEST artist</article></div>',
      valid: true,
    },
    {
      name: "home-empty-directory",
      kind: "home",
      selector: "[data-artist-directory]",
      body: '<h1 id="hero-title">TEST hero</h1><div data-artist-directory style="height:100px"></div>',
      valid: false,
    },
    {
      name: "gift-content",
      kind: "gift",
      selector: "[data-gift-detail]",
      body: "<article data-gift-detail><h1>TEST gift</h1></article>",
      valid: true,
    },
    {
      name: "gift-empty-container",
      kind: "gift",
      selector: "[data-gift-detail]",
      body: '<article data-gift-detail style="height:100px"></article>',
      valid: false,
    },
  ]) {
    await page.setContent(html(fixture.body, fixture.locale));
    const config = createAcceptanceLighthouseConfig(
      {
        kind: fixture.kind ?? "artist",
        selector: fixture.selector ?? "p[data-artist-description][lang]",
        locale: "ja",
      },
      fixture.expectedUrl ?? expectedUrl,
    );
    const value = await config.artifacts[0].gatherer.getArtifact({
      driver: {
        executionContext: {
          evaluate: (fn, { args }) =>
            page.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`),
        },
      },
    });
    evidence.domCases.push({ name: fixture.name, value });
    assert.equal(value.valid, fixture.valid, fixture.name);
  }
  await context.close();
  const preflight = await globalThis.fetch(origin + "/ja/alternating");
  assert.equal(preflight.status, 200);
  assert.match(await preflight.text(), /data-artist-description/);
  for (const fixture of [
    { name: "normal", valid: true },
    { name: "alternating", valid: false },
  ]) {
    const target = {
      kind: "artist",
      locale: "ja",
      selector: "p[data-artist-description][lang]",
    };
    const result = await lighthouse(
      origin + `/ja/${fixture.name}`,
      {
        port: chrome.port,
        logLevel: "error",
        output: "json",
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
      createAcceptanceLighthouseConfig(target, origin + `/ja/${fixture.name}`),
    );
    assert.ok(result);
    await writeFile(
      path.join(output, `${fixture.name}.json`),
      JSON.stringify(result.lhr, null, 2) + "\n",
    );
    const audit = result.lhr.audits["storefront-content"];
    evidence.lighthouse.push({
      name: fixture.name,
      audit,
      runtimeError: result.lhr.runtimeError ?? null,
    });
    assert.equal(result.lhr.runtimeError, undefined);
    assert.equal(audit.score, fixture.valid ? 1 : 0);
    assert.equal(audit.details.content.observed.urlMatches, true);
    if (!fixture.valid) {
      assert.equal(audit.details.content.observed.errorVisible, true);
      assert.throws(
        () =>
          aggregateAcceptanceLighthouse([result.lhr, result.lhr, result.lhr]),
        /content/,
      );
    }
  }
  evidence.alternatingRequests = alternatingRequests;
  evidence.status = "PASS";
} catch (error) {
  evidence.status = "FAIL";
  evidence.failure = { name: error.name, message: error.message };
  throw error;
} finally {
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await browser?.close();
  await chrome?.kill();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  process.stdout.write(
    JSON.stringify({ output, status: evidence.status }) + "\n",
  );
}
