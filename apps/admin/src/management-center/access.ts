import type { ExceptionsContext } from "../management-exceptions/api";
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
  exceptions?: PromiseSettledResult<ExceptionsContext> | undefined,
) {
  return {
    contentAllowed: content.status === "fulfilled",
    orders:
      orders.status === "fulfilled" &&
      orders.value.permissions.includes("orders.read")
        ? orders.value
        : null,
    payments: payments?.status === "fulfilled" ? payments.value : null,
    exceptions:
      exceptions?.status === "fulfilled" && exceptions.value.permissions.canRead
        ? exceptions.value
        : null,
    temporaryFailure:
      unavailable(content) ||
      unavailable(orders) ||
      (payments !== undefined && unavailable(payments)) ||
      (exceptions !== undefined && unavailable(exceptions)),
  };
}
export function managementSectionUnavailable(
  access: ReturnType<typeof resolveManagementAccess> | null,
  section: string,
) {
  if (!access?.temporaryFailure) return false;
  const available =
    section === "EXCEPTIONS"
      ? access.exceptions
      : section === "PAYMENTS"
        ? access.payments
        : section === "ORDERS"
          ? access.orders
          : access.contentAllowed;
  return !available;
}
