import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import copy from "../../../../packages/i18n/src/storefront/en";
import {
  attemptFixture,
  reviewFixture,
} from "../test-support/checkout-fixtures";
vi.mock("server-only", () => ({}));
it("renders uncertain payment as pending confirmation and never a success or fresh-payment link", async () => {
  const loaded = await import("./payment-status").catch(() => null);
  expect(loaded?.PaymentStatus).toBeTypeOf("function");
  if (!loaded) return;
  const html = renderToStaticMarkup(
    <loaded.PaymentStatus
      attempt={attemptFixture}
      locale="en"
      copy={copy}
      busy={false}
      onRecover={() => {}}
      onRefresh={() => {}}
      onContinue={() => {}}
    />,
  );
  expect(html).toContain('data-payment-state="UNKNOWN"');
  expect(html).toContain("data-payment-recover");
  expect(html).not.toContain("data-payment-continue");
  expect(html).not.toContain("href=");
});
it("offers to continue into a provider component only when this release can launch it", async () => {
  const loaded = await import("./payment-status").catch(() => null);
  if (!loaded) throw new Error("Missing payment status");
  const render = (componentKey: string) =>
    renderToStaticMarkup(
      <loaded.PaymentStatus
        attempt={{
          ...attemptFixture,
          status: "REQUIRES_ACTION",
          recovery: "NONE",
          action: {
            schemaVersion: 1,
            type: "PROVIDER_COMPONENT",
            componentKey,
            clientToken: "A".repeat(40),
          } as never,
        }}
        locale="en"
        copy={copy}
        busy={false}
        onRecover={() => {}}
        onRefresh={() => {}}
        onContinue={() => {}}
      />,
    );
  expect(render("airwallex-hpp")).toContain("data-payment-continue");
  expect(render("paypal-buttons")).not.toContain("data-payment-continue");
});
it("reviews the exact server amount and text, with per-object lang and no private editor", async () => {
  const loaded = await import("./checkout-review").catch(() => null);
  expect(loaded?.CheckoutReview).toBeTypeOf("function");
  if (!loaded) return;
  const html = renderToStaticMarkup(
    <loaded.CheckoutReview review={reviewFixture} locale="ja" copy={copy} />,
  );
  expect(html).toContain("data-checkout-review");
  expect(html).toContain('lang="en"');
  expect(html).toContain("Artist");
  expect(html).toContain("Gift");
  expect(html).toContain("TEST terms");
  expect(html).not.toContain("<input");
  expect(html).not.toContain("PRIVATE");
});
