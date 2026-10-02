import { Buffer } from "node:buffer";
import { createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  SUPPORTED_LOCALES,
  orderAccessResponseSchema,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n";

/** Observe the same factual order after each financial event; never replace API responses. */
export async function createSupportCertificateFinanceBrowser(context) {
  const { origin, gateway, tls, check } = context;
  if (new globalThis.URL(origin).hostname !== "storefront.example.invalid")
    throw new Error("CERTIFICATE_BROWSER_REQUIRES_OWNED_TEST_ORIGIN");
  const output = path.join(context.output, "browser");
  await mkdir(output, { recursive: true });
  const report = {
    status: "RUNNING",
    cases: [],
    downloads: [],
    axe: [],
    screenshots: [],
    pageErrors: 0,
    browserClosed: false,
    actualProductionNext: true,
    actualPostgres: true,
    actualPspSandbox: false,
    humanTranslationReview: false,
  };
  const save = () =>
    writeFile(
      path.join(output, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const pins = await Promise.all(
    [
      gateway.certificatePath,
      ...Object.values(tls.certificates).map((v) => v.certificatePath),
    ].map(async (file) =>
      createHash("sha256")
        .update(
          new X509Certificate(await readFile(file)).publicKey.export({
            type: "spki",
            format: "der",
          }),
        )
        .digest("base64"),
    ),
  );
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      `--ignore-certificate-errors-spki-list=${pins.join(",")}`,
      "--host-resolver-rules=MAP media.example.invalid 127.0.0.1,MAP storefront.example.invalid 127.0.0.1,MAP payments.example.invalid 127.0.0.1",
      "--no-proxy-server",
    ],
  });
  report.browserVersion = browser.version();
  const require = createRequire(
    new globalThis.URL("../../../package.json", import.meta.url),
  );
  const { default: AxeBuilder } = require("@axe-core/playwright");
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await browser.close();
    report.browserClosed = true;
    await save();
  }
  async function observe({
    stage,
    publicOrderId,
    accessSession,
    order,
    expected,
    canaries,
  }) {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      for (const locale of SUPPORTED_LOCALES) {
        const name = `${stage}-${locale}-${viewport.width}`;
        context.progress(`certificate browser ${name}`);
        const owned = await browser.newContext({
          viewport,
          reducedMotion: "reduce",
        });
        const separator = accessSession.cookie.indexOf("=");
        const credential = accessSession.cookie.slice(separator + 1);
        await owned.addCookies([
          {
            name: accessSession.cookie.slice(0, separator),
            value: credential,
            domain: new globalThis.URL(origin).hostname,
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "Strict",
          },
        ]);
        try {
          const page = await owned.newPage();
          page.setDefaultTimeout(20000);
          page.on("pageerror", () => report.pageErrors++);
          const optimized = new Set();
          page.on("response", (response) => {
            const url = new globalThis.URL(response.url());
            if (
              url.origin === origin &&
              url.pathname === "/_next/image" &&
              response.status() === 200
            )
              optimized.add(url.searchParams.get("url"));
          });
          const copy = await loadStorefrontCopy(locale);
          const inspect = async (route) => {
            const response = await page.goto(
              `${origin}/${locale}/${route}/${publicOrderId}`,
              { waitUntil: "networkidle" },
            );
            check(
              response.status() === 200 &&
                response.headers()["cache-control"]?.includes("no-store"),
              "Certificate page is real private HTML",
            );
            await expect(page.locator("[data-order-detail]")).toBeVisible();
            check(
              (await page.locator("html").getAttribute("lang")) === locale,
              "Certificate page uses requested locale",
            );
            const actual = await page.evaluate(async (id) => {
              const response = await globalThis.fetch(
                `/api/storefront/orders/${id}`,
                {
                  cache: "no-store",
                  credentials: "same-origin",
                },
              );
              return {
                status: response.status,
                cache: response.headers.get("cache-control"),
                body: await response.json(),
              };
            }, publicOrderId);
            const parsed = orderAccessResponseSchema.parse(actual.body);
            check(
              actual.status === 200 &&
                actual.cache === "private, no-store" &&
                parsed.outcome === "SUCCESS" &&
                "order" in parsed,
              "Browser re-reads actual authorized order through the BFF",
            );
            check(
              parsed.order.publicOrderId === publicOrderId &&
                parsed.order.paymentStatus === expected.paymentStatus &&
                parsed.order.disputeStatus === expected.disputeStatus,
              "Browser receives current independent financial axes for the same order",
            );
            await expect(
              page.locator("[data-support-certificate]"),
            ).toHaveCount(order.items.length);
            for (const item of order.items) {
              const card = page.locator(
                `[data-order-line="${item.position}"] [data-support-certificate]`,
              );
              const revoked = expected.revokedPositions.includes(item.position);
              const received = parsed.order.items.find(
                (candidate) => candidate.position === item.position,
              );
              check(
                received.supportCertificate.revoked === revoked &&
                  received.supportCertificate.deliveredAt ===
                    item.supportCertificate.deliveredAt,
                "Actual response retains delivery date and exact per-line revocation",
              );
              await expect(card).toHaveAttribute(
                "data-certificate-state",
                revoked ? "REVOKED" : "AVAILABLE",
              );
              await expect(card.locator("[data-certificate-save]")).toHaveCount(
                revoked ? 0 : 1,
              );
              await expect(card.locator(".order-certificate-title")).toHaveText(
                copy.orderCertificateTitle,
              );
              if (revoked)
                await expect(
                  card.locator("[data-certificate-revoked]"),
                ).toHaveText(copy.orderCertificateRevoked);
            }
            check(
              await page.evaluate(
                () =>
                  globalThis.document.documentElement.scrollWidth <=
                  globalThis.innerWidth + 1,
              ),
              "Certificate layout has no horizontal overflow",
            );
            const secrets = [
              ...(canaries ?? []),
              credential,
              accessSession.csrf,
            ].filter(Boolean);
            check(
              await page.evaluate((values) => {
                const visible =
                  globalThis.document.documentElement.outerHTML +
                  JSON.stringify([
                    Object.entries(globalThis.localStorage),
                    Object.entries(globalThis.sessionStorage),
                  ]);
                return values.every((value) => !visible.includes(value));
              }, secrets),
              "Certificate HTML and browser storage exclude private plaintext and credentials",
            );
            report.cases.push({
              stage,
              locale,
              width: viewport.width,
              route,
              revoked: expected.revokedPositions.length,
              status: "PASS",
            });
          };
          await inspect("orders");
          if (["en", "zh-CN"].includes(locale)) {
            const available = order.items.find(
              (item) => !expected.revokedPositions.includes(item.position),
            );
            if (available) {
              const card = page.locator(
                `[data-order-line="${available.position}"] [data-support-certificate]`,
              );
              const button = card.locator("[data-certificate-save]");
              await button.focus();
              await expect(button).toBeFocused();
              const bounds = await button.boundingBox();
              check(
                bounds.height >= 44 && bounds.width >= 44,
                "Certificate save button preserves touch target size",
              );
              const waiting = page.waitForEvent("download");
              await page.keyboard.press("Enter");
              const download = await waiting;
              check(
                (await download.failure()) === null,
                "Keyboard save produces an actual PNG download",
              );
              const file = `${name}-certificate.png`;
              await download.saveAs(path.join(output, file));
              const bytes = await readFile(path.join(output, file));
              check(
                bytes
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
                  bytes.readUInt32BE(16) === 1080 &&
                  bytes.readUInt32BE(20) === 1620,
                "Downloaded certificate is the current 1080 by 1620 PNG",
              );
              await expect(
                card.locator("[data-certificate-preview]"),
              ).toBeVisible();
              check(
                optimized.has(available.idol.portrait.url) &&
                  optimized.has(available.gift.image.url),
                "Artist and gift snapshot images both load through the actual same-origin optimizer",
              );
              report.downloads.push({
                stage,
                locale,
                width: viewport.width,
                file,
                sha256: createHash("sha256").update(bytes).digest("hex"),
                artistAndGiftLoaded: true,
              });
            }
            await page.screenshot({
              path: path.join(output, `${name}.png`),
              fullPage: true,
              mask: [page.locator("input,textarea")],
            });
            report.screenshots.push(`${name}.png`);
          }
          const analysis = await new AxeBuilder({ page }).analyze();
          const safe = (entries) =>
            entries.map(({ id, impact }) => ({ id, impact }));
          report.axe.push({
            name,
            violations: safe(analysis.violations),
            incomplete: safe(analysis.incomplete),
          });
          check(
            analysis.violations.length === 0,
            "Available and revoked certificate pages have zero axe violations",
          );
          if (locale === "en") await inspect("thank-you");
          await save();
        } finally {
          await owned.close();
        }
      }
    }
  }
  return {
    observe,
    close,
    async finish() {
      check(
        report.pageErrors === 0,
        "Actual certificate pages have no uncaught browser errors",
      );
      check(
        report.cases.length === SUPPORTED_LOCALES.length * 2 * 5 + 10,
        "Every financial stage has seven-language dual-viewport orders and both success views",
      );
      report.status = "PASS";
      await close();
      return report;
    },
  };
}
