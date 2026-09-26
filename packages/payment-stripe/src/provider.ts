import { z } from "zod";
import type {
  PaymentAccountConnection,
  PaymentRuntimeProviderLocale,
} from "@fan-support/contracts";
import {
  paymentPortCommandSchema,
  paymentPortResponseMatchesCommand,
  paymentPortResponseSchema,
  type CancelPaymentResponse,
  type CreatePaymentResponse,
  type GetPaymentCapabilitiesResponse,
  type GetPaymentResponse,
  type PAYMENT_PROVIDER_OPERATIONS,
  type PaymentCredentialResolver,
  type PaymentPortCommand,
  type PaymentPortError,
  type PaymentPortResponse,
  type PaymentProvider,
  type ReconcilePaymentResponse,
  type ReconcileRefundResponse,
  type RefundPaymentResponse,
} from "@fan-support/payment-port";

import {
  MAXIMUM_AMOUNT_MINOR,
  capabilityId,
  minimumAmountMinor,
  supportsAmount,
} from "./capabilities.js";
import { resolveStripeSecretKey } from "./connection.js";
import { fromPlatformReference, toPlatformReference } from "./references.js";
import { observeSession, refundStatusOf } from "./status.js";
import {
  paymentIntentIdOf,
  stripeErrorSchema,
  stripeListSchema,
  stripeRefundSchema,
  stripeSessionSchema,
  type StripeRefund,
  type StripeSession,
} from "./stripe-objects.js";
import {
  StripeTransportError,
  type StripeParameters,
  type StripeRequest,
  type StripeResponse,
  type StripeTransport,
} from "./transport.js";

type Operation = (typeof PAYMENT_PROVIDER_OPERATIONS)[number];
type Command<Selected extends Operation> = Extract<
  PaymentPortCommand,
  { operation: Selected }
>;
type FailureCode = PaymentPortError["code"];

export type StripePaymentProviderOptions = Readonly<{
  connection: PaymentAccountConnection;
  credentials: PaymentCredentialResolver;
  transport: StripeTransport;
  now?: () => Date;
}>;

const ATTEMPT_KEY = "fan_support_attempt_id";
const REFUND_ID_KEY = "fan_support_refund_id";
const REFUND_REFERENCE_KEY = "fan_support_refund_reference";
const EXTERNAL_REFERENCE_KEY = "fan_support_external_reference";
/** Checkout sessions live 24 hours; reconcile runs within minutes of an unknown outcome. */
const SESSION_SCAN_WINDOW_SECONDS = 172_800;
const MAX_LIST_PAGES = 20;

const isMutation = (operation: Operation) =>
  operation === "CREATE_PAYMENT" ||
  operation === "CANCEL_PAYMENT" ||
  operation === "REFUND_PAYMENT";

class Rejection extends Error {
  public constructor(public readonly code: FailureCode) {
    super("Stripe operation rejected");
  }
}

function failure(operation: Operation, code: FailureCode): PaymentPortResponse {
  const retryable =
    code === "RATE_LIMITED" ||
    code === "TEMPORARY_UNAVAILABLE" ||
    code === "UNEXPECTED_ADAPTER_FAILURE";
  const reconcile =
    code === "TIMEOUT_OUTCOME_UNKNOWN" ||
    (code === "MALFORMED_PROVIDER_RESPONSE" && isMutation(operation));
  return paymentPortResponseSchema.parse({
    schemaVersion: 1,
    operation,
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery: reconcile
        ? "RECONCILE_REQUIRED"
        : retryable
          ? "RETRY_SAME_COMMAND"
          : "NONE",
      ...(retryable
        ? { retryAfterMs: code === "RATE_LIMITED" ? 2_000 : 1_000 }
        : {}),
    },
  });
}

