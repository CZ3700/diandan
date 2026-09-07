import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  observeAcceptanceOverlayStacking,
  verifyAcceptanceOverlayStacking,
} from "./storefront-acceptance-overlay.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const output = process.argv[2];
assert.ok(
  output,
  "a separate output directory is required for each RED/GREEN run",
);
await mkdir(output, { recursive: true });
const chunks = path.join(root, "apps/storefront/.next/static/chunks");
const files = (await readdir(chunks))
  .filter((file) => file.endsWith(".css"))
  .sort();
assert.ok(files.length > 0, "use an actual previously compiled CSS artifact");
const sources = await Promise.all(
  files.map(async (file) => ({
    file: path.relative(root, path.join(chunks, file)),
    text: await readFile(path.join(chunks, file), "utf8"),
  })),
);
sources.push({
  file: "apps/storefront/src/storefront/storefront.css",
  text: await readFile(
    path.join(root, "apps/storefront/src/storefront/storefront.css"),
    "utf8",
  ),
});
const css = sources.map((source) => source.text).join("\n");
const report = {
  schemaVersion: 1,
  status: "RUNNING",
  scope:
    "Actual Chrome painted hit-testing with existing compiled shared CSS and current storefront CSS; isolated portal-shaped DOM, not a replacement for the full Next UI matrix or Base UI keyboard tests",
  sources: sources.map(({ file, text }) => ({
    file,
    sha256: createHash("sha256").update(text).digest("hex"),
  })),
  cases: [],
};
const save = () =>
  writeFile(
    path.join(output, "results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
const browser = await chromium.launch({ channel: "chrome", headless: true });
report.browserVersion = browser.version();
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body>
        <div class="storefront"><header class="storefront-header"><span class="storefront-wordmark">TEST BACKGROUND HEADER</span></header><main><p>Background content</p></main></div>
        <div class="fs-overlay__backdrop"></div>
        <div class="fs-overlay__viewport" data-overlay-kind="drawer" data-side="inline-end">
          <div role="dialog" aria-modal="true" aria-labelledby="overlay-title" aria-describedby="overlay-description" class="fs-drawer__popup" data-overlay-popup="drawer" data-side="inline-end">
            <header class="fs-overlay__header"><div class="fs-overlay__intro"><h2 class="fs-overlay__title" id="overlay-title">TEST filters</h2><p class="fs-overlay__description" id="overlay-description">Find the TEST gift by category and availability.</p></div><button class="fs-overlay__close" aria-label="Close TEST filters">×</button></header>
          </div>
        </div></body></html>`);
      const observation = await observeAcceptanceOverlayStacking(page);
      const entry = { viewport, observation, status: "RUNNING" };
      report.cases.push(entry);
      await page.screenshot({
        path: path.join(output, `overlay-${viewport.width}.png`),
      });
      try {
        verifyAcceptanceOverlayStacking(observation, (condition, label) =>
          assert.ok(condition, label),
        );
        entry.status = "PASS";
      } catch (error) {
        entry.status = "FAIL";
        entry.failure = { name: error.name, assertion: error.message };
      }
      await save();
    } finally {
      await context.close();
    }
  }
  report.status = report.cases.every((entry) => entry.status === "PASS")
    ? "PASS"
    : "FAIL";
  await save();
  assert.equal(
    report.status,
    "PASS",
    "all viewport overlay hit tests must pass",
  );
  console.log(`PASS actual overlay hit-testing at ${output}`);
} finally {
  await browser.close();
}
