import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  orderAccessResponseSchema,
  orderAccessExchangeRequestSchema,
  supportedLocaleSchema,
  publicOrderIdSchema,
} from "@fan-support/contracts";
import { createPaymentRuntimeNext } from "../../api/scripts/payment-runtime-next.mjs";
import { createOrderStorefrontGateway } from "../../api/scripts/order-storefront-gateway.mjs";
import { observeOrderStorefrontPage } from "../../api/scripts/order-storefront-observer.mjs";
import { formatMinorAmount } from "../../../packages/ui/dist/format-minor-amount.js";

export function readNotificationMailLink(context, emailCommand) {
  try {
    const urls = emailCommand.content.text.match(/https:\/\/[^\s]+/gu) ?? [];
    assert.ok(urls.length === 1);
    const url = new globalThis.URL(urls[0]);
    const parts = url.pathname.split("/");
    const locale = supportedLocaleSchema.parse(parts[1]);
    const fragment = new globalThis.URLSearchParams(url.hash.slice(1));
    assert.ok([...fragment.keys()].sort().join(",") === "order,token");
    const credential = {
      ...orderAccessExchangeRequestSchema.parse({
        schemaVersion: 1,
        token: fragment.get("token"),
      }),
      order: publicOrderIdSchema.parse(fragment.get("order")),
    };
    assert.ok(
      url.origin === context.origin &&
        !url.username &&
        !url.password &&
        !url.search,
    );
    assert.ok(url.pathname === `/${locale}/order-access`);
    const hrefs = [...emailCommand.content.html.matchAll(/href="([^"]+)"/gu)];
    assert.ok(
      hrefs.length === 1 && hrefs[0][1].replaceAll("&amp;", "&") === url.href,
    );
    return { url, locale, credential };
  } catch {
    throw new Error("NOTIFICATION_BROWSER_LINK_INVALID");
  }
}

