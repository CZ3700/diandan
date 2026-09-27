import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { expect } from "@playwright/test";
import { checkoutPreflightResponseSchema } from "@fan-support/contracts";
import {
  verifyLocalizedOrder,
  readCurrentPurchase,
} from "./regression-journey-browser.mjs";
import { observeLocalBrowserPayment } from "./local-experience-browser-payment-observer.mjs";
import {
  openAccessibilityMailbox,
  settleAccessibilityOrderRoute,
} from "./accessibility-browser-tools.mjs";
import { searchAccessibilityOrder } from "./accessibility-admin-search.mjs";

async function navigate(page, url) {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  assert(
    response?.status() === 200,
    "Expected production document responds successfully",
  );
}

async function inspectHomepageControls({
  page,
  cell,
  config,
  facts,
  tools,
  report,
}) {
  const initialContext = new URL(page.url());
  const selector = page.locator("#gifts [data-gift-browse-category]");
  const category = await selector
    .locator("option")
    .evaluateAll((options) => options.find((option) => option.value)?.value);
  assert(category, "Homepage offers a real category filter");
  await tools.select(page, selector, category, "home-category");
  await tools.activate(
    page,
    page.locator('#gifts form[method="get"] button[type=submit]'),
    "home-apply-category",
  );
  await page.waitForURL((url) => url.searchParams.get("category") === category);
  await expect(
    page.locator('#gifts [data-gift-browse][data-outcome="success"]'),
  ).toBeVisible();
  await tools.select(page, selector, "", "home-clear-category");
  await tools.activate(
    page,
    page.locator('#gifts form[method="get"] button[type=submit]'),
    "home-clear-apply",
  );
  await page.waitForURL(
    (url) => (url.searchParams.get("category") ?? "") === "",
  );
  await expect(
    page.locator(`#gifts [data-gift-link="${facts.giftId}"]`),
  ).toBeVisible();
  for (const key of ["market", "currency"])
    assert(
      new URL(page.url()).searchParams.get(key) ===
        initialContext.searchParams.get(key),
      "Homepage category changes preserve the economic context",
    );
  await navigate(page, `${config.origins.storefront}/${cell.locale}?page=999`);
  await expect(
    page.locator("#gifts [data-gift-page-out-of-range]"),
  ).toBeVisible();
  const errorCell = { ...cell, id: `${cell.id}-out-of-range`, screens: [] };
  await tools.inspect(page, errorCell, "home-out-of-range");
  report.additionalScreens.push(
    ...errorCell.screens.map((screen) => ({
      scenario: errorCell.id,
      ...screen,
    })),
  );
  await tools.activate(
    page,
    page.locator("#gifts [data-gift-page-out-of-range] a"),
    "home-first-page",
  );
  await expect(
    page.locator(`#gifts [data-gift-link="${facts.giftId}"]`),
  ).toBeVisible();
  assert(
    new URL(page.url()).searchParams.get("page") === "1",
    "Out-of-range recovery reaches the actual first page",
  );
  report.homepageControls = {
    categoryGet: true,
    clearGet: true,
    outOfRangeRecovery: true,
    economicContextUnchanged: true,
    paginationNextBack: "NOT_EXERCISED_SINGLE_PUBLISHED_GIFT",
  };
  await navigate(page, `${config.origins.storefront}/${cell.locale}`);
  await expect(
    page.locator(`#gifts [data-gift-link="${facts.giftId}"]`),
  ).toBeVisible();
}

