import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  readFontCascade,
  codepointsInFaces,
} from "../../../../scripts/font-ui-subset-support.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const output = path.join(path.dirname(fileURLToPath(import.meta.url)), "warm");
const require = createRequire(path.join(root, "apps/api/package.json"));
const { chromium } = require("@playwright/test");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const packageRoot = path.join(root, "packages/design-tokens");
const manifest = JSON.parse(
  await readFile(
    path.join(packageRoot, "styles/fonts/generated/manifest.json"),
  ),
);
const assets = new Map(),
  cases = [],
  sourcePaths = new Set();
const escape = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
const weights = [100, 400, 700, 900];
for (const profile of manifest.profiles) {
  const locale = profile.profile === "japanese" ? "ja" : "zh-CN";
  const catalogPath = path.join(root, profile.catalog);
  const copy = (await import(pathToFileURL(catalogPath))).default;
  assert.equal(digest(await readFile(catalogPath)), profile.corpusSha256);
  sourcePaths.add(catalogPath);
  const original = await readFontCascade(
    path.join(
      packageRoot,
      "node_modules",
      profile.fontsourcePackage,
      "wght.css",
    ),
    packageRoot,
  );
  const ui = await readFontCascade(
    path.join(packageRoot, `styles/fonts/generated/${profile.profile}-ui.css`),
    packageRoot,
  );
  const current = await readFontCascade(
    path.join(packageRoot, `styles/fonts/${profile.profile}.css`),
    packageRoot,
  );
  assert.match(
    current.imports[0].specifier,
    /-fallback\.css$/u,
    "warm candidate must be the actual new generated profile, not a simulated subtraction",
  );
  sourcePaths.add(
    path.join(packageRoot, `styles/fonts/${profile.profile}.css`),
  );
  const points = new Set(profile.codepoints);
  const candidates = [...codepointsInFaces(original.faces)]
    .filter((point) => point >= 0x3400 && point <= 0x9fff && !points.has(point))
    .sort((a, b) => a - b);
  const arbitrary = Array.from({ length: 8 }, (_, i) =>
    String.fromCodePoint(
      candidates[Math.floor((i * (candidates.length - 1)) / 7)],
    ),
  ).join("");
  for (const [variant, faces] of [
    ["original", original.faces],
    ["baseline-overlap", [...original.faces, ...ui.faces]],
    ["actual-profile", current.faces],
  ]) {
    const family = ui.faces[0].family;
    const css = faces
      .map((face) => {
        sourcePaths.add(face.source);
        sourcePaths.add(face.resource);
        const url = `/font/${assets.size}.woff2`;
        assets.set(url, face.resource);
        // The only descriptor changed for this availability-controlled probe is display.
        return face.css
          .replace(/font-display:\s*[^;]+;/u, "font-display: block;")
          .replace(/url\([^)]*\)/u, `url("${url}")`);
      })
      .join("\n");
    for (const dataset of ["ui", "mixed"]) {
      const texts = [
        ...Object.values(copy),
        ...(dataset === "mixed" ? [arbitrary] : []),
      ];
      const key = `${locale}-${variant}-${dataset}`;
      const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><link rel="icon" href="data:,"><style>${css}\nbody{margin:0;background:white;color:black;font-family:"${family}",sans-serif;font-size:24px;line-height:1.5}p{margin:0;width:900px}</style><body>${texts.map((text, index) => `<p data-probe="${index}">${escape(text)}</p>`).join("")}</body></html>`;
      cases.push({ key, variant, dataset, locale, family, texts, html });
    }
  }
}
const identities = async () =>
  Object.fromEntries(
    await Promise.all(
      [...sourcePaths]
        .sort()
        .map(async (filename) => [
          path.relative(root, filename),
          digest(await readFile(filename)),
        ]),
    ),
  );
const before = await identities();
if (!process.argv.includes("--run")) {
  console.log(
    JSON.stringify({
      prepared: true,
      browserStarted: false,
      cases: cases.length,
      sourceInputs: Object.keys(before).length,
    }),
  );
  process.exit(0);
}
const attempt = path.join(
  output,
  `attempt-${new Date().toISOString().replaceAll(":", "-")}`,
);
await mkdir(attempt, { recursive: true });
const byRoute = new Map(cases.map((item) => [`/${item.key}`, item]));
const server = createServer(async (request, response) => {
  try {
    const page = byRoute.get(request.url);
    if (page) {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(page.html);
      return;
    }
    const filename = assets.get(request.url);
    if (filename) {
      response.setHeader("content-type", "font/woff2");
      response.end(await readFile(filename));
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
    "Forced-available Noto shape comparison only. Isolated font-display:block, explicit font loads, no website fixture or performance budget. Actual generated profile versus overlapping baseline; original complete faces are a third reference.",
  sourceBefore: before,
  weights,
  cases: [],
  comparisons: [],
  complete: false,
};
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  result.browserVersion = browser.version();
  for (const item of cases) {
    await writeFile(path.join(attempt, `${item.key}.html`), item.html);
    const context = await browser.newContext({
      viewport: { width: 960, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage(),
      requests = [],
      errors = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "font")
        requests.push({
          url: response.url().replace(origin, ""),
          status: response.status(),
        });
    });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    await page.goto(`${origin}/${item.key}`, { waitUntil: "load" });
    const measurements = [];
    for (const weight of weights) {
      const measured = await page.evaluate(
        async ({ weight, family, texts }) => {
          const font = `${weight} 24px "${family}"`;
          const loaded = await globalThis.document.fonts.load(
            font,
            texts.join(""),
          );
          await globalThis.document.fonts.ready;
          globalThis.document.body.style.fontWeight = String(weight);
          await new Promise((resolve) =>
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            ),
          );
          const canvas = globalThis.document.createElement("canvas"),
            points = [...new Set(texts.join(""))];
          canvas.width = 900;
          canvas.height = 40 + Math.ceil(points.length / 30) * 32;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#000";
          ctx.font = font;
          for (const [index, char] of points.entries())
            ctx.fillText(
              char,
              (index % 30) * 30,
              30 + Math.floor(index / 30) * 32,
            );
          return {
            weight,
            loaded: loaded.length,
            fontCheck: globalThis.document.fonts.check(font, texts.join("")),
            shaped: texts.map((text) => {
              const m = ctx.measureText(text);
              return {
                text,
                width: m.width,
                ascent: m.actualBoundingBoxAscent,
                descent: m.actualBoundingBoxDescent,
              };
            }),
            bounds: [
              ...globalThis.document.querySelectorAll("[data-probe]"),
            ].map((node) => {
              const range = globalThis.document.createRange();
              range.selectNodeContents(node);
              return [...range.getClientRects()].map((r) => [
                r.width,
                r.height,
              ]);
            }),
            pixels: canvas.toDataURL(),
          };
        },
        { weight, family: item.family, texts: item.texts },
      );
      const { root: documentNode } = await cdp.send("DOM.getDocument");
      measured.platforms = [];
      for (const selector of [
        '[data-probe="0"]',
        `[data-probe="${item.texts.length - 1}"]`,
      ]) {
        const { nodeId } = await cdp.send("DOM.querySelector", {
          nodeId: documentNode.nodeId,
          selector,
        });
        measured.platforms.push({
          selector,
          ...(await cdp.send("CSS.getPlatformFontsForNode", { nodeId })),
        });
      }
      measured.onlyNotoCustom = measured.platforms.every(
        (p) =>
          p.fonts.length > 0 &&
          p.fonts.every(
            (f) => f.isCustomFont && f.familyName.startsWith("Noto Sans"),
          ),
      );
      const png = Buffer.from(measured.pixels.split(",")[1], "base64");
      delete measured.pixels;
      measured.pixelsSha256 = digest(png);
      await writeFile(path.join(attempt, `${item.key}-${weight}.png`), png);
      measurements.push(measured);
    }
    const record = {
      key: item.key,
      locale: item.locale,
      variant: item.variant,
      dataset: item.dataset,
      requests,
      errors,
      measurements,
    };
    result.cases.push(record);
    await writeFile(
      path.join(attempt, `${item.key}.json`),
      JSON.stringify(record, null, 2),
    );
    await context.close();
    console.log(
      `${item.key}: ${measurements.every((m) => m.onlyNotoCustom) ? "NOTO VERIFIED" : "FONT SELECTION FAIL"}`,
    );
  }
  for (const locale of ["ja", "zh-CN"])
    for (const dataset of ["ui", "mixed"]) {
      const baseline = result.cases.find(
        (row) =>
          row.locale === locale &&
          row.dataset === dataset &&
          row.variant === "baseline-overlap",
      );
      for (const candidate of result.cases.filter(
        (row) =>
          row.locale === locale &&
          row.dataset === dataset &&
          row.variant !== "baseline-overlap",
      )) {
        for (const [index, old] of baseline.measurements.entries()) {
          const next = candidate.measurements[index];
          result.comparisons.push({
            locale,
            dataset,
            variant: candidate.variant,
            weight: old.weight,
            notoVerified: old.onlyNotoCustom && next.onlyNotoCustom,
            pixelEqual: old.pixelsSha256 === next.pixelsSha256,
            boundsEqual:
              JSON.stringify(old.bounds) === JSON.stringify(next.bounds),
            widthsEqual: old.shaped.every(
              (m, i) => m.width === next.shaped[i].width,
            ),
            metricsEqual:
              JSON.stringify(old.shaped) === JSON.stringify(next.shaped),
          });
        }
      }
    }
  result.complete = true;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  result.sourceAfter = await identities();
  result.sourceUnchanged =
    JSON.stringify(result.sourceBefore) === JSON.stringify(result.sourceAfter);
  result.completedAt = new Date().toISOString();
  result.pass =
    result.complete &&
    result.sourceUnchanged &&
    result.cases.every(
      (c) =>
        c.errors.length === 0 &&
        c.requests.every((r) => r.status === 200) &&
        c.measurements.every(
          (m) => m.fontCheck && m.loaded > 0 && m.onlyNotoCustom,
        ),
    ) &&
    result.comparisons.every(
      (c) =>
        c.notoVerified &&
        c.pixelEqual &&
        c.boundsEqual &&
        c.widthsEqual &&
        c.metricsEqual,
    );
  await writeFile(
    path.join(attempt, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(attempt);
  if (!result.pass) process.exitCode = 1;
}
