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
  resolveStripeSecretKey,
  resolveStripeWebhookSecrets,
} from "./connection.js";
import { isStripeId, toPlatformReference } from "./references.js";
import { disputeStatusOf, refundStatusOf } from "./status.js";
import {
  paymentIntentIdOf,
  stripeDisputeSchema,
  stripeEventSchema,
  stripeListSchema,
  stripeRefundSchema,
  stripeSessionSchema,
  type StripeEvent,
} from "./stripe-objects.js";
import { type StripeTransport } from "./transport.js";

export const STRIPE_SIGNATURE_HEADER = "stripe-signature";
const REFUND_REFERENCE_KEY = "fan_support_refund_reference";
const EXTERNAL_REFERENCE_KEY = "fan_support_external_reference";

export type StripeWebhookVerifierOptions = Readonly<{
  configuration: PaymentGatewayWebhookConfig;
  connection: PaymentAccountConnection;
  credentials: PaymentCredentialResolver;
  transport: StripeTransport;
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
    super("Stripe webhook rejected");
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

/** `t=<seconds>,v1=<hex>[,v1=…]`; other schemes (v0) are ignored to prevent downgrade. */
function parseSignatureHeader(
  value: string | undefined,
): Readonly<{ timestamp: number; signatures: readonly Buffer[] }> | undefined {
  if (value === undefined) return undefined;
  const entries = value.split(",");
  if (entries.length > 32) return undefined;
  let timestamp: number | undefined;
  const signatures: Buffer[] = [];
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    const key = entry.slice(0, separator);
    const item = entry.slice(separator + 1);
    if (key === "t") {
      if (timestamp !== undefined || !/^[1-9][0-9]{0,11}$/u.test(item))
        return undefined;
      timestamp = Number(item);
    } else if (key === "v1" && /^[0-9a-f]{64}$/u.test(item)) {
      signatures.push(Buffer.from(item, "hex"));
    }
  }
  return timestamp === undefined || signatures.length === 0
    ? undefined
    : { timestamp, signatures };
}

const isPlatformSessionReference = (value: string | undefined) =>
  value !== undefined &&
  providerReferenceSchema.safeParse(value).success &&
  isStripeId(value.replaceAll(".", "_"), "session");

