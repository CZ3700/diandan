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
it("asks for one consent that names and links every policy, recording each policy separately", async () => {
  const loaded = await import("./checkout-form").catch(() => null);
  if (!loaded) throw new Error("Missing checkout form");
  const zh = (await import("../../../../packages/i18n/src/storefront/zh-CN"))
    .default;
  const policy = (policyKey: string, title: string) => ({
    ...reviewFixture.policies[0]!,
    policyKey,
    title,
  });
  const preflight = {
    ...reviewFixture,
    policies: [
      policy("transfer", "Transfer notice"),
      policy("privacy", "Privacy"),
      policy("refunds", "Refunds"),
      policy("terms", "Terms"),
    ],
  };
  const render = (locale: "en" | "zh-CN", catalog: typeof copy) =>
    renderToStaticMarkup(
      <loaded.CheckoutForm
        preflight={preflight as never}
        locale={locale}
        copy={catalog}
        busy={false}
        email=""
        onEmail={() => {}}
        onConfirm={() => {}}
      />,
    );
  const html = render("en", copy);
  expect(html.match(/type="checkbox"/gu)).toHaveLength(1);
  expect(html).toContain('data-checkout-policy="all"');
  for (const key of ["transfer", "privacy", "refunds", "terms"])
    expect(html).toContain(`href="#checkout-policy-${key}"`);
  expect(html.replace(/<[^>]+>/gu, "")).toContain(
    "I have read and agree to Transfer notice, Privacy, Refunds, and Terms.",
  );
  expect(html).toMatch(/data-checkout-confirm="[^"]*" disabled=""/u);
  expect(
    render("zh-CN", zh as unknown as typeof copy).replace(/<[^>]+>/gu, ""),
  ).toContain(
    "我已阅读并同意《Transfer notice》、《Privacy》、《Refunds》和《Terms》。",
  );
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
