import { randomUUID, createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { loadStorefrontCopy } from "@fan-support/i18n";
import {
  SUPPORTED_LOCALES,
  paymentRuntimeResponseSchema,
  checkoutPreflightResponseSchema,
} from "@fan-support/contracts";
import { observePaymentBrowserCart } from "./payment-runtime-browser-observer.mjs";

/** Actual compiled website → same-origin BFF → authenticated API → independently persisted TEST PSP. */
export async function verifyPaymentRuntimeBrowser(context) {
  const { origin, psp, fixtures, check, tls, gateway, client } = context;
  const output = path.join(context.output, "browser");
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    cases: [],
    screenshots: [],
    axe: [],
    pageErrors: 0,
    cartResponses: [],
    recoveryDueObservations: [],
    browserClosed: false,
    actualPspSandbox: false,
    physicalDeviceEvidence: false,
    privatePlaintextPersisted: false,
  };
  report.browserHarnessSha256 = createHash("sha256")
    .update(await readFile(new globalThis.URL(import.meta.url)))
    .digest("hex");
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
  report.browserVersion = browser.version();
  const require = createRequire(
    new globalThis.URL("../../../package.json", import.meta.url),
  );
  const { default: AxeBuilder } = require("@axe-core/playwright");
  const save = () =>
    writeFile(
      path.join(output, "browser-results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  let page,
    stage = "START",
    locale,
    width;
  const email = `test-${randomUUID()}@example.invalid`;
  async function capture(name, analyze = true) {
    await page.evaluate(() => {
      if (globalThis.document.activeElement instanceof globalThis.HTMLElement)
        globalThis.document.activeElement.blur();
      globalThis.scrollTo(0, 0);
      return new Promise((resolve) =>
        globalThis.requestAnimationFrame(resolve),
      );
    });
    check(
      !(await page
        .locator("body")
        .evaluate(
          (element, canary) => element.innerText.includes(canary),
          email,
        )),
      "Private email never enters visible page copy or screenshot text",
    );
    await page.screenshot({
      path: path.join(output, name + ".png"),
      fullPage: true,
      mask: [
        page.locator("input:not([type=checkbox]):not([type=radio]),textarea"),
      ],
    });
    report.screenshots.push(name + ".png");
    check(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth + 1,
      ),
      "Checkout has no horizontal overflow at the actual viewport",
    );
    if (analyze) {
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
        "Checkout has zero actual axe violations",
      );
    }
  }
  async function post(suffix, action, schema = paymentRuntimeResponseSchema) {
    const observed = page.waitForResponse(
      (response) =>
        new globalThis.URL(response.url()).pathname === suffix &&
        response.request().method() === "POST",
    );
    await action();
    const response = await observed;
    const parsed = schema.safeParse(await response.json());
    check(
      response.status() === 200 &&
        parsed.success &&
        parsed.data.outcome === "SUCCESS",
      "Browser mutation returns a genuine successful strict API response",
    );
    check(
      response.headers()["cache-control"] === "private, no-store",
      "Browser payment mutation remains private and uncached",
    );
    return parsed.data;
  }
  try {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      width = viewport.width;
      for (const selected of SUPPORTED_LOCALES) {
        locale = selected;
        stage = `${locale}-${width}-add`;
        const owned = await browser.newContext({
          viewport,
          reducedMotion: locale === "ja" ? "reduce" : "no-preference",
        });
        let cartObserver;
        try {
          page = await owned.newPage();
          cartObserver = observePaymentBrowserCart({
            page,
            origin,
            accept: (value) =>
              report.cartResponses.push({ locale, width, ...value }),
          });
          page.on("pageerror", () => {
            report.pageErrors++;
          });
          stage = `${locale}-${width}-empty`;
          const copy = await loadStorefrontCopy(locale);
          await page.goto(`${origin}/${locale}/checkout`, {
            waitUntil: "networkidle",
          });
          await expect(
            page.getByText(copy.checkoutEmpty, { exact: true }),
          ).toBeVisible();
          await cartObserver.settled();
          check(
            (await page
              .locator(
                "[data-checkout-error], [data-checkout-retry], [data-checkout-email]",
              )
              .count()) === 0 && (await owned.cookies()).length === 0,
            "Fresh checkout without Cookie shows its localized empty state without initializing a session or retry loop",
          );
          await expect(
            page.locator(`.checkout-back[href="/${locale}/cart"]`),
          ).toBeVisible();
          await capture(`${locale}-${width}-empty`);
          report.cases.push({
            name: "empty-checkout",
            locale,
            width,
            status: "PASS",
          });
          stage = `${locale}-${width}-add`;
          const gift = fixtures.gifts[0];
          const response = await page.goto(
            `${origin}/${locale}/gifts/${gift.handle}?${new globalThis.URLSearchParams({ ...fixtures.markets[0], idol: fixtures.artists[0].id, variant: gift.variants[0].id })}`,
            { waitUntil: "networkidle" },
          );
          check(
            response?.status() === 200,
            "Payment browser begins with the actual published gift",
          );
          await cartObserver.settled();
          await page.locator("button[data-cart-add-state]").click();
          await page
            .locator(
              '[data-cart-add-state="confirmed"], [data-cart-add-state="error"]',
            )
            .waitFor({ timeout: 15_000 });
          await cartObserver.settled();
          check(
            (await page
              .locator('[data-cart-add-state="confirmed"]')
              .count()) === 1,
            "Fresh HTTPS browser cart initializes and adds the actual available item",
          );
          const cookie = (await owned.cookies()).find(
            (entry) => entry.name === "__Host-fan-cart",
          );
          check(
            cookie?.secure &&
              cookie.httpOnly &&
              cookie.sameSite === "Lax" &&
              cookie.domain === "storefront.example.invalid",
            "Actual TLS browser establishes host-only Secure HttpOnly cart session",
          );
          await page.goto(`${origin}/${locale}/cart`, {
            waitUntil: "networkidle",
          });
          await cartObserver.settled();
          await page.locator("[data-cart-checkout]").click();
          await page.locator("[data-checkout-email]").waitFor();
          stage = `${locale}-${width}-review`;
          check(
            (await page.locator("html").getAttribute("lang")) === locale,
            "Checkout HTML uses the actual requested presentation locale",
          );
          check(
            (await page.locator("[data-checkout-line]").count()) === 1,
            "Checkout visibly reviews the actual cart item",
          );
          check(
            await page.locator("[data-checkout-confirm]").isDisabled(),
            "Explicit policy confirmation is required before checkout",
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
            "Actual checkout HTML is private and non-indexed",
          );
          await capture(`${locale}-${width}-review`);
          if (locale === "en") {
            await page.locator("[data-checkout-email]").focus();
            const visited = [];
            let prior;
            for (let step = 0; step < 6; step++) {
              if (step === 5)
                prior = await page.locator(":focus").elementHandle();
              await page.keyboard.press("Tab");
              const value = await page.evaluate(() => {
                const active = globalThis.document.activeElement;
                const style = active && globalThis.getComputedStyle(active);
                return {
                  body: active === globalThis.document.body,
                  tag: active?.tagName,
                  outline: style?.outlineStyle,
                  outlineWidth: Number.parseFloat(style?.outlineWidth ?? "0"),
                  shadow: style?.boxShadow,
                };
              });
              check(
                !value.body,
                "Checkout keyboard moves to an actual control rather than losing focus",
              );
              check(
                (value.outline !== "none" && value.outlineWidth > 0) ||
                  (value.shadow && value.shadow !== "none"),
                "Actual keyboard focus has a visible outline or shadow treatment",
              );
              visited.push(value.tag);
            }
            await page.keyboard.press("Shift+Tab");
            check(
              await page.evaluate(
                (element) => globalThis.document.activeElement === element,
                prior,
              ),
              "Shift Tab returns to the preceding actual checkout control",
            );
            await prior?.dispose();
            report.cases.push({
              name: "keyboard",
              locale,
              width,
              visited,
              nativeBrowserOnly: true,
            });
          }
          await page.locator("[data-checkout-email]").fill(email);
          for (const policy of await page
            .locator("[data-checkout-policy]")
            .all())
            await policy.check();
          const created = await post(
            "/api/storefront/checkout/sessions",
            () => page.locator("[data-checkout-confirm]").click(),
            checkoutPreflightResponseSchema,
          );
          const sessionId = created.checkout.id;
          await page.locator("[data-payment-country]").waitFor();
          check(
            (await page.locator("[data-checkout-email]").count()) === 0,
            "Confirmed checkout clears and unmounts private email",
          );
          await page.locator("[data-payment-country]").selectOption("US");
          const button = page.locator("[data-payment-create]");
          await button.waitFor();
          const unknownCase = locale === "en" && width === 390;
          if (unknownCase)
            await psp.arm({ operation: "CREATE_PAYMENT", mode: "AFTER" });
          stage = `${locale}-${width}-attempt`;
          const attempt = await post(
            `/api/storefront/checkout/sessions/${sessionId}/attempts`,
            () => button.click(),
          );
          if (unknownCase) {
            await page.locator('[data-payment-state="UNKNOWN"]').waitFor();
            check(
              (await page.locator("[data-payment-continue]").count()) === 0,
              "Unknown payment exposes recovery instead of another payable action",
            );
            await capture(`${locale}-${width}-unknown`);
            await expect
              .poll(
                async () => {
                  const {
                    rows: [value],
                  } = await client.query(
                    "SELECT phase='RECONCILE' AS reconcile,next_attempt_at<=clock_timestamp() AS due,(lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) AS lease_available FROM payment_runtime_operations WHERE attempt_id=$1",
                    [attempt.attempt.id],
                  );
                  const safe = {
                    reconcile: value?.reconcile === true,
                    due: value?.due === true,
                    leaseAvailable: value?.lease_available === true,
                  };
                  report.recoveryDueObservations.push(safe);
                  return safe.reconcile && safe.due && safe.leaseAvailable;
                },
                { timeout: 20_000, intervals: [100] },
              )
              .toBe(true);
            await page.locator("[data-payment-recover]").click();
            await expect(
              page.locator('[data-payment-state="REQUIRES_ACTION"]'),
            ).toBeVisible({ timeout: 20_000 });
          }
          await page.locator("[data-payment-continue]").waitFor();
          check(
            (await page.locator("[data-payment-test]").count()) === 1,
            "Website visibly distinguishes the isolated TEST payment",
          );
          await capture(`${locale}-${width}-ready`);
          const before = await psp.counts();
          await page.reload({ waitUntil: "networkidle" });
          await page.locator("[data-payment-continue]").waitFor();
          check(
            (await psp.counts()).payments === before.payments,
            "Page refresh restores the same attempt without a new payment",
          );
          if (locale === "en" && width === 1440) {
            const beforeLocale = await psp.counts();
            const beforeOrder = await client.query(
              "SELECT a.id,a.amount_minor::text,a.currency,a.requested_locale,o.checkout_session_id FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.id=$1",
              [attempt.attempt.id],
            );
            await page.goto(origin + "/ja/checkout", {
              waitUntil: "networkidle",
            });
            await page.locator("[data-payment-continue]").waitFor();
            check(
              (await page.locator("html").getAttribute("lang")) === "ja" &&
                (await page
                  .locator("[data-checkout-root]")
                  .getAttribute("data-checkout-session")) === sessionId,
              "Actual Japanese navigation restores the same checkout session",
            );
            const currentResponse = await page.evaluate(async () => {
              const result = await globalThis.fetch(
                "/api/storefront/checkout/current/status",
                { credentials: "same-origin", cache: "no-store" },
              );
              return result.json();
            });
            const current = paymentRuntimeResponseSchema.parse(currentResponse);
            check(
              current.action === "CURRENT" &&
                current.attempt?.id === attempt.attempt.id &&
                current.checkout.presentationLocale === "en" &&
                current.checkout.currency === created.checkout.currency &&
                current.checkout.amount.totalAmountMinor ===
                  created.checkout.amount.totalAmountMinor,
              "Locale navigation preserves exact attempt, amount, currency and frozen order language",
            );
            const afterOrder = await client.query(
              "SELECT a.id,a.amount_minor::text,a.currency,a.requested_locale,o.checkout_session_id FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.id=$1",
              [attempt.attempt.id],
            );
            const afterLocale = await psp.counts();
            check(
              JSON.stringify(beforeOrder.rows) ===
                JSON.stringify(afterOrder.rows) &&
                beforeLocale.payments === afterLocale.payments &&
                beforeLocale.createCalls === afterLocale.createCalls,
              "Actual locale navigation does not change SQL order/payment or create a PSP payment",
            );
            report.cases.push({
              name: "frozen-locale-navigation",
              from: "en",
              to: "ja",
              returnLocale: "en",
              width,
              status: "PASS",
            });
          }
          stage = `${locale}-${width}-hosted`;
          await page.locator("[data-payment-continue]").click();
          await page.waitForURL((url) => url.origin === psp.origin);
          check(
            (await page.locator("[data-test-psp-capture]").count()) === 1,
            "Explicit continue opens the real separate TEST HTTPS hosted page",
          );
          check(
            (await page.locator('input:not([type="hidden"])').count()) === 0,
            "Isolated TEST page does not collect card or wallet credentials",
          );
          await capture(`${locale}-${width}-hosted`, false);
          await page.locator("[data-test-psp-capture]").click();
          await page.waitForURL(
            (url) =>
              url.origin === origin &&
              url.pathname === `/${locale}/checkout/return`,
          );
          await page.locator("[data-payment-state]").waitFor();
          check(
            new globalThis.URL(page.url()).searchParams.get("attempt") ===
              attempt.attempt.id,
            "Actual cross-site return preserves original attempt and frozen locale",
          );
          stage = `${locale}-${width}-return`;
          const state = await client.query(
            "SELECT a.status,o.payment_status,o.order_status FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.id=$1",
            [attempt.attempt.id],
          );
          check(
            state.rows[0]?.payment_status === "PENDING" &&
              state.rows[0]?.status !== "SUCCEEDED",
            "Browser return alone never marks attempt or order paid",
          );
          await capture(`${locale}-${width}-return`);
          const storage = await page.evaluate(() => ({
            local: globalThis.localStorage.length,
            session: globalThis.sessionStorage.length,
            cookies: globalThis.document.cookie,
          }));
          check(
            storage.local === 0 &&
              storage.session === 0 &&
              !storage.cookies.includes("__Host-fan-cart"),
            "Checkout browser keeps no persistent client secrets and cannot read HttpOnly cookie",
          );
          report.cases.push({
            name: "checkout-hosted-return",
            locale,
            width,
            reducedMotion: locale === "ja",
            status: "PASS",
          });
          await save();
        } catch (error) {
          if (page && !page.isClosed())
            await page
              .screenshot({
                path: path.join(output, "failure.png"),
                fullPage: true,
                mask: [page.locator("input,textarea")],
              })
              .catch(() => undefined);
          throw error;
        } finally {
          try {
            await cartObserver?.settled();
            cartObserver?.dispose();
          } finally {
            await owned.close();
          }
        }
      }
    }
    check(
      report.pageErrors === 0,
      "All compiled checkout pages have zero uncaught runtime errors",
    );
    check(
      !report.cartResponses.some((entry) =>
        ["BODY_UNAVAILABLE", "SCHEMA_INVALID", "TRANSPORT_FAILED"].includes(
          entry.code,
        ),
      ),
      "Actual cart response bodies and strict schemas remain fully observable before browser navigation",
    );
    check(
      (await psp.observations()).every(
        (entry) => entry.unexpectedCredentials !== true,
      ),
      "Cross-site hosted browsing sends no storefront cookies or private authorization",
    );
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      stage,
      locale,
      width,
      kind: error?.name === "AssertionError" ? "ASSERTION" : "BROWSER",
    };
    if (page && !page.isClosed())
      await page
        .screenshot({
          path: path.join(output, "failure.png"),
          fullPage: true,
          mask: [page.locator("input,textarea")],
        })
        .catch(() => undefined);
    throw error;
  } finally {
    await browser.close();
    report.browserClosed = true;
    await save();
  }
  return report;
}