/** One fresh-cookie browse/add/checkout-form path per cell. Only one cell creates a payment. */
export async function accessibilityCustomerFlow({
  page,
  cell,
  facts,
  config,
  report,
  tools,
  state,
  purchase,
}) {
  const { locale } = cell;
  report.stage = `${cell.id}:home`;
  await navigate(page, `${config.origins.storefront}/${locale}`);
  assert(
    new URL(page.url()).search === "",
    "Homepage entry has no preselected query context",
  );
  const card = page.locator(`#gifts [data-gift-link="${facts.giftId}"]`);
  await expect(card).toBeVisible({ timeout: 60000 });
  assert(
    await page
      .locator("#artists")
      .evaluate((artists) =>
        Boolean(
          artists.compareDocumentPosition(
            globalThis.document.querySelector("#gifts"),
          ) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
    "Inline gifts follow artists in the homepage reading order",
  );
  await expect(
    page.locator('#gifts [data-gift-browse][data-outcome="success"]'),
  ).toBeVisible();
  cell.homeNoContext = true;
  await tools.inspect(page, cell, "home");
  if (cell.id === "en-mobile")
    await inspectHomepageControls({ page, cell, config, facts, tools, report });
  assert(
    !(await page.context().cookies(config.origins.storefront)).some(
      (cookie) => cookie.name === "__Host-fan-cart",
    ),
    "Anonymous homepage reading/filtering does not create a cart cookie",
  );
  cell.homeNoCartCreated = true;
  await tools.activate(page, card, "home-gift");
  await expect(
    page.locator(`[data-gift-detail="${facts.giftId}"] h1`),
  ).toBeVisible();
  await expect(page.locator(".gift-main-image img")).toBeVisible();
  assert(
    new URL(page.url()).pathname === `/${locale}/gifts/${facts.giftHandle}`,
    "Keyboard gift link opens the published product",
  );
  assert(
    !new URL(page.url()).searchParams.has("market"),
    "Gift can be read before choosing a market",
  );
  cell.giftBeforeMarket = true;
  report.stage = `${cell.id}:gift`;
  await tools.inspect(page, cell, "gift");
  // V2 §4-2: a sole published market streams the priced panel in place of the region choice.
  await expect(
    page.locator("[data-market-choices], [data-gift-purchase]").first(),
  ).toBeVisible();
  if ((await page.locator("[data-market-choices]").count()) > 0) {
    const market = page.locator(
      `[data-market-choices] [data-market="${facts.commerceContext.market}"][data-currency="${facts.commerceContext.currency}"]`,
    );
    await tools.activate(page, market, "purchase-market");
  }
  const recipient = page.locator("[data-gift-recipient-picker] button").first();
  await expect(recipient).toBeVisible();
  if (locale === "en") await tools.modal(page, recipient, "recipient-dialog");
  await tools.activate(page, recipient, "choose-recipient");
  await tools.activate(
    page,
    page.locator(`[data-recipient-option="${facts.artistId}"]`),
    "recipient",
  );
  await expect(
    page.locator(`[data-selected-recipient="${facts.artistId}"]`),
  ).toBeVisible();
  const anonymous = page
    .locator("[data-cart-personalization] input[type=radio]")
    .first();
  await tools.reach(page, anonymous, "anonymous-name");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-cart-name]")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("[data-cart-name]")).toHaveCount(0);
  if (!purchase)
    await tools.type(
      page,
      page.locator("[data-cart-message]"),
      "Accessibility TEST message",
      "private-message",
    );
  await tools.activate(
    page,
    page.locator("button[data-cart-add-state]"),
    "add-gift",
  );
  await expect(page.locator('[data-cart-add-state="confirmed"]')).toBeVisible({
    timeout: 30000,
  });
  const cartTrigger = page.locator("[data-cart-trigger] > button");
  if (locale === "en") await tools.modal(page, cartTrigger, "cart-dialog");
  await tools.activate(page, cartTrigger, "cart-open");
  await tools.activate(
    page,
    page.locator(`[data-cart-drawer] a[href^="/${locale}/cart"]`),
    "cart-page",
  );
  await expect(page.locator("[data-cart-item]")).toHaveCount(1);
  report.stage = `${cell.id}:cart`;
  await tools.inspect(page, cell, "cart");
  await tools.activate(page, page.locator("[data-cart-checkout]"), "checkout");
  await expect(page.locator("[data-checkout-email]")).toBeVisible({
    timeout: 30000,
  });
  report.stage = `${cell.id}:checkout`;
  await tools.inspect(page, cell, "checkout");
  if (purchase) {
    await tools.reach(
      page,
      page.locator("[data-checkout-email]"),
      "checkout-email",
    );
    cell.keyboard = true;
    return purchase;
  }
  for (const policy of await page.locator("[data-checkout-policy]").all())
    await tools.activate(page, policy, "checkout-policy", "Space");
  await tools.activate(
    page,
    page.locator("[data-checkout-confirm]"),
    "invalid-checkout",
  );
  const invalid = await page
    .locator("[data-checkout-email]")
    .evaluate((element) => ({
      valueMissing: element.validity.valueMissing,
      focused: globalThis.document.activeElement === element,
      named: Boolean(element.labels?.length),
      described: Boolean(
        globalThis.document.getElementById(
          element.getAttribute("aria-describedby"),
        ),
      ),
    }));
  assert(
    Object.values(invalid).every(Boolean),
    "Native required-email error focuses a named and described field",
  );
  report.validation.push({ scenario: cell.id, ...invalid });
  await tools.type(
    page,
    page.locator("[data-checkout-email]"),
    `a11y-${randomUUID()}@example.test`,
    "checkout-email",
  );
  const resultPromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        "/api/storefront/checkout/sessions" &&
      response.request().method() === "POST",
  );
  await tools.activate(
    page,
    page.locator("[data-checkout-confirm]"),
    "confirm-checkout",
  );
  const response = await resultPromise;
  assert(response.status() === 200, "Keyboard checkout creation succeeds");
  const result = checkoutPreflightResponseSchema.parse(await response.json());
  assert(
    result.outcome === "SUCCESS" && "checkout" in result,
    "Keyboard checkout satisfies the canonical contract",
  );
  // One published country: methods appear directly, without a country question.
  await expect(page.locator("[data-payment-create]").first()).toBeVisible();
  await expect(page.locator("[data-payment-country]")).toHaveCount(0);
  const observer = observeLocalBrowserPayment({
    page,
    config,
    report,
    readBodyForStage: (stage) => stage === "FIRST_PAYMENT_RETURN",
  });
  try {
    await tools.activate(
      page,
      page.locator("[data-payment-create]").first(),
      "create-payment",
    );
    await expect(page.locator("[data-payment-continue]")).toBeVisible();
    purchase = await state.purchase(result.checkout.publicOrderId);
    const current = await readCurrentPurchase(page);
    assert(
      current.attempt.id === purchase.attemptId &&
        current.attempt.status === "REQUIRES_ACTION",
      "Payment starts with canonical pending evidence",
    );
    await tools.activate(
      page,
      page.locator("[data-payment-continue]"),
      "hosted-payment",
    );
    await expect(page.locator("[data-test-psp-capture]")).toBeVisible();
    assert(
      new URL(page.url()).origin === config.origins.psp,
      "Keyboard handoff reaches the independent TEST PSP",
    );
    report.stage = "FIRST_PAYMENT_RETURN";
    await tools.activate(
      page,
      page.locator("[data-test-psp-capture]"),
      "test-psp-pay",
    );
    await verifyLocalizedOrder(page, locale, purchase);
    await observer.settled();
    assert(
      report.paymentCreates.length === 1 &&
        report.paymentReads.some(
          (entry) =>
            entry.attemptId === purchase.attemptId &&
            entry.status === "SUCCEEDED",
        ),
      "One keyboard payment reaches trusted signed confirmation",
    );
  } finally {
    observer.dispose();
  }
  cell.keyboard = true;
  report.journey.payment = true;
  return purchase;
}

