import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import { expect } from "@playwright/test";
import {
  checkoutPreflightResponseSchema,
  paymentRuntimeResponseSchema,
  orderAccessResponseSchema,
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { waitForLocalGiftForm } from "./local-experience-browser-checkout.mjs";
import { assertStablePurchase } from "./regression-journey-contract.mjs";

export async function readCurrentPurchase(page) {
  const input = await page.evaluate(async () => {
    const response = await globalThis.fetch(
      "/api/storefront/checkout/current/status",
      {
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    return { status: response.status, body: await response.json() };
  });
  assert(input.status === 200, "Canonical checkout read uses successful HTTP");
  const result = paymentRuntimeResponseSchema.parse(input.body);
  assert(
    result.outcome === "SUCCESS" &&
      result.action === "CURRENT" &&
      result.attempt,
    "Current checkout and attempt are authorized",
  );
  return result;
}

export async function switchHeaderLocale(page, locale) {
  const previous = new URL(page.url());
  const expected = previous.pathname.replace(/^\/[^/]+/u, `/${locale}`);
  if (page.viewportSize().width === 390) {
    await page.locator(".storefront-mobile-menu > button").click();
    await page
      .locator(".storefront-drawer-nav [data-storefront-language] button")
      .click();
  } else {
    await page
      .locator(".storefront-desktop-language [data-storefront-language] button")
      .click();
  }
  await page
    .getByRole("menuitemradio", {
      name: LOCALE_NATIVE_NAMES[locale],
      exact: true,
    })
    .click();
  await page.waitForURL(
    (url) => url.pathname === expected && url.search === previous.search,
  );
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

export async function checkLocaleCycle({
  page,
  state,
  purchase,
  report,
  stage,
  width,
}) {
  const initial = new URL(page.url()).pathname.split("/")[1];
  const locales = [
    ...SUPPORTED_LOCALES.filter((locale) => locale !== initial),
    initial,
  ];
  for (const locale of locales) {
    await switchHeaderLocale(page, locale);
    if (stage === "CHECKOUT") {
      await page.locator("[data-payment-continue]").waitFor();
      const current = await readCurrentPurchase(page);
      assert(
        current.attempt.id === purchase.attemptId &&
          current.checkout.id === purchase.checkoutId &&
          current.checkout.presentationLocale === purchase.locale &&
          current.checkout.currency === purchase.currency &&
          current.checkout.market === purchase.market &&
          current.checkout.amount.totalAmountMinor === purchase.amountMinor,
        "Header switch keeps the authorized original checkout",
      );
    } else {
      await page.locator('[data-order-payment-status="PAID"]').waitFor();
      assert(
        (await page.locator("[data-order-public-id]").innerText()).trim() ===
          purchase.publicOrderId,
        "Header switch keeps the same order entity",
      );
    }
    assertStablePurchase(
      purchase,
      await state.purchase(purchase.publicOrderId),
    );
    report.localeSwitches.push({
      width,
      stage,
      locale,
      sameEntity: true,
      economicStateUnchanged: true,
    });
  }
}

export async function beginJourney({
  page,
  config,
  facts,
  locale,
  mark,
  capture,
}) {
  const context = new URLSearchParams(facts.commerceContext);
  context.delete("schemaVersion");
  const response = await page.goto(
    `${config.origins.storefront}/${locale}?${context}`,
    {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    },
  );
  assert(response.status() === 200, "Homepage loads");
  await page.locator("#hero-title").waitFor();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  mark("home");
  await page.locator(`[data-artist-link="${facts.artistId}"]`).click();
  await page.locator("#artist-title").waitFor();
  assert(
    new URL(page.url()).pathname === `/${locale}/idols/${facts.artistHandle}`,
    "Artist route matches chosen entity",
  );
  mark("artist");
  await page.locator(".storefront-artist-hero a.storefront-primary").click();
  await page.locator(`[data-gift-link="${facts.giftId}"]`).click();
  await waitForLocalGiftForm(page);
  const giftUrl = new URL(page.url());
  assert(
    giftUrl.pathname === `/${locale}/gifts/${facts.giftHandle}` &&
      giftUrl.searchParams.get("idol") === facts.artistId,
    "Gift journey retains the selected recipient",
  );
  mark("gift");
  const message = `PRIVATE_${randomUUID()}`;
  const displayName = `Fan ${randomUUID().slice(0, 8)}`;
  await page
    .locator("[data-cart-personalization] input[type=radio]")
    .nth(1)
    .click();
  await page.locator("[data-cart-name]").fill(displayName);
  await page.locator("[data-cart-message]").fill(message);
  await page.locator("[data-cart-message-locale]").selectOption(locale);
  await page.locator("[data-cart-add] input[type=number]").fill("2");
  await page.locator("button[data-cart-add-state]").click();
  await page.locator('[data-cart-add-state="confirmed"]').waitFor();
  await page.locator("[data-cart-trigger] > button").click();
  await page.locator(`[data-cart-drawer] a[href^="/${locale}/cart"]`).click();
  await page.locator("[data-cart-item]").waitFor();
  await expect(page.locator("[data-cart-item]")).toHaveCount(1);
  await page.locator("[data-cart-editor-open]").click();
  await page.locator("[data-cart-editor] [data-cart-name]").waitFor();
  assert(
    (await page.locator("[data-cart-editor] [data-cart-name]").inputValue()) ===
      displayName &&
      (await page
        .locator("[data-cart-editor] [data-cart-message]")
        .inputValue()) === message &&
      (await page
        .locator("[data-cart-editor] [data-cart-message-locale]")
        .inputValue()) === locale,
    "Authorized cart editor reads the submitted private context before checkout locks it",
  );
  await page.locator("[data-cart-editor-close]").click();
  mark("cart");
  await capture(page, "cart");
  await page.locator("[data-cart-checkout]").click();
  await page.locator("[data-checkout-email]").waitFor();
  await capture(page, "checkout");
  await page
    .locator("[data-checkout-email]")
    .fill(`journey-${randomUUID()}@example.test`);
  for (const policy of await page.locator("[data-checkout-policy]").all())
    await policy.check();
  const responsePromise = page.waitForResponse((value) => {
    const url = new URL(value.url());
    return (
      url.origin === config.origins.storefront &&
      url.pathname === "/api/storefront/checkout/sessions" &&
      value.request().method() === "POST"
    );
  });
  await page.locator("[data-checkout-confirm]").click();
  const checkoutResponse = await responsePromise;
  assert(checkoutResponse.status() === 200, "Browser creates a checkout");
  const result = checkoutPreflightResponseSchema.parse(
    await checkoutResponse.json(),
  );
  assert(
    result.outcome === "SUCCESS" && "checkout" in result,
    "Checkout contract accepted",
  );
  assert(
    result.checkout.presentationLocale === locale &&
      result.checkout.currency === facts.commerceContext.currency &&
      result.checkout.market === facts.commerceContext.market,
    "Checkout freezes chosen locale and commerce context",
  );
  mark("checkout");
  await page.locator("[data-payment-country]").waitFor();
  const country = await page
    .locator("[data-payment-country] option")
    .evaluateAll((options) => options.find((option) => option.value)?.value);
  assert(country, "Configured payment country exists");
  await page.locator("[data-payment-country]").selectOption(country);
  await page.locator("[data-payment-create]").first().click();
  await page.locator("[data-payment-continue]").waitFor();
  return { checkout: result.checkout };
}

export async function verifyLocalizedOrder(page, locale, purchase) {
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await page
    .locator('[data-order-payment-status="PAID"]')
    .waitFor({ timeout: 90000 });
  const value = await page.evaluate(async (id) => {
    const response = await globalThis.fetch(`/api/storefront/orders/${id}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    return response.json();
  }, purchase.publicOrderId);
  const result = orderAccessResponseSchema.parse(value);
  assert(
    result.outcome === "SUCCESS" && "order" in result,
    "Authorized order contract accepted",
  );
  const order = result.order;
  assert(
    order.publicOrderId === purchase.publicOrderId &&
      order.amount.currency === purchase.currency &&
      order.amount.totalAmountMinor === purchase.amountMinor,
    "Order retains actual amount and currency",
  );
  const price = page.locator("[data-order-total] data");
  await expect(price).toHaveAttribute("value", String(purchase.amountMinor));
  await expect(price).toHaveAttribute("lang", locale);
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: purchase.currency,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  assert(
    (await price.innerText()).trim() ===
      formatter.format(purchase.amountMinor / 10 ** digits),
    "Order money uses the selected presentation locale",
  );
  const expectedDate = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(order.createdAt));
  assert(
    (await page.locator(".order-metadata time").innerText()).trim() ===
      expectedDate,
    "Order date uses the selected presentation locale",
  );
  for (const item of order.items)
    assert(
      (
        await page
          .locator(`[data-order-quantity="${item.quantity}"]`)
          .first()
          .innerText()
      ).trim() === new Intl.NumberFormat(locale).format(item.quantity),
      "Order quantity is localized",
    );
}

export async function verifyMailAccess({
  browser,
  config,
  purchase,
  locale,
  subject,
  width,
}) {
  // A separate context proves mail access does not depend on checkout cookies.
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "reduce",
  });
  let pageErrors = 0;
  context.on("page", (page) =>
    page.on("pageerror", () => {
      pageErrors++;
    }),
  );
  try {
    const page = await context.newPage();
    await page.goto(
      `${config.origins.mail}/#token=${config.services.mail.viewerToken}`,
    );
    await page.locator('a[href="/"]').waitFor();
    const article = page
      .locator("article")
      .filter({ hasText: purchase.publicOrderId });
    await expect
      .poll(
        async () => {
          await page.reload({ waitUntil: "domcontentloaded" });
          return article.count();
        },
        { timeout: 60000, intervals: [500, 1000] },
      )
      .toBe(1);
    assert(
      (await article.locator("h2").innerText()).trim() === subject,
      "Mailbox shows the original localized notification",
    );
    const link = article.locator('a[href*="/order-access#"]');
    const destination = new URL(await link.getAttribute("href"));
    assert(
      destination.pathname === `/${locale}/order-access`,
      "Email link uses the immutable order locale",
    );
    await link.click();
    await page.locator('[data-order-payment-status="PAID"]').waitFor();
    assert(
      new URL(page.url()).hash === "",
      "Secure link token is cleared from the address",
    );
    await verifyLocalizedOrder(page, locale, purchase);
    assert(pageErrors === 0, "Independent mail access has no page errors");
  } finally {
    await context.close();
  }
}
