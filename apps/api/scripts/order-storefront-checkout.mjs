import { expect } from "@playwright/test";
import { waitForOrderPayment } from "./order-payment-client.mjs";

/** Actual hosted return cannot grant an order before signed PSP evidence reaches the real worker. */
export async function verifyOrderStorefrontCheckout({
  context,
  browser,
  observe,
  capture,
  detail,
  captureFailure,
  report,
}) {
  const { payment, origin, psp, check } = context;
  const value = await payment.fresh({ locale: "en" });
  const owned = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const [name, secret] = value.session.cookie.split("=");
  await owned.addCookies([
    {
      name,
      value: secret,
      domain: new globalThis.URL(origin).hostname,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await owned.newPage();
  const observer = await observe(page);
  try {
    await page.goto(`${origin}/en/checkout`, { waitUntil: "networkidle" });
    await page.locator("[data-payment-continue]").waitFor();
    await page.locator("[data-payment-continue]").click();
    await page.waitForURL((url) => url.origin === psp.origin);
    await page.locator("[data-test-psp-capture]").click();
    await page.waitForURL(
      (url) => url.origin === origin && url.pathname === "/en/checkout/return",
    );
    await page.locator("[data-payment-state]").waitFor();
    check(
      (await payment.state(value)).payment_status === "PENDING",
      "Actual hosted browser return does not confirm payment without trusted evidence",
    );
    check(
      (await page.locator("[data-order-detail]").count()) === 0,
      "Unconfirmed payment return cannot display an authorized historical order",
    );
    await capture(page, "en-390-return-awaiting-evidence");
    const worker = await context.createOrderWorker();
    try {
      const signed = await context.signWebhook(value.attempt.id);
      check(
        (await context.sendWebhook(signed)).accepted,
        "Original signed TEST PSP webhook durably commits through the HTTP ingress",
      );
      await waitForOrderPayment(
        "Real durable event worker atomically confirms the existing order",
        async () => (await payment.state(value)).payment_status === "PAID",
        check,
      );
      await payment.assertPaid(value);
      if (await page.locator("[data-payment-refresh]").isVisible())
        await page.locator("[data-payment-refresh]").click();
      await page.waitForURL(
        (url) =>
          url.pathname === `/en/thank-you/${value.checkout.publicOrderId}`,
        { timeout: 30000 },
      );
      await expect(page.locator("[data-order-detail]")).toBeVisible();
      const response = await page.evaluate(
        async (publicOrderId) =>
          (
            await globalThis.fetch(`/api/storefront/orders/${publicOrderId}`, {
              credentials: "same-origin",
              cache: "no-store",
            })
          ).json(),
        value.checkout.publicOrderId,
      );
      check(
        response.outcome === "SUCCESS" && response.action === "READ",
        "Checkout success is authorized by the canonical order API",
      );
      await detail(page, response.order, "en");
      await capture(page, "en-390-checkout-canonical-success");
      const before = await observer.snapshot();
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("[data-order-detail]").waitFor();
      const after = await observer.snapshot();
      check(
        before.responses.filter((entry) => entry.category === "BOOTSTRAP")
          .length === 1 &&
          after.responses.filter((entry) => entry.category === "BOOTSTRAP")
            .length === 1,
        "Success reload reads its existing session without rotating or bootstrapping again",
      );
      report.cases.push({
        name: "hosted-return-signed-webhook-worker-canonical-order",
        status: "PASS",
        ...after,
      });
    } finally {
      await worker.stop();
    }
  } catch (error) {
    await captureFailure(page);
    throw error;
  } finally {
    observer.dispose();
    await owned.close();
  }
}
