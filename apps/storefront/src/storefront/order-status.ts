import type {
  OrderAccessDetail,
  OrderAccessItem,
} from "@fan-support/contracts";
import {
  fanItemStage,
  fanOrderProgress,
  isDigitalOnlyOrder,
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
 * ADR-019: an order of only digital support gifts skips preparation and reads as a support record.
 */
export function fanOrderStatus(order: OrderAccessDetail, copy: StorefrontCopy) {
  const digitalOnly = isDigitalOnlyOrder(order.items);
  const progress = fanOrderProgress(order, { digitalOnly });
  const label = (stage: FanOrderStage) =>
    digitalOnly && stage === "DELIVERED"
      ? copy.orderDigitalDelivered
      : copy[stageLabel[stage]];
  return {
    stage: progress.stage,
    label: label(progress.stage),
    timeline: progress.timeline.map(({ step, state }) => ({
      step,
      state,
      label: label(step),
    })),
    note: progress.partiallyRefunded ? copy.orderPartiallyRefunded : null,
  };
}

/** A digital support gift is delivered as the artist's record, never prepared by the studio. */
export function orderItemStatus(
  item: Pick<OrderAccessItem, "fulfillmentStatus" | "giftKind">,
  copy: StorefrontCopy,
): string {
  const stage = fanItemStage(item.fulfillmentStatus);
  if (item.giftKind === "VIRTUAL") {
    if (stage === "DELIVERED") return copy.orderDigitalDelivered;
    if (stage !== "CANCELED") return copy.orderDigitalAwaiting;
  }
  return copy[itemLabel[stage]];
}

/** Only describe a next step when it follows from the canonical state. */
export function orderProgressHelp(
  order: OrderAccessDetail,
  copy: StorefrontCopy,
): string | null {
  const { stage } = fanOrderProgress(order);
  if (stage === "PAYMENT_PENDING") return copy.orderPaymentPending;
  if (stage === "DELIVERED")
    return isDigitalOnlyOrder(order.items)
      ? copy.orderDigitalDeliveredHelp
      : copy.orderDeliveredHelp;
  if (stage === "REFUNDED" || stage === "CANCELED") return null;
  // An open or lost chargeback makes no preparation promise, without naming the dispute.
  if (order.disputeStatus === "OPEN" || order.disputeStatus === "LOST")
    return null;
  return copy.orderPreparationHelp;
}
