import type { OrderAccessDetail } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";

const payment = {
  UNPAID: "orderUnpaid",
  PENDING: "orderPaymentProcessing",
  PAID: "orderPaid",
  PARTIALLY_REFUNDED: "orderPartiallyRefunded",
  REFUNDED: "orderRefunded",
} as const satisfies Record<
  OrderAccessDetail["paymentStatus"],
  keyof StorefrontCopy
>;
const fulfillment = {
  PENDING: "orderPending",
  PREPARING: "orderPreparing",
  DELIVERED: "orderDelivered",
  ON_HOLD: "orderOnHold",
  CANCELED: "orderCanceled",
} as const satisfies Record<
  OrderAccessDetail["fulfillmentStatus"],
  keyof StorefrontCopy
>;
const orderState = {
  DRAFT: "orderDraft",
  PENDING_PAYMENT: "orderAwaitingPayment",
  OPEN: "orderStateOpen",
  CLOSED: "orderClosed",
  CANCELED: "orderCanceled",
} as const satisfies Record<
  OrderAccessDetail["orderStatus"],
  keyof StorefrontCopy
>;
const dispute = {
  NONE: "orderDisputeNone",
  OPEN: "orderDisputeOpen",
  WON: "orderDisputeWon",
  LOST: "orderDisputeLost",
} as const satisfies Record<
  OrderAccessDetail["disputeStatus"],
  keyof StorefrontCopy
>;

/** Status axes stay independent; no current status is evidence of a past transition time. */
export function orderStatusRows(
  order: OrderAccessDetail,
  copy: StorefrontCopy,
) {
  return [
    {
      axis: "payment",
      state: order.paymentStatus,
      label: copy.orderPaymentLabel,
      value: copy[payment[order.paymentStatus]],
    },
    {
      axis: "fulfillment",
      state: order.fulfillmentStatus,
      label: copy.orderFulfillmentLabel,
      value: copy[fulfillment[order.fulfillmentStatus]],
    },
    {
      axis: "dispute",
      state: order.disputeStatus,
      label: copy.orderDisputeLabel,
      value: copy[dispute[order.disputeStatus]],
    },
    {
      axis: "order",
      state: order.orderStatus,
      label: copy.orderStateLabel,
      value: copy[orderState[order.orderStatus]],
    },
  ] as const;
}

export function orderItemStatus(
  status: OrderAccessDetail["fulfillmentStatus"],
  copy: StorefrontCopy,
): string {
  return copy[fulfillment[status]];
}

/** Only describe a next step when it follows from the canonical state. */
export function orderProgressHelp(
  order: OrderAccessDetail,
  copy: StorefrontCopy,
): string | null {
  if (order.fulfillmentStatus === "ON_HOLD") return copy.orderReviewHelp;
  if (order.fulfillmentStatus === "DELIVERED") return copy.orderDeliveredHelp;
  if (
    order.fulfillmentStatus === "CANCELED" ||
    order.orderStatus === "CANCELED" ||
    order.paymentStatus === "REFUNDED"
  )
    return null;
  if (order.paymentStatus === "UNPAID" || order.paymentStatus === "PENDING")
    return copy.orderPaymentPending;
  if (order.disputeStatus === "OPEN" || order.disputeStatus === "LOST")
    return null;
  return copy.orderPreparationHelp;
}
