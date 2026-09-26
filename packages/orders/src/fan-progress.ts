import type { OrderAccessDetail } from "@fan-support/contracts";

/** The one timeline a fan follows: paid, then prepared, then delivered to the artist. */
export const FAN_ORDER_STEPS = Object.freeze([
  "PAID",
  "PREPARING",
  "DELIVERED",
] as const);
export type FanOrderStep = (typeof FAN_ORDER_STEPS)[number];
/** Off-timeline outcomes replace the timeline instead of joining it. */
export type FanOrderStage =
  FanOrderStep | "PAYMENT_PENDING" | "REFUNDED" | "CANCELED";
export type FanItemStage = "AWAITING" | "PREPARING" | "DELIVERED" | "CANCELED";

export type FanOrderProgress = Readonly<{
  stage: FanOrderStage;
  timeline: readonly Readonly<{
    step: FanOrderStep;
    state: "DONE" | "CURRENT" | "UPCOMING";
  }>[];
  partiallyRefunded: boolean;
}>;

type OrderAxes = Pick<
  OrderAccessDetail,
  "orderStatus" | "paymentStatus" | "fulfillmentStatus" | "disputeStatus"
>;

export type FanOrderProgressOptions = Readonly<{
  /** ADR-019: an order of only VIRTUAL gifts has no studio preparation step. */
  digitalOnly?: boolean;
}>;

/** True when every line is a VIRTUAL gift; legacy lines without a kind count as studio work. */
export function isDigitalOnlyOrder(
  items: readonly Pick<OrderAccessDetail["items"][number], "giftKind">[],
): boolean {
  return items.length > 0 && items.every((item) => item.giftKind === "VIRTUAL");
}

/**
 * Spec §12.2: the four independent axes stay canonical; fans see one friendly stage. A studio
 * review hold reads as preparing, and dispute state never reaches the fan's timeline. The
 * stage describes only the current state, never when an earlier step happened.
 */
export function fanOrderProgress(
  order: OrderAxes,
  options: FanOrderProgressOptions = {},
): FanOrderProgress {
  const stage: FanOrderStage =
    order.paymentStatus === "REFUNDED"
      ? "REFUNDED"
      : order.orderStatus === "CANCELED" ||
          order.fulfillmentStatus === "CANCELED"
        ? "CANCELED"
        : order.paymentStatus === "UNPAID" || order.paymentStatus === "PENDING"
          ? "PAYMENT_PENDING"
          : order.fulfillmentStatus === "DELIVERED"
            ? "DELIVERED"
            : order.fulfillmentStatus === "PREPARING" ||
                order.fulfillmentStatus === "ON_HOLD"
              ? "PREPARING"
              : "PAID";
  const steps: readonly FanOrderStep[] = options.digitalOnly
    ? FAN_ORDER_STEPS.filter((step) => step !== "PREPARING")
    : FAN_ORDER_STEPS;
  const current = steps.indexOf(stage as FanOrderStep);
  return Object.freeze({
    stage,
    timeline:
      current < 0
        ? []
        : steps.map((step, index) =>
            Object.freeze({
              step,
              state:
                index < current
                  ? ("DONE" as const)
                  : index === current
                    ? ("CURRENT" as const)
                    : ("UPCOMING" as const),
            }),
          ),
    partiallyRefunded: order.paymentStatus === "PARTIALLY_REFUNDED",
  });
}

/** One gift line of a paid order; a review hold reads as preparing here too. */
export function fanItemStage(
  status: OrderAccessDetail["fulfillmentStatus"],
): FanItemStage {
  switch (status) {
    case "PENDING":
      return "AWAITING";
    case "PREPARING":
    case "ON_HOLD":
      return "PREPARING";
    case "DELIVERED":
      return "DELIVERED";
    case "CANCELED":
      return "CANCELED";
  }
}
