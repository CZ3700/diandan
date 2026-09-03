import {
  paymentPortCommandSchema,
  paymentPortResponseSchema,
  type CancelPaymentCommand,
  type CancelPaymentResponse,
  type CreatePaymentCommand,
  type CreatePaymentResponse,
  type GetPaymentCapabilitiesCommand,
  type GetPaymentCapabilitiesResponse,
  type GetPaymentCommand,
  type GetPaymentResponse,
  type LegacyWebhookParser,
  type PaymentProvider,
  type ReconcilePaymentCommand,
  type ReconcilePaymentResponse,
  type ReconcileRefundCommand,
  type ReconcileRefundResponse,
  type RefundPaymentCommand,
  type RefundPaymentResponse,
  type VerifyAndParseWebhookCommand,
  type VerifyAndParseWebhookResponse,
} from "@fan-support/payment-port";

export type FakePaymentProviderOptions = Readonly<{
  now?: string;
  providerLocale?: string;
  reconcilePaymentStatus?: "PROCESSING" | "SUCCEEDED" | "FAILED";
  createPaymentOutcome?: "SUCCESS" | "TIMEOUT_AFTER_ACCEPT";
}>;

type PaymentState = {
  createFingerprint: string;
  providerAccountId: string;
  environment: "TEST" | "LIVE";
  attemptId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  externalReference: string;
  providerLocale: string;
  fallbackUsed: boolean;
  status:
    | "REQUIRES_ACTION"
    | "PROCESSING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELED"
    | "EXPIRED"
    | "UNKNOWN";
  refundedAmountMinor: number;
};

type RefundState = Readonly<{
  fingerprint: string;
  providerAccountId: string;
  environment: "TEST" | "LIVE";
  refundId: string;
  paymentAttemptId: string;
  idempotencyKey: string;
  externalReference: string;
  amountMinor: number;
  currency: string;
  refundReference: string;
  status: "SUCCEEDED";
  observedAt: string;
  response: RefundPaymentResponse;
}>;

function parsedResponse<Response>(value: unknown): Response {
  return paymentPortResponseSchema.parse(value) as Response;
}

function failure<Response>(
  operation: string,
  code:
    | "INVALID_COMMAND"
    | "CAPABILITY_UNAVAILABLE"
    | "PAYMENT_NOT_FOUND"
    | "REFUND_NOT_FOUND"
    | "IDEMPOTENCY_CONFLICT"
    | "PROVIDER_DECLINED"
    | "INVALID_SIGNATURE"
    | "EVENT_OUTSIDE_TOLERANCE"
    | "UNSUPPORTED_EVENT"
    | "AUTHENTICATION_FAILED"
    | "CONFIGURATION_ERROR"
    | "TIMEOUT_OUTCOME_UNKNOWN"
    | "MALFORMED_PROVIDER_RESPONSE",
): Response {
  const mutationOperation = [
    "CREATE_PAYMENT",
    "CANCEL_PAYMENT",
    "REFUND_PAYMENT",
  ].includes(operation);
  const recovery =
    code === "TIMEOUT_OUTCOME_UNKNOWN" ||
    (code === "MALFORMED_PROVIDER_RESPONSE" && mutationOperation)
      ? "RECONCILE_REQUIRED"
      : "NONE";
  return parsedResponse({
    schemaVersion: 1,
    operation,
    outcome: "FAILURE",
    error: { schemaVersion: 1, code, recovery },
  });
}

