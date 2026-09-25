import { expect, test } from "vitest";
import { checkoutFixture, id } from "./checkout-preflight.test-fixtures.js";
const modulePath = "./checkout-observation.js";
const runtime = (await import(modulePath).catch(() => ({}))) as {
  createCheckoutObservation?: (
    current: unknown,
    preflightId: string,
    quoteId: string,
    ttl: number,
  ) => {
    quote: {
      amount: {
        totalAmountMinor: number;
        taxAmountMinor: number;
        shippingAmountMinor: number;
        feeAmountMinor: number;
        discountAmountMinor: number;
      };
    };
    expiresAt: string;
    consentHash: string;
  };
};
test("server quote calculates all components and caps its lifetime to the cart", () => {
  const f = checkoutFixture();
  f.cart.expiresAt = "2026-09-08T00:01:00Z";
  expect(runtime.createCheckoutObservation).toBeTypeOf("function");
  const result = runtime.createCheckoutObservation!(
    f,
    id(200),
    id(201),
    900000,
  );
  expect(result.quote.amount).toMatchObject({
    totalAmountMinor: 500,
    taxAmountMinor: 0,
    shippingAmountMinor: 0,
    feeAmountMinor: 0,
    discountAmountMinor: 0,
  });
  expect(result.expiresAt).toBe("2026-09-08T00:01:00.000Z");
  expect(result.consentHash).toMatch(/^[a-f0-9]{64}$/u);
});
test("an old observed price cannot silently become a new accepted quote", () => {
  const f = checkoutFixture();
  f.consent.lines[0]!.observedPriceId = id(
    300,
  ) as (typeof f.consent.lines)[0]["observedPriceId"];
  expect(runtime.createCheckoutObservation).toBeTypeOf("function");
  expect(() =>
    runtime.createCheckoutObservation!(f, id(200), id(201), 900000),
  ).toThrow();
});
test("safe integer overflow and an already expired cart produce no quote", () => {
  const f = checkoutFixture();
  f.consent.lines[0]!.unitAmountMinor =
    Number.MAX_SAFE_INTEGER as (typeof f.consent.lines)[0]["unitAmountMinor"];
  expect(runtime.createCheckoutObservation).toBeTypeOf("function");
  expect(() =>
    runtime.createCheckoutObservation!(f, id(200), id(201), 900000),
  ).toThrow();
  const expired = checkoutFixture();
  expired.cart.expiresAt = "2026-09-07T00:00:00Z";
  expect(() =>
    runtime.createCheckoutObservation!(expired, id(200), id(201), 900000),
  ).toThrow();
});
