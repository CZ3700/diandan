import type { z } from "zod";
import {
  AIRWALLEX_HPP_COMPONENT_KEY,
  encodeAirwallexHppClientToken,
  publicHttpsUrlSchema,
  supportedLocaleSchema,
  type AirwallexHppLaunch,
  type PaymentAccountConnection,
  type PaymentRuntimeProviderLocale,
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
  airwallexErrorSchema,
  airwallexListSchema,
  airwallexPaymentIntentSchema,
  airwallexRefundSchema,
  type AirwallexPaymentIntent,
  type AirwallexRefund,
} from "./airwallex-objects.js";
import {
  MAXIMUM_AMOUNT_MINOR,
  MINIMUM_AMOUNT_MINOR,
  capabilityId,
  supportsAmount,
  toMajorAmount,
  toMinorAmount,
} from "./amounts.js";
import { apiOriginOf } from "./connection.js";
import { fromPlatformReference, toPlatformReference } from "./references.js";
import {
  AirwallexRejection,
  createAirwallexSession,
  type AirwallexSession,
} from "./session.js";
import { observeIntentStatus, refundStatusOf } from "./status.js";
import {
  AirwallexTransportError,
  type AirwallexRequest,
  type AirwallexResponse,
  type AirwallexTransport,
} from "./transport.js";

type Operation = (typeof PAYMENT_PROVIDER_OPERATIONS)[number];
type Command<Selected extends Operation> = Extract<
  PaymentPortCommand,
  { operation: Selected }
>;
type FailureCode = PaymentPortError["code"];

export type AirwallexPaymentProviderOptions = Readonly<{
  connection: PaymentAccountConnection;
  credentials: PaymentCredentialResolver;
  transport: AirwallexTransport;
  session?: AirwallexSession;
  now?: () => Date;
}>;

const ATTEMPT_KEY = "fan_support_attempt_id";
const ORDER_KEY = "fan_support_order_id";
const LOCALE_KEY = "fan_support_requested_locale";
const CANCEL_URL_KEY = "fan_support_cancel_url";
const REFUND_ID_KEY = "fan_support_refund_id";
const REFUND_REFERENCE_KEY = "fan_support_refund_reference";
const EXTERNAL_REFERENCE_KEY = "fan_support_external_reference";
const MAX_LIST_PAGES = 20;
const PAGE_SIZE = 100;

const isMutation = (operation: Operation) =>
  operation === "CREATE_PAYMENT" ||
  operation === "CANCEL_PAYMENT" ||
  operation === "REFUND_PAYMENT";

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

const errorCodeOf = (response: AirwallexResponse) => {
  const parsed = airwallexErrorSchema.safeParse(response.body);
  return parsed.success ? parsed.data.code : undefined;
};

/** Duplicate and state-conflict answers are handled by each operation before this mapping. */
function errorCodeFor(
  operation: Operation,
  response: AirwallexResponse,
  notFound: "PAYMENT_NOT_FOUND" | "REFUND_NOT_FOUND",
): FailureCode {
  const code = errorCodeOf(response);
  if (response.status === 429) return "RATE_LIMITED";
  // A 5xx gives no guarantee either way: a mutation may have taken effect.
  if (response.status >= 500)
    return isMutation(operation)
      ? "TIMEOUT_OUTCOME_UNKNOWN"
      : "TEMPORARY_UNAVAILABLE";
  if (response.status === 409) return "TEMPORARY_UNAVAILABLE";
  if (response.status === 401 || response.status === 403)
    return "AUTHENTICATION_FAILED";
  if (response.status === 404 || code === "resource_not_found") return notFound;
  if (code === "provider_declined" || code === "issuer_declined")
    return "PROVIDER_DECLINED";
  if (code === "currency_not_supported") return "CAPABILITY_UNAVAILABLE";
  if (code === "provider_unavailable") return "TEMPORARY_UNAVAILABLE";
  if (response.status === 400) return "CONFIGURATION_ERROR";
  return "MALFORMED_PROVIDER_RESPONSE";
}

type Context = Readonly<{
  operation: Operation;
  call(request: AirwallexRequest): Promise<AirwallexResponse>;
}>;

function expectObject<Output>(
  context: Context,
  response: AirwallexResponse,
  schema: z.ZodType<Output>,
  notFound: "PAYMENT_NOT_FOUND" | "REFUND_NOT_FOUND" = "PAYMENT_NOT_FOUND",
): Output {
  if (response.status !== 200 && response.status !== 201)
    throw new AirwallexRejection(
      errorCodeFor(context.operation, response, notFound),
    );
  const parsed = schema.safeParse(response.body);
  if (!parsed.success)
    throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
  return parsed.data;
}

