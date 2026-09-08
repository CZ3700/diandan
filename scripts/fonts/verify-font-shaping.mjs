import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import {
  readFontCascade,
  requiredFontResources,
} from "../font-ui-subset-support.mjs";
import { createFontProbeAssets } from "./font-probe-assets.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputRoot = path.resolve(
  process.argv[2] ??
    path.join(
      root,
      "output/checks/p3-06-performance-final/font-shaping-browser",
    ),
);
const output = path.join(
  outputRoot,
  `attempt-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
);
await mkdir(output, { recursive: true });
const report = {
  schemaVersion: 1,
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  scope:
    "Controlled real Chrome font comparison of complete current ja/zh-CN default UI copy and each codepoint. Static owned HTTP fonts, no Next or production/Lighthouse evidence.",
  conditions: {
    weights: [400, 500, 600, 700],
    fontSizePx: 32,
    cssLineHeight: "normal",
    deviceScaleFactor: 1,
    pixelDifferenceTolerance: 0,
    metricDifferenceTolerance: 0,
    explicitFontLoadBeforeComparison: true,
    fontDisplay: "optional",
    samePlatformOnly: true,
  },
  profiles: [],
  browserClosed: false,
  serverClosed: false,
  pageErrors: [],
  networkFailures: [],
  fontResponses: [],
};
const save = () =>
  writeFile(
    path.join(output, "results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
await save();
const {
  assets,
  resources,
  describe: faceDescriptor,
} = createFontProbeAssets(root);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let browser;
let server;
try {
  const config = JSON.parse(
    await readFile(path.join(root, "scripts/fonts/sources.json"), "utf8"),
  );
  const targets = [];
  for (const profile of config.profiles) {
    const copyBytes = await readFile(path.join(root, profile.catalog));
    const copy = (
      await import(pathToFileURL(path.join(root, profile.catalog)).href)
    ).default;
    const entries = Object.entries(copy);
    assert.ok(
      entries.length > 100 &&
        entries.every(([, text]) => typeof text === "string"),
    );
    const codepoints = [
      ...new Set(
        [...Object.values(copy).join("")].map((text) => text.codePointAt(0)),
      ),
    ].sort((a, b) => a - b);
    const packageRoot = path.join(root, "packages/design-tokens");
    const original = await readFontCascade(
      path.join(
        packageRoot,
        "node_modules",
        profile.fontsourcePackage,
        "wght.css",
      ),
      packageRoot,
    );
    const candidate = await readFontCascade(
      path.join(packageRoot, "styles/fonts/generated", `${profile.id}-ui.css`),
      packageRoot,
    );
    const selected = requiredFontResources(original.faces, new Set(codepoints));
    assert.deepEqual(selected.missing, []);
    assert.equal(candidate.faces.length, 1);
    targets.push({
      id: profile.id,
      locale: profile.locale,
      corpusSha256: sha256(copyBytes),
      codepoints,
      cases: [
        ...codepoints.map((point) => ({
          kind: "CODEPOINT",
          key: `U+${point.toString(16).toUpperCase()}`,
          text: String.fromCodePoint(point),
        })),
        ...entries.map(([key, text]) => ({ kind: "COPY", key, text })),
      ],
      original: await Promise.all(original.faces.map(faceDescriptor)),
      candidate: await Promise.all(candidate.faces.map(faceDescriptor)),
      requiredOriginalPaths: [...selected.resources].map(
        (resource) => resources.get(resource).pathname,
      ),
    });
  }
  assert.equal(
    assets.size,
    resources.size,
    "distinct font files require distinct asset URLs",
  );
  for (const target of targets) {
    for (const descriptor of [...target.original, ...target.candidate]) {
      assert.equal(
        sha256(assets.get(descriptor.pathname)),
        descriptor.sha256,
        "HTTP route bytes must match the precise font descriptor",
      );
    }
  }
  report.uniqueSourceFiles = resources.size;
  report.uniqueHttpFontUrls = assets.size;
  server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        "<!doctype html><html><head><title>TEST font shaping comparison</title></head><body><main></main></body></html>",
      );
      return;
    }
    const body = assets.get(request.url);
    if (!body) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": "font/woff2",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  report.origin = origin;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", () =>
    report.pageErrors.push({ code: "FONT_PROBE_PAGE_ERROR" }),
  );
  page.on("requestfailed", (request) =>
    report.networkFailures.push({
      code: "REQUEST_FAILED",
      path: new globalThis.URL(request.url()).pathname,
    }),
  );
  const fontResponsePromises = [];
  page.on("response", (response) => {
    if (!response.url().includes("/fonts/")) return;
    fontResponsePromises.push(
      (async () => {
        const pathname = new globalThis.URL(response.url()).pathname;
        try {
          const body = await response.body();
          const actualSha256 = sha256(body);
          const expectedSha256 = sha256(assets.get(pathname));
          const matched =
            response.status() === 200 && actualSha256 === expectedSha256;
          report.fontResponses.push({
            path: pathname,
            status: response.status(),
            actualSha256,
            expectedSha256,
            matched,
          });
          if (!matched)
            report.networkFailures.push({
              code: "FONT_RESPONSE_MISMATCH",
              path: pathname,
              status: response.status(),
            });
        } catch {
          report.networkFailures.push({
            code: "FONT_RESPONSE_OBSERVATION_FAILED",
            path: pathname,
          });
        }
      })(),
    );
  });
  assert.equal((await page.goto(origin)).status(), 200);
  for (const target of targets) {
    console.log(
      `Comparing ${target.id}: ${target.codepoints.length} codepoints and ${target.cases.length - target.codepoints.length} full strings`,
    );
    const result = await page.evaluate(
      async ({ target, conditions }) => {
        globalThis.document.fonts.clear();
        globalThis.document.documentElement.lang = target.locale;
        const aliases = {
          original: `Original_${target.id}`,
          candidate: `Candidate_${target.id}`,
        };
        const registered = { original: [], candidate: [] };
        for (const kind of ["original", "candidate"]) {
          for (const descriptor of target[kind]) {
            const face = new globalThis.FontFace(
              aliases[kind],
              `url("${descriptor.pathname}")`,
              {
                weight: descriptor.weight,
                style: descriptor.style,
                display: "optional",
                unicodeRange: descriptor.unicodeRange,
              },
            );
            globalThis.document.fonts.add(face);
            registered[kind].push({ face, descriptor });
          }
        }
        const required = registered.original
          .filter((entry) =>
            target.requiredOriginalPaths.includes(entry.descriptor.pathname),
          )
          .concat(registered.candidate);
        await Promise.all(required.map(({ face }) => face.load()));
        const completeText = target.cases
          .filter((item) => item.kind === "COPY")
          .map((item) => item.text)
          .join("");
        const fontLoads = [];
        for (const weight of conditions.weights) {
          for (const kind of ["original", "candidate"]) {
            const font = `${weight} ${conditions.fontSizePx}px "${aliases[kind]}"`;
            const loaded = await globalThis.document.fonts.load(
              font,
              completeText,
            );
            if (
              loaded.length === 0 ||
              loaded.some(
                (face) =>
                  face.status !== "loaded" || face.family !== aliases[kind],
              ) ||
              !globalThis.document.fonts.check(font, completeText)
            )
              throw new Error("Custom font failed to load before comparison");
            fontLoads.push({
              weight,
              kind,
              loadedFaceCount: loaded.length,
              check: true,
            });
          }
        }
        await globalThis.document.fonts.ready;
        await new Promise((resolve) =>
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(resolve),
          ),
        );
        if (required.some(({ face }) => face.status !== "loaded"))
          throw new Error("Required real font remains unloaded");
        const spans = {};
        const canvases = {};
        for (const kind of ["original", "candidate"]) {
          const span = globalThis.document.createElement("span");
          Object.assign(span.style, {
            position: "absolute",
            left: "-10000px",
            top: "0",
            display: "inline-block",
            whiteSpace: "pre",
            fontSize: `${conditions.fontSizePx}px`,
            lineHeight: "normal",
            fontFamily: `"${aliases[kind]}"`,
            fontKerning: "normal",
          });
          span.lang = target.locale;
          span.id = `font-comparison-${kind}`;
          globalThis.document.body.append(span);
          spans[kind] = span;
          canvases[kind] = globalThis.document.createElement("canvas");
        }
        const rows = [];
        const samples = [];
        let mismatchScreenshots = 0;
        for (const weight of conditions.weights) {
          for (const item of target.cases) {
            const measures = {};
            for (const kind of ["original", "candidate"]) {
              const ctx = canvases[kind].getContext("2d", {
                willReadFrequently: true,
              });
              ctx.font = `${weight} ${conditions.fontSizePx}px "${aliases[kind]}"`;
              ctx.fontKerning = "normal";
              if ("lang" in ctx) ctx.lang = target.locale;
              const metrics = ctx.measureText(item.text);
              spans[kind].style.fontWeight = String(weight);
              spans[kind].textContent = item.text;
              const box = spans[kind].getBoundingClientRect();
              measures[kind] = Object.fromEntries(
                [
                  "width",
                  "actualBoundingBoxLeft",
                  "actualBoundingBoxRight",
                  "actualBoundingBoxAscent",
                  "actualBoundingBoxDescent",
                  "fontBoundingBoxAscent",
                  "fontBoundingBoxDescent",
                ].map((key) => [key, metrics[key]]),
              );
              measures[kind].domWidth = box.width;
              measures[kind].domHeight = box.height;
            }
            const padding = 8;
            const ascent = Math.max(
              measures.original.actualBoundingBoxAscent,
              measures.candidate.actualBoundingBoxAscent,
              conditions.fontSizePx,
            );
            const descent = Math.max(
              measures.original.actualBoundingBoxDescent,
              measures.candidate.actualBoundingBoxDescent,
              conditions.fontSizePx / 2,
            );
            const left = Math.max(
              measures.original.actualBoundingBoxLeft,
              measures.candidate.actualBoundingBoxLeft,
              0,
            );
            const width = Math.max(
              1,
              Math.ceil(
                Math.max(
                  measures.original.width,
                  measures.candidate.width,
                  measures.original.actualBoundingBoxRight,
                  measures.candidate.actualBoundingBoxRight,
                ) +
                  left +
                  padding * 2,
              ),
            );
            const height = Math.ceil(ascent + descent + padding * 2);
            const pixels = {};
            for (const kind of ["original", "candidate"]) {
              const canvas = canvases[kind];
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              ctx.fillStyle = "white";
              ctx.fillRect(0, 0, width, height);
              ctx.fillStyle = "black";
              ctx.textBaseline = "alphabetic";
              ctx.font = `${weight} ${conditions.fontSizePx}px "${aliases[kind]}"`;
              ctx.fontKerning = "normal";
              if ("lang" in ctx) ctx.lang = target.locale;
              ctx.fillText(item.text, padding + left, padding + ascent);
              pixels[kind] = ctx.getImageData(0, 0, width, height).data;
            }
            let pixelChannelsChanged = 0;
            let maximumChannelDifference = 0;
            for (let index = 0; index < pixels.original.length; index += 1) {
              const difference = Math.abs(
                pixels.original[index] - pixels.candidate[index],
              );
              if (difference !== 0) pixelChannelsChanged += 1;
              maximumChannelDifference = Math.max(
                maximumChannelDifference,
                difference,
              );
            }
            const metricsMatch = Object.keys(measures.original).every(
              (key) =>
                Number.isFinite(measures.original[key]) &&
                measures.original[key] === measures.candidate[key],
            );
            const passed = metricsMatch && pixelChannelsChanged === 0;
            rows.push({
              kind: item.kind,
              key: item.key,
              weight,
              metrics: measures,
              metricsMatch,
              pixelChannelsChanged,
              maximumChannelDifference,
              passed,
            });
            const captureFailure = !passed && mismatchScreenshots < 12;
            const captureSample = item.key === "giftHandover";
            if (captureFailure || captureSample) {
              if (captureFailure) mismatchScreenshots += 1;
              samples.push({
                kind: item.kind,
                key: item.key,
                weight,
                passed,
                original: canvases.original.toDataURL("image/png"),
                candidate: canvases.candidate.toDataURL("image/png"),
              });
            }
          }
        }
        return {
          fontLoads,
          requiredLoadedFaces: required.map(({ face, descriptor }) => ({
            path: descriptor.pathname,
            status: face.status,
            sha256: descriptor.sha256,
          })),
          rows,
          samples,
          comparedCases: rows.length,
          mismatchCount: rows.filter((row) => !row.passed).length,
          metricMismatchCount: rows.filter((row) => !row.metricsMatch).length,
          pixelMismatchCount: rows.filter(
            (row) => row.pixelChannelsChanged !== 0,
          ).length,
        };
      },
      { target, conditions: report.conditions },
    );
    const cdp = await context.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const documentNode = await cdp.send("DOM.getDocument");
    result.platformFonts = {};
    for (const kind of ["original", "candidate"]) {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: documentNode.root.nodeId,
        selector: `#font-comparison-${kind}`,
      });
      result.platformFonts[kind] = await cdp.send(
        "CSS.getPlatformFontsForNode",
        { nodeId },
      );
    }
    await cdp.detach();
    await page.evaluate(() => {
      globalThis.document
        .querySelectorAll('[id^="font-comparison-"]')
        .forEach((element) => element.remove());
    });
    const samples = [];
    for (const [index, sample] of result.samples.entries()) {
      const files = {};
      for (const kind of ["original", "candidate"]) {
        const name = `${target.id}-${sample.weight}-${index}-${kind}.png`;
        await writeFile(
          path.join(output, name),
          Buffer.from(sample[kind].split(",")[1], "base64"),
        );
        files[kind] = name;
      }
      samples.push({
        kind: sample.kind,
        key: sample.key,
        weight: sample.weight,
        passed: sample.passed,
        files,
      });
    }
    report.profiles.push({
      id: target.id,
      locale: target.locale,
      corpusSha256: target.corpusSha256,
      codepoints: target.codepoints.length,
      copyStrings: target.cases.length - target.codepoints.length,
      resources: { original: target.original, candidate: target.candidate },
      ...result,
      samples,
    });
    await save();
    console.log(
      `${target.id}: ${result.comparedCases} comparisons, ${result.metricMismatchCount} metric and ${result.pixelMismatchCount} pixel mismatches`,
    );
  }
  await Promise.all(fontResponsePromises);
  report.status =
    report.profiles.every((profile) => profile.mismatchCount === 0) &&
    report.profiles.every((profile) =>
      Object.values(profile.platformFonts).every(
        (value) =>
          value.fonts.length > 0 &&
          value.fonts.every((font) => font.isCustomFont),
      ),
    ) &&
    report.fontResponses.length > 0 &&
    report.pageErrors.length === 0 &&
    report.networkFailures.length === 0
      ? "PASS"
      : "FAIL";
} catch (error) {
  report.status = "FAIL";
  report.failure = {
    code:
      error?.code === "ERR_ASSERTION"
        ? "FONT_SHAPING_ASSERTION"
        : "FONT_SHAPING_PROBE_FAILED",
    name: error?.name === "AssertionError" ? "AssertionError" : "Error",
  };
} finally {
  if (browser) {
    await browser.close();
    report.browserClosed = true;
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    report.serverClosed = true;
  }
  report.completedAt = new Date().toISOString();
  await save();
}
console.log(`Font shaping ${report.status}: ${output}`);
if (report.status !== "PASS") process.exitCode = 1;
