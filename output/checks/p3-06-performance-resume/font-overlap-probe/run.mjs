import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import {
  readFontCascade,
  codepointsInFaces,
} from "../../../../scripts/font-ui-subset-support.mjs";
import { subtractPoints } from "./probe-support.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const output = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(root, "apps/api/package.json"));
const { chromium } = require("@playwright/test");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(
  await readFile(
    path.join(
      root,
      "packages/design-tokens/styles/fonts/generated/manifest.json",
    ),
  ),
);
const assets = new Map();
const pages = new Map();
const inputs = [];
const escape = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");

function faceCss(face, variant, uiPoints, isUi) {
  const ranges =
    variant === "disjoint" && !isUi
      ? subtractPoints(face.ranges, uiPoints)
      : face.ranges;
  if (!ranges.length) return "";
  const family =
    variant === "alias" && isUi ? `${face.family} UI Probe` : face.family;
  const url = `/assets/${assets.size}.woff2`;
  assets.set(url, face.resource);
  return `@font-face{font-family:"${family}";font-style:${face.style};font-weight:${face.weight};font-display:${face.display};src:url("${url}") format("woff2");unicode-range:${ranges.map(([a, b]) => `U+${a.toString(16)}${a === b ? "" : `-${b.toString(16)}`}`).join(",")}}`;
}

