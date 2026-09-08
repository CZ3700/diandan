import {
  paymentPortCommandSchema,
  paymentPortResponseSchema,
  paymentPortResponseMatchesCommand,
  type PaymentProvider,
  type PaymentPortCommand,
  type PaymentPortResponse,
  type CreatePaymentResponse,
  type GetPaymentCapabilitiesResponse,
  type GetPaymentResponse,
  type CancelPaymentResponse,
  type RefundPaymentResponse,
  type ReconcilePaymentResponse,
  type ReconcileRefundResponse,
} from "@fan-support/payment-port";
import {
  paymentRuntimeProviderBindingSchema,
  paymentRuntimeOriginSchema,
  type PaymentRuntimeProviderBinding,
} from "@fan-support/contracts";
export type PersistentTestPaymentProviderOptions = {
  binding: PaymentRuntimeProviderBinding;
  endpointOrigin: string;
  returnOrigin: string;
  authorizationToken: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};
function failure(
  operation: PaymentPortCommand["operation"],
  code:
    | "INVALID_COMMAND"
    | "CONFIGURATION_ERROR"
    | "TIMEOUT_OUTCOME_UNKNOWN"
    | "MALFORMED_PROVIDER_RESPONSE",
) {
  return paymentPortResponseSchema.parse({
    schemaVersion: 1,
    operation,
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery:
        code === "TIMEOUT_OUTCOME_UNKNOWN" ||
        (code === "MALFORMED_PROVIDER_RESPONSE" &&
          ["CREATE_PAYMENT", "CANCEL_PAYMENT", "REFUND_PAYMENT"].includes(
            operation,
          ))
          ? "RECONCILE_REQUIRED"
          : "NONE",
    },
  });
}
async function readBody(response: Response) {
  if (!response.body) throw new Error("Missing TEST PSP response");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1_048_576) {
        await reader.cancel();
        throw new Error("TEST PSP response bound");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
}
/** TEST-only authenticated transport. All mutable provider truth belongs to the separate durable PSP service. */
export function createPersistentTestPaymentProvider(
  options: PersistentTestPaymentProviderOptions,
): PaymentProvider {
  const binding = paymentRuntimeProviderBindingSchema.parse(options.binding);
  const origin = paymentRuntimeOriginSchema.parse(options.endpointOrigin),
    returnOrigin = paymentRuntimeOriginSchema.parse(options.returnOrigin);
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (
    binding.environment !== "TEST" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(options.authorizationToken) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 60_000
  )
    throw new TypeError("Invalid persistent TEST PSP configuration");
  async function invoke(
    operation: PaymentPortCommand["operation"],
    input: unknown,
  ): Promise<PaymentPortResponse> {
    const parsed = paymentPortCommandSchema.safeParse(input);
    if (!parsed.success || parsed.data.operation !== operation)
      return failure(operation, "INVALID_COMMAND");
    const command = parsed.data;
    if (
      command.environment !== "TEST" ||
      command.providerAccountId !== binding.providerAccountId ||
      (command.operation === "CREATE_PAYMENT" &&
        (new URL(command.returnUrl).origin !== returnOrigin ||
          new URL(command.cancelUrl).origin !== returnOrigin))
    )
      return failure(operation, "CONFIGURATION_ERROR");
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(
        new URL("/v1/commands", origin),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${options.authorizationToken}`,
          },
          body: JSON.stringify(command),
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch {
      return failure(operation, "TIMEOUT_OUTCOME_UNKNOWN");
    }
    try {
      if (
        response.status !== 200 ||
        !/^application\/json(?:;|$)/iu.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        await response.body?.cancel();
        return failure(operation, "MALFORMED_PROVIDER_RESPONSE");
      }
      const result = paymentPortResponseSchema.parse(await readBody(response));
      if (!paymentPortResponseMatchesCommand(command, result))
        return failure(operation, "MALFORMED_PROVIDER_RESPONSE");
      if (result.outcome === "SUCCESS" && "action" in result.value) {
        const action = result.value.action;
        if (
          action &&
          "url" in action &&
          !binding.allowedActionOrigins.some(
            (origin) => origin === new URL(action.url).origin,
          )
        )
          return failure(operation, "MALFORMED_PROVIDER_RESPONSE");
      }
      if (
        result.outcome === "SUCCESS" &&
        "requestedLocale" in command &&
        "providerLocale" in result.value
      ) {
        const expected = binding.localeMapping[command.requestedLocale];
        if (
          result.value.providerLocale !== expected.providerLocale ||
          result.value.fallbackUsed !== expected.fallbackUsed
        )
          return failure(operation, "MALFORMED_PROVIDER_RESPONSE");
      }
      return result;
    } catch {
      return failure(operation, "MALFORMED_PROVIDER_RESPONSE");
    }
  }
  const provider: PaymentProvider = {
    getCapabilities: async (command) =>
      (await invoke(
        "GET_CAPABILITIES",
        command,
      )) as GetPaymentCapabilitiesResponse,
    createPayment: async (command) =>
      (await invoke("CREATE_PAYMENT", command)) as CreatePaymentResponse,
    getPayment: async (command) =>
      (await invoke("GET_PAYMENT", command)) as GetPaymentResponse,
    cancelPayment: async (command) =>
      (await invoke("CANCEL_PAYMENT", command)) as CancelPaymentResponse,
    refundPayment: async (command) =>
      (await invoke("REFUND_PAYMENT", command)) as RefundPaymentResponse,
    reconcilePayment: async (command) =>
      (await invoke("RECONCILE_PAYMENT", command)) as ReconcilePaymentResponse,
    reconcileRefund: async (command) =>
      (await invoke("RECONCILE_REFUND", command)) as ReconcileRefundResponse,
  };
  return Object.freeze(provider);
}
