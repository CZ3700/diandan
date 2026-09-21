import { AdminClientError } from "../workspace/client";
import type { OrdersContext } from "../management-orders/api";
const unavailable = (result: PromiseSettledResult<unknown>) =>
  result.status === "rejected" &&
  !(
    result.reason instanceof AdminClientError &&
    ["FORBIDDEN", "NOT_FOUND"].includes(result.reason.code)
  );
export function resolveManagementAccess(
  content: PromiseSettledResult<unknown>,
  orders: PromiseSettledResult<OrdersContext>,
) {
  return {
    contentAllowed: content.status === "fulfilled",
    orders:
      orders.status === "fulfilled" &&
      orders.value.permissions.includes("orders.read")
        ? orders.value
        : null,
    temporaryFailure: unavailable(content) || unavailable(orders),
  };
}
