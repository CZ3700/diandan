import assert from "node:assert/strict";
import test from "node:test";

test("mail browser accepts an exact genuine route and keeps credentials only in memory", async () => {
  const loaded = await import("./notification-link-browser.mjs");
  assert.equal(typeof loaded.readNotificationMailLink, "function");
  const origin = "https://storefront.example.invalid";
  const url = `${origin}/vi/order-access#token=${"A".repeat(43)}&order=71000000-0000-4000-8000-000000000001`;
  const parsed = loaded.readNotificationMailLink(
    { origin },
    {
      content: {
        html: `<a href="${url.replaceAll("&", "&amp;")}">View order</a>`,
        text: url,
      },
    },
  );
  assert.ok(
    parsed.locale === "vi" &&
      parsed.url.href === url &&
      parsed.credential.order.length === 36 &&
      parsed.credential.token.length === 43,
  );
});

test("mail browser rejects invented routes and HTML/text link drift before starting services", async () => {
  const loaded = await import("./notification-link-browser.mjs").catch(
    () => null,
  );
  assert.equal(typeof loaded?.verifyNotificationLinkBrowser, "function");
  const origin = "https://storefront.example.invalid";
  const fragment = `#token=${"A".repeat(43)}&order=71000000-0000-4000-8000-000000000001`;
  for (const [htmlUrl, textUrl] of [
    [
      `${origin}/vi/orders/exchange${fragment}`,
      `${origin}/vi/orders/exchange${fragment}`,
    ],
    [
      `${origin}/vi/order-access${fragment}`,
      `${origin}/en/order-access${fragment}`,
    ],
    [
      `https://outside.invalid/vi/order-access${fragment}`,
      `${origin}/vi/order-access${fragment}`,
    ],
  ]) {
    await assert.rejects(
      () =>
        loaded.verifyNotificationLinkBrowser({
          context: { origin },
          emailCommand: {
            content: {
              html: `<a href="${htmlUrl.replaceAll("&", "&amp;")}">View order</a>`,
              text: textUrl,
            },
          },
        }),
      { message: "NOTIFICATION_BROWSER_LINK_INVALID" },
    );
  }
});