/** One fresh-cookie, real keyboard activation of the single-use email capability. */
export async function accessibilityMailOrder({
  page,
  cell,
  purchase,
  config,
  tools,
  state,
  report,
}) {
  report.stage = `${cell.id}:mail-order`;
  await state.notification(
    purchase.publicOrderId,
    purchase.locale,
    purchase.amountMinor,
    purchase.currency,
  );
  await openAccessibilityMailbox(
    page,
    `${config.origins.mail}/#token=${config.services.mail.viewerToken}`,
  );
  const link = page
    .locator("article")
    .filter({
      has: page.locator(`a[href*="order=${purchase.publicOrderId}"]`),
    })
    .locator('a[href*="/order-access#"]');
  await expect(link).toHaveCount(1);
  await tools.activate(page, link, "mail-order-link");
  await settleAccessibilityOrderRoute(page, {
    origin: config.origins.storefront,
    locale: purchase.locale,
    publicOrderId: purchase.publicOrderId,
  });
  assert(
    new URL(page.url()).hash === "",
    "Possession fragment is removed after exchange",
  );
  const target = new URL(page.url());
  target.pathname = target.pathname.replace(/^\/[^/]+/u, `/${cell.locale}`);
  await navigate(page, target.href);
  await verifyLocalizedOrder(page, cell.locale, purchase);
  report.stage = `${cell.id}:order`;
  await tools.inspect(page, cell, "order");
  report.journey.mailAccess = true;
  // In-memory only. Other layout cells reuse this real short-lived authorized
  // session; they do not claim another independent exchange of this used token.
  return {
    url: page.url(),
    cookies: await page.context().cookies(config.origins.storefront),
  };
}

