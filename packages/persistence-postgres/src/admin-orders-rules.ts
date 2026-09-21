import type {
  AdminOrdersPermission,
  AdminOrdersLine,
} from "@fan-support/contracts";
import type { DraftRow } from "./content-draft-data.js";
export function orderIsFulfillable(order: DraftRow): boolean {
  return (
    order["order_status"] === "OPEN" &&
    order["payment_status"] === "PAID" &&
    order["dispute_status"] === "NONE"
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
  if (permissions.includes("orders.fulfillment") && privateContentSafe(line)) {
    if (line["status"] === "PENDING") actions.push("PREPARE");
    if (line["status"] === "PREPARING") actions.push("DELIVER");
  }
  if (permissions.includes("orders.manage")) {
    if (line["status"] === "PENDING" || line["status"] === "PREPARING")
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
  if (lines.every((l) => l["status"] === "CANCELED")) return "CANCELED";
  if (lines.every((l) => l["status"] === "DELIVERED")) return "DELIVERED";
  if (lines.some((l) => l["status"] === "ON_HOLD")) return "ON_HOLD";
  return lines.some((l) =>
    ["PREPARING", "DELIVERED"].includes(String(l["status"])),
  )
    ? "PREPARING"
    : "PENDING";
}