const hasErrorCode = (response: AirwallexResponse, code: string) =>
  response.status === 400 && errorCodeOf(response) === code;

export function createAirwallexPaymentProvider(
  options: AirwallexPaymentProviderOptions,
): PaymentProvider {
  const { connection } = options;
  const binding = connection.binding;
  const now = options.now ?? (() => new Date());
  const origin = apiOriginOf(connection);
  const session =
    options.session ??
    createAirwallexSession({
      connection,
      credentials: options.credentials,
      transport: options.transport,
      now,
    });
  const environment = binding.environment === "LIVE" ? "prod" : "sandbox";

  /** A reference that cannot name an Airwallex intent names no payment of this account. */
  function intentPath(externalReference: string, suffix = ""): string {
    let intentId: string;
    try {
      intentId = fromPlatformReference(externalReference, "paymentIntent");
    } catch {
      throw new AirwallexRejection("PAYMENT_NOT_FOUND");
    }
    return `/api/v1/pa/payment_intents/${intentId}${suffix}`;
  }

  function assertOwned(
    intent: AirwallexPaymentIntent,
    attemptId: string,
    amount?: Readonly<{ amountMinor: number; currency: string }>,
  ): void {
    if (
      intent.merchant_order_id !== attemptId ||
      intent.metadata?.[ATTEMPT_KEY] !== attemptId ||
      (amount !== undefined &&
        (intent.currency !== amount.currency ||
          toMinorAmount(intent.currency, intent.amount) !== amount.amountMinor))
    )
      throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
  }

  /** The requested locale travels in metadata; the immutable binding maps it back. */
  function localeOf(
    intent: AirwallexPaymentIntent,
  ): PaymentRuntimeProviderLocale {
    const requested = supportedLocaleSchema.safeParse(
      intent.metadata?.[LOCALE_KEY],
    );
    if (!requested.success)
      throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
    return binding.localeMapping[requested.data];
  }

  function componentAction(
    intent: AirwallexPaymentIntent,
    locale: PaymentRuntimeProviderLocale,
  ) {
    const cancelUrl = publicHttpsUrlSchema.safeParse(
      intent.metadata?.[CANCEL_URL_KEY],
    );
    if (
      typeof intent.client_secret !== "string" ||
      !cancelUrl.success ||
      new URL(cancelUrl.data).origin !== connection.returnOrigin
    )
      throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
    let clientToken: string;
    try {
      clientToken = encodeAirwallexHppClientToken({
        v: 1,
        env: environment,
        intentId: intent.id,
        clientSecret: intent.client_secret,
        currency: intent.currency as AirwallexHppLaunch["currency"],
        locale: locale.providerLocale as AirwallexHppLaunch["locale"],
        cancelUrl: cancelUrl.data,
      });
    } catch {
      throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
    }
    return {
      schemaVersion: 1 as const,
      type: "PROVIDER_COMPONENT" as const,
      componentKey: AIRWALLEX_HPP_COMPONENT_KEY,
      clientToken,
    };
  }

  function observation(
    intent: AirwallexPaymentIntent,
    locale: PaymentRuntimeProviderLocale,
  ) {
    const status = observeIntentStatus(intent.status);
    if (status === undefined)
      throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
    return {
      status,
      externalReference: toPlatformReference(intent.id, "paymentIntent"),
      providerLocale: locale.providerLocale,
      fallbackUsed: locale.fallbackUsed,
      ...(status === "REQUIRES_ACTION"
        ? { action: componentAction(intent, locale) }
        : {}),
      observedAt: now().toISOString(),
    };
  }

  async function readIntent(
    context: Context,
    externalReference: string,
  ): Promise<AirwallexPaymentIntent> {
    return expectObject(
      context,
      await context.call({
        method: "GET",
        path: intentPath(externalReference),
      }),
      airwallexPaymentIntentSchema,
    );
  }

  /** One attempt creates at most one intent, found again by its merchant order ID. */
  async function findIntentForAttempt(
    context: Context,
    attemptId: string,
  ): Promise<AirwallexPaymentIntent | undefined> {
    const list = expectObject(
      context,
      await context.call({
        method: "GET",
        path: "/api/v1/pa/payment_intents",
        query: [
          ["merchant_order_id", attemptId],
          ["page_num", "0"],
          ["page_size", "10"],
        ],
      }),
      airwallexListSchema,
    );
    const matches: AirwallexPaymentIntent[] = [];
    for (const item of list.items) {
      const intent = airwallexPaymentIntentSchema.safeParse(item);
      if (!intent.success)
        throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
      if (intent.data.merchant_order_id === attemptId)
        matches.push(intent.data);
    }
    if (matches.length > 1 || list.has_more)
      throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
    const [match] = matches;
    // List entries may omit fields such as the client secret; the full object is authoritative.
    return match === undefined
      ? undefined
      : readIntent(context, toPlatformReference(match.id, "paymentIntent"));
  }

  async function findRefund(
    context: Context,
    intentId: string,
    refundId: string,
  ): Promise<AirwallexRefund | undefined> {
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const list = expectObject(
        context,
        await context.call({
          method: "GET",
          path: "/api/v1/pa/refunds",
          query: [
            ["payment_intent_id", intentId],
            ["page_num", String(page)],
            ["page_size", String(PAGE_SIZE)],
          ],
        }),
        airwallexListSchema,
      );
      for (const item of list.items) {
        const refund = airwallexRefundSchema.safeParse(item);
        if (!refund.success)
          throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
        if (
          refund.data.request_id === refundId ||
          refund.data.metadata?.[REFUND_ID_KEY] === refundId
        )
          return refund.data;
      }
      if (!list.has_more) return undefined;
    }
    throw new AirwallexRejection("TEMPORARY_UNAVAILABLE");
  }

  async function paidIntentOf(
    context: Context,
    externalReference: string,
    attemptId: string,
    currency: string,
  ): Promise<AirwallexPaymentIntent> {
    const intent = await readIntent(context, externalReference);
    assertOwned(intent, attemptId);
    if (intent.status !== "SUCCEEDED" || intent.currency !== currency)
      throw new AirwallexRejection("PAYMENT_NOT_FOUND");
    return intent;
  }

  function assertRefund(
    refund: AirwallexRefund,
    command: Command<"REFUND_PAYMENT"> | Command<"RECONCILE_REFUND">,
    intentId: string,
  ): void {
    if (
      refund.payment_intent_id !== intentId ||
      refund.currency !== command.currency ||
      toMinorAmount(refund.currency, refund.amount) !== command.amountMinor ||
      refund.metadata?.[REFUND_ID_KEY] !== command.refundId ||
      refund.metadata?.[REFUND_REFERENCE_KEY] !== command.refundReference
    )
      throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
  }

  function getCapabilities(command: Command<"GET_CAPABILITIES">): unknown {
    if (!command.supportedActionTypes.includes("PROVIDER_COMPONENT"))
      return {
        schemaVersion: 1,
        operation: "GET_CAPABILITIES",
        outcome: "SUCCESS",
        value: { capabilities: [] },
      };
    if (!supportsAmount(command.currency, command.amountMinor))
      throw new AirwallexRejection("CAPABILITY_UNAVAILABLE");
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
          minimumAmountMinor: MINIMUM_AMOUNT_MINOR,
          maximumAmountMinor: MAXIMUM_AMOUNT_MINOR,
          actionTypes: ["PROVIDER_COMPONENT"],
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
      throw new AirwallexRejection("CONFIGURATION_ERROR");
    if (
      !connection.instruments.some(
        (instrument) => instrument.paymentMethod === command.paymentMethod,
      ) ||
      !supportsAmount(command.currency, command.amountMinor)
    )
      throw new AirwallexRejection("CAPABILITY_UNAVAILABLE");
    const response = await context.call({
      method: "POST",
      path: "/api/v1/pa/payment_intents/create",
      body: {
        request_id: command.providerIdempotencyKey,
        amount: toMajorAmount(command.currency, command.amountMinor),
        currency: command.currency,
        merchant_order_id: command.attemptId,
        return_url: command.returnUrl,
        metadata: {
          [ATTEMPT_KEY]: command.attemptId,
          [ORDER_KEY]: command.orderId,
          [LOCALE_KEY]: command.requestedLocale,
          [CANCEL_URL_KEY]: command.cancelUrl,
        },
      },
    });
    let intent: AirwallexPaymentIntent;
    if (hasErrorCode(response, "duplicate_request")) {
      // Airwallex refuses a reused request ID instead of replaying; the intent is found again.
      const found = await findIntentForAttempt(context, command.attemptId);
      if (found === undefined)
        throw new AirwallexRejection("TIMEOUT_OUTCOME_UNKNOWN");
      intent = found;
    } else
      intent = expectObject(context, response, airwallexPaymentIntentSchema);
    assertOwned(intent, command.attemptId, command);
    const observed = observation(
      intent,
      binding.localeMapping[command.requestedLocale],
    );
    if (
      observed.status !== "REQUIRES_ACTION" &&
      observed.status !== "PROCESSING"
    )
      throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
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
    const intent = await readIntent(context, command.externalReference);
    assertOwned(intent, command.attemptId);
    return {
      schemaVersion: 1,
      operation: "GET_PAYMENT",
      outcome: "SUCCESS",
      value: {
        ...observation(intent, localeOf(intent)),
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
      path: intentPath(command.externalReference, "/cancel"),
      body: {
        request_id: command.idempotencyKey,
        cancellation_reason: command.reasonCode,
      },
    });
    // A settled intent refuses cancellation; a repeated request ID was already applied or refused.
    const conflict =
      hasErrorCode(response, "invalid_status_for_operation") ||
      hasErrorCode(response, "duplicate_request");
    const intent = conflict
      ? await readIntent(context, command.externalReference)
      : expectObject(context, response, airwallexPaymentIntentSchema);
    assertOwned(intent, command.attemptId);
    const status = observeIntentStatus(intent.status);
    if (!conflict && status !== "CANCELED")
      throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
    if (conflict && status === "REQUIRES_ACTION")
      throw new AirwallexRejection("CONFIGURATION_ERROR");
    return {
      schemaVersion: 1,
      operation: "CANCEL_PAYMENT",
      outcome: "SUCCESS",
      value: {
        ...observation(intent, localeOf(intent)),
        providerAccountId: command.providerAccountId,
        environment: command.environment,
        attemptId: command.attemptId,
      },
    };
  }

  async function refundPayment(
    context: Context,
    command: Command<"REFUND_PAYMENT">,
  ): Promise<unknown> {
    if (!supportsAmount(command.currency, command.amountMinor))
      throw new AirwallexRejection("CONFIGURATION_ERROR");
    const intent = await paidIntentOf(
      context,
      command.externalReference,
      command.paymentAttemptId,
      command.currency,
    );
    // Look before creating: a request ID is refused when reused, the lookup never expires.
    let refund = await findRefund(context, intent.id, command.refundId);
    if (refund === undefined) {
      const response = await context.call({
        method: "POST",
        path: "/api/v1/pa/refunds/create",
        body: {
          request_id: command.idempotencyKey,
          payment_intent_id: intent.id,
          amount: toMajorAmount(command.currency, command.amountMinor),
          metadata: {
            [REFUND_ID_KEY]: command.refundId,
            [REFUND_REFERENCE_KEY]: command.refundReference,
            [ATTEMPT_KEY]: command.paymentAttemptId,
            [EXTERNAL_REFERENCE_KEY]: command.externalReference,
          },
        },
      });
      if (hasErrorCode(response, "duplicate_request")) {
        refund = await findRefund(context, intent.id, command.refundId);
        if (refund === undefined)
          throw new AirwallexRejection("TIMEOUT_OUTCOME_UNKNOWN");
      } else
        refund = expectObject(
          context,
          response,
          airwallexRefundSchema,
          "REFUND_NOT_FOUND",
        );
    }
    assertRefund(refund, command, intent.id);
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
    const intent =
      command.externalReference === undefined
        ? await findIntentForAttempt(context, command.attemptId)
        : await readIntent(context, command.externalReference);
    if (intent === undefined) throw new AirwallexRejection("PAYMENT_NOT_FOUND");
    assertOwned(intent, command.attemptId, command);
    const status = observeIntentStatus(intent.status);
    if (status === undefined)
      throw new AirwallexRejection("MALFORMED_PROVIDER_RESPONSE");
    const externalReference = toPlatformReference(intent.id, "paymentIntent");
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
          providerEventId: `reconcile:${externalReference}:${status}`,
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
          ...(status === "SUCCEEDED"
            ? {
                transaction: {
                  type: "CAPTURE",
                  providerReference: externalReference,
                },
              }
            : {}),
          status,
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
    const intent = await paidIntentOf(
      context,
      command.externalReference,
      command.paymentAttemptId,
      command.currency,
    );
    const refund = await findRefund(context, intent.id, command.refundId);
    if (refund === undefined) throw new AirwallexRejection("REFUND_NOT_FOUND");
    assertRefund(refund, command, intent.id);
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
    const context: Context = {
      operation,
      async call(request) {
        // An expired token is refused before any work is done, so one fresh-token retry is safe.
        for (let attempt = 0; ; attempt++) {
          // Nothing was sent yet, so running out of time is retryable rather than unknown.
          if (remaining() < 1)
            throw new AirwallexRejection("TEMPORARY_UNAVAILABLE");
          const token = await session.token(remaining());
          const budget = remaining();
          if (budget < 1) throw new AirwallexRejection("TEMPORARY_UNAVAILABLE");
          const response = await options.transport(
            origin,
            request,
            { kind: "token", token },
            budget,
          );
          if (response.status !== 401 || attempt > 0) return response;
          session.invalidate(token);
        }
      },
    };
    let output: unknown;
    try {
      switch (command.operation) {
        case "GET_CAPABILITIES":
          output = getCapabilities(command);
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
      if (error instanceof AirwallexRejection)
        return failure(operation, error.code);
      if (error instanceof AirwallexTransportError)
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
