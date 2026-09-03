import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  paymentWebhookEndpointIdSchema,
  paymentWebhookAcceptedResponseSchema,
  paymentWebhookEndpointPreflightCommandSchema,
  paymentWebhookEndpointPreflightResultSchema,
  paymentWebhookHeadersSchema,
  portBase64Schema,
  portTimestampSchema,
  receivePaymentWebhookCommandSchema,
  receivePaymentWebhookResponseSchema,
  type PaymentWebhookEndpointPreflightCommand,
  type PaymentWebhookEndpointPreflightResult,
  type ReceivePaymentWebhookCommand,
  type ReceivePaymentWebhookError,
  type ReceivePaymentWebhookResponse,
} from "@fan-support/contracts";
import {
  createQueuePropagationCarrier,
  createSafeRuntimeError,
  REQUEST_ID_HEADER,
} from "@fan-support/observability";
import { currentRequestContext } from "@fan-support/observability/node";

const PAYMENT_WEBHOOK_ROUTE = "/api/v1/webhooks/payments/:endpointId" as const;
const SIGNATURE_HEADER = "x-fan-support-signature" as const;
const TIMESTAMP_HEADER = "x-fan-support-timestamp" as const;
const PAYMENT_WEBHOOK_BODY_LIMIT_BYTES = 49_152;
const DEFAULT_VERIFICATION_HEADER_NAMES = Object.freeze([
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
]);
const EXACT_RAW_CONTENT_TYPES = Object.freeze([
  "application/json",
  "application/x-www-form-urlencoded",
  "text/plain",
  "application/octet-stream",
]);
const STRUCTURED_JSON_CONTENT_TYPE =
  /^application\/[!#$%&'*+\-.^_`|~0-9a-z]+\+json(?:\s*;|$)/iu;
const PAYMENT_WEBHOOK_ACCEPTED_RESPONSE = Object.freeze(
  paymentWebhookAcceptedResponseSchema.parse({
    schemaVersion: 1,
    status: "accepted",
  }),
);

export type PaymentWebhookReceiveCommand = ReceivePaymentWebhookCommand;
export type PaymentWebhookReceiveResult = ReceivePaymentWebhookResponse;
export type {
  PaymentWebhookEndpointPreflightCommand,
  PaymentWebhookEndpointPreflightResult,
} from "@fan-support/contracts";

export type PaymentWebhookReceiver = Readonly<{
  receive: (
    command: PaymentWebhookReceiveCommand,
  ) => Promise<PaymentWebhookReceiveResult>;
}>;

export type PaymentWebhookEndpointPreflight = (
  command: PaymentWebhookEndpointPreflightCommand,
) => Promise<PaymentWebhookEndpointPreflightResult>;

export type PaymentWebhookRouteOptions = Readonly<{
  receiver: PaymentWebhookReceiver;
  endpointPreflight: PaymentWebhookEndpointPreflight;
  now?: () => Date;
  createCorrelationId?: () => string;
  verificationHeaderNames?: readonly string[];
}>;

function selectVerificationHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  names: readonly string[],
): Readonly<Record<string, string>> {
  const selected = Object.create(null) as Record<string, string>;
  for (const name of names) {
    const value = headers[name];
    if (typeof value === "string") {
      selected[name] = value;
    }
  }
  return Object.freeze(selected);
}

function resolveVerificationHeaderNames(value: unknown): readonly string[] {
  try {
    const candidate = value ?? DEFAULT_VERIFICATION_HEADER_NAMES;
    if (!Array.isArray(candidate)) {
      throw new Error("invalid allowlist");
    }
    const names: unknown[] = [...candidate];
    if (!names.every((name): name is string => typeof name === "string")) {
      throw new Error("invalid allowlist");
    }
    const probe = Object.fromEntries(names.map((name) => [name, ""]));
    if (
      names.length === 0 ||
      new Set(names).size !== names.length ||
      !paymentWebhookHeadersSchema.safeParse(probe).success
    ) {
      throw new Error("invalid allowlist");
    }
    return Object.freeze(names);
  } catch {
    throw new Error("Payment webhook header allowlist is invalid");
  }
}

function sendSafeError(
  reply: FastifyReply,
  statusCode: 400 | 404 | 409 | 413 | 503,
) {
  const error = createSafeRuntimeError(
    statusCode,
    currentRequestContext()?.requestId ?? reply.getHeader(REQUEST_ID_HEADER),
  );
  return reply
    .header(REQUEST_ID_HEADER, error.requestId)
    .code(statusCode)
    .send(error);
}

function statusForReceiveFailure(
  code: ReceivePaymentWebhookError["code"],
): 400 | 404 | 409 | 503 {
  switch (code) {
    case "ENDPOINT_UNAVAILABLE":
      return 404;
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    case "TEMPORARY_UNAVAILABLE":
    case "CONFIGURATION_ERROR":
      return 503;
    default:
      return 400;
  }
}

function statusForFastifyError(error: unknown): 400 | 413 | 503 {
  try {
    if (typeof error !== "object" || error === null) {
      return 503;
    }
    const code = (error as Readonly<Record<string, unknown>>)["code"];
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return 413;
    }
    if (
      code === "FST_ERR_CTP_INVALID_CONTENT_LENGTH" ||
      code === "FST_ERR_CTP_INVALID_MEDIA_TYPE"
    ) {
      return 400;
    }
  } catch {
    return 503;
  }
  return 503;
}