export function createStripeWebhookVerifier(
  options: StripeWebhookVerifierOptions,
): PaymentWebhookVerifier {
  const configuration = paymentGatewayWebhookConfigSchema.parse(
    options.configuration,
  );
  const { connection } = options;
  if (
    JSON.stringify(configuration.binding) !== JSON.stringify(connection.binding)
  )
    throw new TypeError("Stripe webhook endpoint belongs to another account");
  const livemode = connection.binding.environment === "LIVE";

  async function sessionReferenceForIntent(intentId: string): Promise<string> {
    let secretKey: string;
    try {
      secretKey = await resolveStripeSecretKey(
        options.credentials,
        connection,
        connection.timeoutMs,
      );
    } catch {
      throw new Rejection("TEMPORARY_UNAVAILABLE");
    }
    let body: unknown;
    try {
      const response = await options.transport(
        {
          method: "GET",
          path: "/v1/checkout/sessions",
          parameters: [
            ["payment_intent", intentId],
            ["limit", "1"],
          ],
        },
        secretKey,
        connection.timeoutMs,
      );
      if (response.status !== 200) throw new Error("lookup failed");
      body = response.body;
    } catch {
      throw new Rejection("TEMPORARY_UNAVAILABLE");
    }
    const list = stripeListSchema.safeParse(body);
    const session = list.success
      ? stripeSessionSchema.safeParse(list.data.data[0])
      : undefined;
    // A dispute on a payment that did not come from our Checkout has nothing to associate with.
    if (session === undefined || !session.success)
      throw new Rejection("UNSUPPORTED_EVENT");
    return toPlatformReference(session.data.id, "session");
  }

  async function candidateOf(event: StripeEvent) {
    const base = {
      schemaVersion: 1 as const,
      providerEventId: toPlatformReference(event.id, "event"),
      occurredAt: new Date(event.created * 1000).toISOString(),
    };
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const session = stripeSessionSchema.safeParse(event.data.object);
        if (
          !session.success ||
          session.data.amount_total === null ||
          session.data.currency === null
        )
          throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
        const status =
          event.type === "checkout.session.expired"
            ? "EXPIRED"
            : event.type === "checkout.session.async_payment_failed"
              ? "FAILED"
              : event.type === "checkout.session.async_payment_succeeded" ||
                  session.data.payment_status === "paid"
                ? "SUCCEEDED"
                : "PROCESSING";
        const intentId = paymentIntentIdOf(session.data);
        if (status === "SUCCEEDED" && intentId === undefined)
          throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
        return {
          ...base,
          eventType: "PAYMENT_STATUS" as const,
          externalReference: toPlatformReference(session.data.id, "session"),
          ...(status === "SUCCEEDED" && intentId !== undefined
            ? {
                transaction: {
                  type: "CAPTURE" as const,
                  providerReference: toPlatformReference(
                    intentId,
                    "paymentIntent",
                  ),
                },
              }
            : {}),
          status,
          amountMinor: session.data.amount_total,
          currency: session.data.currency.toUpperCase(),
        };
      }
      case "refund.created":
      case "refund.updated":
      case "refund.failed": {
        const refund = stripeRefundSchema.safeParse(event.data.object);
        if (!refund.success) throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
        const reference = refund.data.metadata?.[REFUND_REFERENCE_KEY];
        const external = refund.data.metadata?.[EXTERNAL_REFERENCE_KEY];
        // Refunds made outside the platform carry no platform references.
        if (
          reference === undefined ||
          !providerReferenceSchema.safeParse(reference).success ||
          !isPlatformSessionReference(external)
        )
          throw new Rejection("UNSUPPORTED_EVENT");
        const status = refundStatusOf(refund.data);
        return {
          ...base,
          eventType: "REFUND_STATUS" as const,
          externalReference: external,
          ...(status === "SUCCEEDED"
            ? {
                transaction: {
                  type: "REFUND" as const,
                  providerReference: toPlatformReference(
                    refund.data.id,
                    "refund",
                  ),
                },
              }
            : {}),
          refundReference: reference,
          status,
          amountMinor: refund.data.amount,
          currency: refund.data.currency.toUpperCase(),
        };
      }
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed": {
        const dispute = stripeDisputeSchema.safeParse(event.data.object);
        if (!dispute.success)
          throw new Rejection("MALFORMED_PROVIDER_RESPONSE");
        if (dispute.data.payment_intent === null)
          throw new Rejection("UNSUPPORTED_EVENT");
        const status = disputeStatusOf(dispute.data);
        const disputeReference = toPlatformReference(
          dispute.data.id,
          "dispute",
        );
        return {
          ...base,
          eventType: "DISPUTE_STATUS" as const,
          externalReference: await sessionReferenceForIntent(
            dispute.data.payment_intent,
          ),
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
          amountMinor: dispute.data.amount,
          currency: dispute.data.currency.toUpperCase(),
        };
      }
      default:
        throw new Rejection("UNSUPPORTED_EVENT");
    }
  }

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
        const signature = parseSignatureHeader(
          command.headers[STRIPE_SIGNATURE_HEADER],
        );
        if (signature === undefined) return failure("INVALID_SIGNATURE");
        if (
          Math.abs(
            Date.parse(command.receivedAt) / 1000 - signature.timestamp,
          ) > configuration.toleranceSeconds
        )
          return failure("EVENT_OUTSIDE_TOLERANCE");
        let secrets: readonly string[];
        try {
          secrets = await resolveStripeWebhookSecrets(
            options.credentials,
            connection,
            configuration.secretRef,
            connection.timeoutMs,
          );
        } catch {
          return failure("TEMPORARY_UNAVAILABLE");
        }
        const signed = Buffer.concat([
          Buffer.from(`${signature.timestamp}.`, "utf8"),
          raw,
        ]);
        let matched = false;
        for (const secret of secrets) {
          const expected = createHmac("sha256", secret).update(signed).digest();
          for (const candidate of signature.signatures)
            matched = timingSafeEqual(expected, candidate) || matched;
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
        const event = stripeEventSchema.safeParse(body);
        if (!event.success) return failure("MALFORMED_PROVIDER_RESPONSE");
        if (event.data.livemode !== livemode)
          return failure("CONFIGURATION_ERROR");
        const response = paymentWebhookVerificationResponseSchema.safeParse({
          schemaVersion: 1,
          operation: "VERIFY_PAYMENT_WEBHOOK",
          outcome: "SUCCESS",
          value: {
            endpointId: command.endpointId,
            providerAccountId: command.providerAccountId,
            environment: command.environment,
            verificationKeyReferenceHash: command.verificationKeyReferenceHash,
            signatureTimestamp: new Date(
              signature.timestamp * 1000,
            ).toISOString(),
            candidate: await candidateOf(event.data),
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

/** The events a Stripe endpoint for this adapter must subscribe to. */
export const STRIPE_WEBHOOK_EVENT_TYPES = Object.freeze([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const);
