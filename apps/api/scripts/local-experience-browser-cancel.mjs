import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { expect } from "@playwright/test";
import { waitForLocalGiftForm } from "./local-experience-browser-checkout.mjs";
import {
  checkoutPreflightResponseSchema,
  adminFinanceResponseSchema,
} from "@fan-support/contracts";

function financeDetail(page, config) {
  return page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === config.origins.admin &&
        url.pathname === "/api/admin/finance-detail" &&
        response.request().method() === "POST"
      );
    },
    { timeout: 30000 },
  );
}
async function readCanceled(response, check) {
  check(
    response.status() === 200,
    "Canceled order is read through actual finance BFF",
  );
  const detail = adminFinanceResponseSchema.parse(await response.json());
  check(
    detail.outcome === "SUCCESS" && detail.kind === "DETAIL",
    "Canceled order satisfies finance detail contract",
  );
  check(
    detail.order.orderStatus === "CANCELED" && !detail.canCancel,
    "Unpaid order is durably canceled",
  );
  check(
    detail.order.capturedAmountMinor === 0,
    "Canceled order has no captured funds",
  );
  return {
    publicOrderId: detail.order.publicOrderId,
    orderId: detail.order.orderId,
    orderStatus: detail.order.orderStatus,
  };
}

export async function readLocalCanceledOrder({
  admin,
  config,
  publicOrderId,
  selectOrder,
  check,
}) {
  const result = financeDetail(admin, config);
  await selectOrder(publicOrderId);
  return readCanceled(await result, check);
}

/** Cancels only the specified existing unpaid order through the normal controls. */
export async function cancelLocalExistingOrder({
  admin,
  config,
  publicOrderId,
  selectOrder,
  capture,
  check,
}) {
  await selectOrder(publicOrderId);
  await admin.locator("[data-finance-cancel]").click();
  await expect(admin.locator("[data-finance-submit]")).toBeDisabled();
  await admin.locator("[data-finance-confirm]").check();
  const changed = financeDetail(admin, config);
  await admin.locator("[data-finance-submit]").click();
  const facts = await readCanceled(await changed, check);
  await expect(admin.locator("[data-finance-cancel]")).toHaveCount(0);
  await capture(admin, "en-1440-canceled-unpaid-order");
  return facts;
}

/** Creates a second real guest checkout, then cancels it through the manager UI. */
export async function verifyLocalCancellation({
  browser,
  config,
  giftUrl,
  admin,
  selectOrder,
  navigate,
  capture,
  check,
  observeContext,
}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  observeContext(context, "cancellation");
  try {
    const page = await context.newPage();
    await navigate(page, giftUrl);
    await waitForLocalGiftForm(page);
    await page.locator("button[data-cart-add-state]").click();
    await page.locator('[data-cart-add-state="confirmed"]').waitFor();
    await navigate(page, `${config.origins.storefront}/en/cart`);
    await page.locator("[data-cart-checkout]").click();
    await page
      .locator("[data-checkout-email]")
      .fill(`cancel-${randomUUID()}@example.test`);
    for (const policy of await page.locator("[data-checkout-policy]").all())
      await policy.check();
    const created = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.origin === config.origins.storefront &&
          url.pathname === "/api/storefront/checkout/sessions" &&
          response.request().method() === "POST"
        );
      },
      { timeout: 30000 },
    );
    await page.locator("[data-checkout-confirm]").click();
    const response = await created;
    check(
      response.status() === 200,
      "Actual guest checkout creates an unpaid order",
    );
    const checkout = checkoutPreflightResponseSchema.parse(
      await response.json(),
    );
    check(
      checkout.outcome === "SUCCESS" && "checkout" in checkout,
      "Created checkout satisfies its canonical contract",
    );
    await page.locator("[data-payment-country]").waitFor();
    return await cancelLocalExistingOrder({
      admin,
      config,
      publicOrderId: checkout.checkout.publicOrderId,
      selectOrder,
      capture,
      check,
    });
  } finally {
    await context.close();
  }
}
