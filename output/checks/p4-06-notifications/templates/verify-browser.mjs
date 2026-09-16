/* global document, getComputedStyle, matchMedia */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../..");
const evidence = path.join(
  directory,
  `browser-${new Date().toISOString().replace(/[:.]/gu, "-")}`,
);
await mkdir(evidence, { recursive: true });
const { createOrderNotificationTemplates } = await import(
  pathToFileURL(path.join(root, "packages/i18n/dist/notifications/index.js"))
);
const { orderNotificationRenderCommandSchema } = await import(
  pathToFileURL(path.join(root, "packages/contracts/dist/index.js"))
);
const fixture = JSON.parse(
  await readFile(
    path.join(root, "packages/i18n/src/notifications/v1/history.fixture.json"),
    "utf8",
  ),
);
const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const safePreviewLink = "https://preview.invalid/order";
const previews = new Map();
const scenarios = [
  ...fixture.messages.map((archived) => ({ ...archived, large: false })),
  {
    ...fixture.messages.find(
      (item) => item.locale === "es" && item.eventType === "PREPARING",
    ),
    large: true,
  },
];
for (const archived of scenarios) {
  const scenarioVariables = archived.large
    ? {
        ...fixture.variables,
        totalMinor: 50000,
        items: Array.from({ length: 500 }, () => ({
          ...fixture.variables.items[0],
          idolName: fixture.variables.items[0].idolName.repeat(8),
          giftName: fixture.variables.items[0].giftName.repeat(32),
          variantName: "Archive option ".repeat(6),
          variantLocale: "en",
          quantity: 1,
          lineTotalMinor: 100,
        })),
      }
    : fixture.variables;
  const credentialUrl = `https://store.example/en/order-access#token=${"A".repeat(43)}&order=${fixture.variables.publicOrderId}`;
  const command = orderNotificationRenderCommandSchema.parse({
    schemaVersion: 1,
    eventType: archived.eventType,
    locale: {
      schemaVersion: 1,
      requestedLocale: archived.locale,
      resolvedLocale: archived.locale,
      fallbackUsed: false,
      templateKey: archived.templateKey,
      templateVersion: archived.templateVersion,
      contentRevisionIds: [],
    },
    variables: { ...scenarioVariables, orderUrl: credentialUrl },
  });
  const content = templates.render(command);
  if (!archived.large)
    assert.equal(hash(JSON.stringify(content)), archived.contentHash);
  const html = content.html.replace(
    credentialUrl.replaceAll("&", "&amp;"),
    safePreviewLink,
  );
  assert(!html.includes("#token=") && !html.includes("A".repeat(43)));
  assert.equal(
    content.html.split(credentialUrl.replaceAll("&", "&amp;")).length,
    2,
  );
  const id = `${archived.locale}-${archived.eventType.toLowerCase()}${archived.large ? "-500-items" : ""}`;
  previews.set(`/${id}`, {
    html,
    subject: content.subject,
    originalHtmlHash: hash(content.html),
    previewHtmlHash: hash(html),
    ...archived,
    expectedVisibleItems: archived.large ? 10 : 1,
    contentHash: hash(JSON.stringify(content)),
    id,
  });
  await writeFile(path.join(evidence, `${id}.html`), html);
}

