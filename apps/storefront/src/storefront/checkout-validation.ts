import {
  cartRuntimeCurrentResponseSchema,
  checkoutPreflightResponseSchema,
  paymentRuntimeResponseSchema,
} from "@fan-support/contracts";
import type { CheckoutCall } from "./checkout-transport";
const same = (left: string, right?: string) =>
  right === undefined || left.toLowerCase() === right.toLowerCase();
function responseSchema(kind: CheckoutCall["kind"]) {
  if (kind === "cart") return cartRuntimeCurrentResponseSchema;
  if (["validate", "create", "session"].includes(kind))
    return checkoutPreflightResponseSchema;
  return paymentRuntimeResponseSchema;
}
export function validateCheckoutReply(data: unknown, call: CheckoutCall) {
  const result = responseSchema(call.kind).parse(data);
  if (result.outcome === "FAILURE") return result;
  let valid = false;
  switch (call.kind) {
    case "current":
      valid = result.action === "CURRENT" || result.action === "EMPTY";
      break;
    case "cart":
      valid =
        result.action === "READ" &&
        "cart" in result &&
        result.cart.presentationLocale === call.locale;
      break;
    case "validate":
      valid =
        result.action === "VALIDATED" &&
        result.preflight.presentationLocale === call.locale &&
        result.preflight.cartVersion === call.cartVersion;
      break;
    case "create":
      valid =
        ["CREATED", "REPLAYED"].includes(result.action) && "checkout" in result;
      break;
    case "session":
      valid =
        result.action === "READ" &&
        "checkout" in result &&
        same(result.checkout.id, call.sessionId);
      break;
    case "capabilities":
      valid =
        result.action === "CAPABILITIES" &&
        same(result.capabilities.checkoutSessionId, call.sessionId) &&
        result.capabilities.presentationLocale === call.locale;
      break;
    case "attempt-create":
    case "attempt":
    case "recover": {
      const actions =
        call.kind === "attempt-create"
          ? ["CREATED", "REPLAYED"]
          : call.kind === "recover"
            ? ["RECOVERED", "REPLAYED"]
            : ["READ"];
      valid =
        actions.includes(result.action) &&
        "attempt" in result &&
        result.attempt !== null &&
        same(result.attempt.checkoutSessionId, call.sessionId) &&
        same(result.attempt.id, call.attemptId);
    }
  }
  if (!valid) throw new Error("CHECKOUT_RESPONSE_MISMATCH");
  return result;
}
