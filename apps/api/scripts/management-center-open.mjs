import { createHash, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

/** One authenticated operator window. Credentials remain in memory/HttpOnly cookies only. */
export async function openManagementCenter({
  adminOrigin,
  gateway,
  credentials,
  configPath,
}) {
  const pins = await Promise.all(
    [
      ...new Set([
        gateway.certificatePath,
        path.join(path.dirname(configPath), "server.crt"),
      ]),
    ].map(async (filename) => {
      const certificate = new X509Certificate(await readFile(filename));
      return createHash("sha256")
        .update(certificate.publicKey.export({ type: "spki", format: "der" }))
        .digest("base64");
    }),
  );
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: [
      `--ignore-certificate-errors-spki-list=${pins.join(",")}`,
      "--host-resolver-rules=MAP media.example.invalid 127.0.0.1",
      "--no-proxy-server",
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await context.addCookies(
      ["session", "csrf"].map((name) => ({
        name: `__Host-fan-admin-${name}`,
        value: name === "session" ? credentials.token : credentials.csrf,
        domain: new globalThis.URL(adminOrigin).hostname,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Strict",
      })),
    );
    const page = await context.newPage();
    const url = `${adminOrigin}/zh-CN`;
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (response?.status() !== 200)
      throw new Error("MANAGEMENT_WINDOW_HTTP_UNAVAILABLE");
    await page
      .locator('[data-management-list="ARTISTS"]')
      .waitFor({ timeout: 45_000 });
    await page.bringToFront();
    return { url, browser, context, page, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
