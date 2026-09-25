import { createHash, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

/** Only the owned TEST media certificate is exempted; no blanket TLS bypass or persisted authentication. */
export async function withAcceptanceBrowser({ gateway }, verify) {
  const certificate = new X509Certificate(
    await readFile(gateway.certificatePath),
  );
  const pin = createHash("sha256")
    .update(certificate.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      `--ignore-certificate-errors-spki-list=${pin}`,
      "--host-resolver-rules=MAP media.example.invalid 127.0.0.1",
      "--no-proxy-server",
    ],
  });
  try {
    return await verify(browser);
  } finally {
    await browser.close();
  }
}

/** Readiness smoke, deliberately independent from formal seven-locale/performance measurements. */
export async function verifyAcceptanceBrowserBaseline({
  origin,
  fixtures,
  gateway,
  check,
}) {
  return withAcceptanceBrowser({ gateway }, async (browser) => {
    const cases = [];
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({
        viewport,
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        const response = await page.goto(`${origin}/en`, {
          waitUntil: "networkidle",
        });
        check(
          response?.status() === 200,
          "compiled TEST homepage returns HTTP 200",
        );
        await page.locator("[data-artist-directory]").waitFor();
        check(
          (await page.locator("[data-artist-card]").count()) === 12,
          "homepage mounts the actual initial artist window",
        );
        const scope = new globalThis.URLSearchParams(fixtures.markets[0]);
        const gifts = await page.goto(`${origin}/en/gifts?${scope}`, {
          waitUntil: "networkidle",
        });
        check(
          gifts?.status() === 200,
          "compiled TEST gift directory returns HTTP 200",
        );
        check(
          (await page.locator("[data-gift-card]").count()) === 12,
          "gift directory mounts actual first-page data",
        );
        cases.push({ viewport, status: "PASS" });
      } finally {
        await context.close();
      }
    }
    return {
      schemaVersion: 1,
      scope: "Compiled TEST browser readiness only",
      browserVersion: browser.version(),
      cases,
      sevenLocaleAcceptance: false,
      performanceAcceptance: false,
      voiceOverEvidence: false,
    };
  });
}
