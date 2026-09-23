import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash, X509Certificate } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const root = process.cwd();
const config = JSON.parse(
  await readFile(
    root +
      "/node_modules/.cache/fan-support-local-experience/acceptance-e143d720dd1a4357a3c3/config.json",
    "utf8",
  ),
);
const facts = JSON.parse(
  await readFile(
    root +
      "/output/playwright/p5-08-local-experience/acceptance-e143d720dd1a4357a3c3-1790153667799/facts.json",
    "utf8",
  ),
);
const pin = createHash("sha256")
  .update(
    new X509Certificate(
      await readFile(config.tls.certificatePath),
    ).publicKey.export({ type: "spki", format: "der" }),
  )
  .digest("base64");
const output = root + "/output/checks/p3-06-ui-alignment/after";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--ignore-certificate-errors-spki-list=" + pin,
    "--host-resolver-rules=" +
      Object.values(config.origins)
        .map((x) => "MAP " + new globalThis.URL(x).hostname + " 127.0.0.1")
        .join(","),
    "--no-proxy-server",
  ],
});
const report = {
  status: "RUNNING",
  checks: 0,
  cases: [],
  axe: [],
  pageErrors: [],
  consoleErrors: [],
};
const check = (ok, label) => {
  report.checks++;
  if (!ok) throw new Error(label);
};
const locales = ["en", "zh-CN", "th", "vi", "ja", "es", "pt"];
const query = new globalThis.URLSearchParams(facts.commerceContext);
query.delete("schemaVersion");
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (e) => report.pageErrors.push({ name: e.name }));
    page.on("console", (message) => {
      if (message.type() === "error")
        report.consoleErrors.push({
          kind: message.text().includes("hydrated") ? "hydration" : "other",
        });
    });
    for (const locale of locales) {
      for (const [name, route] of [
        ["home", "/" + locale],
        ["gifts", "/" + locale + "/gifts?" + query],
        [
          "detail",
          "/" +
            locale +
            "/gifts/" +
            facts.giftHandle +
            "?" +
            query +
            "&idol=" +
            facts.artistId,
        ],
      ]) {
        await page.goto(config.origins.storefront + route, {
          waitUntil: "networkidle",
        });
        await page
          .locator(
            name === "home"
              ? "#hero-title"
              : name === "gifts"
                ? ".gift-directory-grid"
                : ".gift-detail-summary h1",
          )
          .waitFor();
        if (name === "gifts")
          await page.locator(".gift-directory-grid").waitFor();
        if (name === "detail")
          await page.locator("[data-gift-offer]").waitFor();
        for (const img of await page.locator("main img").all()) {
          await img.scrollIntoViewIfNeeded();
          await expect(img).toBeVisible();
          await img.evaluate((image) => image.decode());
        }
        await page.evaluate(() => globalThis.scrollTo(0, 0));
        const imgs = await page
          .locator("main img")
          .evaluateAll((xs) => xs.map((x) => x.complete && x.naturalWidth > 0));
        check(
          imgs.length > 0 && imgs.every(Boolean),
          locale + " " + name + " images",
        );
        await page.evaluate(() => globalThis.document.fonts.ready);
        check(
          await page.evaluate(
            () =>
              globalThis.document.documentElement.scrollWidth <=
              globalThis.innerWidth + 1,
          ),
          locale + " " + name + " reflow",
        );
        check(
          await page.evaluate(
            () =>
              globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
          ),
          "reduced motion",
        );
        const metrics = {};
        if (name === "home") {
          metrics.hero = (
            await page.locator(".storefront-hero-image").boundingBox()
          ).height;
          if (width === 390) {
            check(metrics.hero <= 384, "mobile photo budget");
            const cta = await page
              .locator(".storefront-hero .storefront-primary")
              .boundingBox();
            check(cta.y + cta.height < height, "home primary visible");
          }
          check(
            (await page
              .locator("#artists .storefront-featured-shortcuts")
              .count()) === 0,
            "one artist directory path",
          );
        }
        if (name === "gifts") {
          const grid = await page
            .locator(".gift-directory-grid")
            .evaluate(
              (x) =>
                globalThis.getComputedStyle(x).gridTemplateColumns.split(" ")
                  .length,
            );
          check(grid === (width === 390 ? 2 : 3), "gift grid columns");
          if (width === 1440) {
            check(
              (await page
                .locator("details[data-gift-filter-disclosure]")
                .getAttribute("open")) === null,
              "filters initially collapsed",
            );
            metrics.firstProductY = (
              await page.locator(".gift-directory-card").first().boundingBox()
            ).y;
            check(
              metrics.firstProductY < height * 0.65,
              "products visible in desktop first screen",
            );
          }
        }
        if (name === "detail") {
          const price = await page.locator(".gift-detail-price").boundingBox();
          const recipient = await page
            .locator(".gift-recipient-summary")
            .boundingBox();
          check(price.y + price.height < recipient.y, "price before recipient");
          metrics.priceY = price.y;
          check(
            (await page.locator("[data-gift-variant]").count()) === 0,
            "single variant is static",
          );
          check(
            (await page.locator("[data-gift-selected-variant]").count()) === 1,
            "selected variant is present",
          );
        }
        const id = locale + "-" + name + "-" + width;
        await page.screenshot({
          path: output + "/" + id + ".png",
          fullPage: true,
          animations: "disabled",
        });
        const axe = await new AxeBuilder({ page }).analyze();
        report.axe.push({
          id,
          violations: axe.violations.map(({ id, impact, nodes }) => ({
            id,
            impact,
            targets: nodes.map((x) => x.target),
          })),
          incomplete: axe.incomplete.map(({ id, impact, nodes }) => ({
            id,
            impact,
            targets: nodes.map((x) => x.target),
          })),
        });
        check(axe.violations.length === 0, id + " axe");
        report.cases.push({ id, metrics });
        console.log(id, "PASS");
      }
      await page.goto(
        config.origins.storefront + "/" + locale + "/gifts?" + query,
        { waitUntil: "networkidle" },
      );
      const trigger = page.locator(
        width === 1440
          ? "[data-gift-filter-disclosure] summary"
          : '.gift-filters__mobile [data-overlay-trigger="drawer"]',
      );
      await trigger.focus();
      await page.keyboard.press("Enter");
      const form = page.locator(
        '[data-gift-filters="' + (width === 1440 ? "desktop" : "mobile") + '"]',
      );
      await expect(form).toBeVisible();
      const minimum = form.locator("[data-gift-price-min]");
      await minimum.fill("not-a-price");
      await form.locator("button[type=submit]").click();
      await expect(minimum).toHaveAttribute("aria-invalid", "true");
      await expect(minimum).toBeFocused();
      report.checks += 2;
      const axe = await new AxeBuilder({ page }).analyze();
      check(axe.violations.length === 0, "filter error axe");
      report.axe.push({
        id: locale + "-filter-error-" + width,
        violations: axe.violations.map((x) => x.id),
        incomplete: axe.incomplete.map((x) => ({
          id: x.id,
          targets: x.nodes.map((n) => n.target),
        })),
      });
      await page.screenshot({
        path: output + "/" + locale + "-filter-error-" + width + ".png",
        animations: "disabled",
      });
      if (width === 390) {
        for (const key of ["Tab", "Shift+Tab"])
          for (let i = 0; i < 12; i++) {
            await page.keyboard.press(key);
            await page.waitForFunction(
              () =>
                globalThis.document
                  .querySelector('[data-overlay-popup="drawer"]')
                  ?.contains(globalThis.document.activeElement) === true,
              undefined,
              { timeout: 500 },
            );
            report.checks++;
          }
      }
      await page.keyboard.press("Escape");
      await expect(form).not.toBeVisible();
      await expect(trigger).toBeFocused();
      report.checks += 2;
      const unsorted = page.url();
      await page.locator("[data-gift-toolbar-sort]").selectOption("PRICE_DESC");
      check(page.url() === unsorted, "select does not navigate");
      await page.locator("[data-gift-toolbar-apply]").focus();
      await page.keyboard.press("Enter");
      await page.waitForURL((u) => u.searchParams.get("sort") === "PRICE_DESC");
      const sorted = new globalThis.URL(page.url());
      for (const [key, value] of query) {
        check(
          sorted.searchParams.get(key) === value,
          "sort preserves commerce context",
        );
      }
      check(
        sorted.searchParams.get("page") === null ||
          sorted.searchParams.get("page") === "1",
        "sort resets page",
      );
      await page.goBack();
      await expect(page.locator("[data-gift-toolbar-sort]")).toHaveValue(
        "RECOMMENDED",
      );
      report.checks++;
      report.cases.push({
        id: locale + "-filter-keyboard-error-sort-history-" + width,
      });
    }
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 320, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  for (const locale of ["th", "vi", "es", "pt"]) {
    await page.goto(
      config.origins.storefront + "/" + locale + "/gifts?" + query,
      { waitUntil: "networkidle" },
    );
    await page.locator(".gift-directory-grid").waitFor();
    check(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth + 1,
      ),
      "320 " + locale + " reflow",
    );
    await page.screenshot({
      path: output + "/" + locale + "-320.png",
      fullPage: true,
    });
    report.cases.push({ id: locale + "-320" });
  }
  await page.goto(
    config.origins.storefront +
      "/en/gifts?" +
      query +
      "&priceMinMinor=99999999",
  );
  await page.locator("[data-gift-empty]").waitFor();
  check(
    (await page.locator("[data-gift-applied-filters]").count()) === 1,
    "empty filters remain visible",
  );
  await page.screenshot({ path: output + "/empty-320.png", fullPage: true });
  report.cases.push({ id: "filtered-empty-320" });
  await context.close();
  check(report.pageErrors.length === 0, "zero page errors");
  check(report.consoleErrors.length === 0, "zero browser console errors");
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = error.message;
  throw error;
} finally {
  await writeFile(
    output + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