export function registerPaymentWebhookRoute(
  instance: FastifyInstance,
  options: PaymentWebhookRouteOptions,
): void {
  instance.register(async (webhookScope) => {
    const preflightByRequest = new WeakMap<
      FastifyRequest,
      Readonly<{
        endpointId: ReceivePaymentWebhookCommand["endpointId"];
        receivedAt: ReceivePaymentWebhookCommand["receivedAt"];
      }>
    >();
    const verificationHeaderNames = resolveVerificationHeaderNames(
      options.verificationHeaderNames,
    );
    webhookScope.removeContentTypeParser([
      ...EXACT_RAW_CONTENT_TYPES,
      STRUCTURED_JSON_CONTENT_TYPE,
    ]);
    webhookScope.addContentTypeParser<Buffer>(
      [...EXACT_RAW_CONTENT_TYPES],
      { bodyLimit: PAYMENT_WEBHOOK_BODY_LIMIT_BYTES, parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );
    webhookScope.addContentTypeParser<Buffer>(
      STRUCTURED_JSON_CONTENT_TYPE,
      { bodyLimit: PAYMENT_WEBHOOK_BODY_LIMIT_BYTES, parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );
    webhookScope.setErrorHandler((error, _request, reply) =>
      sendSafeError(reply, statusForFastifyError(error)),
    );

    webhookScope.post<{ Params: { endpointId: string } }>(
      PAYMENT_WEBHOOK_ROUTE,
      {
        bodyLimit: PAYMENT_WEBHOOK_BODY_LIMIT_BYTES,
        onRequest: async (request, reply) => {
          const endpoint = paymentWebhookEndpointIdSchema.safeParse(
            request.params.endpointId,
          );
          if (!endpoint.success) {
            return sendSafeError(reply, 400);
          }

          let receivedAt: ReceivePaymentWebhookCommand["receivedAt"];
          try {
            const parsedReceivedAt = portTimestampSchema.safeParse(
              (options.now?.() ?? new Date()).toISOString(),
            );
            if (!parsedReceivedAt.success) {
              return sendSafeError(reply, 503);
            }
            receivedAt = parsedReceivedAt.data;
          } catch {
            return sendSafeError(reply, 503);
          }

          const preflightCommand =
            paymentWebhookEndpointPreflightCommandSchema.safeParse({
              schemaVersion: 1,
              endpointId: endpoint.data,
              receivedAt,
            });
          if (!preflightCommand.success) {
            return sendSafeError(reply, 503);
          }

          let outcome: PaymentWebhookEndpointPreflightResult["outcome"];
          try {
            const result =
              paymentWebhookEndpointPreflightResultSchema.safeParse(
                await options.endpointPreflight(
                  Object.freeze(preflightCommand.data),
                ),
              );
            if (!result.success) {
              return sendSafeError(reply, 503);
            }
            outcome = result.data.outcome;
          } catch {
            return sendSafeError(reply, 503);
          }
          if (outcome === "INVALID_REQUEST") {
            return sendSafeError(reply, 400);
          }
          if (outcome === "UNAVAILABLE") {
            return sendSafeError(reply, 404);
          }
          if (outcome !== "ELIGIBLE") {
            return sendSafeError(reply, 503);
          }
          preflightByRequest.set(
            request,
            Object.freeze({ endpointId: endpoint.data, receivedAt }),
          );
        },
      },
      async (request, reply) => {
        const preflight = preflightByRequest.get(request);
        if (preflight === undefined) {
          return sendSafeError(reply, 503);
        }
        if (!Buffer.isBuffer(request.body)) {
          return sendSafeError(reply, 400);
        }
        const rawBodyBase64 = request.body.toString("base64url");
        const headers = paymentWebhookHeadersSchema.safeParse(
          selectVerificationHeaders(request.headers, verificationHeaderNames),
        );
        if (
          !portBase64Schema.safeParse(rawBodyBase64).success ||
          !headers.success
        ) {
          return sendSafeError(reply, 400);
        }

        try {
          const propagation = createQueuePropagationCarrier();
          if (propagation === undefined) {
            return sendSafeError(reply, 503);
          }
          const command = receivePaymentWebhookCommandSchema.safeParse({
            schemaVersion: 1 as const,
            operation: "RECEIVE_PAYMENT_WEBHOOK",
            endpointId: preflight.endpointId,
            rawBodyBase64,
            headers: headers.data,
            receivedAt: preflight.receivedAt,
            correlationId: options.createCorrelationId?.() ?? randomUUID(),
            propagation,
          });
          if (!command.success) {
            return sendSafeError(reply, 503);
          }
          const result = receivePaymentWebhookResponseSchema.safeParse(
            await options.receiver.receive(command.data),
          );
          if (!result.success) {
            return sendSafeError(reply, 503);
          }

          if (result.data.outcome === "SUCCESS") {
            return reply.code(202).send(PAYMENT_WEBHOOK_ACCEPTED_RESPONSE);
          }
          const statusCode = statusForReceiveFailure(result.data.error.code);
          if (result.data.error.code === "TEMPORARY_UNAVAILABLE") {
            void reply.header(
              "retry-after",
              String(
                Math.ceil((result.data.error.retryAfterMs ?? 1_000) / 1_000),
              ),
            );
          }
          return sendSafeError(reply, statusCode);
        } catch {
          return sendSafeError(reply, 503);
        }
      },
    );
  });
}
