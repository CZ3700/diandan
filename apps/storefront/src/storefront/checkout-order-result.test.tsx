import { expect, it } from "vitest";
import {
  currentFixture,
  checkoutFixture,
} from "../test-support/checkout-fixtures";
const load = () => import("./checkout-order-result").catch(() => null);
it("starts secure order access after applied payment, including an expired quote, without using browser claims", async () => {
  const loaded = await load();
  expect(loaded?.canOpenOrderResult).toBeTypeOf("function");
  if (!loaded) return;
  expect(
    loaded.canOpenOrderResult(checkoutFixture, currentFixture.attempt),
  ).toBe(false);
  expect(
    loaded.canOpenOrderResult(
      { ...checkoutFixture, expired: true, paymentStatus: "PAID" },
      null,
    ),
  ).toBe(true);
  expect(
    loaded.canOpenOrderResult(checkoutFixture, {
      ...currentFixture.attempt,
      status: "SUCCEEDED",
      recovery: "NONE",
    }),
  ).toBe(true);
  expect(
    loaded.canOpenOrderResult(null, {
      ...currentFixture.attempt,
      status: "SUCCEEDED",
    }),
  ).toBe(false);
});
