import type { OrderAccessDetail } from "@fan-support/contracts";
import {
  fanItemStage,
  fanOrderProgress,
  type FanItemStage,
  type FanOrderStage,
} from "@fan-support/orders";
import type { StorefrontCopy } from "./copy";

const stageLabel = {
  PAYMENT_PENDING: "orderPaymentProcessing",
  PAID: "orderPaid",
  PREPARING: "orderPreparing",
  DELIVERED: "orderDelivered",
  REFUNDED: "orderRefunded",
  CANCELED: "orderCanceled",
} as const satisfies Record<FanOrderStage, keyof StorefrontCopy>;
const itemLabel = {
  AWAITING: "orderPending",
  PREPARING: "orderPreparing",
  DELIVERED: "orderDelivered",
  CANCELED: "orderCanceled",
} as const satisfies Record<FanItemStage, keyof StorefrontCopy>;

/**
 * The fan sees one stage and, while the order is on track, the paid → preparing → delivered
 * timeline. The canonical axes stay on the element for support tooling, never as text.
 */
export function fanOrderStatus(order: OrderAccessDetail, copy: StorefrontCopy) {
  const progress = fanOrderProgress(order);
  return {
    stage: progress.stage,
    label: copy[stageLabel[progress.stage]],
    timeline: progress.timeline.map(({ step, state }) => ({
      step,
      state,
      label: copy[stageLabel[step]],
    })),
    note: progress.partiallyRefunded ? copy.orderPartiallyRefunded : null,
  };
}

export function orderItemStatus(
  status: OrderAccessDetail["fulfillmentStatus"],
  copy: StorefrontCopy,
): string {
  return copy[itemLabel[fanItemStage(status)]];
}

/** Only describe a next step when it follows from the canonical state. */
export function orderProgressHelp(
  order: OrderAccessDetail,
  copy: StorefrontCopy,
): string | null {
  const { stage } = fanOrderProgress(order);
  if (stage === "PAYMENT_PENDING") return copy.orderPaymentPending;
  if (stage === "DELIVERED") return copy.orderDeliveredHelp;
  if (stage === "REFUNDED" || stage === "CANCELED") return null;
  // An open or lost chargeback makes no preparation promise, without naming the dispute.
  if (order.disputeStatus === "OPEN" || order.disputeStatus === "LOST")
    return null;
  return copy.orderPreparationHelp;
}
