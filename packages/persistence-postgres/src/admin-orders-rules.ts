import {
  DELIVERY_PROOF_PROFILE,
  type AdminOrdersPermission,
  type AdminOrdersLine,
} from "@fan-support/contracts";
import type { DraftRow } from "./content-draft-data.js";
import { deriveFulfillmentAggregate } from "./fulfillment-aggregate.js";
import { isDigitalFulfillmentLine } from "./digital-fulfillment.js";
export function orderIsFulfillable(order: DraftRow): boolean {
  return (
    order["order_status"] === "OPEN" &&
    // A partial refund settles only its allocated lines; the other paid lines keep moving (audit TXN-03).
    ["PAID", "PARTIALLY_REFUNDED"].includes(String(order["payment_status"])) &&
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
  // A line refunded in full is how a single line is canceled; it never moves again.
  if (
    !orderIsFulfillable(order) ||
    line["refunded_in_full"] === true ||
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
/** V2 §4-6: studio photos document physical lines being prepared or delivered; digital lines never carry them. */
export function proofActions(
  line: DraftRow,
  activeProofs: number,
  permissions: AdminOrdersPermission[],
): AdminOrdersLine["proofActions"] {
  const actions: AdminOrdersLine["proofActions"] = [];
  if (
    permissions.includes("orders.fulfillment") &&
    !isDigitalFulfillmentLine({
      giftKind:
        typeof line["gift_kind"] === "string" ? line["gift_kind"] : null,
    }) &&
    ["PREPARING", "DELIVERED"].includes(String(line["status"])) &&
    activeProofs < DELIVERY_PROOF_PROFILE.maxActiveProofsPerLine
  )
    actions.push("ATTACH");
  if (permissions.includes("orders.manage") && activeProofs > 0)
    actions.push("WITHDRAW");
  return actions;
}
export function deriveAdminOrderFulfillment(lines: DraftRow[]): string {
  return deriveFulfillmentAggregate(lines.map((l) => String(l["status"])));
}