const server = createServer((request, response) => {
  const preview = previews.get(request.url);
  response.writeHead(preview ? 200 : 404, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
  });
  response.end(preview?.html ?? "Not found");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
let assertions = 0;
const check = (condition, message) => {
  assert(condition, message);
  assertions++;
};
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
      locale: "en-US",
    });
    await context.route("https://preview.invalid/**", (route) =>
      route.fulfill({ status: 200, body: "Safe notification preview target" }),
    );
    for (const preview of previews.values()) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", () => errors.push("pageerror"));
      await page.goto(origin + "/" + preview.id, { waitUntil: "networkidle" });
      check((await page.title()) === preview.subject, "subject document title");
      const visible = await page.locator("main").innerText();
      check(visible.includes(fixture.variables.publicOrderId), "order number");
      check(
        visible.includes(fixture.variables.items[0].giftName),
        "historical gift",
      );
      check(
        visible.includes(fixture.variables.items[0].idolName),
        "historical artist",
      );
      check(
        visible.includes(preview.large ? "500" : "123"),
        "amount remains unchanged",
      );
      if (preview.large) {
        check(
          (await page.locator("[data-mail-item]").count()) === 10,
          "500 item order shows ten summaries",
        );
        check(
          (await page.locator("[data-mail-summary]").innerText()).includes(
            "490",
          ),
          "remainder count is explicit",
        );
        check(
          (await page.locator("[data-mail-total]").innerText()).includes("500"),
          "full order total is retained",
        );
      }
      check(!visible.includes("#token="), "no credentials in visible text");
      check(!/\{(?:siteName|quantity)\}/u.test(visible), "no ICU parameters");
      check(
        (await page.locator("html").getAttribute("lang")) === preview.locale,
        "whole template language",
      );
      check(
        (await page.locator('[data-mail-item] [lang="ja"]').count()) ===
          preview.expectedVisibleItems,
        "original idol language",
      );
      check(
        (await page.locator('[data-mail-item] [lang="zh-CN"]').count()) ===
          preview.expectedVisibleItems,
        "original gift language",
      );
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        animated: [...document.querySelectorAll("main *")].some(
          (element) => getComputedStyle(element).animationName !== "none",
        ),
      }));
      check(geometry.scroll <= geometry.width, "no horizontal overflow");
      check(geometry.reduced && !geometry.animated, "reduced motion");
      const link = page.locator("[data-mail-link]");
      check(
        (await link.getAttribute("href")) === safePreviewLink,
        "only safe preview link reaches browser",
      );
      const box = await link.boundingBox();
      check(box.width >= 44 && box.height >= 44, "touch target");
      await page.keyboard.press("Tab");
      check(
        await link.evaluate((element) => element === document.activeElement),
        "keyboard link focus",
      );
      check(
        (await link.evaluate(
          (element) => getComputedStyle(element).outlineStyle,
        )) === "solid",
        "visible focus",
      );
      await page.screenshot({
        path: path.join(evidence, `${preview.id}-${viewport.width}.png`),
        fullPage: true,
      });
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      check(axe.violations.length === 0, "axe violations");
      check(errors.length === 0, "no browser errors");
      await page.keyboard.press("Enter");
      await page.waitForURL(safePreviewLink);
      check(
        (await page.locator("body").innerText()).includes(
          "Safe notification preview target",
        ),
        "keyboard activation",
      );
      results.push({
        id: preview.id,
        viewport,
        templateVersion: preview.templateVersion,
        originalHtmlHash: preview.originalHtmlHash,
        previewHtmlHash: preview.previewHtmlHash,
        axe: {
          violations: axe.violations.map((item) => ({
            id: item.id,
            impact: item.impact,
          })),
          incomplete: axe.incomplete.map((item) => ({
            id: item.id,
            impact: item.impact,
          })),
        },
      });
      await page.close();
    }
    await context.close();
    console.log(`Verified ${viewport.width}px: ${results.length} cases`);
  }
  const report = {
    schemaVersion: 1,
    status: "PASS",
    cases: results.length,
    assertions,
    previewRedaction:
      "Only the single credential-bearing href was replaced with https://preview.invalid/order before any browser navigation. Original render content hashes match archived fixtures; original/preview HTML hashes are retained. No raw credentials, recipient, private fan text or genuine PII are persisted in browser artifacts.",
    limitations: [
      "Chromium responsive email-HTML preview, not Outlook/Gmail inbox delivery or mailbox-client acceptance.",
      "All seven copy reviews remain DRAFT. No mail was sent.",
    ],
    results,
  };
  await writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      cases: results.length,
      assertions,
      evidence,
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
