import type { PaymentWorkspace } from "../management-payments/api";
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
  payments?: PromiseSettledResult<PaymentWorkspace> | undefined,
) {
  return {
    contentAllowed: content.status === "fulfilled",
    orders:
      orders.status === "fulfilled" &&
      orders.value.permissions.includes("orders.read")
        ? orders.value
        : null,
    payments: payments?.status === "fulfilled" ? payments.value : null,
    temporaryFailure:
      unavailable(content) ||
      unavailable(orders) ||
      (payments !== undefined && unavailable(payments)),
  };
}
