import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { DialogProps } from "@fan-support/ui/interactions";
import type * as UiInteractions from "@fan-support/ui/interactions";
import { checkoutPreflightViewSchema } from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";
import {
  attemptFixture,
  reviewFixture,
} from "../test-support/checkout-fixtures";
vi.mock("server-only", () => ({}));
const observed = vi.hoisted(() => ({ policies: [] as DialogProps[] }));
vi.mock("@fan-support/ui/interactions", async (load) => {
  const actual = await load<typeof UiInteractions>();
  return {
    ...actual,
    Dialog: (props: DialogProps) => {
      observed.policies.push(props);
      return <actual.Dialog {...props} />;
    },
  };
});
it("offers a clear resume-payment action for an expired authorization only when the server permits recovery", async () => {
  const { PaymentStatus } = await import("./payment-status");
  const render = (recovery: "NONE" | "RECONCILE_REQUIRED") =>
    renderToStaticMarkup(
      <PaymentStatus
        attempt={{
          ...attemptFixture,
          status: "REQUIRES_ACTION",
          actionExpired: true,
          recovery,
        }}
        locale="en"
        copy={copy}
        busy={false}
        onRecover={() => {}}
        onRefresh={() => {}}
        onContinue={() => {}}
      />,
    );
  const resumable = render("RECONCILE_REQUIRED");
  expect(resumable).toContain("Resume payment");
  expect(resumable).toContain("data-payment-recover");
  expect(resumable).not.toContain("data-payment-continue");
  expect(resumable).not.toContain("href=");
  expect(render("NONE")).not.toContain("data-payment-recover=");
});
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
it("asks for one consent with separate policy-reading buttons and an explicit payment action", async () => {
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
  expect(html).not.toContain('checked=""');
  expect(html).toContain("aria-labelledby=");
  for (const key of ["transfer", "privacy", "refunds", "terms"])
    expect(html).toContain(`data-checkout-policy-link="${key}"`);
  expect(html.match(/data-overlay-trigger="dialog"/gu)).toHaveLength(4);
  expect(html).not.toContain('href="#checkout-policy-');
  for (const label of html.match(/<label\b[^>]*>[\s\S]*?<\/label>/gu) ?? [])
    expect(label).not.toContain('data-overlay-trigger="dialog"');
  expect(html.replace(/<[^>]+>/gu, "")).toContain(
    "I have read and agree to Transfer notice, Privacy, Refunds, and Terms.",
  );
  expect(html).toMatch(/data-checkout-confirm="[^"]*" disabled=""/u);
  expect(html).toContain(copy.checkoutPay);
  expect(html).not.toContain(copy.checkoutConfirm);
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
it("lists payment methods without a country question unless the country changes which methods apply", async () => {
  const loaded = await import("./payment-methods").catch(() => null);
  if (!loaded) throw new Error("Missing payment methods");
  const method = {
    schemaVersion: 1,
    id: "30000000-0000-4000-8000-000000000001",
    paymentMethod: "fake_card",
    displayName: "Pay with TEST",
    customerHint: "Test funds only",
    environment: "TEST",
    configVersion: 1,
    ruleVersion: 1,
    supportedActionTypes: ["REDIRECT"],
  };
  const view = {
    schemaVersion: 1,
    checkoutSessionId: "30000000-0000-4000-8000-000000000002",
    presentationLocale: "en",
    market: "GLOBAL",
    currency: "USD",
    amountMinor: 1500,
    countries: ["US"],
    country: "US",
    countrySelectionRequired: false,
    capabilities: [method],
  };
  const render = (capabilities: object) =>
    renderToStaticMarkup(
      <loaded.PaymentMethods
        capabilities={capabilities as never}
        locale="en"
        copy={copy}
        busy={false}
        retrying={false}
        onCountry={() => {}}
        onStart={() => {}}
        onRefresh={() => {}}
      />,
    );
  const direct = render(view);
  expect(direct).not.toContain("data-payment-country");
  expect(direct).not.toContain(copy.checkoutCountry);
  expect(direct).toContain(`data-payment-create="${method.id}"`);
  const regional = render({
    ...view,
    countries: ["TH", "US"],
    country: null,
    countrySelectionRequired: true,
    capabilities: [],
  });
  expect(regional).toContain("data-payment-country");
  expect(regional).toContain(copy.checkoutCountry);
  expect(regional).not.toContain("data-payment-create");
  expect(regional).not.toContain(copy.checkoutNoMethods);
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
  expect(html).not.toContain("TEST terms");
  expect(html).not.toContain("<details");
  expect(html).not.toContain(copy.checkoutSubtotal);
  expect(html).toContain(copy.cartTotal);
  expect(html).not.toContain("<input");
  expect(html).not.toContain("PRIVATE");
});

it("reads the exact preflight policy version in the shared dialog without fetching a newer policy", async () => {
  observed.policies = [];
  const { CheckoutForm } = await import("./checkout-form");
  const policy = {
    ...reviewFixture.policies[0]!,
    locale: "ja" as const,
    title: "Versioned conditions",
    body: "<p>Accepted revision from this preflight only.</p>",
  };
  renderToStaticMarkup(
    <CheckoutForm
      preflight={{ ...reviewFixture, policies: [policy] }}
      locale="en"
      copy={copy}
      busy={false}
      email="fan@example.test"
      onEmail={() => {}}
      onConfirm={() => {}}
    />,
  );
  const dialog = observed.policies[0];
  expect(dialog).toMatchObject({
    closeLabel: copy.close,
    description: copy.giftPolicies,
    initialFocus: "popup",
  });
  const title = renderToStaticMarkup(<>{dialog?.title}</>);
  expect(title).toContain('lang="ja"');
  expect(title).toContain(policy.title);
  const content = renderToStaticMarkup(<>{dialog?.children}</>);
  expect(content).toContain('lang="ja"');
  expect(content).toContain(policy.body);
  expect(content).not.toContain("href=");
});

it("omits a variant name that simply repeats the gift title", async () => {
  const { CheckoutReview } = await import("./checkout-review");
  const html = renderToStaticMarkup(
    <CheckoutReview
      review={{
        ...reviewFixture,
        lines: reviewFixture.lines.map((line) => ({
          ...line,
          giftVariantLabel: line.giftTitle,
        })),
      }}
      locale="en"
      copy={copy}
    />,
  );
  expect(html.match(/>Gift</gu)).toHaveLength(1);
});

it("keeps distinct variants and the amount breakdown when an actual adjustment exists", async () => {
  const { CheckoutReview } = await import("./checkout-review");
  for (const adjustment of [
    "taxAmountMinor",
    "shippingAmountMinor",
    "feeAmountMinor",
    "discountAmountMinor",
  ] as const) {
    const totalAmountMinor = adjustment === "discountAmountMinor" ? 1400 : 1600;
    const lineAdjustment =
      adjustment === "taxAmountMinor" || adjustment === "discountAmountMinor";
    const html = renderToStaticMarkup(
      <CheckoutReview
        review={checkoutPreflightViewSchema.parse({
          ...reviewFixture,
          lines: reviewFixture.lines.map((line) => ({
            ...line,
            ...(lineAdjustment
              ? { [adjustment]: 100, lineTotalMinor: totalAmountMinor }
              : {}),
          })),
          amount: {
            ...reviewFixture.amount,
            [adjustment]: 100,
            totalAmountMinor,
          },
        })}
        locale="en"
        copy={copy}
      />,
    );
    expect(html).toContain("Standard");
    expect(html).toContain(copy.checkoutSubtotal);
    expect(html).toContain(copy.cartTotal);
  }
});
