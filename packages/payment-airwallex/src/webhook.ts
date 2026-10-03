import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  paymentGatewayWebhookConfigSchema,
  providerReferenceSchema,
  type PaymentAccountConnection,
  type PaymentGatewayWebhookConfig,
} from "@fan-support/contracts";
import {
  paymentWebhookVerificationCommandSchema,
  paymentWebhookVerificationResponseSchema,
  type PaymentCredentialResolver,
  type PaymentWebhookVerificationResponse,
  type PaymentWebhookVerifier,
} from "@fan-support/payment-port";

import {
  airwallexDisputeSchema,
  airwallexEventSchema,
  airwallexPaymentIntentSchema,
  airwallexRefundSchema,
  parseAirwallexTimestamp,
  type AirwallexEvent,
} from "./airwallex-objects.js";
import { currencyExponent, toMinorAmount } from "./amounts.js";
import { resolveAirwallexWebhookSecrets } from "./connection.js";
import { toPlatformReference } from "./references.js";
import {
  disputeStatusOf,
  observeIntentStatus,
  refundStatusOf,
} from "./status.js";

export const AIRWALLEX_SIGNATURE_HEADER = "x-signature";
export const AIRWALLEX_TIMESTAMP_HEADER = "x-timestamp";
const ATTEMPT_KEY = "fan_support_attempt_id";
const REFUND_REFERENCE_KEY = "fan_support_refund_reference";

/** The events an Airwallex subscription for this adapter must include, on API version 2026-08-21. */
export const AIRWALLEX_WEBHOOK_EVENT_TYPES = Object.freeze([
  "payment_intent.succeeded",
  "payment_intent.cancelled",
  "payment_intent.pending",
  "payment_intent.pending_review",
  "refund.received",
  "refund.accepted",
  "refund.settled",
  "refund.failed",
  "payment_dispute.requires_response",
  "payment_dispute.challenged",
  "payment_dispute.accepted",
  "payment_dispute.expired",
  "payment_dispute.pending_closure",
  "payment_dispute.pending_decision",
  "payment_dispute.won",
  "payment_dispute.lost",
  "payment_dispute.reversed",
] as const);
const subscribed: ReadonlySet<string> = new Set(AIRWALLEX_WEBHOOK_EVENT_TYPES);

export type AirwallexWebhookVerifierOptions = Readonly<{
  configuration: PaymentGatewayWebhookConfig;
  connection: PaymentAccountConnection;
  credentials: PaymentCredentialResolver;
}>;

type FailureCode =
  | "INVALID_COMMAND"
  | "INVALID_SIGNATURE"
  | "EVENT_OUTSIDE_TOLERANCE"
  | "UNSUPPORTED_EVENT"
  | "TEMPORARY_UNAVAILABLE"
  | "CONFIGURATION_ERROR"
  | "MALFORMED_PROVIDER_RESPONSE";

class Rejection extends Error {
  public constructor(public readonly code: FailureCode) {
    super("Airwallex webhook rejected");
  }
}

function failure(code: FailureCode): PaymentWebhookVerificationResponse {
  return paymentWebhookVerificationResponseSchema.parse({
    schemaVersion: 1,
    operation: "VERIFY_PAYMENT_WEBHOOK",
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery:
        code === "TEMPORARY_UNAVAILABLE" ? "RETRY_SAME_COMMAND" : "NONE",
      ...(code === "TEMPORARY_UNAVAILABLE" ? { retryAfterMs: 1_000 } : {}),
    },
  });
}

/** The platform never creates intents in unlisted currencies, so such events are not ours. */
function minorAmountOf(currency: string, amount: number): number {
  if (currencyExponent(currency) === undefined)
    throw new Rejection("UNSUPPORTED_EVENT");
  const minor = toMinorAmount(currency, amount);
  if (minor === undefined) throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
  return minor;
}

