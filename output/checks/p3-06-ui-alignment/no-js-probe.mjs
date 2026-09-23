import { readFile, mkdir, writeFile } from "node:fs/promises";
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
const output = root + "/output/checks/p3-06-ui-alignment/no-javascript-probe";
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
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const query = new globalThis.URLSearchParams(facts.commerceContext);
  query.delete("schemaVersion");
  await page.goto(
    config.origins.storefront + "/en/gifts?" + query + "&page=2&sort=PRICE_ASC",
  );
  const node = page.locator("[data-gift-toolbar-sort]");
  const result = {
    visible: await node.isVisible(),
    ancestors: await node.evaluate((x) => {
      const result = [];
      for (let p = x; p; p = p.parentElement)
        result.push({
          tag: p.tagName,
          hidden: p.hidden,
          display: globalThis.getComputedStyle(p).display,
          visibility: globalThis.getComputedStyle(p).visibility,
          id: p.id,
        });
      return result;
    }),
  };
  await writeFile(
    output + "/report.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  await page.screenshot({ path: output + "/page.png" });
  console.log(JSON.stringify(result));
  await context.close();
} finally {
  await browser.close();
}
