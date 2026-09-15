import { expect } from "@playwright/test";
import { waitForOrderPayment } from "./order-payment-client.mjs";

export function orderReadRoute(publicOrderId) {
  if (!/^[a-f\d-]{36}$/iu.test(publicOrderId))
    throw new TypeError("Invalid TEST order ID");
  return new RegExp(`/api/storefront/orders/${publicOrderId}$`, "iu");
}

/** Real browser navigation, a discarded read, and real DB expiry exercise access lifecycle recovery. */
export async function verifyOrderStorefrontRecovery({
  context,
  browser,
  page,
  entry,
  observer,
  capture,
  detail,
  report,
}) {
  const { origin, check } = context;
  const orderPath = `/pt/orders/${entry.order.publicOrderId}`;
  context.progress("actual order read network failure and retry");
  await page.route(
    orderReadRoute(entry.order.publicOrderId),
    (route) => route.abort("failed"),
    {
      times: 1,
    },
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-order-error]").waitFor();
  check(
    (await page.locator("[data-order-detail]").count()) === 0,
    "A failed authorization read clears previously rendered order data",
  );
  await capture("pt-390-network-error");
  await page.locator("[data-order-retry]").click();
  await detail(entry.order, "pt");
  report.cases.push({
    name: "discarded-read-retry",
    status: "PASS",
    fault: "BROWSER_REQUEST_ABORT",
  });

  context.progress("actual order native Back reauthorization");
  await page.goto(`${origin}/pt/orders/lookup`, { waitUntil: "networkidle" });
  await page.locator("form[data-order-lookup]").waitFor();
  const before = await observer.snapshot();
  await page.goBack({ waitUntil: "networkidle" });
  await page.waitForURL(
    (url) => url.pathname.toLowerCase() === orderPath.toLowerCase(),
  );
  await detail(entry.order, "pt");
  const restored = await observer.snapshot();
  check(
    restored.responses.filter((item) => item.category === "READ").length >
      before.responses.filter((item) => item.category === "READ").length,
    "Native Back navigation reauthorizes the order through its actual API",
  );
  const navigation = await page.evaluate(() => ({
    type:
      globalThis.performance.getEntriesByType("navigation")[0]?.type ?? null,
    pageshow: globalThis.__orderBrowserEvidence?.().pageShows ?? [],
  }));
  report.cases.push({
    name: "native-back-reauthorization",
    status: "PASS",
    navigation,
    actualBfcacheRestoration: navigation.pageshow.some(
      (entry) => entry.persisted,
    ),
  });

  context.progress("actual new browser grant rotates the old session");
  const other = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const nextPage = await other.newPage();
    const link = await context.issue(entry);
    await nextPage.goto(
      `${origin}/pt/order-access#${new globalThis.URLSearchParams({ token: link.token, order: entry.order.publicOrderId })}`,
      { waitUntil: "networkidle" },
    );
    await nextPage.locator("[data-order-detail]").waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("[data-order-error]").waitFor();
    await expect(page.locator("[data-order-detail]")).toHaveCount(0);
    await capture("pt-390-session-rotated");
    report.cases.push({
      name: "new-browser-session-revokes-old-browser",
      status: "PASS",
    });
  } finally {
    await other.close();
  }

  context.progress("actual order link expiry");
  const expired = await context.issue(entry, 1);
  await waitForOrderPayment(
    "Actual order link expiry elapses without modifying any stored instant",
    async () =>
      (
        await context.client.query(
          "SELECT expires_at <= clock_timestamp() AS expired FROM order_access_tokens WHERE token_digest=decode($1,'hex')",
          [expired.access.tokenDigest],
        )
      ).rows[0]?.expired,
    check,
    { timeoutMs: 10000 },
  );
  await page.goto(
    `${origin}/pt/order-access#${new globalThis.URLSearchParams({ token: expired.token, order: entry.order.publicOrderId })}`,
    { waitUntil: "networkidle" },
  );
  await page.locator("[data-order-error]").waitFor();
  check(
    !new globalThis.URL(page.url()).hash &&
      (await page.locator("[data-order-detail]").count()) === 0,
    "Expired link is cleared immediately and cannot show an order",
  );
  await capture("pt-390-expired-link");
  report.cases.push({ name: "real-link-expiry", status: "PASS" });
  context.progress("actual order browser session expiry");
  const shortApi = await context.createAccessApi({
    config: { ...context.configuration, sessionTtlSeconds: 1 },
  });
  try {
    const freshLink = await context.issue(entry);
    const granted = await context.access.exchange(freshLink.token, {
      target: shortApi.base,
    });
    const [name, value] = granted.session.cookie.split("=");
    await page.context().addCookies([
      {
        name,
        value,
        domain: new globalThis.URL(origin).hostname,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Strict",
        expires: Math.floor(Date.parse(granted.data.grant.expiresAt) / 1000),
      },
    ]);
    await waitForOrderPayment(
      "Actual protected session expiry elapses without changing its deadline",
      async () =>
        (
          await context.client.query(
            "SELECT $1::timestamptz <= clock_timestamp() AS expired",
            [granted.data.grant.expiresAt],
          )
        ).rows[0]?.expired,
      check,
      { timeoutMs: 10000 },
    );
    await page.goto(origin + orderPath, { waitUntil: "networkidle" });
    await page.locator("[data-order-error]").waitFor();
    check(
      (await page.locator("[data-order-detail]").count()) === 0,
      "Expired browser order session cannot restore protected detail",
    );
    await capture("pt-390-expired-session");
    report.cases.push({ name: "real-browser-session-expiry", status: "PASS" });
  } finally {
    await shortApi.stop();
  }
}