export function createFakePaymentProvider(
  options: FakePaymentProviderOptions = {},
): PaymentProvider & LegacyWebhookParser {
  const now = options.now ?? "2026-09-03T00:00:00.000Z";
  const forcedProviderLocale = options.providerLocale;
  const reconcilePaymentStatus = options.reconcilePaymentStatus ?? "SUCCEEDED";
  const createPaymentOutcome = options.createPaymentOutcome ?? "SUCCESS";
  const payments = new Map<string, PaymentState>();
  const cancellations = new Map<
    string,
    { fingerprint: string; response: CancelPaymentResponse }
  >();
  const refunds = new Map<string, RefundState>();

  function observation(state: PaymentState) {
    return {
      status: state.status,
      externalReference: state.externalReference,
      providerLocale: state.providerLocale,
      fallbackUsed: state.fallbackUsed,
      observedAt: now,
      ...(state.status === "REQUIRES_ACTION"
        ? {
            action: {
              schemaVersion: 1,
              type: "REDIRECT",
              url: `https://payments.example.invalid/continue/${state.externalReference.split("/").at(-1) ?? "fixture"}`,
            },
          }
        : {}),
    };
  }

  function identifiedObservation(state: PaymentState) {
    return {
      ...observation(state),
      providerAccountId: state.providerAccountId,
      environment: state.environment,
      attemptId: state.attemptId,
    };
  }

  function paymentIdentityMatches(
    state: PaymentState,
    command: Readonly<{
      providerAccountId: string;
      environment: "TEST" | "LIVE";
      externalReference?: string | undefined;
    }>,
  ): boolean {
    return (
      state.providerAccountId === command.providerAccountId &&
      state.environment === command.environment &&
      (command.externalReference === undefined ||
        state.externalReference === command.externalReference)
    );
  }

  return Object.freeze({
    async getCapabilities(
      command: GetPaymentCapabilitiesCommand,
    ): Promise<GetPaymentCapabilitiesResponse> {
      const parsed = paymentPortCommandSchema.safeParse(command);
      if (!parsed.success || parsed.data.operation !== "GET_CAPABILITIES") {
        return failure("GET_CAPABILITIES", "INVALID_COMMAND");
      }
      if (parsed.data.environment === "LIVE") {
        return failure("GET_CAPABILITIES", "CONFIGURATION_ERROR");
      }
      const supportsRedirect =
        parsed.data.supportedActionTypes.includes("REDIRECT");
      return parsedResponse({
        schemaVersion: 1,
        operation: "GET_CAPABILITIES",
        outcome: "SUCCESS",
        value: {
          capabilities: supportsRedirect
            ? [
                {
                  schemaVersion: 1,
                  id: "30000000-0000-4000-8000-000000000001",
                  paymentMethod: "fake_card",
                  displayName: "Fake card",
                  market: parsed.data.market,
                  country: parsed.data.country,
                  currency: parsed.data.currency,
                  minimumAmountMinor: 1,
                  maximumAmountMinor: Number.MAX_SAFE_INTEGER,
                  actionTypes: ["REDIRECT"],
                  available: true,
                },
              ]
            : [],
        },
      });
    },

    async createPayment(
      command: CreatePaymentCommand,
    ): Promise<CreatePaymentResponse> {
      const parsed = paymentPortCommandSchema.safeParse(command);
      if (!parsed.success || parsed.data.operation !== "CREATE_PAYMENT") {
        return failure("CREATE_PAYMENT", "INVALID_COMMAND");
      }
      if (parsed.data.environment === "LIVE") {
        return failure("CREATE_PAYMENT", "CONFIGURATION_ERROR");
      }
      if (parsed.data.paymentMethod !== "fake_card") {
        return failure("CREATE_PAYMENT", "CAPABILITY_UNAVAILABLE");
      }
      const attemptId = String(parsed.data.attemptId);
      const fingerprint = JSON.stringify(parsed.data);
      const existing = payments.get(attemptId);
      if (existing !== undefined) {
        if (existing.createFingerprint !== fingerprint) {
          return failure("CREATE_PAYMENT", "IDEMPOTENCY_CONFLICT");
        }
        return parsedResponse({
          schemaVersion: 1,
          operation: "CREATE_PAYMENT",
          outcome: "SUCCESS",
          value: {
            ...identifiedObservation(existing),
            orderId: existing.orderId,
            amountMinor: existing.amountMinor,
            currency: existing.currency,
          },
        });
      }
      const state: PaymentState = {
        createFingerprint: fingerprint,
        providerAccountId: parsed.data.providerAccountId,
        environment: parsed.data.environment,
        attemptId,
        orderId: parsed.data.orderId,
        amountMinor: parsed.data.amountMinor,
        currency: parsed.data.currency,
        externalReference: `fake-payment/${attemptId}`,
        providerLocale: forcedProviderLocale ?? parsed.data.requestedLocale,
        fallbackUsed:
          forcedProviderLocale !== undefined &&
          forcedProviderLocale !== parsed.data.requestedLocale,
        status: "REQUIRES_ACTION",
        refundedAmountMinor: 0,
      };
      payments.set(attemptId, state);
      if (createPaymentOutcome === "TIMEOUT_AFTER_ACCEPT") {
        return failure("CREATE_PAYMENT", "TIMEOUT_OUTCOME_UNKNOWN");
      }
      return parsedResponse({
        schemaVersion: 1,
        operation: "CREATE_PAYMENT",
        outcome: "SUCCESS",
        value: {
          ...identifiedObservation(state),
          orderId: state.orderId,
          amountMinor: state.amountMinor,
          currency: state.currency,
        },
      });
    },

    async verifyAndParseWebhook(
      command: VerifyAndParseWebhookCommand,
    ): Promise<VerifyAndParseWebhookResponse> {
      const parsed = paymentPortCommandSchema.safeParse(command);
      if (
        !parsed.success ||
        parsed.data.operation !== "VERIFY_AND_PARSE_WEBHOOK"
      ) {
        return failure("VERIFY_AND_PARSE_WEBHOOK", "INVALID_COMMAND");
      }
      if (parsed.data.environment === "LIVE") {
        return failure("VERIFY_AND_PARSE_WEBHOOK", "CONFIGURATION_ERROR");
      }
      // Raw webhook authentication and parsing is intentionally owned by P1-06.
      return failure("VERIFY_AND_PARSE_WEBHOOK", "UNSUPPORTED_EVENT");
    },

    async getPayment(command: GetPaymentCommand): Promise<GetPaymentResponse> {
      const parsed = paymentPortCommandSchema.safeParse(command);
      if (!parsed.success || parsed.data.operation !== "GET_PAYMENT") {
        return failure("GET_PAYMENT", "INVALID_COMMAND");
      }
      if (parsed.data.environment === "LIVE") {
        return failure("GET_PAYMENT", "CONFIGURATION_ERROR");
      }
      const state = payments.get(String(parsed.data.attemptId));
      if (state === undefined || !paymentIdentityMatches(state, parsed.data)) {
        return failure("GET_PAYMENT", "PAYMENT_NOT_FOUND");
      }
      return parsedResponse({
        schemaVersion: 1,
        operation: "GET_PAYMENT",
        outcome: "SUCCESS",
        value: identifiedObservation(state),
      });
    },

    async cancelPayment(
      command: CancelPaymentCommand,
    ): Promise<CancelPaymentResponse> {
      const parsed = paymentPortCommandSchema.safeParse(command);
      if (!parsed.success || parsed.data.operation !== "CANCEL_PAYMENT") {
        return failure("CANCEL_PAYMENT", "INVALID_COMMAND");
      }
      if (parsed.data.environment === "LIVE") {
        return failure("CANCEL_PAYMENT", "CONFIGURATION_ERROR");
      }
      const state = payments.get(String(parsed.data.attemptId));
      if (state === undefined || !paymentIdentityMatches(state, parsed.data)) {
        return failure("CANCEL_PAYMENT", "PAYMENT_NOT_FOUND");
      }
      const fingerprint = JSON.stringify(parsed.data);
      const existing = cancellations.get(String(parsed.data.attemptId));
      if (existing !== undefined) {
        return existing.fingerprint === fingerprint
          ? existing.response
          : failure("CANCEL_PAYMENT", "IDEMPOTENCY_CONFLICT");
      }
      if (!["REQUIRES_ACTION", "PROCESSING"].includes(state.status)) {
        return failure("CANCEL_PAYMENT", "PROVIDER_DECLINED");
      }
      state.status = "CANCELED";
      const response = parsedResponse<CancelPaymentResponse>({
        schemaVersion: 1,
        operation: "CANCEL_PAYMENT",
        outcome: "SUCCESS",
        value: identifiedObservation(state),
      });
      cancellations.set(String(parsed.data.attemptId), {
        fingerprint,
        response,
      });
      return response;
    },

    async refundPayment(
      command: RefundPaymentCommand,
    ): Promise<RefundPaymentResponse> {
      const parsed = paymentPortCommandSchema.safeParse(command);
      if (!parsed.success || parsed.data.operation !== "REFUND_PAYMENT") {
        return failure("REFUND_PAYMENT", "INVALID_COMMAND");
      }
      if (parsed.data.environment === "LIVE") {
        return failure("REFUND_PAYMENT", "CONFIGURATION_ERROR");
      }
      const state = payments.get(String(parsed.data.paymentAttemptId));
      if (state === undefined || !paymentIdentityMatches(state, parsed.data)) {
        return failure("REFUND_PAYMENT", "PAYMENT_NOT_FOUND");
      }
      const fingerprint = JSON.stringify(parsed.data);
      const idempotencyKey = String(parsed.data.idempotencyKey);
      const existing = refunds.get(idempotencyKey);
      if (existing !== undefined) {
        return existing.fingerprint === fingerprint
          ? existing.response
          : failure("REFUND_PAYMENT", "IDEMPOTENCY_CONFLICT");
      }
      if (
        state.status !== "SUCCEEDED" ||
        state.currency !== parsed.data.currency ||
        parsed.data.amountMinor > state.amountMinor - state.refundedAmountMinor
      ) {
        return failure("REFUND_PAYMENT", "PROVIDER_DECLINED");
      }
      const refundReference = parsed.data.refundReference;
      const response = parsedResponse<RefundPaymentResponse>({
        schemaVersion: 1,
        operation: "REFUND_PAYMENT",
        outcome: "SUCCESS",
        value: {
          providerAccountId: parsed.data.providerAccountId,
          environment: parsed.data.environment,
          refundId: parsed.data.refundId,
          paymentAttemptId: parsed.data.paymentAttemptId,
          status: "PROCESSING",
          refundReference,
          amountMinor: parsed.data.amountMinor,
          currency: parsed.data.currency,
          observedAt: now,
        },
      });
      state.refundedAmountMinor += parsed.data.amountMinor;
      refunds.set(idempotencyKey, {
        fingerprint,
        providerAccountId: parsed.data.providerAccountId,
        environment: parsed.data.environment,
        refundId: parsed.data.refundId,
        paymentAttemptId: parsed.data.paymentAttemptId,
        idempotencyKey,
        externalReference: parsed.data.externalReference,
        amountMinor: parsed.data.amountMinor,
        currency: parsed.data.currency,
        refundReference,
        status: "SUCCEEDED",
        observedAt: now,
        response,
      });
      return response;
    },

    async reconcilePayment(
      command: ReconcilePaymentCommand,
    ): Promise<ReconcilePaymentResponse> {
      const parsed = paymentPortCommandSchema.safeParse(command);
      if (!parsed.success || parsed.data.operation !== "RECONCILE_PAYMENT") {
        return failure("RECONCILE_PAYMENT", "INVALID_COMMAND");
      }
      if (parsed.data.environment === "LIVE") {
        return failure("RECONCILE_PAYMENT", "CONFIGURATION_ERROR");
      }
      const state = payments.get(String(parsed.data.attemptId));
      if (
        state === undefined ||
        !paymentIdentityMatches(state, parsed.data) ||
        state.amountMinor !== parsed.data.amountMinor ||
        state.currency !== parsed.data.currency
      ) {
        return failure("RECONCILE_PAYMENT", "PAYMENT_NOT_FOUND");
      }
      if (
        !["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].includes(state.status)
      ) {
        state.status = reconcilePaymentStatus;
      }
      return parsedResponse({
        schemaVersion: 1,
        operation: "RECONCILE_PAYMENT",
        outcome: "SUCCESS",
        value: {
          event: {
            schemaVersion: 1,
            providerAccountId: state.providerAccountId,
            environment: state.environment,
            // A reconcile observation is scoped to its audit evidence. Reusing
            // a provider event ID with a different audit ID would violate the
            // persistence authority's immutable event identity.
            providerEventId: `fake-event/payment/${state.attemptId}/${state.status}/${parsed.data.auditLogId}`,
            evidence: {
              kind: "AUTHENTICATED_RECONCILE",
              auditLogId: parsed.data.auditLogId,
            },
            occurredAt: now,
            association: {
              status: "MATCHED",
              paymentAttemptId: state.attemptId,
              externalReference: state.externalReference,
            },
            eventType: "PAYMENT_STATUS",
            status: state.status,
            amountMinor: state.amountMinor,
            currency: state.currency,
            ...(state.status === "SUCCEEDED"
              ? {
                  transaction: {
                    type: "CAPTURE",
                    providerReference: `fake-native-capture/${state.attemptId}`,
                  },
                }
              : {}),
          },
        },
      });
    },

    async reconcileRefund(
      command: ReconcileRefundCommand,
    ): Promise<ReconcileRefundResponse> {
      const parsed = paymentPortCommandSchema.safeParse(command);
      if (!parsed.success || parsed.data.operation !== "RECONCILE_REFUND") {
        return failure("RECONCILE_REFUND", "INVALID_COMMAND");
      }
      if (parsed.data.environment === "LIVE") {
        return failure("RECONCILE_REFUND", "CONFIGURATION_ERROR");
      }
      const refund = refunds.get(String(parsed.data.idempotencyKey));
      if (
        refund === undefined ||
        refund.providerAccountId !== parsed.data.providerAccountId ||
        refund.environment !== parsed.data.environment ||
        refund.refundId !== parsed.data.refundId ||
        refund.paymentAttemptId !== parsed.data.paymentAttemptId ||
        refund.externalReference !== parsed.data.externalReference ||
        refund.refundReference !== parsed.data.refundReference ||
        refund.amountMinor !== parsed.data.amountMinor ||
        refund.currency !== parsed.data.currency
      ) {
        return failure("RECONCILE_REFUND", "REFUND_NOT_FOUND");
      }
      return parsedResponse({
        schemaVersion: 1,
        operation: "RECONCILE_REFUND",
        outcome: "SUCCESS",
        value: {
          refundId: refund.refundId,
          idempotencyKey: refund.idempotencyKey,
          event: {
            schemaVersion: 1,
            providerAccountId: refund.providerAccountId,
            environment: refund.environment,
            providerEventId: `fake-event/refund/${refund.refundId}/${refund.status}/${parsed.data.auditLogId}`,
            evidence: {
              kind: "AUTHENTICATED_RECONCILE",
              auditLogId: parsed.data.auditLogId,
            },
            occurredAt: refund.observedAt,
            association: {
              status: "MATCHED",
              paymentAttemptId: refund.paymentAttemptId,
              externalReference: refund.externalReference,
            },
            eventType: "REFUND_STATUS",
            refundReference: refund.refundReference,
            status: refund.status,
            amountMinor: refund.amountMinor,
            currency: refund.currency,
            transaction: {
              type: "REFUND",
              providerReference: `fake-native-refund/${refund.refundId}`,
            },
          },
        },
      });
    },
  });
}

export const workspacePackageName = "@fan-support/payment-fake" as const;

export {
  createFakePaymentWebhookVerifier,
  type FakePaymentWebhookVerifierOptions,
} from "./webhook.js";