for (const profile of manifest.profiles) {
  const locale = profile.profile === "japanese" ? "ja" : "zh-CN";
  const catalogPath = path.join(root, profile.catalog);
  const copy = (await import(pathToFileURL(catalogPath))).default;
  assert.equal(digest(await readFile(catalogPath)), profile.corpusSha256);
  const original = await readFontCascade(
    path.join(
      root,
      "packages/design-tokens/node_modules",
      profile.fontsourcePackage,
      "wght.css",
    ),
    path.join(root, "packages/design-tokens"),
  );
  // Apply the same production font-display policy without editing installed source CSS.
  original.faces.forEach((face) => {
    face.display = "optional";
  });
  const ui = (
    await readFontCascade(
      path.join(
        root,
        `packages/design-tokens/styles/fonts/generated/${profile.profile}-ui.css`,
      ),
      path.join(root, "packages/design-tokens"),
    )
  ).faces[0];
  const points = new Set(profile.codepoints);
  const union = codepointsInFaces(original.faces);
  const candidates = [...union]
    .filter((point) => point >= 0x3400 && point <= 0x9fff && !points.has(point))
    .sort((a, b) => a - b);
  const arbitrary = Array.from(
    { length: 8 },
    (_, index) => candidates[Math.floor((index * (candidates.length - 1)) / 7)],
  )
    .map((point) => String.fromCodePoint(point))
    .join("");
  for (const variant of ["original", "overlap", "disjoint", "alias"]) {
    const faces =
      variant === "original" ? original.faces : [...original.faces, ui];
    const css = faces
      .map((face) => faceCss(face, variant, points, face === ui))
      .join("\n");
    if (variant === "disjoint") {
      const disjoint = original.faces.map((face) => ({
        ...face,
        ranges: subtractPoints(face.ranges, points),
      }));
      const remaining = codepointsInFaces(disjoint);
      assert.equal(
        [...points].some((point) => remaining.has(point)),
        false,
      );
      assert.deepEqual(new Set([...remaining, ...points]), union);
    }
    for (const dataset of ["ui", "mixed"]) {
      const key = `${locale}-${variant}-${dataset}`;
      const texts = [
        ...Object.values(copy),
        ...(dataset === "mixed" ? [arbitrary] : []),
      ];
      const family =
        variant === "alias"
          ? `"${ui.family} UI Probe","${ui.family}"`
          : `"${ui.family}"`;
      const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><style>${css}\nbody{margin:0;background:white;color:black;font-family:${family},sans-serif;font-size:24px;line-height:1.5}p{margin:0;width:900px}</style><body>${texts.map((text, index) => `<p data-probe="${index}">${escape(text)}</p>`).join("")}</body></html>`;
      pages.set(`/${key}`, {
        html,
        key,
        texts,
        family,
        locale,
        variant,
        dataset,
      });
      await writeFile(path.join(output, `${key}.html`), html, { flag: "wx" });
    }
  }
  inputs.push({
    locale,
    catalogSha256: profile.corpusSha256,
    uiSha256: profile.woff2Sha256,
    uiPoints: points.size,
    originalPoints: union.size,
    arbitrary,
    originalFamilies: original.faces.length,
  });
}
await writeFile(
  path.join(output, "inputs.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      inputs,
      assets: [...assets].map(([url, filename]) => ({
        url,
        path: path.relative(root, filename),
      })),
    },
    null,
    2,
  ),
  { flag: "wx" },
);
if (!process.argv.includes("--run")) {
  console.log(
    "PREPARED; Chrome was not started. Run with --run after receiving the exclusive browser window.",
  );
  process.exit(0);
}

const attempt = path.join(
  output,
  `attempt-${new Date().toISOString().replaceAll(":", "-")}`,
);
await mkdir(attempt);
const server = createServer(async (request, response) => {
  try {
    const page = pages.get(request.url);
    if (page) {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(page.html);
      return;
    }
    const asset = assets.get(request.url);
    if (asset) {
      response.setHeader("content-type", "font/woff2");
      response.end(await readFile(asset));
      return;
    }
    response.statusCode = 404;
    response.end();
  } catch {
    response.statusCode = 500;
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const result = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  scope:
    "Isolated font mechanism and shape diagnostic, no website fixture, build, production edits or Lighthouse performance acceptance",
  inputs,
  cases: [],
  comparisons: [],
  complete: false,
};
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  result.browserVersion = browser.version();
  for (const pageData of pages.values()) {
    const context = await browser.newContext({
      viewport: { width: 960, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const requests = [],
      errors = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "font")
        requests.push({
          url: response.url().replace(origin, ""),
          file: path.basename(
            assets.get(new URL(response.url()).pathname) ?? "",
          ),
          status: response.status(),
        });
    });
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning")
        errors.push(message.text());
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    await page.goto(`${origin}/${pageData.key}`, { waitUntil: "load" });
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready;
      await new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      );
    });
    const metrics = await page.evaluate(({ texts, family }) => {
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 1500;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 900, 1500);
      ctx.fillStyle = "#000";
      const points = [...new Set(texts.join(""))];
      const shaped = [];
      for (const weight of [100, 400, 700, 900]) {
        ctx.font = `${weight} 24px ${family},sans-serif`;
        for (const text of texts) {
          const m = ctx.measureText(text);
          shaped.push({
            weight,
            text,
            width: m.width,
            ascent: m.actualBoundingBoxAscent,
            descent: m.actualBoundingBoxDescent,
          });
        }
      }
      for (const [wi, weight] of [400, 700].entries()) {
        ctx.font = `${weight} 24px ${family},sans-serif`;
        for (const [i, char] of points.entries())
          ctx.fillText(
            char,
            (i % 30) * 30,
            35 + Math.floor(i / 30) * 32 + wi * 750,
          );
      }
      return {
        shaped,
        pixels: canvas.toDataURL(),
        bounds: [...globalThis.document.querySelectorAll("[data-probe]")].map(
          (n) => {
            const r = n.getBoundingClientRect();
            return [r.width, r.height];
          },
        ),
        fonts: [...globalThis.document.fonts]
          .filter((f) => f.status === "loaded")
          .map((f) => ({
            family: f.family,
            unicodeRange: f.unicodeRange,
            status: f.status,
          })),
      };
    }, pageData);
    const { root: documentNode } = await cdp.send("DOM.getDocument");
    const platforms = [];
    for (const selector of [
      '[data-probe="0"]',
      `[data-probe="${pageData.texts.length - 1}"]`,
    ]) {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: documentNode.nodeId,
        selector,
      });
      platforms.push({
        selector,
        ...(await cdp.send("CSS.getPlatformFontsForNode", { nodeId })),
      });
    }
    const pixels = Buffer.from(metrics.pixels.split(",")[1], "base64");
    delete metrics.pixels;
    await writeFile(path.join(attempt, `${pageData.key}-glyphs.png`), pixels);
    await page.screenshot({
      path: path.join(attempt, `${pageData.key}-viewport.png`),
    });
    const record = {
      key: pageData.key,
      locale: pageData.locale,
      variant: pageData.variant,
      dataset: pageData.dataset,
      requests,
      errors,
      platforms,
      pixelsSha256: digest(pixels),
      ...metrics,
    };
    result.cases.push(record);
    await writeFile(
      path.join(attempt, `${pageData.key}.json`),
      JSON.stringify(record, null, 2),
    );
    await context.close();
    console.log(`${pageData.key}: ${requests.length} font requests`);
  }
  for (const locale of ["ja", "zh-CN"])
    for (const dataset of ["ui", "mixed"]) {
      const baseline = result.cases.find(
        (row) =>
          row.locale === locale &&
          row.dataset === dataset &&
          row.variant === "original",
      );
      for (const candidate of result.cases.filter(
        (row) =>
          row.locale === locale &&
          row.dataset === dataset &&
          row.variant !== "original",
      ))
        result.comparisons.push({
          locale,
          dataset,
          variant: candidate.variant,
          pixelEqual: baseline.pixelsSha256 === candidate.pixelsSha256,
          boundsEqual:
            JSON.stringify(baseline.bounds) ===
            JSON.stringify(candidate.bounds),
          widthsEqual: baseline.shaped.every(
            (row, index) => row.width === candidate.shaped[index].width,
          ),
          metricsEqual:
            JSON.stringify(baseline.shaped) ===
            JSON.stringify(candidate.shaped),
        });
    }
  result.complete = true;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  result.completedAt = new Date().toISOString();
  await writeFile(
    path.join(attempt, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(attempt);
}
