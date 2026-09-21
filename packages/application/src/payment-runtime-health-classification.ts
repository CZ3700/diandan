import {
  PAYMENT_HEALTH_BUSINESS_CODES,
  PAYMENT_HEALTH_TECHNICAL_CODES,
  paymentPortResponseMatchesCommand,
  paymentPortResponseSchema,
  type PaymentHealthClassification,
  type PaymentPortCommand,
  type PaymentPortError,
} from "@fan-support/contracts";

export type PaymentHealthOutcome = Readonly<{
  classification: PaymentHealthClassification;
  code: PaymentPortError["code"] | null;
}>;

/** Classify communication health only; this never grants financial finalization authority. */
export function classifyPaymentHealthResponse(
  command: PaymentPortCommand,
  input: unknown,
): PaymentHealthOutcome {
  const parsed = paymentPortResponseSchema.safeParse(input);
  if (
    parsed.success &&
    command.operation === "GET_CAPABILITIES" &&
    parsed.data.operation === "GET_CAPABILITIES" &&
    parsed.data.outcome === "SUCCESS"
  ) {
    const capabilities = parsed.data.value.capabilities;
    if (
      capabilities.length > 0 &&
      capabilities.every(
        (entry) =>
          entry.market === command.market &&
          entry.country === command.country &&
          entry.currency === command.currency &&
          entry.actionTypes.every((action) =>
            command.supportedActionTypes.includes(action),
          ),
      ) &&
      !capabilities.some(
        (entry) =>
          entry.available &&
          entry.minimumAmountMinor <= command.amountMinor &&
          entry.maximumAmountMinor >= command.amountMinor,
      )
    )
      return { classification: "BUSINESS_OUTCOME", code: null };
  }
  const emptyCapabilities =
    parsed.success &&
    command.operation === "GET_CAPABILITIES" &&
    parsed.data.operation === "GET_CAPABILITIES" &&
    parsed.data.outcome === "SUCCESS" &&
    parsed.data.value.capabilities.length === 0;
  if (
    !parsed.success ||
    (!emptyCapabilities &&
      !paymentPortResponseMatchesCommand(command, parsed.data))
  )
    return {
      classification: "TECHNICAL_FAILURE",
      code: "MALFORMED_PROVIDER_RESPONSE",
    };
  const response = parsed.data;
  if (response.outcome === "FAILURE") {
    const code = response.error.code;
    if (PAYMENT_HEALTH_TECHNICAL_CODES.some((value) => value === code))
      return { classification: "TECHNICAL_FAILURE", code };
    if (PAYMENT_HEALTH_BUSINESS_CODES.some((value) => value === code))
      return { classification: "BUSINESS_OUTCOME", code };
    return { classification: "CONFIGURATION_ERROR", code };
  }
  if (
    "status" in response.value &&
    ["CANCELED", "FAILED"].includes(response.value.status)
  )
    return { classification: "BUSINESS_OUTCOME", code: null };
  return { classification: "SUCCESS", code: null };
}
