/* global document, window */
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { parseArgs } from "node:util";
import { chromium, expect } from "@playwright/test";
import { accessibilityLocales as SUPPORTED_LOCALES } from "../apps/api/scripts/accessibility-contracts.mjs";
import { localExperienceConfigSchema } from "../apps/api/scripts/local-experience-config.mjs";

const { values } = parseArgs({
  options: {
    instance: { type: "string" },
    output: { type: "string" },
    smoke: { type: "boolean", default: false },
    locale: { type: "string" },
  },
});
assert.match(values.instance ?? "", /^[a-z0-9-]+$/u);
assert(values.output, "An explicit evidence directory is required");
assert(!values.locale || SUPPORTED_LOCALES.includes(values.locale));
const config = localExperienceConfigSchema.parse(
  JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "node_modules/.cache/fan-support-local-experience",
        values.instance,
        "config.json",
      ),
      "utf8",
    ),
  ),
);
assert.equal(config.workspaceRoot, process.cwd());
const output = path.resolve(values.output);
await mkdir(output, { recursive: true });
const certificate = new X509Certificate(
  await readFile(config.tls.certificatePath),
);
const pin = createHash("sha256")
  .update(certificate.publicKey.export({ type: "spki", format: "der" }))
  .digest("base64");
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    `--ignore-certificate-errors-spki-list=${pin}`,
    `--host-resolver-rules=${Object.values(config.origins)
      .map((origin) => `MAP ${new URL(origin).hostname} 127.0.0.1`)
      .join(",")}`,
    "--no-proxy-server",
  ],
});
const report = {
  status: "RUNNING",
  browserVersion: browser.version(),
  cases: [],
  pageErrors: [],
};

async function visibleGeometry(locator) {
  await expect(locator).toBeInViewport({ ratio: 1 });
  const rect = await locator.boundingBox();
  assert(rect && rect.width > 0 && rect.height > 0);
  return rect;
}

async function scrollPosition(page) {
  return page.evaluate(() => window.scrollY);
}

async function checkCase(locale, mobile) {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: mobile ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const entry = { locale, mobile, status: "RUNNING" };
  report.cases.push(entry);
  page.on("pageerror", (error) => report.pageErrors.push(error.name));
  try {
    await page.goto(`${config.origins.storefront}/${locale}?page=1`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.locator('[data-storefront-language] button[aria-expanded="false"]'),
    ).toHaveCount(1);
    await page.evaluate(() =>
      window.scrollTo({ top: 1100, behavior: "instant" }),
    );
    await expect.poll(() => scrollPosition(page)).toBeGreaterThan(500);
    const before = await scrollPosition(page);
    const header = page.locator(".storefront-header");
    await visibleGeometry(header);
    const drawerTrigger = page
      .locator(".storefront-mobile-menu button")
      .first();
    let language = page.locator(".storefront-desktop-language button");
    if (mobile) {
      await drawerTrigger.tap();
      await expect(page.getByRole("dialog")).toBeVisible();
      language = page
        .getByRole("dialog")
        .locator("[data-storefront-language] button");
    }
    await visibleGeometry(language);
    if (mobile) await language.tap();
    else await language.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    entry.openMenu = await visibleGeometry(menu);
    if (!mobile) await visibleGeometry(header);
    assert.equal(await scrollPosition(page), before);
    await page.screenshot({
      path: path.join(
        output,
        `${locale}-${mobile ? "mobile" : "desktop"}-open.png`,
      ),
    });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(language).toBeFocused();
    if (mobile) {
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(drawerTrigger).toBeFocused();
    }
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.hasAttribute("data-fs-menu-scroll-lock"),
        ),
      )
      .toBe(false);
    await visibleGeometry(header);
    assert.equal(await scrollPosition(page), before);
    await page.mouse.move(200, 700);
    await page.mouse.wheel(0, 240);
    await expect.poll(() => scrollPosition(page)).toBeGreaterThan(before);
    entry.escapeRestoresFocusAndScroll = true;

    // Both sizes expose the same navigation drawer; order lookup is only inside it.
    if (!values.smoke) {
      await expect(
        page.locator('.storefront-desktop-nav a[href*="/orders/lookup"]'),
      ).toHaveCount(0);
      await visibleGeometry(drawerTrigger);
      await drawerTrigger.click();
      await expect(
        page.getByRole("dialog").locator('a[href*="/orders/lookup"]'),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
      entry.lookupInDrawer = true;
    }
    if (mobile) await drawerTrigger.tap();
    await language.focus();
    await page.keyboard.press("ArrowDown");
    await expect(menu).toBeVisible();
    await visibleGeometry(menu);
    const next =
      SUPPORTED_LOCALES[
        (SUPPORTED_LOCALES.indexOf(locale) + 1) % SUPPORTED_LOCALES.length
      ];
    const option = menu
      .getByRole("menuitemradio")
      .nth(SUPPORTED_LOCALES.indexOf(next));
    const box = await visibleGeometry(option);
    // Coordinate activation cannot silently scroll an offscreen popup into view.
    if (mobile)
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForURL(
      (url) => url.pathname === `/${next}` && url.search === "?page=1",
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#gifts")).toBeAttached();
    await expect(page.locator("html")).toHaveAttribute("lang", next);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.hasAttribute("data-fs-menu-scroll-lock"),
        ),
      )
      .toBe(false);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.mouse.move(200, 700);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scrollPosition(page)).toBeGreaterThan(100);
    entry.switchedLocale = next;
    entry.queryPreserved = true;
    entry.status = "PASS";
  } catch (error) {
    entry.status = "FAIL";
    entry.failure = error.name;
    entry.diagnostics = await page.evaluate(() => ({
      scrollY: window.scrollY,
      rootStyle: document.documentElement.getAttribute("style"),
      bodyStyle: document.body.getAttribute("style"),
      rootOverflow: window.getComputedStyle(document.documentElement).overflow,
      bodyOverflow: window.getComputedStyle(document.body).overflow,
      header: document
        .querySelector("header")
        ?.getBoundingClientRect()
        .toJSON(),
      menu: document
        .querySelector('[role="menu"]')
        ?.getBoundingClientRect()
        .toJSON(),
      drawers: [...document.querySelectorAll(".fs-drawer__popup")].map(
        (node) => ({
          ending: node.hasAttribute("data-ending-style"),
          rect: node.getBoundingClientRect().toJSON(),
        }),
      ),
    }));
    await page.screenshot({ path: path.join(output, "failure.png") });
    throw error;
  } finally {
    await context.close();
  }
}

try {
  for (const locale of values.locale
    ? [values.locale]
    : values.smoke
      ? ["zh-CN"]
      : SUPPORTED_LOCALES) {
    for (const mobile of values.smoke ? [false] : [false, true]) {
      await checkCase(locale, mobile);
    }
  }
  assert.deepEqual(report.pageErrors, []);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  throw error;
} finally {
  await browser.close();
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
