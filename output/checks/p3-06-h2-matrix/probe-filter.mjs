import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withAcceptanceBrowser } from "../../../apps/api/scripts/storefront-acceptance-browser.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const priorReport =
  "output/checks/p3-06-storefront-acceptance/run-2026-09-21T15-55-54-248Z/browser-attempt-3/browser-results.json";
const sourceFiles = [
  "apps/api/scripts/storefront-acceptance-matrix.mjs",
  "apps/storefront/src/storefront/artist-directory.module.css",
  "apps/storefront/src/storefront/artist-track.tsx",
  "apps/storefront/src/storefront/storefront.css",
  "apps/storefront/src/storefront/gift-filters-client.tsx",
  "packages/design-tokens/styles/foundations.css",
  "packages/ui/src/overlay.tsx",
  "packages/ui/styles/interactions.css",
];

/** Public TEST DOM only. Keep the actual node identity instead of guessing generated IDs. */
function observeElement(element) {
  const describe = (node) =>
    node
      ? {
          tag: node.tagName,
          id: node.id,
          role: node.getAttribute("role"),
          className: node.getAttribute("class"),
          ariaHidden: node.getAttribute("aria-hidden"),
          focusGuard: node.hasAttribute("data-base-ui-focus-guard"),
          focusGuardType: node.getAttribute("data-type"),
          inert: node.inert ?? false,
          tabIndex: node.tabIndex,
        }
      : null;
  const style = (node, pseudo) => {
    const css = globalThis.getComputedStyle(node, pseudo);
    return Object.fromEntries(
      [
        "color",
        "backgroundColor",
        "backgroundImage",
        "opacity",
        "fontSize",
        "fontWeight",
        "lineHeight",
        "display",
        "visibility",
        "position",
        "zIndex",
        "filter",
        "backdropFilter",
        "mixBlendMode",
        "content",
      ].map((name) => [name, css[name]]),
    );
  };
  const rect = element.getBoundingClientRect();
  const ancestors = [];
  for (let node = element; node; node = node.parentElement)
    ancestors.push({
      ...describe(node),
      computed: style(node),
      before: style(node, "::before"),
      after: style(node, "::after"),
    });
  const hitPoints = [0.2, 0.5, 0.8].flatMap((xFraction) =>
    [0.2, 0.5, 0.8].map((yFraction) => {
      const x = rect.x + rect.width * xFraction;
      const y = rect.y + rect.height * yFraction;
      const hit = globalThis.document.elementFromPoint(x, y);
      return {
        x,
        y,
        inViewport:
          x >= 0 &&
          x < globalThis.innerWidth &&
          y >= 0 &&
          y < globalThis.innerHeight,
        targetReceivesHit: hit === element || element.contains(hit),
        hit: describe(hit),
      };
    }),
  );
  return {
    ...describe(element),
    html: element.outerHTML,
    text: element.textContent,
    visible: element.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
    }),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    computed: style(element),
    ancestors,
    hitPoints,
  };
}

function rgb(value) {
  const parts = value
    .match(/^rgba?\(([^)]+)\)$/u)?.[1]
    .split(",")
    .map(Number);
  return parts?.length >= 3 && parts.every(Number.isFinite) ? parts : null;
}

/** Deliberately refuse gradients, blending, translucent text and uncertain coverage. */
function flatContrast(observation) {
  const unresolved = (reason) => ({ status: "MANUAL_REQUIRED", reason });
  if (
    !observation.visible ||
    observation.rect.width <= 0 ||
    observation.rect.height <= 0 ||
    !observation.hitPoints.every(
      (point) => point.inViewport && point.targetReceivesHit,
    )
  )
    return unresolved("Target is not fully visible at all recorded hit points");
  if (
    observation.ancestors.some(
      ({ computed }) =>
        computed.opacity !== "1" ||
        computed.filter !== "none" ||
        computed.backdropFilter !== "none" ||
        computed.mixBlendMode !== "normal",
    )
  )
    return unresolved("An ancestor has opacity, filtering or blending");
  const foreground = rgb(observation.computed.color);
  if (!foreground || (foreground[3] ?? 1) !== 1)
    return unresolved("Text color is unsupported or translucent");
  let background;
  for (const ancestor of observation.ancestors) {
    if (
      ancestor.computed.backgroundImage !== "none" ||
      [ancestor.before, ancestor.after].some(
        (pseudo) => !["none", "normal"].includes(pseudo.content),
      )
    )
      return unresolved("Background includes an image or generated content");
    const candidate = rgb(ancestor.computed.backgroundColor);
    if (!candidate) return unresolved("Unsupported computed background color");
    const alpha = candidate[3] ?? 1;
    if (alpha === 1) {
      background = candidate;
      break;
    }
    if (alpha !== 0) return unresolved("Background requires alpha compositing");
  }
  if (!background) return unresolved("No opaque background was observed");
  const luminance = (color) =>
    color
      .slice(0, 3)
      .map((channel) => channel / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      )
      .reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0,
      );
  const values = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  const ratio = (values[0] + 0.05) / (values[1] + 0.05);
  return {
    status: ratio >= 4.5 ? "PASS_NORMAL_TEXT_AA" : "FAIL_NORMAL_TEXT_AA",
    foreground,
    background,
    ratio,
    minimum: 4.5,
    scope:
      "Observed solid background only; not a general photography assertion",
  };
}

