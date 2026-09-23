import { readFile, mkdir } from "node:fs/promises";
import { createHash, X509Certificate } from "node:crypto";
import { chromium } from "@playwright/test";
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
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const query = new globalThis.URLSearchParams(facts.commerceContext);
  query.delete("schemaVersion");
  await page.goto(config.origins.storefront + "/en/gifts?" + query, {
    waitUntil: "networkidle",
  });
  const trigger = page.locator("[data-gift-filter-disclosure] summary");
  await page.evaluate(() => {
    globalThis.probe = [];
    for (const event of ["keydown", "click", "toggle", "focusin"])
      globalThis.document.addEventListener(
        event,
        (e) =>
          globalThis.probe.push({
            event,
            key: e.key,
            tag: e.target.tagName,
            open: globalThis.document.querySelector(
              "details[data-gift-filter-disclosure]",
            ).open,
          }),
        true,
      );
  });
  await trigger.focus();
  console.log(
    "focused",
    await trigger.evaluate((x) => globalThis.document.activeElement === x),
  );
  await page.keyboard.press("Enter");
  console.log(
    "after Enter",
    await page
      .locator("[data-gift-filter-disclosure]")
      .evaluate((x) => ({
        open: x.open,
        formStyle: globalThis.getComputedStyle(x.querySelector("form")).display,
        rect: x.querySelector("form").getBoundingClientRect().toJSON(),
        events: globalThis.probe,
      })),
  );
  await page.screenshot({ path: output + "/keyboard-probe.png" });
  await page.keyboard.press("Escape");
  await page.locator("[data-gift-toolbar-sort]").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  console.log(
    "arrows",
    new globalThis.URL(page.url()).search,
    await page.locator("[data-gift-toolbar-sort]").inputValue(),
  );
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");
  console.log("enter", new globalThis.URL(page.url()).search);
  await context.close();
} finally {
  await browser.close();
}
