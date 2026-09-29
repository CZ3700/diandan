import type { OrdersCopy } from "./copy";
import {
  fulfillmentTone,
  orderStatusLabel,
  paymentStatusLabel,
  paymentTone,
} from "./labels";

/** A labelled, colour-toned state; the words stay, the colour only speeds scanning. */
export function OrderStatus({
  kind,
  status,
  copy,
  className,
}: {
  kind: "fulfillment" | "payment";
  status: string;
  copy: OrdersCopy;
  className?: string;
}) {
  return (
    <span
      className={className ? `${className} mo-status` : "mo-status"}
      data-tone={
        kind === "payment" ? paymentTone(status) : fulfillmentTone(status)
      }
      data-status-kind={kind}
    >
      {kind === "payment"
        ? paymentStatusLabel(status, copy)
        : orderStatusLabel(status, copy)}
    </span>
  );
}
