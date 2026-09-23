import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash, X509Certificate } from "node:crypto";
import { chromium, expect } from "@playwright/test";
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
const output = root + "/output/checks/p3-06-ui-alignment/candidate";
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
const report = [];
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
    const query = new globalThis.URLSearchParams(facts.commerceContext);
    query.delete("schemaVersion");
    for (const [name, route, selector] of [
      ["home", "/zh-CN", "#hero-title"],
      [
        "gifts",
        "/zh-CN/gifts?" + query,
        '[data-gift-directory][data-outcome="success"]',
      ],
      [
        "detail",
        "/zh-CN/gifts/" +
          facts.giftHandle +
          "?" +
          query +
          "&idol=" +
          facts.artistId,
        "[data-gift-detail]",
      ],
    ]) {
      await page.goto(config.origins.storefront + route, {
        waitUntil: "domcontentloaded",
      });
      if (name === "detail") await page.locator("h1").waitFor();
      else await page.locator(selector).waitFor();
      await expect(page.locator("main img").first()).toBeVisible();
      await page.waitForFunction(() =>
        Array.from(globalThis.document.querySelectorAll("main img"))
          .filter((x) => x.getBoundingClientRect().top < globalThis.innerHeight)
          .every((x) => x.complete && x.naturalWidth > 0),
      );
      await page.screenshot({
        path: output + "/" + name + "-" + width + ".png",
      });
      report.push({
        name,
        width,
        route,
        metrics: await page.evaluate(() => ({
          overflow:
            globalThis.document.documentElement.scrollWidth >
            globalThis.innerWidth,
          headings: Array.from(
            globalThis.document.querySelectorAll("h1,h2"),
          ).map((x) => ({
            text: x.textContent,
            y: x.getBoundingClientRect().y,
          })),
          heroImage: globalThis.document
            .querySelector(".storefront-hero-image")
            ?.getBoundingClientRect()
            .toJSON(),
          filters: globalThis.document
            .querySelector(".gift-filters")
            ?.getBoundingClientRect()
            .toJSON(),
        })),
      });
      console.log(name, width, "captured");
    }
    await page.goto(config.origins.admin + "/zh-CN", {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator(
        'form[action="/api/admin/auth/begin"], [data-management-section]:enabled',
      )
      .first()
      .waitFor();
    if (await page.locator('form[action="/api/admin/auth/begin"]').count()) {
      await page
        .locator('form[action="/api/admin/auth/begin"] button[type=submit]')
        .click();
      await page.locator("select[name=actor]").selectOption("manager");
      await page.locator("button[type=submit]").click();
    }
    await page.locator("[data-management-item]").first().waitFor();
    await page.screenshot({ path: output + "/admin-" + width + ".png" });
    console.log("admin", width, "captured");
    await context.close();
  }
} finally {
  await writeFile(
    output + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