/** Click the actual transient TEST email CTA; credentials never enter artifacts. */
export async function verifyNotificationLinkBrowser({ context, emailCommand }) {
  const { url, locale, credential } = readNotificationMailLink(
    context,
    emailCommand,
  );
  const { check } = context;
  const output = path.join(context.output, "notification-link-browser");
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    actualEmail: false,
    actualPostgres: true,
    actualProductionNext: true,
    actualMailHref: true,
    locale,
    cases: [],
    screenshots: [],
    browserClosed: false,
  };
  const save = () =>
    writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const canaries = [
    ...context.canaries,
    credential.token,
    emailCommand.recipient,
  ];
  let browser, owned, observer, proxy, next;
  let stage = "PREPARE";
  try {
    const canonical = (
      await context.client.query(
        "SELECT presentation_locale,currency,total_amount_minor,order_status,payment_status,dispute_status,fulfillment_status,created_at FROM orders WHERE public_order_id=$1",
        [credential.order],
      )
    ).rows[0];
    check(
      canonical?.presentation_locale === locale,
      "Actual mail link retains the original order locale",
    );
    proxy = await createOrderStorefrontGateway({
      fallbackBase: context.proxy.origin,
      accessBase: context.accessBase,
    });
    next = createPaymentRuntimeNext({ ...context, output, proxy });
    stage = "NEXT_START";
    await next.start();
    const pins = await Promise.all(
      [
        context.gateway.certificatePath,
        ...Object.values(context.tls.certificates).map(
          (entry) => entry.certificatePath,
        ),
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
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [
        `--ignore-certificate-errors-spki-list=${pins.join(",")}`,
        "--host-resolver-rules=MAP media.example.invalid 127.0.0.1,MAP storefront.example.invalid 127.0.0.1,MAP payments.example.invalid 127.0.0.1",
        "--no-proxy-server",
      ],
    });
    owned = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const page = await owned.newPage();
    observer = await observeOrderStorefrontPage(page, { ...context, canaries });
    stage = "CLICK_MAIL_CTA";
    // No trace, screenshot, HTML snapshot or console capture is enabled here.
    await page.setContent(emailCommand.content.html);
    check(
      (await page.locator("a").getAttribute("href")) === url.href,
      "Browser clicks the exact HTML CTA that the real Worker sent",
    );
    await page.locator("a").click();
    await page.waitForURL(
      (current) =>
        current.pathname ===
        `/${locale}/orders/${credential.order.toLowerCase()}`,
      { timeout: 30000 },
    );
    const require = createRequire(
      new globalThis.URL("../../../package.json", import.meta.url),
    );
    const { default: AxeBuilder } = require("@axe-core/playwright");
    let historical;
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      stage = `DETAIL_${viewport.width}`;
      await page.setViewportSize(viewport);
      if (viewport.width === 1440)
        await page.reload({ waitUntil: "networkidle" });
      await page.locator("[data-order-detail]").waitFor({ timeout: 30000 });
      const response = await page.evaluate(async (id) => {
        const result = await globalThis.fetch(`/api/storefront/orders/${id}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        return {
          body: await result.json(),
          headers: Object.fromEntries(result.headers),
        };
      }, credential.order);
      const parsed = orderAccessResponseSchema.safeParse(response.body);
      check(
        parsed.success &&
          parsed.data.outcome === "SUCCESS" &&
          parsed.data.action === "READ",
        "Mail exchange grants a real protected order read",
      );
      const order = parsed.data.order;
      check(
        order.publicOrderId.toLowerCase() === credential.order.toLowerCase() &&
          order.presentationLocale === locale,
        "Protected response is the exact historical mail order and locale",
      );
      check(
        order.amount.currency === canonical.currency &&
          String(order.amount.totalAmountMinor) ===
            String(canonical.total_amount_minor) &&
          Date.parse(order.createdAt) ===
            new Date(canonical.created_at).getTime(),
        "Visible order matches real PostgreSQL amount, currency and creation time",
      );
      historical ??= JSON.stringify(order);
      check(
        JSON.stringify(order) === historical,
        "Viewport change and refresh preserve historical order data",
      );
      check(
        (await page.locator("html").getAttribute("lang")) === locale,
        "Rendered shell retains mail language",
      );
      check(
        (await page.locator("[data-order-line]").count()) ===
          order.items.length,
        "Every real historical order line is shown",
      );
      const total = page.locator("[data-order-total] data");
      check(
        (await total.getAttribute("value")) ===
          String(order.amount.totalAmountMinor) &&
          (await total.getAttribute("data-currency")) === order.amount.currency,
        "Actual visible total preserves exact money",
      );
      for (const [money, amount] of [
        [
          page.locator(".order-totals data").first(),
          order.amount.subtotalMinor,
        ],
        [total, order.amount.totalAmountMinor],
      ]) {
        await money.scrollIntoViewIfNeeded();
        await expect(money.locator("bdi")).toBeVisible();
        await expect(money.locator("bdi")).toHaveText(
          formatMinorAmount(amount, order.amount.currency, locale),
        );
      }
      check(true, "Subtotal and total have exact visible localized money text");
      for (const [axis, expected] of [
        ["order", canonical.order_status],
        ["payment", canonical.payment_status],
        ["dispute", canonical.dispute_status],
        ["fulfillment", canonical.fulfillment_status],
      ])
        check(
          (await page
            .locator(`[data-order-${axis}-status]`)
            .getAttribute(`data-order-${axis}-status`)) === expected,
          "Visible independent order status matches PostgreSQL",
        );
      for (const item of order.items) {
        check(
          (await page
            .getByText(item.gift.title, { exact: true })
            .first()
            .isVisible()) &&
            (await page
              .getByText(item.idol.displayName, { exact: true })
              .first()
              .isVisible()),
          "Real mail order preserves historical artist and gift names",
        );
      }
      check(
        response.headers["cache-control"]?.includes("no-store") &&
          response.headers["referrer-policy"] === "no-referrer",
        "Protected read suppresses caches and referrers",
      );
      const cookie = (await owned.cookies()).find(
        (entry) => entry.name === "__Host-fan-order",
      );
      check(
        cookie?.secure && cookie.httpOnly && cookie.sameSite === "Strict",
        "Real HTTPS exchange creates a Secure HttpOnly SameSite Strict order session",
      );
      check(
        await page.evaluate(
          () =>
            !globalThis.location.hash &&
            !globalThis.location.search &&
            globalThis.localStorage.length === 0 &&
            globalThis.sessionStorage.length === 0 &&
            !globalThis.document.cookie.includes("__Host-fan-order"),
        ),
        "Credentials are cleared from URL and absent from script-readable storage",
      );
      check(
        await page.evaluate(
          () =>
            globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
        "Actual order page honors the reduced motion preference",
      );
      await page.locator("[data-order-retry]").focus();
      await page.keyboard.press("Tab");
      check(
        await page.locator("[data-order-revoke]").evaluate((element) => {
          const style = globalThis.getComputedStyle(element);
          return (
            element === globalThis.document.activeElement &&
            ((style.outlineStyle !== "none" &&
              Number.parseFloat(style.outlineWidth) > 0) ||
              style.boxShadow !== "none")
          );
        }),
        "Keyboard reaches the revoke action with visible focus",
      );
      await page.keyboard.press("Shift+Tab");
      check(
        await page
          .locator("[data-order-retry]")
          .evaluate((element) => element === globalThis.document.activeElement),
        "Keyboard returns to refresh without consuming the mail link again",
      );
      check(
        await page
          .locator("body")
          .evaluate(
            (element, values) =>
              !values.some((value) => element.innerText.includes(value)),
            canaries,
          ),
        "Authorized screenshot contains no email, token or private fan canary",
      );
      check(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth + 1,
        ),
        "Actual order has no horizontal overflow",
      );
      await total.scrollIntoViewIfNeeded();
      await page.evaluate(async () => {
        await globalThis.document.fonts.ready;
        globalThis.document.activeElement?.blur();
        await new Promise((resolve) =>
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(resolve),
          ),
        );
      });
      const summaryName = `mail-order-${locale}-${viewport.width}-summary.png`;
      await page.screenshot({
        path: path.join(output, summaryName),
        fullPage: false,
        mask: [page.locator("input,textarea")],
      });
      report.screenshots.push(summaryName);
      await page.evaluate(() => {
        globalThis.document.activeElement?.blur();
        globalThis.scrollTo(0, 0);
      });
      const name = `mail-order-${locale}-${viewport.width}.png`;
      await page.screenshot({
        path: path.join(output, name),
        fullPage: true,
        mask: [page.locator("input,textarea")],
      });
      report.screenshots.push(name);
      const axe = await new AxeBuilder({ page }).analyze();
      check(
        axe.violations.length === 0,
        "Actual mail order has zero axe violations",
      );
      report.cases.push({
        viewport,
        reducedMotion: true,
        keyboard: true,
        visibleMoney: true,
        status: "PASS",
        axeViolations: axe.violations.length,
        axeIncomplete: axe.incomplete.length,
      });
    }
    const observations = await observer.snapshot();
    check(
      observations.fragmentEvents.some((event) => event.stage === "REPLACE") &&
        observations.fragmentEvents.some(
          (event) => event.stage === "EXCHANGE",
        ) &&
        observations.fragmentEvents.every((event) => event.cleared),
      "Actual mail fragment is removed before session exchange begins",
    );
    check(
      observations.responses.filter((entry) => entry.category === "EXCHANGE")
        .length === 1,
      "One mail click exchanges once across both viewports and refresh",
    );
    report.observations = observations;
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      stage,
      assertion: error?.name === "AssertionError",
      timeout: error?.name === "TimeoutError",
    };
    // Preserve only the allowlisted cause: Playwright errors can embed the raw mail href.
    /* eslint-disable preserve-caught-error -- A raw browser cause may disclose a one-time credential. */
    throw new Error("NOTIFICATION_LINK_BROWSER_FAILED", {
      cause: report.failure,
    });
    /* eslint-enable preserve-caught-error */
  } finally {
    observer?.dispose();
    await owned?.close();
    await browser?.close();
    report.browserClosed = true;
    await next?.stop();
    await proxy?.close();
    await save();
  }
  return report;
}
