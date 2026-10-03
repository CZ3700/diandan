import { createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { LOCALE_NATIVE_NAMES } from "@fan-support/contracts";
import { captureOrderAccessBusinessState } from "./order-access-observers.mjs";
import { changeOrderAccessCatalog } from "./order-access-history.mjs";
import { verifyOrderStorefrontRecovery } from "./order-storefront-recovery.mjs";
import { verifyOrderStorefrontCheckout } from "./order-storefront-checkout.mjs";
import { observeOrderStorefrontPage } from "./order-storefront-observer.mjs";

/** Production Next plus actual PostgreSQL, S3 and TEST PSP; only failure transport is injected. */
export async function verifyOrderStorefrontBrowser(context) {
  const {
    origin,
    gateway,
    tls,
    check,
    history,
    dailyHistory,
    issue,
    canaries,
  } = context;
  const output = path.join(context.output, "browser");
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    cases: [],
    screenshots: [],
    axe: [],
    browserClosed: false,
    actualPspSandbox: false,
    physicalDeviceEvidence: false,
    humanTranslationReview: false,
  };
  const save = () =>
    writeFile(
      path.join(output, "browser-results.json"),
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
    ignoreDefaultArgs: ["--disable-back-forward-cache"],
    args: [
      `--ignore-certificate-errors-spki-list=${pins.join(",")}`,
      "--host-resolver-rules=MAP media.example.invalid 127.0.0.1,MAP storefront.example.invalid 127.0.0.1,MAP payments.example.invalid 127.0.0.1",
      "--no-proxy-server",
    ],
  });
  report.browserVersion = browser.version();
  report.browserBfcacheExplicitlyEnabled = true;
  const require = createRequire(
    new globalThis.URL("../../../package.json", import.meta.url),
  );
  const { default: AxeBuilder } = require("@axe-core/playwright");
  let page,
    stage = "START";
  async function capture(name) {
    await page.evaluate(() => {
      globalThis.document.activeElement?.blur();
      globalThis.scrollTo(0, 0);
    });
    check(
      !(await page
        .locator("body")
        .evaluate(
          (element, values) =>
            values.some((value) => element.innerText.includes(value)),
          canaries,
        )),
      "Screenshots contain no credential or private checkout canary",
    );
    check(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth + 1,
      ),
      "Order page has no horizontal overflow at its actual viewport",
    );
    await page.screenshot({
      path: path.join(output, name + ".png"),
      fullPage: true,
      mask: [page.locator("input,textarea")],
    });
    report.screenshots.push(name + ".png");
    const result = await new AxeBuilder({ page }).analyze();
    const safe = (entries) =>
      entries.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target),
      }));
    report.axe.push({
      name,
      violations: safe(result.violations),
      incomplete: safe(result.incomplete),
    });
    check(
      result.violations.length === 0,
      "Actual order page has zero axe violations",
    );
  }
  async function detail(order, locale) {
    await page.locator("[data-order-detail]").waitFor({ timeout: 20000 });
    check(
      (await page.locator("html").getAttribute("lang")) === locale,
      "Actual order shell uses the requested language",
    );
    check(
      (await page.locator("[data-order-line]").count()) === order.items.length,
      "Visible order lines retain exact historical cardinality",
    );
    check(
      (await page.locator("[data-order-number]").innerText()).trim() ===
        order.publicOrderNo &&
        !(await page.locator("[data-order-detail]").innerText()).includes(
          order.publicOrderId,
        ),
      "Visible order shows its public number and keeps the UUID internal",
    );
    const total = page.locator("[data-order-total] data");
    check(
      (await total.getAttribute("value")) ===
        String(order.amount.totalAmountMinor) &&
        (await total.getAttribute("data-currency")) === order.amount.currency,
      "Visible order total preserves exact minor amount and currency",
    );
    for (const [axis, value] of [
      ["order", order.orderStatus],
      ["payment", order.paymentStatus],
      ["dispute", order.disputeStatus],
      ["fulfillment", order.fulfillmentStatus],
    ])
      check(
        (await page
          .locator(`[data-order-${axis}-status]`)
          .getAttribute(`data-order-${axis}-status`)) === value,
        "Order progress reflects the actual independent canonical status",
      );
    const privacy = await page.evaluate(async () => {
      const response = await globalThis.fetch(globalThis.location.href, {
        cache: "no-store",
        credentials: "same-origin",
      });
      await response.body?.cancel();
      return Object.fromEntries(response.headers);
    });
    check(
      privacy["cache-control"]?.includes("no-store") &&
        privacy["referrer-policy"] === "no-referrer" &&
        privacy["x-robots-tag"]?.includes("noindex"),
      "Actual protected order HTML is private, non-indexed and suppresses referrers",
    );
    check(
      await page
        .locator("script[src]")
        .evaluateAll((elements) =>
          elements.every(
            (script) =>
              new globalThis.URL(script.src).origin ===
              globalThis.location.origin,
          ),
        ),
      "Protected order HTML loads no third-party script",
    );
    for (const item of order.items) {
      await expect(
        page.getByText(item.gift.title, { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText(item.idol.displayName, { exact: true }).first(),
      ).toBeVisible();
    }
    const images = await page
      .locator("[data-order-detail] img")
      .evaluateAll(async (elements) => {
        await Promise.all(
          elements.map((element) => element.decode().catch(() => undefined)),
        );
        return elements.map((element) => ({
          complete: element.complete,
          width: element.naturalWidth,
          source: element.currentSrc,
          alt: element.alt,
          lang: element.closest("[lang]")?.getAttribute("lang"),
        }));
      });
    check(
      images.length >= 2 &&
        images.every((image) => image.complete && image.width > 0),
      "Historical recipient and gift images decode real S3 bytes",
    );
    for (const item of order.items)
      for (const snapshot of [item.gift.image, item.idol.portrait])
        check(
          images.some(
            (image) =>
              image.source === snapshot.url && image.alt === snapshot.alt,
          ),
          "Order shows exact original historical derivative and alt after current catalog changes",
        );
    const storage = await page.evaluate(() => ({
      local: globalThis.localStorage.length,
      session: globalThis.sessionStorage.length,
      cookies: globalThis.document.cookie,
    }));
    check(
      storage.local === 0 &&
        storage.session === 0 &&
        !storage.cookies.includes("__Host-fan-order"),
      "Order authorization is not exposed in browser storage or document.cookie",
    );
    const cookie = (await page.context().cookies()).find(
      (item) => item.name === "__Host-fan-order",
    );
    check(
      cookie?.secure &&
        cookie.httpOnly &&
        cookie.sameSite === "Strict" &&
        cookie.domain === new globalThis.URL(origin).hostname &&
        cookie.path === "/",
      "Actual HTTPS order Cookie is host-only Secure HttpOnly SameSite Strict",
    );
    check(
      !new globalThis.URL(page.url()).hash &&
        !new globalThis.URL(page.url()).search,
      "Final order URL contains no fragment or query credentials",
    );
    return {
      imageCount: images.length,
      storageEmpty: true,
      secureOrderCookie: true,
    };
  }
  async function openLink(entry, locale, mode) {
    const link = await issue(entry);
    if (mode)
      context.edge.discardNextResponse(
        "/api/storefront/order-access/exchange",
        mode,
      );
    await page.goto(
      `${origin}/${locale}/order-access#${new globalThis.URLSearchParams({ token: link.token, order: entry.order.publicOrderId.toUpperCase() })}`,
      { waitUntil: "networkidle" },
    );
    await page.waitForURL(
      (url) =>
        url.pathname === `/${locale}/orders/${entry.order.publicOrderId}`,
    );
    await detail(entry.order, locale);
    return link;
  }
  async function keyboard() {
    const samples = [];
    await page.locator("[data-order-retry]").focus();
    for (const expected of [
      "[data-order-revoke]",
      ".order-page > a:last-child",
    ]) {
      await page.keyboard.press("Tab");
      const sample = await page.evaluate((selector) => {
        const element = globalThis.document.activeElement;
        const style = element && globalThis.getComputedStyle(element);
        return {
          expectedMatched: element?.matches(selector) === true,
          body: element === globalThis.document.body,
          tag: element?.tagName ?? null,
          outline: style?.outlineStyle ?? null,
          outlineWidth: Number.parseFloat(style?.outlineWidth ?? "0"),
          shadow: style?.boxShadow ?? null,
        };
      }, expected);
      samples.push(sample);
      report.keyboard = [...(report.keyboard ?? []), sample];
      await save();
      check(
        sample.expectedMatched &&
          !sample.body &&
          ((sample.outline !== "none" && sample.outlineWidth > 0) ||
            (sample.shadow && sample.shadow !== "none")),
        "Keyboard reaches the next actual order action with visible focus",
      );
    }
    await page.keyboard.press("Shift+Tab");
    check(
      await page
        .locator("[data-order-revoke]")
        .evaluate((element) => element === globalThis.document.activeElement),
      "Reverse keyboard navigation returns to the exact preceding order action",
    );
    return samples;
  }
  async function captureFailure(selected) {
    if (!selected || selected.isClosed()) return;
    const safe = await selected
      .locator("body")
      .evaluate(
        (element, values) =>
          !values.some((value) => element.innerText.includes(value)),
        canaries,
      )
      .catch(() => false);
    if (!safe) {
      report.failureScreenshotSkippedForPrivacy = true;
      return;
    }
    await selected
      .screenshot({
        path: path.join(output, "failure.png"),
        fullPage: true,
        mask: [selected.locator("input,textarea")],
      })
      .catch(() => {
        report.failureScreenshotUnavailable = true;
      });
  }
  async function switchLanguage(entry) {
    const initialCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === "__Host-fan-order",
    );
    for (const locale of ["ja", "zh-CN", "pt"]) {
      await page.locator(".storefront-desktop-language button").click();
      await page
        .getByRole("menuitemradio", {
          name: LOCALE_NATIVE_NAMES[locale],
          exact: true,
        })
        .click();
      await page.waitForURL(
        (url) =>
          url.pathname === `/${locale}/thank-you/${entry.order.publicOrderId}`,
      );
      await detail(entry.order, locale);
      const actual = await page.evaluate(
        async (id) =>
          (
            await globalThis.fetch(`/api/storefront/orders/${id}`, {
              cache: "no-store",
              credentials: "same-origin",
            })
          ).json(),
        entry.order.publicOrderId,
      );
      check(
        actual.outcome === "SUCCESS" &&
          actual.action === "READ" &&
          JSON.stringify(actual.order) === JSON.stringify(entry.order),
        "Actual header language navigation preserves exact order identity, historical snapshots, original locale and all amounts",
      );
      const cookie = (await page.context().cookies()).find(
        (value) => value.name === "__Host-fan-order",
      );
      check(
        cookie?.value === initialCookie?.value,
        "Header language selection reuses the same protected order session",
      );
      await capture(`pt-order-1440-header-${locale}`);
    }
    report.cases.push({
      name: "actual-header-language-preserves-order",
      from: "pt",
      to: ["ja", "zh-CN", "pt"],
      status: "PASS",
    });
  }

  try {
    stage = "checkout-return-canonical-order";
    await verifyOrderStorefrontCheckout({
      context,
      browser,
      report,
      observe: (selected) => observeOrderStorefrontPage(selected, context),
      capture: async (selected, name) => {
        page = selected;
        await capture(name);
      },
      captureFailure,
      detail: async (selected, order, locale) => {
        page = selected;
        return detail(order, locale);
      },
    });
    stage = "historical-catalog-normal-republish";
    report.catalogChange = await changeOrderAccessCatalog(context);
    const baseline = await captureOrderAccessBusinessState(
      context.client,
      context.psp,
    );
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      for (const entry of history) {
        const locale = entry.order.presentationLocale;
        stage = `${locale}-${viewport.width}-matrix`;
        context.progress(stage);
        const owned = await browser.newContext({
          viewport,
          reducedMotion: viewport.width === 390 ? "reduce" : "no-preference",
        });
        let observer;
        try {
          page = await owned.newPage();
          observer = await observeOrderStorefrontPage(page, context);
          await page.goto(`${origin}/${locale}/orders/lookup`, {
            waitUntil: "networkidle",
          });
          await page.locator("form[data-order-lookup]").waitFor();
          await capture(`${locale}-${viewport.width}-lookup`);
          const link = await openLink(entry, locale);
          await capture(`${locale}-${viewport.width}-history`);
          await page.goto(
            `${origin}/${locale}/thank-you/${entry.order.publicOrderId}`,
            { waitUntil: "networkidle" },
          );
          await detail(entry.order, locale);
          await capture(`${locale}-${viewport.width}-success`);
          if (locale === "en") await keyboard();
          if (locale === "pt" && viewport.width === 1440)
            await switchLanguage(entry);
          const after = await observer.snapshot();
          check(
            after.fragmentEvents.some((event) => event.stage === "REPLACE") &&
              after.fragmentEvents.some(
                (event) => event.stage === "EXCHANGE",
              ) &&
              after.fragmentEvents.every((event) => event.cleared),
            "Fragment replacement is observed before the one-time exchange starts",
          );
          check(
            after.responses.filter((entry) => entry.category === "EXCHANGE")
              .length === 1,
            "Successful fragment boot exchanges once and never rotates on detail rendering",
          );
          report.cases.push({
            name: "seven-locale-order-matrix",
            locale,
            viewport,
            reducedMotion: viewport.width === 390,
            status: "PASS",
            ...after,
          });
          // A real replay uses the original consumed link; an existing Cookie must not make it valid.
          if (locale === "en" && viewport.width === 390) {
            await page.goto(
              `${origin}/${locale}/order-access#${new globalThis.URLSearchParams({ token: link.token, order: entry.order.publicOrderId.toUpperCase() })}`,
              { waitUntil: "networkidle" },
            );
            await page.locator("[data-order-error]").waitFor();
            check(
              (await page.locator("[data-order-detail]").count()) === 0,
              "Consumed token replay never silently renews access through an existing Cookie",
            );
            await capture("en-390-token-replay");
            report.cases.push({
              name: "consumed-token-replay",
              status: "PASS",
            });
          }
          await save();
        } catch (error) {
          await captureFailure(page);
          throw error;
        } finally {
          await observer?.snapshot();
          observer?.dispose();
          await owned.close();
        }
      }
    }
    stage = "daily-language-and-response-loss";
    context.progress(stage);
    const owned = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    let observer;
    try {
      page = await owned.newPage();
      observer = await observeOrderStorefrontPage(page, context);
      await openLink(dailyHistory, "pt", "EMPTY_BODY");
      await expect(
        page.getByRole("heading", {
          name: dailyHistory.order.items[0].gift.title,
          exact: true,
        }),
      ).toHaveAttribute("lang", "zh-CN");
      await capture("pt-390-daily-original-response-loss");
      report.cases.push({
        name: "real-cookie-with-discarded-json-recovers-via-known-order",
        status: "PASS",
        injectedAt: "NEXT_RESPONSE_BODY",
        socketDisconnected: false,
        bodyDiscarded: true,
      });
      await page.goto(`${origin}/pt/orders/${history[0].order.publicOrderId}`, {
        waitUntil: "networkidle",
      });
      await page.locator("[data-order-error]").waitFor();
      check(
        (await page.locator("[data-order-detail]").count()) === 0,
        "Another order ID cannot disclose history with a differently scoped Cookie",
      );
      await capture("pt-390-cross-order-denied");
      await page.goto(`${origin}/pt/orders/lookup`, {
        waitUntil: "networkidle",
      });
      // Another order's public number cannot be located with this browser's order session.
      await page
        .locator("input[name=orderId]")
        .fill(history[0].order.publicOrderNo);
      await page.locator("[data-order-open]").click();
      await page.locator("[data-order-error]").waitFor();
      check(
        new globalThis.URL(page.url()).pathname === "/pt/orders/lookup" &&
          (await page.locator("[data-order-detail]").count()) === 0,
        "A public number of another order locates nothing without its session",
      );
      // The number as a fan reads it out: lowercase, spaced, no prefix.
      await page
        .locator("input[name=orderId]")
        .fill(
          dailyHistory.order.publicOrderNo
            .slice(3)
            .toLowerCase()
            .split("")
            .join(" "),
        );
      await page.locator("[data-order-open]").click();
      await page.waitForURL(
        (url) =>
          url.pathname === `/pt/orders/${dailyHistory.order.publicOrderId}`,
      );
      await detail(dailyHistory.order, "pt");
      await verifyOrderStorefrontRecovery({
        context,
        browser,
        page,
        entry: dailyHistory,
        observer,
        capture,
        detail,
        report,
      });
      await openLink(dailyHistory, "pt");
      context.edge.discardNextResponse(
        "/api/storefront/order-access/revoke",
        "EMPTY_BODY",
      );
      await page.locator("[data-order-revoke]").click();
      await page.locator("[data-order-error]").waitFor();
      await expect(page.locator("[data-order-detail]")).toHaveCount(0);
      await page.locator("[data-order-retry]").click();
      await page.locator("[data-order-revoked]").waitFor();
      check(
        (await page.locator("[data-order-detail]").count()) === 0,
        "Lost revocation response retry preserves the close intent and cannot reopen the order",
      );
      report.cases.push({
        name: "revocation-body-loss-retains-close-intent",
        status: "PASS",
        socketDisconnected: false,
        bodyDiscarded: true,
      });
      await page.reload({ waitUntil: "networkidle" });
      await page
        .locator("[data-order-error],form[data-order-lookup]")
        .first()
        .waitFor();
      check(
        !(await owned.cookies()).some(
          (entry) => entry.name === "__Host-fan-order",
        ),
        "Revocation removes the real browser Cookie and refresh cannot reveal old order",
      );
      await capture("pt-390-revoked");
      report.cases.push({
        name: "daily-original-lookup-cross-order-and-revoke",
        status: "PASS",
        ...(await observer.snapshot()),
      });
    } catch (error) {
      await captureFailure(page);
      throw error;
    } finally {
      observer?.dispose();
      await owned.close();
    }
    const after = await captureOrderAccessBusinessState(
      context.client,
      context.psp,
    );
    check(
      JSON.stringify(after) === JSON.stringify(baseline),
      "Order browsing, language, replay, body loss and revocation do not mutate financial, inventory, fulfillment or notification facts",
    );
    report.financialStateUnchanged = true;
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      stage,
      kind: error?.name === "AssertionError" ? "ASSERTION" : "BROWSER",
      strictLocator: error?.message?.includes("strict mode violation") === true,
      timeout: error?.name === "TimeoutError",
      callsites: [
        ...(error?.stack ?? "").matchAll(
          /order-storefront-[a-z-]+\.mjs:\d+:\d+/gu,
        ),
      ].map((match) => match[0]),
    };
    await captureFailure(page);
    throw error;
  } finally {
    await browser.close();
    report.browserClosed = true;
    await save();
  }
  return report;
}
