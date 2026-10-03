import { createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { orderAccessResponseSchema } from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n";

/** Observe factual orders during fulfillment; credentials stay in memory. */
export async function createOrderLifecycleBrowser(context) {
  const { origin, gateway, tls, check } = context;
  const output = path.join(context.output, "lifecycle-browser");
  await mkdir(output, { recursive: true });
  const report = {
    status: "RUNNING",
    cases: [],
    axe: [],
    screenshots: [],
    pageErrors: 0,
    browserClosed: false,
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
      ...Object.values(tls.certificates).map((entry) => entry.certificatePath),
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
    scenario,
    stage,
    publicOrderId,
    accessSession,
    order,
    canaries,
  }) {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      for (const locale of ["en", "zh-CN"]) {
        const name = `${scenario}-${stage}-${locale}-${viewport.width}`;
        context.progress(`lifecycle browser ${name}`);
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
          const response = await page.goto(
            `${origin}/${locale}/orders/${publicOrderId}`,
            { waitUntil: "networkidle" },
          );
          check(
            response.status() === 200 &&
              response.headers()["cache-control"]?.includes("no-store"),
            "Lifecycle order is actual private HTML",
          );
          await expect(page.locator("[data-order-detail]")).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          const copy = await loadStorefrontCopy(locale);
          const read = await page.evaluate(async (id) => {
            const result = await globalThis.fetch(
              `/api/storefront/orders/${id}`,
              { cache: "no-store", credentials: "same-origin" },
            );
            return {
              status: result.status,
              cache: result.headers.get("cache-control"),
              body: await result.json(),
            };
          }, publicOrderId);
          const parsed = orderAccessResponseSchema.parse(read.body);
          check(
            read.status === 200 &&
              read.cache === "private, no-store" &&
              parsed.outcome === "SUCCESS" &&
              "order" in parsed,
            "Lifecycle browser re-reads the authorized canonical order",
          );
          check(
            JSON.stringify(parsed.order) === JSON.stringify(order),
            "Lifecycle BFF matches the protected order snapshot at this stage",
          );
          const progress = page.locator("[data-order-timeline]");
          for (const [axis, value] of [
            ["payment", "PAID"],
            ["fulfillment", order.fulfillmentStatus],
            ["dispute", "NONE"],
          ])
            await expect(progress).toHaveAttribute(
              `data-order-${axis}-status`,
              value,
            );
          await expect(progress).toHaveAttribute(
            "data-order-stage",
            stage === "DELIVERED" ? "DELIVERED" : "PREPARING",
          );
          await expect(
            page.locator("[data-order-step='DELIVERED']"),
          ).toHaveAttribute(
            "data-step-state",
            stage === "DELIVERED" ? "CURRENT" : "UPCOMING",
          );
          await expect(page.locator("[data-order-line]")).toHaveCount(
            order.items.length,
          );
          const digital = order.items.filter(
            (item) => item.giftKind === "VIRTUAL",
          );
          await expect(page.locator("[data-support-certificate]")).toHaveCount(
            digital.length,
          );
          for (const item of order.items) {
            const line = page.locator(`[data-order-line="${item.position}"]`);
            const status = line.locator("[data-order-item-status]");
            await expect(status).toHaveAttribute(
              "data-order-item-kind",
              item.giftKind,
            );
            await expect(status).toHaveAttribute(
              "data-order-item-status",
              item.fulfillmentStatus,
            );
            const labels = {
              PENDING: copy.orderPending,
              PREPARING: copy.orderPreparing,
              ON_HOLD: copy.orderPreparing,
              DELIVERED: copy.orderDelivered,
            };
            const label =
              item.giftKind === "VIRTUAL"
                ? copy.orderDigitalDelivered
                : labels[item.fulfillmentStatus];
            await expect(status).toHaveText(label);
            if (item.giftKind === "VIRTUAL") {
              await expect(
                line.locator("[data-support-certificate]"),
              ).toHaveAttribute("data-certificate-state", "AVAILABLE");
              await expect(
                line.locator("[data-certificate-save]"),
              ).toBeVisible();
            }
          }
          const refresh = page.locator("[data-order-retry]");
          await refresh.focus();
          await expect(refresh).toBeFocused();
          const refreshed = page.waitForResponse(
            (entry) =>
              new globalThis.URL(entry.url()).pathname ===
                `/api/storefront/orders/${publicOrderId}` &&
              entry.request().method() === "GET",
          );
          await page.keyboard.press("Enter");
          check(
            (await refreshed).status() === 200,
            "Keyboard refresh safely re-reads the same order",
          );
          await expect(refresh).toBeEnabled();
          const secrets = [...canaries, credential, accessSession.csrf].filter(
            Boolean,
          );
          check(
            await page.evaluate((values) => {
              const contents =
                globalThis.document.documentElement.outerHTML +
                JSON.stringify([
                  Object.entries(globalThis.localStorage),
                  Object.entries(globalThis.sessionStorage),
                ]);
              return values.every((value) => !contents.includes(value));
            }, secrets),
            "Lifecycle HTML and storage do not contain private canaries or credentials",
          );
          check(
            await page.evaluate(
              () =>
                globalThis.document.documentElement.scrollWidth <=
                globalThis.innerWidth + 1,
            ),
            "Lifecycle layout has no horizontal overflow",
          );
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
            "Mixed and held order pages have zero axe violations",
          );
          await page.screenshot({
            path: path.join(output, `${name}.png`),
            fullPage: true,
            mask: [page.locator("input,textarea")],
          });
          report.screenshots.push(`${name}.png`);
          report.cases.push({
            scenario,
            stage,
            locale,
            width: viewport.width,
            status: "PASS",
          });
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
        report.cases.length === 24 && report.pageErrors === 0,
        "Both actual order journeys cover their six stages on two locales and both viewports without browser errors",
      );
      report.status = "PASS";
      await close();
      return report;
    },
  };
}