export async function accessibilityOrderLayout({
  page,
  cell,
  purchase,
  tools,
  report,
  session,
}) {
  await page.context().addCookies(session.cookies);
  const target = new URL(session.url);
  target.pathname = target.pathname.replace(/^\/[^/]+/u, `/${cell.locale}`);
  await navigate(page, target.href);
  await verifyLocalizedOrder(page, cell.locale, purchase);
  report.stage = `${cell.id}:order`;
  await tools.inspect(page, cell, "order");
}

export async function accessibilityAdminFlow({
  page,
  cell,
  purchase,
  config,
  report,
  tools,
}) {
  report.stage = `${cell.id}:admin-login`;
  await navigate(page, `${config.origins.admin}/${cell.locale}`);
  const login = page.locator(
    'form[action="/api/admin/auth/begin"] button[type=submit]',
  );
  await expect(login).toBeVisible({ timeout: 30000 });
  await tools.activate(page, login, "admin-login");
  await expect(page.locator("select[name=actor]")).toBeVisible();
  await tools.select(
    page,
    page.locator("select[name=actor]"),
    "manager",
    "test-identity",
  );
  await tools.activate(
    page,
    page.locator("button[type=submit]"),
    "test-identity-confirm",
  );
  await expect(
    page.locator("[data-management-section]:enabled").first(),
  ).toBeVisible({ timeout: 30000 });
  report.stage = `${cell.id}:management`;
  await tools.inspect(page, cell, "management");
  await tools.activate(
    page,
    page.locator('[data-management-section="ORDERS"]'),
    "admin-orders",
  );
  await expect(page.locator("[data-orders-search]")).toBeVisible();
  const row = await searchAccessibilityOrder({
    page,
    tools,
    publicOrderId: purchase.publicOrderId,
    report,
    cellId: cell.id,
  });
  await tools.activate(page, row, "order-detail");
  await expect(page.locator("[data-orders-detail]")).toBeVisible();
  await expect(page.locator("[data-finance-panel]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  if (!report.journey.fulfillment) {
    report.stage = `${cell.id}:message-review`;
    await tools.activate(
      page,
      page.locator("[data-message-open]").first(),
      "message-review",
    );
    await expect(page.locator("[data-private-content]")).toBeVisible();
    await tools.activate(
      page,
      page.locator("[data-message-confirm]"),
      "confirm-review-language",
      "Space",
    );
    await tools.activate(
      page,
      page.locator("[data-message-approve]"),
      "approve-message",
    );
    await expect(page.locator("[data-private-content]")).toHaveCount(0);
    await expect(page.locator("[data-order-prepare]").first()).toBeEnabled();
    await tools.activate(
      page,
      page.locator("[data-order-prepare]").first(),
      "prepare-gift",
    );
    await expect(page.locator("[data-order-deliver]").first()).toBeEnabled();
    await tools.activate(
      page,
      page.locator("[data-order-deliver]").first(),
      "deliver-gift",
    );
    await expect(page.locator('[data-proof-panel="DELIVER"]')).toBeVisible();
    await tools.inspect(page, cell, "delivery-panel");
    await tools.activate(
      page,
      page.locator('[data-proof-submit="DELIVER"]'),
      "confirm-delivery",
    );
    await expect(page.locator("[data-proof-panel]")).toHaveCount(0);
    await expect(page.locator("[data-order-deliver]")).toHaveCount(0);
    await expect(page.locator("[data-orders-workspace]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator("[data-orders-detail]")).toBeVisible();
    await expect(page.locator("[data-finance-panel]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator("[data-order-deliver]")).toHaveCount(0);
    report.journey.fulfillment = true;
  }
  report.stage = `${cell.id}:operations`;
  await tools.inspect(page, cell, "operations");
}
