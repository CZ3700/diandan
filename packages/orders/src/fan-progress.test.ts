import {
  disputeStatusSchema,
  fulfillmentStatusSchema,
  orderPaymentStatusSchema,
  orderStatusSchema,
} from "@fan-support/contracts";
import { expect, test } from "vitest";

import {
  FAN_ORDER_STEPS,
  fanItemStage,
  fanOrderProgress,
  type FanOrderStage,
} from "./fan-progress.js";

const paid = {
  orderStatus: "OPEN",
  paymentStatus: "PAID",
  fulfillmentStatus: "PENDING",
  disputeStatus: "NONE",
} as const;

const every = <Value extends string>(schema: { options: readonly Value[] }) =>
  schema.options;

test("a paid order walks paid, preparing and delivered on one timeline", () => {
  for (const [fulfillmentStatus, orderStatus, stage] of [
    ["PENDING", "OPEN", "PAID"],
    ["PREPARING", "OPEN", "PREPARING"],
    ["ON_HOLD", "OPEN", "PREPARING"],
    ["DELIVERED", "OPEN", "DELIVERED"],
    ["DELIVERED", "CLOSED", "DELIVERED"],
  ] as const) {
    const progress = fanOrderProgress({
      ...paid,
      fulfillmentStatus,
      orderStatus,
    });
    expect(progress.stage).toBe(stage);
    const current = FAN_ORDER_STEPS.indexOf(stage as never);
    expect(progress.timeline.map(({ state }) => state)).toEqual(
      FAN_ORDER_STEPS.map((_, index) =>
        index < current ? "DONE" : index === current ? "CURRENT" : "UPCOMING",
      ),
    );
  }
});

test("unconfirmed payment, cancellation and a full refund leave the timeline", () => {
  for (const [change, stage] of [
    [
      { orderStatus: "PENDING_PAYMENT", paymentStatus: "PENDING" },
      "PAYMENT_PENDING",
    ],
    [
      { orderStatus: "PENDING_PAYMENT", paymentStatus: "UNPAID" },
      "PAYMENT_PENDING",
    ],
    [{ orderStatus: "CANCELED", paymentStatus: "UNPAID" }, "CANCELED"],
    [{ fulfillmentStatus: "CANCELED" }, "CANCELED"],
    [
      {
        orderStatus: "CANCELED",
        fulfillmentStatus: "CANCELED",
        paymentStatus: "REFUNDED",
      },
      "REFUNDED",
    ],
    [{ paymentStatus: "REFUNDED", fulfillmentStatus: "DELIVERED" }, "REFUNDED"],
  ] as const) {
    const progress = fanOrderProgress({ ...paid, ...change });
    expect(progress.stage).toBe(stage);
    expect(progress.timeline).toEqual([]);
  }
});

test("a partial refund keeps the timeline and adds a note", () => {
  expect(
    fanOrderProgress({
      ...paid,
      paymentStatus: "PARTIALLY_REFUNDED",
      fulfillmentStatus: "PREPARING",
    }),
  ).toMatchObject({ stage: "PREPARING", partiallyRefunded: true });
  expect(fanOrderProgress(paid).partiallyRefunded).toBe(false);
});

test("every canonical combination maps to exactly one stage, and dispute state never changes it", () => {
  const stages = new Set<FanOrderStage>();
  for (const orderStatus of every(orderStatusSchema))
    for (const paymentStatus of every(orderPaymentStatusSchema))
      for (const fulfillmentStatus of every(fulfillmentStatusSchema)) {
        const [first, ...rest] = every(disputeStatusSchema).map(
          (disputeStatus) =>
            fanOrderProgress({
              orderStatus,
              paymentStatus,
              fulfillmentStatus,
              disputeStatus,
            }),
        );
        for (const other of rest) expect(other).toEqual(first);
        stages.add(first!.stage);
        expect(first!.timeline.length === 0).toBe(
          ["PAYMENT_PENDING", "REFUNDED", "CANCELED"].includes(first!.stage),
        );
      }
  expect([...stages].sort()).toEqual([
    "CANCELED",
    "DELIVERED",
    "PAID",
    "PAYMENT_PENDING",
    "PREPARING",
    "REFUNDED",
  ]);
});

test("gift lines read a studio hold as preparing", () => {
  expect(
    every(fulfillmentStatusSchema).map((status) => [
      status,
      fanItemStage(status),
    ]),
  ).toEqual([
    ["PENDING", "AWAITING"],
    ["PREPARING", "PREPARING"],
    ["DELIVERED", "DELIVERED"],
    ["ON_HOLD", "PREPARING"],
    ["CANCELED", "CANCELED"],
  ]);
});