function errorCodeFor(
  operation: Operation,
  response: StripeResponse,
  notFound: "PAYMENT_NOT_FOUND" | "REFUND_NOT_FOUND",
): FailureCode {
  const error = stripeErrorSchema.safeParse(response.body);
  const type = error.success ? error.data.error.type : undefined;
  if (response.status === 429) return "RATE_LIMITED";
  // Stripe documents 5xx results as indeterminate: a mutation may have taken effect.
  if (response.status >= 500)
    return isMutation(operation)
      ? "TIMEOUT_OUTCOME_UNKNOWN"
      : "TEMPORARY_UNAVAILABLE";
  if (response.status === 409) return "TEMPORARY_UNAVAILABLE";
  if (response.status === 401 || response.status === 403)
    return "AUTHENTICATION_FAILED";
  if (type === "idempotency_error") return "IDEMPOTENCY_CONFLICT";
  if (response.status === 404) return notFound;
  if (response.status === 402 || type === "card_error")
    return "PROVIDER_DECLINED";
  if (response.status === 400) return "CONFIGURATION_ERROR";
  return "MALFORMED_PROVIDER_RESPONSE";
}

type Context = Readonly<{
  operation: Operation;
  call(request: StripeRequest): Promise<StripeResponse>;
}>;

function expectObject<Output>(
  context: Context,
  response: StripeResponse,
  schema: z.ZodType<Output>,
  notFound: "PAYMENT_NOT_FOUND" | "REFUND_NOT_FOUND" = "PAYMENT_NOT_FOUND",
): Output {
  if (response.status !== 200)
    throw new Rejection(errorCodeFor(context.operation, response, notFound));
  const parsed = schema.safeParse(response.body);
  if (!parsed.success) throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
  return parsed.data;
}

function expectList(
  context: Context,
  response: StripeResponse,
): z.infer<typeof stripeListSchema> {
  return expectObject(context, response, stripeListSchema);
}

