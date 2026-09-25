import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  paymentGatewayWebhookConfigSchema,
  verifiedWebhookEventCandidateSchema,
  providerAccountIdSchema,
  type PaymentAccountConnection,
  type PaymentGatewayWebhookConfig,
} from "@fan-support/contracts";
import {
  paymentWebhookVerificationCommandSchema,
  paymentWebhookVerificationResponseSchema,
  type PaymentWebhookVerifier,
  type PaymentWebhookVerificationResponse,
} from "@fan-support/payment-port";
import {
  resolveGatewayCredentials,
  type GatewayCredentialResolver,
} from "./credentials.js";
import { parseGatewayConnection } from "./client.js";
export type GatewayWebhookVerifierOptions = Readonly<{
  configuration: PaymentGatewayWebhookConfig;
  connection: PaymentAccountConnection;
  credentials: GatewayCredentialResolver;
}>;
const envelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  protocol: z.literal("fan-support-gateway-v1"),
  providerAccountId: providerAccountIdSchema,
  environment: z.enum(["TEST", "LIVE"]),
  candidate: verifiedWebhookEventCandidateSchema,
});
function failure(
  code:
    | "INVALID_COMMAND"
    | "INVALID_SIGNATURE"
    | "EVENT_OUTSIDE_TOLERANCE"
    | "CONFIGURATION_ERROR"
    | "MALFORMED_PROVIDER_RESPONSE",
): PaymentWebhookVerificationResponse {
  return paymentWebhookVerificationResponseSchema.parse({
    schemaVersion: 1,
    operation: "VERIFY_PAYMENT_WEBHOOK",
    outcome: "FAILURE",
    error: { schemaVersion: 1, code, recovery: "NONE" },
  });
}
function verifySignatures(
  raw: Uint8Array,
  id: string,
  timestamp: string,
  header: string,
  values: readonly string[],
) {
  const entries = header.split(" ");
  if (entries.length > 32) return false;
  const signatures = entries
    .filter((value) => /^v1,[A-Za-z0-9+/]{43}=$/u.test(value))
    .map((value) => Buffer.from(value.slice(3), "base64"));
  let matched = false;
  for (const value of values) {
    const key = Buffer.from(value.slice(6), "base64");
    try {
      const expected = createHmac("sha256", key)
        .update(`${id}.${timestamp}.`, "utf8")
        .update(raw)
        .digest();
      for (const signature of signatures) {
        const equal = timingSafeEqual(expected, signature);
        matched = equal || matched;
      }
    } finally {
      key.fill(0);
    }
  }
  return matched;
}
/** Standard Webhooks v1 authentication only; association, inbox deduplication and payment writes belong downstream. */
export function createGatewayWebhookVerifier(
  options: GatewayWebhookVerifierOptions,
): PaymentWebhookVerifier {
  const connection = parseGatewayConnection(options.connection);
  const parsed = paymentGatewayWebhookConfigSchema.safeParse(
    options.configuration,
  );
  if (
    !parsed.success ||
    JSON.stringify(parsed.data.binding) !== JSON.stringify(connection.binding)
  )
    throw new TypeError("Invalid gateway webhook configuration");
  const configuration = parsed.data;
  return Object.freeze({
    async verifyPaymentWebhook(command) {
      const parsed = paymentWebhookVerificationCommandSchema.safeParse(command);
      if (!parsed.success) return failure("INVALID_COMMAND");
      const input = parsed.data;
      if (
        input.endpointId !== configuration.endpointId ||
        input.providerAccountId !== configuration.binding.providerAccountId ||
        input.environment !== configuration.binding.environment ||
        input.verificationKeyReferenceHash !==
          configuration.verificationKeyReferenceHash
      )
        return failure("INVALID_COMMAND");
      const raw = Buffer.from(input.rawBodyBase64, "base64url");
      if (raw.byteLength > configuration.maxBodyBytes)
        return failure("INVALID_COMMAND");
      const id = input.headers["webhook-id"],
        timestamp = input.headers["webhook-timestamp"],
        signature = input.headers["webhook-signature"];
      if (
        !id ||
        !/^[A-Za-z0-9_-]{1,256}$/u.test(id) ||
        !timestamp ||
        !/^(?:0|[1-9][0-9]{0,12})$/u.test(timestamp) ||
        !signature
      )
        return failure("INVALID_SIGNATURE");
      const milliseconds = Number(timestamp) * 1000;
      if (!Number.isSafeInteger(milliseconds))
        return failure("INVALID_SIGNATURE");
      let values: readonly string[];
      try {
        values = await resolveGatewayCredentials(
          options.credentials,
          {
            schemaVersion: 1,
            secretRef: configuration.secretRef,
            providerAccountId: input.providerAccountId,
            environment: input.environment,
            purpose: "WEBHOOK_VERIFY",
          },
          connection.timeoutMs,
        );
      } catch {
        return failure("CONFIGURATION_ERROR");
      }
      if (!verifySignatures(raw, id, timestamp, signature, values))
        return failure("INVALID_SIGNATURE");
      if (
        Math.abs(milliseconds - Date.parse(input.receivedAt)) >
        configuration.toleranceSeconds * 1000
      )
        return failure("EVENT_OUTSIDE_TOLERANCE");
      try {
        const envelope = envelopeSchema.parse(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(raw),
          ) as unknown,
        );
        if (
          envelope.providerAccountId !== input.providerAccountId ||
          envelope.environment !== input.environment ||
          envelope.candidate.providerEventId !== id
        )
          return failure("MALFORMED_PROVIDER_RESPONSE");
        return paymentWebhookVerificationResponseSchema.parse({
          schemaVersion: 1,
          operation: "VERIFY_PAYMENT_WEBHOOK",
          outcome: "SUCCESS",
          value: {
            endpointId: input.endpointId,
            providerAccountId: input.providerAccountId,
            environment: input.environment,
            verificationKeyReferenceHash: input.verificationKeyReferenceHash,
            signatureTimestamp: new Date(milliseconds).toISOString(),
            candidate: envelope.candidate,
          },
        });
      } catch {
        return failure("MALFORMED_PROVIDER_RESPONSE");
      }
    },
  } satisfies PaymentWebhookVerifier);
}
