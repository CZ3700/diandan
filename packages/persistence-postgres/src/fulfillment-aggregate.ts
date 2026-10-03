/**
 * Order-level fulfillment status derived from its lines. Mirrors the PostgreSQL
 * assert_fulfillment_aggregate trigger exactly; both must change together.
 */
export function deriveFulfillmentAggregate(
  statuses: readonly string[],
): string {
  if (statuses.every((status) => status === "CANCELED")) return "CANCELED";
  if (statuses.every((status) => status === "DELIVERED")) return "DELIVERED";
  if (statuses.some((status) => status === "ON_HOLD")) return "ON_HOLD";
  return statuses.some(
    (status) => status === "PREPARING" || status === "DELIVERED",
  )
    ? "PREPARING"
    : "PENDING";
}