/** Inject into the existing real fixture after performance collection has ended. */
export async function verifyBrowser(context) {
  assert.equal(context.manifest.environment, "TEST");
  assert.match(
    context.origin,
    /^(?:http:\/\/(?:localhost|127\.0\.0\.1)|https:\/\/media\.example\.invalid):\d+$/u,
  );
  const directory = path.join(context.output, `filter-probe-${randomUUID()}`);
  await mkdir(directory);
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    scope:
      "Read-only public TEST Portuguese mobile filter evidence; not VoiceOver, physical-device, performance, all-locale or complete P3-06 acceptance",
    priorReport,
    scenarioSource: "apps/api/scripts/storefront-acceptance-matrix.mjs:494",
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    sourceFiles: [],
    originalScenarioKeys: [],
    supplementalKeys: [],
    nodes: [],
    checks: [],
    pageErrors: [],
    screenshots: [],
    contextClosed: false,
    voiceOverEvidence: false,
    physicalDeviceEvidence: false,
  };
  const save = () =>
    writeFile(
      path.join(directory, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const check = (condition, label) => {
    report.checks.push({ label, pass: Boolean(condition) });
    context.check(condition, label);
  };
  await save();
  try {
    report.buildId = (
      await readFile(
        path.join(workspaceRoot, "apps/storefront/.next/BUILD_ID"),
        "utf8",
      )
    ).trim();
    report.nextGeneration = context.next.generation();
    for (const file of [...sourceFiles, priorReport]) {
      const bytes = await readFile(path.join(workspaceRoot, file));
      report.sourceFiles.push({
        path: file,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    await withAcceptanceBrowser(context, async (browser) => {
      report.browserVersion = browser.version();
      const browserContext = await browser.newContext({
        viewport: report.viewport,
        reducedMotion: "reduce",
      });
      const page = await browserContext.newPage();
      page.on("pageerror", (error) =>
        report.pageErrors.push({ name: error.name }),
      );
      const screenshot = async (name) => {
        await page.screenshot({
          path: path.join(directory, name),
          fullPage: true,
          animations: "disabled",
        });
        report.screenshots.push(name);
        await save();
      };
      try {
        const scope = new globalThis.URLSearchParams(
          context.fixtures.markets[0],
        );
        const url = `${context.origin}/pt/gifts?${scope}`;
        const response = await page.goto(url, {
          waitUntil: "networkidle",
          timeout: 60_000,
        });
        check(
          response?.status() === 200 && page.url() === url,
          "Expected public TEST gift URL returns 200 without redirect",
        );
        await page.evaluate(async () => globalThis.document.fonts.ready);
        await page.locator("[data-gift-directory]").waitFor();
        const triggerSelector =
          '.gift-filters__mobile [data-overlay-trigger="drawer"]';
        const trigger = page.locator(triggerSelector);
        await trigger.click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible" });
        await page.locator('[data-gift-filters="mobile"]').waitFor();
        const step = async (key, target) => {
          await page.keyboard.press(key);
          const initial = await dialog.evaluate((element) => ({
            inside: element.contains(globalThis.document.activeElement),
            knownInsideGuard:
              globalThis.document.activeElement?.hasAttribute(
                "data-base-ui-focus-guard",
              ) &&
              globalThis.document.activeElement?.getAttribute("data-type") ===
                "inside",
            activeHtml: globalThis.document.activeElement?.outerHTML,
          }));
          const record = { key, initial };
          target.push(record);
          await save();
          check(
            initial.inside || initial.knownInsideGuard,
            "Focus is in the popup or its recognized transient inside guard",
          );
          const started = globalThis.performance.now();
          if (!initial.inside)
            await page.waitForFunction(
              () =>
                globalThis.document
                  .querySelector('[data-overlay-popup="drawer"]')
                  ?.contains(globalThis.document.activeElement),
              undefined,
              { timeout: 500 },
            );
          record.settled = await dialog.evaluate((element) => ({
            inside: element.contains(globalThis.document.activeElement),
            activeHtml: globalThis.document.activeElement?.outerHTML,
          }));
          record.guardSettledWithinMs = initial.inside
            ? 0
            : globalThis.performance.now() - started;
          check(
            record.settled.inside,
            "Transient guard settles inside within the existing 500 ms boundary",
          );
        };
        for (let index = 0; index < 12; index++)
          await step("Tab", report.originalScenarioKeys);
        await page
          .locator('[data-gift-filters="mobile"] [data-gift-price-min]')
          .fill("10,50");
        // Capture the live DOM first; generated IDs are evidence, never semantic assumptions.
        report.popup = await dialog.evaluate(observeElement);
        report.background = await page
          .locator(".storefront")
          .evaluate(observeElement);
        report.guards = await page
          .locator('[data-base-ui-focus-guard][data-type="inside"]')
          .evaluateAll((elements) =>
            elements.map((element) => ({
              html: element.outerHTML,
              ariaHidden: element.getAttribute("aria-hidden"),
              tabIndex: element.tabIndex,
            })),
          );
        await screenshot("mobile-filter-open.png");
        const require = createRequire(path.join(workspaceRoot, "package.json"));
        const { default: AxeBuilder } = require("@axe-core/playwright");
        const axe = await new AxeBuilder({ page }).analyze();
        await writeFile(
          path.join(directory, "axe.json"),
          JSON.stringify(axe, null, 2) + "\n",
        );
        report.axe = {
          version: axe.testEngine.version,
          violations: axe.violations.length,
          incomplete: axe.incomplete.length,
          file: "axe.json",
        };
        for (const rule of axe.incomplete) {
          for (const node of rule.nodes) {
            const entry = {
              rule: rule.id,
              target: node.target,
              axeHtml: node.html,
            };
            report.nodes.push(entry);
            if (
              node.target.length !== 1 ||
              typeof node.target[0] !== "string"
            ) {
              entry.resolution = "MANUAL_REQUIRED_NESTED_TARGET";
              continue;
            }
            const locator = page.locator(node.target[0]);
            const count = await locator.count();
            entry.matches = count;
            if (count !== 1) {
              entry.resolution = "MANUAL_REQUIRED_NONUNIQUE_TARGET";
              continue;
            }
            entry.observation = await locator.evaluate(observeElement);
            entry.resolution = "RESOLVED_CURRENT_DOM";
            if (rule.id === "color-contrast")
              entry.contrast = flatContrast(entry.observation);
            else if (
              rule.id !== "aria-hidden-focus" ||
              !(
                entry.observation.className
                  ?.split(/\s+/u)
                  .includes("storefront") ||
                (entry.observation.focusGuard &&
                  entry.observation.focusGuardType === "inside")
              )
            )
              entry.resolution = "MANUAL_REQUIRED_UNEXPECTED_RULE_OR_NODE";
          }
        }
        await save();
        check(
          report.background.ariaHidden === "true",
          "Modal marks the storefront background aria-hidden",
        );
        check(
          report.guards.length === 2 &&
            report.guards.every((guard) => guard.ariaHidden === "true"),
          "Both observed inside guards are hidden from accessibility semantics",
        );
        for (const key of ["Tab", "Shift+Tab"])
          for (let index = 0; index < 24; index++)
            await step(key, report.supplementalKeys);
        await screenshot("mobile-filter-keyboard.png");
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.waitForFunction(
          (selector) => globalThis.document.activeElement?.matches(selector),
          triggerSelector,
        );
        report.focusReturned = true;
        report.backgroundAfterClose = await page
          .locator(".storefront")
          .evaluate(observeElement);
        check(
          report.backgroundAfterClose.ariaHidden !== "true",
          "Closing restores storefront accessibility visibility",
        );
        check(report.pageErrors.length === 0, "No public page runtime errors");
        check(
          axe.violations.length === 0,
          "Original axe violations remain zero",
        );
        const contrasts = report.nodes.filter(
          (node) => node.rule === "color-contrast",
        );
        report.status = contrasts.some(
          (node) => node.contrast?.status === "FAIL_NORMAL_TEXT_AA",
        )
          ? "FAIL_CONTRAST"
          : report.nodes.some(
                (node) => node.resolution !== "RESOLVED_CURRENT_DOM",
              ) ||
              contrasts.some(
                (node) => node.contrast?.status !== "PASS_NORMAL_TEXT_AA",
              )
            ? "COLLECTED_MANUAL_REQUIRED"
            : "PASS_SUPPLEMENTAL_PROBES";
        await save();
        check(
          report.status !== "FAIL_CONTRAST",
          "Observed solid-background text meets normal-text AA",
        );
      } catch (error) {
        report.status = "FAIL";
        report.failure = {
          name: error?.name,
          assertion: error?.name === "AssertionError" ? error.message : null,
        };
        await save();
        try {
          await screenshot("failure.png");
        } catch {
          /* Retain the primary failure even if a closed page cannot be captured. */
        }
        throw error;
      } finally {
        await browserContext.close();
        report.contextClosed = true;
      }
    });
    report.browserClosed = true;
    return report;
  } catch (error) {
    report.status = "FAIL";
    report.failure ??= {
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    };
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await save();
  }
}
