import { readFile, mkdir } from "node:fs/promises";
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
const pin = createHash("sha256")
  .update(
    new X509Certificate(
      await readFile(config.tls.certificatePath),
    ).publicKey.export({ type: "spki", format: "der" }),
  )
  .digest("base64");
const output = root + "/output/checks/p3-06-ui-alignment/before";
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
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(config.origins.storefront + "/zh-CN");
  await page.locator(".storefront-hero-image").waitFor();
  const height = await page
    .locator(".storefront-hero-image")
    .evaluate((x) => x.getBoundingClientRect().height);
  console.log(JSON.stringify({ heroHeight: height, maxApprovedHeight: 384 }));
  expect(height).toBeLessThanOrEqual(384);
} finally {
  await browser.close();
}
