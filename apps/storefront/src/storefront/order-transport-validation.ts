import {
  orderAccessRawTokenSchema,
  orderAccessResponseSchema,
  type OrderAccessFailureCode,
  type OrderAccessResponse,
} from "@fan-support/contracts";

export type OrderOperation =
  | { kind: "exchange" }
  | { kind: "bootstrap" }
  | { kind: "read"; publicOrderId: string }
  | { kind: "revoke"; publicOrderId: string };
export const orderPrivateHeaders = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
} as const;
const failureStatuses: Record<OrderAccessFailureCode, readonly number[]> = {
  INVALID_REQUEST: [400, 413],
  ACCESS_DENIED: [401, 403],
  PAYMENT_NOT_CONFIRMED: [409],
  RATE_LIMITED: [429],
  TEMPORARY_UNAVAILABLE: [503],
};
export function orderResponseBudget(operation: OrderOperation): number {
  // The archived read contract permits 500 lines with two 8192-character URLs each.
  // Other operations contain only a grant, public ID or fixed error vocabulary.
  return operation.kind === "read" ? 33_554_432 : 16_384;
}
export function checkOrderResponseHeaders(
  headers: Headers,
  maximum: number,
): void {
  if (
    !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
      headers.get("content-type") ?? "",
    ) ||
    headers.get("cache-control") !== orderPrivateHeaders["cache-control"] ||
    headers.get("referrer-policy") !== orderPrivateHeaders["referrer-policy"] ||
    headers.get("x-robots-tag") !== orderPrivateHeaders["x-robots-tag"]
  )
    throw new Error("Invalid order response headers");
  const length = headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum))
    throw new Error("Invalid order response length");
}
/** The BFF and browser apply the same fixed status/action/scope protocol. */
export function validateOrderResponse(
  value: unknown,
  status: number,
  headers: Headers,
  operation: OrderOperation,
): {
  result: OrderAccessResponse;
  csrf?: string;
  retryAfterSeconds?: number;
} {
  const result = orderAccessResponseSchema.parse(value);
  const csrf = headers.get("x-csrf-token");
  const retry = headers.get("retry-after");
  if (result.outcome === "FAILURE") {
    if (!failureStatuses[result.code].includes(status) || csrf !== null)
      throw new Error("Invalid order failure");
    if (result.code === "RATE_LIMITED") {
      if (!/^[1-9]\d{0,3}$/u.test(retry ?? "") || Number(retry) > 3600)
        throw new Error("Invalid retry delay");
      return { result, retryAfterSeconds: Number(retry) };
    }
    if (retry !== null) throw new Error("Unexpected retry delay");
    return { result };
  }
  if (status !== 200 || retry !== null)
    throw new Error("Invalid order success");
  if (operation.kind === "exchange" || operation.kind === "bootstrap") {
    if (result.action !== "GRANTED") throw new Error("Invalid order grant");
  } else if (operation.kind === "read") {
    if (
      result.action !== "READ" ||
      result.order.publicOrderId.toLowerCase() !==
        operation.publicOrderId.toLowerCase()
    )
      throw new Error("Invalid order read scope");
  } else if (
    result.action !== "REVOKED" ||
    result.publicOrderId.toLowerCase() !== operation.publicOrderId.toLowerCase()
  )
    throw new Error("Invalid order revoke scope");
  if (result.action === "REVOKED") {
    if (csrf !== null) throw new Error("Unexpected revoked credential");
    return { result };
  }
  return { result, csrf: orderAccessRawTokenSchema.parse(csrf) };
}
