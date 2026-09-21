import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { chromium } from "@playwright/test";
import { readFontCascade } from "../../../scripts/font-ui-subset-support.mjs";
import { createFontProbeAssets } from "../../../scripts/fonts/font-probe-assets.mjs";

const checkpoint = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(checkpoint, "../../..");
const canonical = path.join(
  root,
  "packages/design-tokens/styles/fonts/generated",
);
const output = path.join(
  path.resolve(process.argv[2] ?? checkpoint),
  `rendering-attempt-${randomUUID()}`,
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const { assets, resources, describe } = createFontProbeAssets(root);
const kinds = ["baseline", "candidate"];
const report = {
  schemaVersion: 1,
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  scope:
    "Same-platform loaded-font rendering only; source CSS/font inputs, not Next build, navigation performance or RUM.",
  conditions: {
    weights: [400, 500, 600, 700],
    fontSizePx: 32,
    deviceScaleFactor: 1,
    pixelTolerance: 0,
    metricTolerance: 0,
    fontDisplay: "optional",
  },
  inputs: [],
  profiles: [],
  errors: [],
  responses: [],
  browserClosed: false,
  serverClosed: false,
};
const save = () =>
  writeFile(
    path.join(output, "results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
async function bind(filename) {
  const bytes = await readFile(filename);
  report.inputs.push({
    path: path.relative(root, filename),
    bytes: bytes.length,
    sha256: sha(bytes),
  });
  return bytes;
}
let browser;
let server;
await mkdir(output, { recursive: true });
await save();
try {
  const binding = JSON.parse(
    await bind(path.join(checkpoint, "baseline-source-binding.json")),
  );
  assert.equal(binding.sourceBaseline, "c252c52");
  report.baselineBinding = binding;
  for (const filename of [
    fileURLToPath(import.meta.url),
    "scripts/font-ui-subset-support.mjs",
    "scripts/fonts/font-probe-assets.mjs",
    "scripts/fonts/generate-fallback-css.mjs",
    "apps/storefront/postcss-font-display-optional/index.cjs",
    path.join(canonical, "fallback-manifest.json"),
  ])
    await bind(path.resolve(root, filename));
  const config = JSON.parse(
    await bind(path.join(root, "scripts/fonts/sources.json")),
  );
  assert.deepEqual(
    config.profiles.map(({ id }) => id),
    ["japanese", "simplified-chinese"],
  );
  const targets = [];
  for (const profile of config.profiles) {
    const cases = Array.from({ length: 95 }, (_, i) =>
      String.fromCodePoint(i + 32),
    );
    cases.push(
      profile.locale === "ja"
        ? "山田 Hana へのギフト：花束 #12 / USD 1,234.50"
        : "送给林月 Lin Yue 的礼物：鲜花 #12 / USD 1,234.50",
      "Anna-Marie O'Neil / VIP_2026 @ $99.00 (数量: 2)",
      "A\u2010B A\u2011B A\u2027B · ¥ € £ – — …",
      profile.locale === "ja"
        ? "新しい贈り物を準備中。心を込めてお届けします。"
        : "工作室正在准备心愿礼物，将把这份支持转交给艺人。",
    );
    const points = [
      ...new Set([...cases.join("")].map((char) => char.codePointAt(0))),
    ];
    const target = {
      id: profile.id,
      locale: profile.locale,
      cases,
      corpusSha256: sha(JSON.stringify(cases)),
      families: Object.fromEntries(
        kinds.map((kind) => [kind, `TEST_${profile.id}_${kind}`]),
      ),
    };
    const uiPath = path.join(canonical, `${profile.id}-ui.css`);
    const ui = await readFontCascade(
      uiPath,
      path.join(root, "packages/design-tokens"),
    );
    assert.equal(ui.imports.length, 0);
    assert.equal(ui.faces.length, 1);
    for (const filename of [uiPath, ui.faces[0].resource]) {
      const bytes = await bind(filename);
      assert.equal(
        sha(bytes),
        sha(
          execFileSync(
            "git",
            ["show", `c252c52:${path.relative(root, filename)}`],
            { cwd: root, maxBuffer: 4 * 1024 * 1024 },
          ),
        ),
        "UI input must remain identical to c252c52",
      );
    }
    for (const kind of kinds) {
      const filename =
        kind === "baseline"
          ? path.join(checkpoint, `baseline-${profile.id}-fallback.css`)
          : path.join(canonical, `${profile.id}-fallback.css`);
      const bytes = await bind(filename);
      if (kind === "baseline")
        assert.equal(
          sha(bytes),
          binding.files.find(
            (file) =>
              file.path ===
              path.relative(
                root,
                path.join(canonical, `${profile.id}-fallback.css`),
              ),
          )?.sha256,
          "baseline copy must match frozen source binding",
        );
      const parsed = await readFontCascade(
        filename,
        path.join(root, "packages/design-tokens"),
      );
      assert.equal(parsed.imports.length, 0);
      // Copied baseline CSS still encodes paths relative to the canonical generated directory.
      const faces = parsed.faces
        .map((face) => ({
          ...face,
          resource: path.resolve(
            canonical,
            path.relative(path.dirname(filename), face.resource),
          ),
        }))
        .concat(ui.faces);
      assert.ok(
        points.every((point) =>
          faces.some((face) =>
            face.ranges.some(([a, b]) => a <= point && point <= b),
          ),
        ),
        "corpus must be declared by each cascade",
      );
      target[kind] = await Promise.all(
        faces.map(async (face) => {
          assert.equal(face.family, profile.family);
          return {
            ...(await describe(face)),
            needed: face.ranges.some(([a, b]) =>
              points.some((point) => a <= point && point <= b),
            ),
          };
        }),
      );
    }
    targets.push(target);
  }
  for (const [filename, resource] of resources)
    report.inputs.push({
      path: path.relative(root, filename),
      bytes: resource.bytes,
      sha256: resource.sha256,
    });
  report.targets = targets;
  await save();
  server = createServer((req, res) => {
    const body =
      req.url === "/"
        ? "<!doctype html><html><head><meta charset=utf-8><title>Font fallback comparison</title></head><body></body></html>"
        : assets.get(req.url);
    res.writeHead(req.method === "GET" && body ? 200 : 404, {
      "Content-Type":
        req.url === "/" ? "text/html; charset=utf-8" : "font/woff2",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "GET" && body ? body : "Not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 2400, height: 1200 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("requestfailed", (request) =>
    report.errors.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  const responses = [];
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (assets.has(pathname))
      responses.push(
        response
          .body()
          .then((bytes) => {
            const matches =
              response.status() === 200 &&
              sha(bytes) === sha(assets.get(pathname));
            report.responses.push({ pathname, sha256: sha(bytes), matches });
            if (!matches)
              report.errors.push(`Font response mismatch: ${pathname}`);
          })
          .catch((error) => report.errors.push(error.message)),
      );
  });
  assert.equal((await page.goto(origin)).status(), 200);
  for (const target of targets) {
    const loaded = await page.evaluate(async (target) => {
      globalThis.document.fonts.clear();
      globalThis.document.documentElement.lang = target.locale;
      const registered = [];
      for (const kind of ["baseline", "candidate"])
        for (const descriptor of target[kind]) {
          const face = new globalThis.FontFace(
            target.families[kind],
            `url("${descriptor.pathname}")`,
            {
              weight: descriptor.weight,
              style: descriptor.style,
              unicodeRange: descriptor.unicodeRange,
              display: "optional",
            },
          );
          globalThis.document.fonts.add(face);
          if (descriptor.needed) registered.push({ face, descriptor, kind });
        }
      await Promise.all(registered.map(({ face }) => face.load()));
      for (const weight of [400, 500, 600, 700])
        for (const kind of ["baseline", "candidate"]) {
          const font = `${weight} 32px "${target.families[kind]}"`;
          const faces = await globalThis.document.fonts.load(
            font,
            target.cases.join(""),
          );
          if (
            !faces.length ||
            faces.some(
              (face) =>
                face.status !== "loaded" ||
                face.family !== target.families[kind],
            ) ||
            !globalThis.document.fonts.check(font, target.cases.join(""))
          )
            throw new Error("Required custom font not loaded");
        }
      await globalThis.document.fonts.ready;
      return registered.map(({ face, descriptor, kind }) => ({
        kind,
        family: face.family,
        path: descriptor.pathname,
        status: face.status,
        sha256: descriptor.sha256,
      }));
    }, target);
    for (const weight of report.conditions.weights) {
      const result = await page.evaluate(
        ({ target, weight }) => {
          const doc = globalThis.document;
          doc.body.replaceChildren();
          doc.body.style.cssText =
            "margin:16px;background:white;color:black;display:flex;gap:24px";
          const panels = {},
            probes = {};
          for (const kind of ["baseline", "candidate"]) {
            const panel = doc.createElement("section"),
              title = doc.createElement("h2"),
              probe = doc.createElement("span");
            title.textContent = `${target.locale} ${weight} ${kind}`;
            panel.style.cssText =
              "width:1160px;display:flex;flex-wrap:wrap;align-content:flex-start";
            title.style.cssText = "width:100%;font:20px sans-serif";
            probe.id = kind;
            probe.style.cssText = `position:absolute;left:-10000px;white-space:pre;font:${weight} 32px "${target.families[kind]}";font-kerning:normal;line-height:normal`;
            panel.append(title);
            doc.body.append(panel, probe);
            panels[kind] = panel;
            probes[kind] = probe;
          }
          const rows = target.cases.map((text, index) => {
            const measures = {},
              canvases = {},
              pixels = {};
            for (const kind of ["baseline", "candidate"]) {
              const canvas = doc.createElement("canvas"),
                ctx = canvas.getContext("2d", { willReadFrequently: true });
              ctx.font = `${weight} 32px "${target.families[kind]}"`;
              ctx.fontKerning = "normal";
              ctx.lang = target.locale;
              const metrics = ctx.measureText(text);
              probes[kind].textContent = text;
              const box = probes[kind].getBoundingClientRect();
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
              Object.assign(measures[kind], {
                domWidth: box.width,
                domHeight: box.height,
              });
              canvases[kind] = canvas;
            }
            const pair = Object.values(measures);
            const left = Math.max(
              0,
              ...pair.map((m) => m.actualBoundingBoxLeft),
            );
            const ascent = Math.max(
              32,
              ...pair.map((m) => m.actualBoundingBoxAscent),
            );
            const height = Math.ceil(
              ascent +
                Math.max(16, ...pair.map((m) => m.actualBoundingBoxDescent)) +
                16,
            );
            const width = Math.ceil(
              Math.max(
                ...pair.map((m) => Math.max(m.width, m.actualBoundingBoxRight)),
              ) +
                left +
                16,
            );
            for (const kind of ["baseline", "candidate"]) {
              const canvas = canvases[kind];
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              ctx.fillStyle = "white";
              ctx.fillRect(0, 0, width, height);
              ctx.fillStyle = "black";
              ctx.font = `${weight} 32px "${target.families[kind]}"`;
              ctx.fontKerning = "normal";
              ctx.lang = target.locale;
              ctx.fillText(text, left + 8, ascent + 8);
              pixels[kind] = ctx.getImageData(0, 0, width, height).data;
              const cell = doc.createElement("div");
              cell.style.cssText =
                index < 95 ? "width:116px;height:88px" : "width:100%";
              cell.append(canvas);
              panels[kind].append(cell);
            }
            let changedChannels = 0;
            for (let i = 0; i < pixels.baseline.length; i++)
              if (pixels.baseline[i] !== pixels.candidate[i]) changedChannels++;
            const metricsMatch = Object.keys(measures.baseline).every(
              (key) =>
                Number.isFinite(measures.baseline[key]) &&
                measures.baseline[key] === measures.candidate[key],
            );
            return {
              text,
              index,
              metrics: measures,
              metricsMatch,
              changedChannels,
              passed: metricsMatch && changedChannels === 0,
            };
          });
          for (const kind of ["baseline", "candidate"])
            probes[kind].textContent = target.cases.join("");
          return {
            rows,
            mismatchCount: rows.filter((row) => !row.passed).length,
          };
        },
        { target, weight },
      );
      const cdp = await context.newCDPSession(page);
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      const { root: documentNode } = await cdp.send("DOM.getDocument");
      const platformFonts = {};
      for (const kind of kinds) {
        const { nodeId } = await cdp.send("DOM.querySelector", {
          nodeId: documentNode.nodeId,
          selector: `#${kind}`,
        });
        platformFonts[kind] = (
          await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
        ).fonts;
      }
      await cdp.detach();
      const screenshot = `${target.id}-${weight}.png`;
      const png = await page.screenshot({
        path: path.join(output, screenshot),
        fullPage: true,
      });
      report.profiles.push({
        id: target.id,
        weight,
        loaded,
        platformFonts,
        ...result,
        screenshot,
        screenshotSha256: sha(png),
      });
      await save();
    }
  }
  await Promise.all(responses);
  for (const input of report.inputs)
    assert.equal(
      sha(await readFile(path.resolve(root, input.path))),
      input.sha256,
      `Input changed during probe: ${input.path}`,
    );
  assert.ok(
    report.profiles.length === 8 &&
      report.profiles.every((profile) => profile.rows.length === 99),
  );
  report.status =
    report.errors.length === 0 &&
    report.responses.length > 0 &&
    report.profiles.every(
      (profile) =>
        profile.mismatchCount === 0 &&
        Object.values(profile.platformFonts).every(
          (fonts) =>
            fonts.length > 0 && fonts.every((font) => font.isCustomFont),
        ),
    )
      ? "PASS"
      : "FAIL";
} catch (error) {
  report.status = "FAIL";
  report.errors.push(`${error.name}: ${error.message}`);
} finally {
  if (browser)
    await browser
      .close()
      .then(() => {
        report.browserClosed = true;
      })
      .catch((error) => {
        report.status = "FAIL";
        report.errors.push(error.message);
      });
  if (server)
    await new Promise((resolve) =>
      server.close((error) => {
        report.serverClosed = !error;
        if (error) {
          report.status = "FAIL";
          report.errors.push(error.message);
        }
        resolve();
      }),
    );
  report.completedAt = new Date().toISOString();
  await save();
}
console.log(`Fallback rendering ${report.status}: ${output}`);
if (report.status !== "PASS") process.exitCode = 1;
