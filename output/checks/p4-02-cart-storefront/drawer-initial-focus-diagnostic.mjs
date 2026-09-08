import { URL, URLSearchParams } from "node:url";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, writeFile } from "node:fs/promises";
const directory = new URL("./run-2026-09-08T12-20-02.282Z/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("fixture-manifest.json", directory), "utf8"),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const records = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(
    `http://localhost:59129/en/gifts/${manifest.gifts[0].handle}?${new URLSearchParams({ ...manifest.markets[0], idol: manifest.artists[0].id })}`,
    { waitUntil: "networkidle" },
  );
  await page.locator("[data-cart-add-state]").click();
  await page.locator('[data-cart-add-state="confirmed"]').waitFor();
  await page.goto(
    `http://localhost:59129/en/gifts/${manifest.gifts[0].handle}?${new URLSearchParams({ ...manifest.markets[0], idol: manifest.artists[1].id })}`,
    { waitUntil: "networkidle" },
  );
  await page.locator("[data-cart-add-state]").click();
  await page.locator('[data-cart-add-state="confirmed"]').waitFor();
  for (let round = 0; round < 3; round++) {
    await page.goto("http://localhost:59129/en/cart", {
      waitUntil: "networkidle",
    });
    await page.locator("[data-cart-item]").first().waitFor();
    await new AxeBuilder({ page }).analyze();
    await page.locator("[data-cart-trigger] button").click();
    await page.locator("[data-cart-drawer] [data-cart-item]").first().waitFor();
    async function sample(label) {
      records.push(
        await page.evaluate((label) => {
          const active = globalThis.document.activeElement,
            popup = globalThis.document.querySelector('[role="dialog"]');
          return {
            label,
            activeTag: active?.tagName,
            activeClass: active?.className,
            activeIsTrigger: !!active?.closest("[data-cart-trigger]"),
            activeIsBody: active === globalThis.document.body,
            inside: !!popup?.contains(active),
            popupPresent: !!popup,
            popupVisible: !!popup?.getClientRects().length,
            guard: active?.getAttribute("data-base-ui-focus-guard"),
            type: active?.getAttribute("data-type"),
          };
        }, label),
      );
    }
    await sample("initial");
    for (const ms of [0, 50, 200, 500]) {
      await new Promise((r) => globalThis.setTimeout(r, ms));
      await sample(`after-${ms}ms`);
    }
    await page.keyboard.press("Tab");
    await sample("after-Tab");
  }
  await context.close();
} finally {
  await browser.close();
  await writeFile(
    new URL("drawer-initial-focus-with-axe-diagnostic-2.json", directory),
    JSON.stringify({ records, browserClosed: true }, null, 2) + "\n",
  );
}
console.log(JSON.stringify(records));
