import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "@playwright/test";
import {
  createAccessibilityBrowserTools,
  openAccessibilityMailbox,
  settleAccessibilityOrderRoute,
} from "./accessibility-browser-tools.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

let browser, page;
before(async () => {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  page = await browser.newPage();
});
after(async () => {
  await browser?.close();
});
const content = `<style>:focus-visible{outline:3px solid black;outline-offset:2px}</style>
  <button id="first">First</button><input id="text" aria-label="Name">
  <select id="choice" aria-label="Choice"><option value="a">A</option><option value="b">B</option></select>
  <input id="check" type="checkbox" aria-label="Accept"><button id="last">Last</button>`;
test("browser tools reach and activate controls with real sequential keyboard input", async () => {
  await page.setContent(content);
  const report = { keyboard: [] };
  const tools = createAccessibilityBrowserTools({ report });
  await tools.type(page, page.locator("#text"), "Example", "name");
  assert.equal(await page.locator("#text").inputValue(), "Example");
  await tools.select(page, page.locator("#choice"), "b", "choice");
  assert.equal(await page.locator("#choice").inputValue(), "b");
  await tools.activate(page, page.locator("#check"), "accept", "Space");
  assert.equal(await page.locator("#check").isChecked(), true);
  assert.equal(report.keyboard.length, 3);
  assert(
    report.keyboard.every(
      (entry) => entry.reached && entry.focusVisible && entry.unobscured,
    ),
  );
});
test("a visually obstructed target fails instead of accepting DOM focus alone", async () => {
  await page.setContent(
    content +
      '<div style="position:fixed;inset:0;z-index:999;background:white"></div>',
  );
  const tools = createAccessibilityBrowserTools({ report: { keyboard: [] } });
  await assert.rejects(
    () => tools.reach(page, page.locator("#first"), "obstructed"),
    /unobscured/u,
  );
});
test("unreachable disabled control never receives an artificial focus pass", async () => {
  await page.setContent('<button disabled id="only">Disabled</button>');
  const tools = createAccessibilityBrowserTools({ report: { keyboard: [] } });
  await assert.rejects(
    () => tools.reach(page, page.locator("#only"), "disabled", 3),
    /sequential/u,
  );
});

test("mail entry waits for the session exchange and its own reload before another navigation", async () => {
  let authenticated = false;
  await page.route("https://mail.example.test/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/session") {
      await delay(150);
      authenticated = true;
      await route.fulfill({ status: 204 });
    } else
      await route.fulfill({
        contentType: "text/html",
        body: authenticated
          ? '<a href="/">Refresh messages</a>'
          : '<p role="status">Authorizing</p><script>fetch("/session",{method:"POST"}).then(()=>location.reload())</script>',
      });
  });
  try {
    await openAccessibilityMailbox(
      page,
      "https://mail.example.test/#TEST_CAPABILITY",
    );
    assert.equal(await page.locator('a[href="/"]').count(), 1);
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await page.locator('a[href="/"]').count(), 1);
  } finally {
    await page.unroute("https://mail.example.test/**");
  }
});

test("a paid transient access view is not the final protected order route", async () => {
  const publicOrderId = "accessibility-order-fixture";
  const targetPath = `/en/orders/${publicOrderId}`;
  await page.route("https://storefront.example.test/**", (route) => {
    const url = new URL(route.request().url());
    const body =
      url.pathname === targetPath
        ? '<main data-order-payment-status="PAID">Canonical order</main>'
        : `<main data-order-payment-status="PAID">Exchange succeeded</main><script>history.replaceState(null,"",location.pathname);setTimeout(()=>location.replace(${JSON.stringify(targetPath)}),200)</script>`;
    return route.fulfill({ contentType: "text/html", body });
  });
  try {
    await page.goto(
      "https://storefront.example.test/en/order-access#TEST_CAPABILITY",
      { waitUntil: "domcontentloaded" },
    );
    await settleAccessibilityOrderRoute(page, {
      origin: "https://storefront.example.test",
      locale: "en",
      publicOrderId,
    });
    assert.equal(new URL(page.url()).pathname, targetPath);
    assert.equal(new URL(page.url()).hash, "");
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(
      await page.locator('[data-order-payment-status="PAID"]').count(),
      1,
    );
  } finally {
    await page.unroute("https://storefront.example.test/**");
  }
});
