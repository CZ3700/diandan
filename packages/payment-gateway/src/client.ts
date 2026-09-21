import {
  type PAYMENT_PROVIDER_OPERATIONS,
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
  paymentAccountConnectionSchema,
  type PaymentAccountConnection,
} from "@fan-support/contracts";
import {
  resolveGatewayCredentials,
  type GatewayCredentialResolver,
} from "./credentials.js";
export type GatewayPaymentProviderOptions = Readonly<{
  connection: PaymentAccountConnection;
  credentials: GatewayCredentialResolver;
  fetcher?: typeof fetch;
}>;
type Operation = (typeof PAYMENT_PROVIDER_OPERATIONS)[number];
type GatewayCommand = Extract<PaymentPortCommand, { operation: Operation }>;
const mutation = (operation: Operation) =>
  ["CREATE_PAYMENT", "CANCEL_PAYMENT", "REFUND_PAYMENT"].includes(operation);
function failure(
  operation: Operation,
  code:
    | "INVALID_COMMAND"
    | "CONFIGURATION_ERROR"
    | "CAPABILITY_UNAVAILABLE"
    | "MALFORMED_PROVIDER_RESPONSE"
    | "TIMEOUT_OUTCOME_UNKNOWN",
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
        (code === "MALFORMED_PROVIDER_RESPONSE" && mutation(operation))
          ? "RECONCILE_REQUIRED"
          : "NONE",
    },
  });
}
/** The v1 normalized gateway intentionally excludes stablecoins until a dedicated settlement mapper exists. */
export function parseGatewayConnection(
  input: unknown,
): PaymentAccountConnection {
  const parsed = paymentAccountConnectionSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.binding.providerCode !== "normalized-gateway" ||
    parsed.data.protocol !== "fan-support-gateway-v1" ||
    parsed.data.adapterVersion !== "1.0.0" ||
    parsed.data.instruments.some(
      (instrument) => instrument.kind === "STABLECOIN",
    )
  )
    throw new TypeError("Invalid gateway connection");
  return parsed.data;
}
async function exchange(
  options: GatewayPaymentProviderOptions,
  connection: PaymentAccountConnection,
  command: GatewayCommand,
  token: string,
): Promise<unknown> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      reject(new Error("Gateway deadline"));
    }, connection.timeoutMs);
  });
  const request = async () => {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    };
    if (command.operation === "CREATE_PAYMENT")
      headers["idempotency-key"] = command.providerIdempotencyKey;
    if (
      command.operation === "CANCEL_PAYMENT" ||
      command.operation === "REFUND_PAYMENT"
    )
      headers["idempotency-key"] = command.idempotencyKey;
    const response = await (options.fetcher ?? fetch)(
      new URL("/v1/payment-commands", connection.apiOrigin),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          schemaVersion: 1,
          protocol: "fan-support-gateway-v1",
          merchantAccount: connection.merchantAccount,
          command,
          ...(command.operation === "CREATE_PAYMENT"
            ? {
                instrument: connection.instruments.find(
                  (instrument) =>
                    instrument.paymentMethod === command.paymentMethod,
                ),
              }
            : command.operation === "GET_CAPABILITIES"
              ? { instruments: connection.instruments }
              : {}),
        }),
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (
      controller.signal.aborted ||
      response.status !== 200 ||
      response.redirected ||
      !/^application\/json(?:;|$)/iu.test(
        response.headers.get("content-type") ?? "",
      ) ||
      !response.body
    ) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("Invalid gateway response");
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 1048576) {
          void reader.cancel().catch(() => undefined);
          throw new Error("Gateway response bound");
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
      reader = undefined;
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
  };
  try {
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  }
}
function validateResponse(
  connection: PaymentAccountConnection,
  command: GatewayCommand,
  input: unknown,
): PaymentPortResponse {
  const operation = command.operation;
  const parsed = paymentPortResponseSchema.safeParse(input);
  // A valid empty list describes no purchasable capability, not a broken transport.
  if (
    parsed.success &&
    command.operation === "GET_CAPABILITIES" &&
    parsed.data.operation === "GET_CAPABILITIES" &&
    parsed.data.outcome === "SUCCESS"
  ) {
    const capabilities = parsed.data.value.capabilities;
    if (capabilities.length === 0) return parsed.data;
    if (
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
      return failure(operation, "CAPABILITY_UNAVAILABLE");
  }
  if (
    !parsed.success ||
    !paymentPortResponseMatchesCommand(command, parsed.data)
  )
    return failure(operation, "MALFORMED_PROVIDER_RESPONSE");
  const result = parsed.data;
  if (result.outcome === "FAILURE") return result;
  if (result.operation === "GET_CAPABILITIES") {
    result.value.capabilities = result.value.capabilities.filter(
      (capability) =>
        connection.instruments.some(
          (instrument) => instrument.paymentMethod === capability.paymentMethod,
        ) &&
        capability.actionTypes.every(
          (action) => action === "REDIRECT" || action === "WAIT",
        ),
    );
    return paymentPortResponseMatchesCommand(command, result)
      ? result
      : failure(operation, "CAPABILITY_UNAVAILABLE");
  }
  if ("action" in result.value && result.value.action) {
    const action = result.value.action;
    if (!(
      action.type === "WAIT" ||
      (action.type === "REDIRECT" &&
        connection.binding.allowedActionOrigins.some(
          (origin) => origin === new URL(action.url).origin,
        ))
    ))
      return failure(operation, "MALFORMED_PROVIDER_RESPONSE");
  }
  if ("providerLocale" in result.value) {
    const received = result.value;
    const mappings =
      "requestedLocale" in command
        ? [connection.binding.localeMapping[command.requestedLocale]]
        : Object.values(connection.binding.localeMapping);
    if (
      !mappings.some(
        (expected) =>
          received.providerLocale === expected.providerLocale &&
          received.fallbackUsed === expected.fallbackUsed,
      )
    )
      return failure(operation, "MALFORMED_PROVIDER_RESPONSE");
  }
  return result;
}
export function createGatewayPaymentProvider(
  options: GatewayPaymentProviderOptions,
): PaymentProvider {
  const connection = parseGatewayConnection(options.connection);
  async function invoke(
    operation: Operation,
    input: unknown,
  ): Promise<PaymentPortResponse> {
    const parsed = paymentPortCommandSchema.safeParse(input);
    if (!parsed.success || parsed.data.operation !== operation)
      return failure(operation, "INVALID_COMMAND");
    const command = parsed.data as GatewayCommand;
    if (
      command.providerAccountId !== connection.binding.providerAccountId ||
      command.environment !== connection.binding.environment ||
      (command.operation === "CREATE_PAYMENT" &&
        (new URL(command.returnUrl).origin !== connection.returnOrigin ||
          new URL(command.cancelUrl).origin !== connection.returnOrigin))
    )
      return failure(operation, "CONFIGURATION_ERROR");
    if (
      command.operation === "CREATE_PAYMENT" &&
      !connection.instruments.some(
        (instrument) => instrument.paymentMethod === command.paymentMethod,
      )
    )
      return failure(operation, "CAPABILITY_UNAVAILABLE");
    let token: string;
    const startedAt = performance.now();
    try {
      const values = await resolveGatewayCredentials(
        options.credentials,
        {
          schemaVersion: 1,
          secretRef: connection.credentialRef,
          providerAccountId: connection.binding.providerAccountId,
          environment: connection.binding.environment,
          purpose: "API_AUTH",
        },
        connection.timeoutMs,
      );
      token = values[0]!;
    } catch {
      return failure(operation, "CONFIGURATION_ERROR");
    }
    const remainingMs = Math.floor(
      connection.timeoutMs - (performance.now() - startedAt),
    );
    if (remainingMs < 1) return failure(operation, "CONFIGURATION_ERROR");
    try {
      return validateResponse(
        connection,
        command,
        await exchange(
          options,
          { ...connection, timeoutMs: remainingMs },
          command,
          token,
        ),
      );
    } catch {
      return failure(
        operation,
        mutation(operation)
          ? "TIMEOUT_OUTCOME_UNKNOWN"
          : "MALFORMED_PROVIDER_RESPONSE",
      );
    }
  }
  return Object.freeze({
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
  } satisfies PaymentProvider);
}