function candidateOf(event: AirwallexEvent) {
  const occurredAt = parseAirwallexTimestamp(event.created_at);
  if (occurredAt === undefined)
    throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
  if (!subscribed.has(event.name)) throw new Rejection("UNSUPPORTED_EVENT");
  const base = {
    schemaVersion: 1 as const,
    providerEventId: toPlatformReference(event.id, "event"),
    occurredAt: new Date(occurredAt).toISOString(),
  };
  if (event.name.startsWith("payment_intent.")) {
    const intent = airwallexPaymentIntentSchema.safeParse(event.data.object);
    if (!intent.success) throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
    const attemptId = intent.data.metadata?.[ATTEMPT_KEY];
    // Intents from payment links or the dashboard carry no platform attempt.
    if (typeof attemptId !== "string") throw new Rejection("UNSUPPORTED_EVENT");
    if (attemptId !== intent.data.merchant_order_id)
      throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
    // The object is the authoritative snapshot; the event name only selects the family.
    const status = observeIntentStatus(intent.data.status);
    if (status === undefined)
      throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
    if (status === "REQUIRES_ACTION") throw new Rejection("UNSUPPORTED_EVENT");
    const externalReference = toPlatformReference(
      intent.data.id,
      "paymentIntent",
    );
    return {
      ...base,
      eventType: "PAYMENT_STATUS" as const,
      externalReference,
      ...(status === "SUCCEEDED"
        ? {
            transaction: {
              type: "CAPTURE" as const,
              providerReference: externalReference,
            },
          }
        : {}),
      status,
      amountMinor: minorAmountOf(intent.data.currency, intent.data.amount),
      currency: intent.data.currency,
    };
  }
  if (event.name.startsWith("refund.")) {
    const refund = airwallexRefundSchema.safeParse(event.data.object);
    if (!refund.success) throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
    const reference = refund.data.metadata?.[REFUND_REFERENCE_KEY];
    // Refunds made in the Airwallex web app carry no platform references.
    if (
      typeof reference !== "string" ||
      !providerReferenceSchema.safeParse(reference).success
    )
      throw new Rejection("UNSUPPORTED_EVENT");
    const status = refundStatusOf(refund.data);
    return {
      ...base,
      eventType: "REFUND_STATUS" as const,
      externalReference: toPlatformReference(
        refund.data.payment_intent_id,
        "paymentIntent",
      ),
      ...(status === "SUCCEEDED"
        ? {
            transaction: {
              type: "REFUND" as const,
              providerReference: toPlatformReference(refund.data.id, "refund"),
            },
          }
        : {}),
      refundReference: reference,
      status,
      amountMinor: minorAmountOf(refund.data.currency, refund.data.amount),
      currency: refund.data.currency,
    };
  }
  const dispute = airwallexDisputeSchema.safeParse(event.data.object);
  if (!dispute.success) throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
  const intentId = dispute.data.payment_intent_id;
  // A dispute raised against a refund has no platform payment state to move.
  if (
    typeof intentId !== "string" ||
    dispute.data.transaction_type === "REFUND"
  )
    throw new Rejection("UNSUPPORTED_EVENT");
  const status = disputeStatusOf(dispute.data);
  const disputeReference = toPlatformReference(dispute.data.id, "dispute");
  return {
    ...base,
    eventType: "DISPUTE_STATUS" as const,
    externalReference: toPlatformReference(intentId, "paymentIntent"),
    ...(status === "OPEN" || status === "LOST"
      ? {
          transaction: {
            type: "CHARGEBACK" as const,
            providerReference: disputeReference,
          },
        }
      : {}),
    disputeReference,
    status,
    amountMinor: minorAmountOf(dispute.data.currency, dispute.data.amount),
    currency: dispute.data.currency,
  };
}

export function createAirwallexWebhookVerifier(
  options: AirwallexWebhookVerifierOptions,
): PaymentWebhookVerifier {
  const configuration = paymentGatewayWebhookConfigSchema.parse(
    options.configuration,
  );
  const { connection } = options;
  if (
    JSON.stringify(configuration.binding) !== JSON.stringify(connection.binding)
  )
    throw new TypeError(
      "Airwallex webhook endpoint belongs to another account",
    );

  return Object.freeze({
    async verifyPaymentWebhook(input: unknown) {
      const parsed = paymentWebhookVerificationCommandSchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_COMMAND");
      const command = parsed.data;
      if (
        command.endpointId !== configuration.endpointId ||
        command.providerAccountId !== connection.binding.providerAccountId ||
        command.environment !== connection.binding.environment ||
        command.verificationKeyReferenceHash !==
          configuration.verificationKeyReferenceHash
      )
        return failure("CONFIGURATION_ERROR");
      try {
        const raw = Buffer.from(command.rawBodyBase64, "base64url");
        if (raw.length > configuration.maxBodyBytes)
          return failure("INVALID_COMMAND");
        const timestamp = command.headers[AIRWALLEX_TIMESTAMP_HEADER];
        const signature = command.headers[AIRWALLEX_SIGNATURE_HEADER];
        if (
          timestamp === undefined ||
          signature === undefined ||
          !/^[1-9][0-9]{9,15}$/u.test(timestamp) ||
          !/^[0-9a-fA-F]{64}$/u.test(signature)
        )
          return failure("INVALID_SIGNATURE");
        const signedAt = Number(timestamp);
        if (
          Math.abs(Date.parse(command.receivedAt) - signedAt) / 1000 >
          configuration.toleranceSeconds
        )
          return failure("EVENT_OUTSIDE_TOLERANCE");
        let secrets: readonly string[];
        try {
          secrets = await resolveAirwallexWebhookSecrets(
            options.credentials,
            connection,
            configuration.secretRef,
            connection.timeoutMs,
          );
        } catch {
          return failure("TEMPORARY_UNAVAILABLE");
        }
        // The digest covers the timestamp exactly as received, then the untouched body bytes.
        const signed = Buffer.concat([Buffer.from(timestamp, "utf8"), raw]);
        const presented = Buffer.from(signature, "hex");
        let matched = false;
        for (const secret of secrets) {
          const expected = createHmac("sha256", secret).update(signed).digest();
          matched = timingSafeEqual(expected, presented) || matched;
        }
        if (!matched) return failure("INVALID_SIGNATURE");
        let body: unknown;
        try {
          body = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(raw),
          ) as unknown;
        } catch {
          return failure("MALFORMED_PROVIDER_RESPONSE");
        }
        const event = airwallexEventSchema.safeParse(body);
        if (!event.success) return failure("MALFORMED_PROVIDER_RESPONSE");
        const response = paymentWebhookVerificationResponseSchema.safeParse({
          schemaVersion: 1,
          operation: "VERIFY_PAYMENT_WEBHOOK",
          outcome: "SUCCESS",
          value: {
            endpointId: command.endpointId,
            providerAccountId: command.providerAccountId,
            environment: command.environment,
            verificationKeyReferenceHash: command.verificationKeyReferenceHash,
            signatureTimestamp: new Date(signedAt).toISOString(),
            candidate: candidateOf(event.data),
          },
        });
        return response.success
          ? response.data
          : failure("MALFORMED_PROVIDER_RESPONSE");
      } catch (error) {
        return failure(
          error instanceof Rejection
            ? error.code
            : "MALFORMED_PROVIDER_RESPONSE",
        );
      }
    },
  } satisfies PaymentWebhookVerifier);
}
