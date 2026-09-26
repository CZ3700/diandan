import type {
  AdminOrdersPermission,
  AdminOrdersLine,
} from "@fan-support/contracts";
import type { DraftRow } from "./content-draft-data.js";
import { deriveFulfillmentAggregate } from "./fulfillment-aggregate.js";
import { isDigitalFulfillmentLine } from "./digital-fulfillment.js";
export function orderIsFulfillable(order: DraftRow): boolean {
  return (
    order["order_status"] === "OPEN" &&
    order["payment_status"] === "PAID" &&
    ["NONE", "WON"].includes(String(order["dispute_status"])) &&
    order["refund_pending"] !== true
  );
}
export function privateContentSafe(line: DraftRow): boolean {
  return (
    line["privacy_state"] === "ACTIVE" &&
    line["moderation_status"] !== "REJECTED" &&
    line["moderation_status"] !== "REDACTED" &&
    (!(line["has_message"] || line["has_display_name"]) ||
      line["moderation_status"] === "APPROVED")
  );
}
export function fulfillmentActions(
  order: DraftRow,
  line: DraftRow,
  permissions: AdminOrdersPermission[],
): AdminOrdersLine["allowedActions"] {
  if (
    !orderIsFulfillable(order) ||
    ["DELIVERED", "CANCELED"].includes(String(line["status"]))
  )
    return [];
  const actions: AdminOrdersLine["allowedActions"] = [];
  // ADR-019: the system delivers digital support lines; the studio only resumes a held one.
  const digital = isDigitalFulfillmentLine({
    giftKind: typeof line["gift_kind"] === "string" ? line["gift_kind"] : null,
  });
  if (
    !digital &&
    permissions.includes("orders.fulfillment") &&
    privateContentSafe(line)
  ) {
    if (line["status"] === "PENDING") actions.push("PREPARE");
    if (line["status"] === "PREPARING") actions.push("DELIVER");
  }
  if (permissions.includes("orders.manage")) {
    if (
      !digital &&
      (line["status"] === "PENDING" || line["status"] === "PREPARING")
    )
      actions.push("HOLD");
    if (
      line["status"] === "ON_HOLD" &&
      ["PENDING", "PREPARING"].includes(String(line["resume_status"])) &&
      privateContentSafe(line)
    )
      actions.push("RESUME");
  }
  return actions;
}
export function deriveAdminOrderFulfillment(lines: DraftRow[]): string {
  return deriveFulfillmentAggregate(lines.map((l) => String(l["status"])));
}