export function createStripePaymentProvider(
  options: StripePaymentProviderOptions,
): PaymentProvider {
  const { connection } = options;
  const binding = connection.binding;
  const now = options.now ?? (() => new Date());
  const livemode = binding.environment === "LIVE";

  function sessionPath(externalReference: string, suffix = ""): string {
    return `/v1/checkout/sessions/${fromPlatformReference(externalReference, "session")}${suffix}`;
  }

  function assertOwned(
    session: StripeSession,
    attemptId: string,
    amount?: Readonly<{ amountMinor: number; currency: string }>,
  ): void {
    if (
      session.client_reference_id !== attemptId ||
      session.metadata?.[ATTEMPT_KEY] !== attemptId ||
      session.livemode !== livemode ||
      (amount !== undefined &&
        (session.amount_total !== amount.amountMinor ||
          session.currency !== amount.currency.toLowerCase()))
    )
      throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
  }

  function redirectAction(url: string) {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
    }
    if (!binding.allowedActionOrigins.some((allowed) => allowed === origin))
      throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
    return { schemaVersion: 1 as const, type: "REDIRECT" as const, url };
  }

  /** Sessions echo the Checkout locale we sent; it must map back to exactly one binding entry. */
  function localeOf(session: StripeSession): PaymentRuntimeProviderLocale {
    const matches = new Map(
      Object.values(binding.localeMapping)
        .filter((entry) => entry.providerLocale === session.locale)
        .map((entry) => [
          `${entry.providerLocale}/${String(entry.fallbackUsed)}`,
          entry,
        ]),
    );
    const [entry] = [...matches.values()];
    if (matches.size !== 1 || entry === undefined)
      throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
    return entry;
  }

  function observation(
    session: StripeSession,
    locale: PaymentRuntimeProviderLocale,
    status?: "CANCELED",
  ) {
    const observed = observeSession(session);
    if (observed === undefined)
      throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
    return {
      status: status ?? observed.status,
      externalReference: toPlatformReference(session.id, "session"),
      providerLocale: locale.providerLocale,
      fallbackUsed: locale.fallbackUsed,
      ...(status === undefined && observed.status === "REQUIRES_ACTION"
        ? { action: redirectAction(observed.redirectUrl) }
        : {}),
      observedAt: now().toISOString(),
    };
  }

  /** Every parameter derives from the frozen command, so a replay with the same key is byte-identical. */
  function sessionParameters(
    command: Command<"CREATE_PAYMENT">,
  ): StripeParameters {
    return [
      ["mode", "payment"],
      ["payment_method_types[0]", "card"],
      ["line_items[0][quantity]", "1"],
      ["line_items[0][price_data][currency]", command.currency.toLowerCase()],
      ["line_items[0][price_data][unit_amount]", String(command.amountMinor)],
      [
        "line_items[0][price_data][product_data][name]",
        connection.merchantAccount,
      ],
      ["client_reference_id", command.attemptId],
      [`metadata[${ATTEMPT_KEY}]`, command.attemptId],
      [`payment_intent_data[metadata][${ATTEMPT_KEY}]`, command.attemptId],
      ["success_url", command.returnUrl],
      ["cancel_url", command.cancelUrl],
      ["locale", binding.localeMapping[command.requestedLocale].providerLocale],
    ];
  }

  async function readSession(
    context: Context,
    externalReference: string,
  ): Promise<StripeSession> {
    return expectObject(
      context,
      await context.call({
        method: "GET",
        path: sessionPath(externalReference),
        parameters: [["expand[]", "payment_intent"]],
      }),
      stripeSessionSchema,
    );
  }

  async function findRefund(
    context: Context,
    paymentIntentId: string,
    refundId: string,
  ): Promise<StripeRefund | undefined> {
    let startingAfter: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const list = expectList(
        context,
        await context.call({
          method: "GET",
          path: "/v1/refunds",
          parameters: [
            ["payment_intent", paymentIntentId],
            ["limit", "100"],
            ...(startingAfter === undefined
              ? []
              : [["starting_after", startingAfter] as const]),
          ],
        }),
      );
      for (const item of list.data) {
        const refund = stripeRefundSchema.safeParse(item);
        if (!refund.success) throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
        if (refund.data.metadata?.[REFUND_ID_KEY] === refundId)
          return refund.data;
        startingAfter = refund.data.id;
      }
      if (!list.has_more) return undefined;
    }
    throw new Rejection("TEMPORARY_UNAVAILABLE");
  }

  /** Paid attempts leave a tagged PaymentIntent; unpaid ones only a recent session. */
  async function findSessionForAttempt(
    context: Context,
    attemptId: string,
  ): Promise<StripeSession | undefined> {
    const intents = expectList(
      context,
      await context.call({
        method: "GET",
        path: "/v1/payment_intents/search",
        parameters: [
          ["query", `metadata['${ATTEMPT_KEY}']:'${attemptId}'`],
          ["limit", "10"],
        ],
      }),
    );
    for (const item of intents.data) {
      const intentId = z.object({ id: z.string() }).safeParse(item);
      if (!intentId.success) throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
      const sessions = expectList(
        context,
        await context.call({
          method: "GET",
          path: "/v1/checkout/sessions",
          parameters: [
            ["payment_intent", intentId.data.id],
            ["limit", "1"],
            ["expand[]", "data.payment_intent"],
          ],
        }),
      );
      for (const candidate of sessions.data) {
        const session = stripeSessionSchema.safeParse(candidate);
        if (session.success && session.data.client_reference_id === attemptId)
          return session.data;
      }
    }
    const since =
      Math.floor(now().getTime() / 1000) - SESSION_SCAN_WINDOW_SECONDS;
    let startingAfter: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const list = expectList(
        context,
        await context.call({
          method: "GET",
          path: "/v1/checkout/sessions",
          parameters: [
            ["limit", "100"],
            ["created[gte]", String(since)],
            ["expand[]", "data.payment_intent"],
            ...(startingAfter === undefined
              ? []
              : [["starting_after", startingAfter] as const]),
          ],
        }),
      );
      for (const candidate of list.data) {
        const summary = z
          .object({
            id: z.string(),
            client_reference_id: z.string().nullable(),
          })
          .safeParse(candidate);
        if (!summary.success)
          throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
        if (summary.data.client_reference_id === attemptId) {
          const session = stripeSessionSchema.safeParse(candidate);
          if (!session.success)
            throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
          return session.data;
        }
        startingAfter = summary.data.id;
      }
      if (!list.has_more) return undefined;
    }
    return undefined;
  }

  async function getCapabilities(
    command: Command<"GET_CAPABILITIES">,
  ): Promise<unknown> {
    if (!command.supportedActionTypes.includes("REDIRECT"))
      return {
        schemaVersion: 1,
        operation: "GET_CAPABILITIES",
        outcome: "SUCCESS",
        value: { capabilities: [] },
      };
    const minimum = minimumAmountMinor(command.currency);
    if (
      minimum === undefined ||
      !supportsAmount(command.currency, command.amountMinor)
    )
      throw new Rejection("CAPABILITY_UNAVAILABLE");
    return {
      schemaVersion: 1,
      operation: "GET_CAPABILITIES",
      outcome: "SUCCESS",
      value: {
        capabilities: connection.instruments.map((instrument) => ({
          schemaVersion: 1,
          id: capabilityId(binding.providerAccountId, instrument.paymentMethod),
          paymentMethod: instrument.paymentMethod,
          displayName: "Card",
          market: command.market,
          country: command.country,
          currency: command.currency,
          minimumAmountMinor: minimum,
          maximumAmountMinor: MAXIMUM_AMOUNT_MINOR,
          actionTypes: ["REDIRECT"],
          available: true,
        })),
      },
    };
  }

  async function createPayment(
    context: Context,
    command: Command<"CREATE_PAYMENT">,
  ): Promise<unknown> {
    if (
      new URL(command.returnUrl).origin !== connection.returnOrigin ||
      new URL(command.cancelUrl).origin !== connection.returnOrigin
    )
      throw new Rejection("CONFIGURATION_ERROR");
    if (
      !connection.instruments.some(
        (instrument) => instrument.paymentMethod === command.paymentMethod,
      ) ||
      !supportsAmount(command.currency, command.amountMinor)
    )
      throw new Rejection("CAPABILITY_UNAVAILABLE");
    const session = expectObject(
      context,
      await context.call({
        method: "POST",
        path: "/v1/checkout/sessions",
        parameters: sessionParameters(command),
        idempotencyKey: command.providerIdempotencyKey,
      }),
      stripeSessionSchema,
    );
    assertOwned(session, command.attemptId, command);
    const mapping = binding.localeMapping[command.requestedLocale];
    const observed = observation(session, mapping);
    // A replayed response echoes the original open session; later states arrive by webhook.
    if (
      observed.status !== "REQUIRES_ACTION" &&
      observed.status !== "PROCESSING"
    )
      throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
    return {
      schemaVersion: 1,
      operation: "CREATE_PAYMENT",
      outcome: "SUCCESS",
      value: {
        ...observed,
        providerAccountId: command.providerAccountId,
        environment: command.environment,
        attemptId: command.attemptId,
        orderId: command.orderId,
        amountMinor: command.amountMinor,
        currency: command.currency,
      },
    };
  }

  async function getPayment(
    context: Context,
    command: Command<"GET_PAYMENT">,
  ): Promise<unknown> {
    const session = await readSession(context, command.externalReference);
    assertOwned(session, command.attemptId);
    return {
      schemaVersion: 1,
      operation: "GET_PAYMENT",
      outcome: "SUCCESS",
      value: {
        ...observation(session, localeOf(session)),
        providerAccountId: command.providerAccountId,
        environment: command.environment,
        attemptId: command.attemptId,
      },
    };
  }

  async function cancelPayment(
    context: Context,
    command: Command<"CANCEL_PAYMENT">,
  ): Promise<unknown> {
    const response = await context.call({
      method: "POST",
      path: sessionPath(command.externalReference, "/expire"),
      idempotencyKey: command.idempotencyKey,
    });
    // Expiry only applies to open sessions; otherwise payment won the race and we report it.
    const expired = response.status === 200;
    const session = expired
      ? expectObject(context, response, stripeSessionSchema)
      : response.status === 400
        ? await readSession(context, command.externalReference)
        : expectObject(context, response, stripeSessionSchema);
    assertOwned(session, command.attemptId);
    if (expired && session.status !== "expired")
      throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
    if (!expired && session.status === "open")
      throw new Rejection("CONFIGURATION_ERROR");
    return {
      schemaVersion: 1,
      operation: "CANCEL_PAYMENT",
      outcome: "SUCCESS",
      value: {
        ...observation(
          session,
          localeOf(session),
          expired ? "CANCELED" : undefined,
        ),
        providerAccountId: command.providerAccountId,
        environment: command.environment,
        attemptId: command.attemptId,
      },
    };
  }

  async function paidIntentOf(
    context: Context,
    externalReference: string,
    attemptId: string,
    currency: string,
  ): Promise<string> {
    const session = await readSession(context, externalReference);
    assertOwned(session, attemptId);
    const intentId = paymentIntentIdOf(session);
    if (
      session.status !== "complete" ||
      session.payment_status !== "paid" ||
      intentId === undefined ||
      session.currency !== currency.toLowerCase()
    )
      throw new Rejection("PAYMENT_NOT_FOUND");
    return intentId;
  }

  function assertRefund(
    refund: StripeRefund,
    command: Command<"REFUND_PAYMENT"> | Command<"RECONCILE_REFUND">,
    intentId: string,
  ): void {
    if (
      refund.payment_intent !== intentId ||
      refund.amount !== command.amountMinor ||
      refund.currency !== command.currency.toLowerCase() ||
      refund.metadata?.[REFUND_ID_KEY] !== command.refundId ||
      refund.metadata?.[REFUND_REFERENCE_KEY] !== command.refundReference
    )
      throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
  }

  async function refundPayment(
    context: Context,
    command: Command<"REFUND_PAYMENT">,
  ): Promise<unknown> {
    const intentId = await paidIntentOf(
      context,
      command.externalReference,
      command.paymentAttemptId,
      command.currency,
    );
    // Look before creating: Stripe keys expire after 24 hours, this lookup never does.
    let refund = await findRefund(context, intentId, command.refundId);
    if (refund === undefined)
      refund = expectObject(
        context,
        await context.call({
          method: "POST",
          path: "/v1/refunds",
          parameters: [
            ["payment_intent", intentId],
            ["amount", String(command.amountMinor)],
            [`metadata[${REFUND_ID_KEY}]`, command.refundId],
            [`metadata[${REFUND_REFERENCE_KEY}]`, command.refundReference],
            [`metadata[${ATTEMPT_KEY}]`, command.paymentAttemptId],
            [`metadata[${EXTERNAL_REFERENCE_KEY}]`, command.externalReference],
          ],
          idempotencyKey: command.idempotencyKey,
        }),
        stripeRefundSchema,
        "REFUND_NOT_FOUND",
      );
    assertRefund(refund, command, intentId);
    return {
      schemaVersion: 1,
      operation: "REFUND_PAYMENT",
      outcome: "SUCCESS",
      value: {
        providerAccountId: command.providerAccountId,
        environment: command.environment,
        refundId: command.refundId,
        paymentAttemptId: command.paymentAttemptId,
        status: "PROCESSING",
        refundReference: command.refundReference,
        amountMinor: command.amountMinor,
        currency: command.currency,
        observedAt: now().toISOString(),
      },
    };
  }

  async function reconcilePayment(
    context: Context,
    command: Command<"RECONCILE_PAYMENT">,
  ): Promise<unknown> {
    const session =
      command.externalReference === undefined
        ? await findSessionForAttempt(context, command.attemptId)
        : await readSession(context, command.externalReference);
    if (session === undefined) throw new Rejection("PAYMENT_NOT_FOUND");
    assertOwned(session, command.attemptId, command);
    const observed = observeSession(session);
    if (observed === undefined)
      throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
    const externalReference = toPlatformReference(session.id, "session");
    return {
      schemaVersion: 1,
      operation: "RECONCILE_PAYMENT",
      outcome: "SUCCESS",
      value: {
        event: {
          schemaVersion: 1,
          eventType: "PAYMENT_STATUS",
          providerAccountId: command.providerAccountId,
          environment: command.environment,
          providerEventId: `reconcile:${externalReference}:${observed.status}`,
          evidence: {
            kind: "AUTHENTICATED_RECONCILE",
            auditLogId: command.auditLogId,
          },
          occurredAt: now().toISOString(),
          association: {
            status: "MATCHED",
            paymentAttemptId: command.attemptId,
            externalReference,
          },
          ...(observed.status === "SUCCEEDED"
            ? {
                transaction: {
                  type: "CAPTURE",
                  providerReference: toPlatformReference(
                    observed.paymentIntentId,
                    "paymentIntent",
                  ),
                },
              }
            : {}),
          status: observed.status,
          amountMinor: command.amountMinor,
          currency: command.currency,
        },
      },
    };
  }

  async function reconcileRefund(
    context: Context,
    command: Command<"RECONCILE_REFUND">,
  ): Promise<unknown> {
    const intentId = await paidIntentOf(
      context,
      command.externalReference,
      command.paymentAttemptId,
      command.currency,
    );
    const refund = await findRefund(context, intentId, command.refundId);
    if (refund === undefined) throw new Rejection("REFUND_NOT_FOUND");
    assertRefund(refund, command, intentId);
    const status = refundStatusOf(refund);
    const refundReference = toPlatformReference(refund.id, "refund");
    return {
      schemaVersion: 1,
      operation: "RECONCILE_REFUND",
      outcome: "SUCCESS",
      value: {
        refundId: command.refundId,
        idempotencyKey: command.idempotencyKey,
        event: {
          schemaVersion: 1,
          eventType: "REFUND_STATUS",
          providerAccountId: command.providerAccountId,
          environment: command.environment,
          providerEventId: `reconcile:${refundReference}:${status}`,
          evidence: {
            kind: "AUTHENTICATED_RECONCILE",
            auditLogId: command.auditLogId,
          },
          occurredAt: now().toISOString(),
          association: {
            status: "MATCHED",
            paymentAttemptId: command.paymentAttemptId,
            externalReference: command.externalReference,
          },
          ...(status === "SUCCEEDED"
            ? {
                transaction: {
                  type: "REFUND",
                  providerReference: refundReference,
                },
              }
            : {}),
          refundReference: command.refundReference,
          status,
          amountMinor: command.amountMinor,
          currency: command.currency,
        },
      },
    };
  }

  async function invoke(
    operation: Operation,
    input: unknown,
  ): Promise<PaymentPortResponse> {
    const parsed = paymentPortCommandSchema.safeParse(input);
    if (!parsed.success || parsed.data.operation !== operation)
      return failure(operation, "INVALID_COMMAND");
    const command = parsed.data;
    if (
      command.providerAccountId !== binding.providerAccountId ||
      command.environment !== binding.environment
    )
      return failure(operation, "CONFIGURATION_ERROR");
    const startedAt = performance.now();
    const remaining = () =>
      Math.floor(connection.timeoutMs - (performance.now() - startedAt));
    let secretKey: string | undefined;
    const context: Context = {
      operation,
      async call(request) {
        secretKey ??= await resolveStripeSecretKey(
          options.credentials,
          connection,
          Math.max(1, remaining()),
        ).catch(() => {
          throw new Rejection("CONFIGURATION_ERROR");
        });
        const budget = remaining();
        // Nothing was sent yet, so running out of time is retryable rather than unknown.
        if (budget < 1) throw new Rejection("TEMPORARY_UNAVAILABLE");
        return options.transport(request, secretKey, budget);
      },
    };
    let output: unknown;
    try {
      switch (command.operation) {
        case "GET_CAPABILITIES":
          output = await getCapabilities(command);
          break;
        case "CREATE_PAYMENT":
          output = await createPayment(context, command);
          break;
        case "GET_PAYMENT":
          output = await getPayment(context, command);
          break;
        case "CANCEL_PAYMENT":
          output = await cancelPayment(context, command);
          break;
        case "REFUND_PAYMENT":
          output = await refundPayment(context, command);
          break;
        case "RECONCILE_PAYMENT":
          output = await reconcilePayment(context, command);
          break;
        case "RECONCILE_REFUND":
          output = await reconcileRefund(context, command);
          break;
        default:
          return failure(operation, "INVALID_COMMAND");
      }
    } catch (error) {
      if (error instanceof Rejection) return failure(operation, error.code);
      if (error instanceof StripeTransportError)
        return failure(
          operation,
          isMutation(operation)
            ? "TIMEOUT_OUTCOME_UNKNOWN"
            : "TEMPORARY_UNAVAILABLE",
        );
      return failure(
        operation,
        isMutation(operation)
          ? "TIMEOUT_OUTCOME_UNKNOWN"
          : "UNEXPECTED_ADAPTER_FAILURE",
      );
    }
    const response = paymentPortResponseSchema.safeParse(output);
    if (!response.success)
      return failure(operation, "MALFORMED_PROVIDER_RESPONSE");
    // An empty capability list is an ordinary "nothing purchasable" answer, not a malformed one.
    const emptyCapabilities =
      response.data.operation === "GET_CAPABILITIES" &&
      response.data.outcome === "SUCCESS" &&
      response.data.value.capabilities.length === 0;
    return emptyCapabilities ||
      paymentPortResponseMatchesCommand(command, response.data)
      ? response.data
      : failure(operation, "MALFORMED_PROVIDER_RESPONSE");
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
