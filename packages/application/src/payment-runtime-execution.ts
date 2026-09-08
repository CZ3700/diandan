import { randomUUID } from "node:crypto";
import {
  paymentPortCommandSchema,
  paymentPortResponseMatchesCommand,
  paymentPortResponseSchema,
  paymentRuntimeAttemptRecordSchema,
  paymentRuntimeRecordReconcileCommandSchema,
  paymentRuntimeSettleCreateCommandSchema,
  type PaymentRuntimeClaim,
  type PaymentRuntimeSettleCreateCommand,
} from "@fan-support/contracts";
import { encryptPaymentAction } from "./payment-runtime-action.js";
import {
  findPaymentProvider,
  readPaymentCreateResult,
  readPaymentRecoveryAction,
} from "./payment-runtime-provider.js";
import { type PaymentRuntime } from "./payment-runtime-context.js";

const defer = (
  runtime: PaymentRuntime,
  claim: PaymentRuntimeClaim,
  errorCode: string,
) =>
  runtime.run(async ({ paymentRuntime }) =>
    paymentRuntimeAttemptRecordSchema.parse(
      await paymentRuntime.deferRecovery({
        schemaVersion: 1,
        claim,
        errorCode,
        retryAfterMs: runtime.configuration.recoveryDelayMs,
      }),
    ),
  );

async function executeCreate(
  runtime: PaymentRuntime,
  claim: PaymentRuntimeClaim,
) {
  const provider = findPaymentProvider(runtime.providers, claim.attempt);
  if (!provider) return defer(runtime, claim, "PROVIDER_UNAVAILABLE");
  let result: PaymentRuntimeSettleCreateCommand["result"];
  try {
    const response = readPaymentCreateResult(
      claim.createCommand,
      await provider.provider.createPayment(claim.createCommand),
      provider.configuration,
      claim.supportedActionTypes,
      {
        providerLocale: claim.attempt.providerLocale,
        fallbackUsed: claim.attempt.providerLocaleFallbackUsed,
      },
    );
    result =
      response === null
        ? {
            kind: "NETWORK_UNCERTAINTY",
            reasonCode: "PROVIDER_RESPONSE_UNCERTAIN",
          }
        : {
            kind: "CREATE_RESULT",
            status: response.status,
            externalReference: response.externalReference,
            providerLocale: response.providerLocale,
            providerLocaleFallbackUsed: response.fallbackUsed,
            action: await encryptPaymentAction(
              runtime,
              claim.attempt,
              response.action,
            ),
          };
  } catch {
    result = {
      kind: "NETWORK_UNCERTAINTY",
      reasonCode: "PROVIDER_OUTCOME_UNCERTAIN",
    };
  }
  const command = paymentRuntimeSettleCreateCommandSchema.parse({
    schemaVersion: 1,
    claim,
    eventId: randomUUID(),
    outboxEventId: randomUUID(),
    retryAfterMs: runtime.configuration.recoveryDelayMs,
    result,
  });
  return runtime.run(async ({ paymentRuntime }) =>
    paymentRuntimeAttemptRecordSchema.parse(
      await paymentRuntime.settleCreate(command),
    ),
  );
}

async function executeReconcile(
  runtime: PaymentRuntime,
  claim: PaymentRuntimeClaim,
) {
  const provider = findPaymentProvider(runtime.providers, claim.attempt);
  if (!provider) return defer(runtime, claim, "PROVIDER_UNAVAILABLE");
  const frozen = claim.createCommand;
  const command = paymentPortCommandSchema.parse({
    schemaVersion: 1,
    operation: "RECONCILE_PAYMENT",
    providerAccountId: frozen.providerAccountId,
    environment: frozen.environment,
    attemptId: frozen.attemptId,
    merchantReference: frozen.merchantReference,
    providerIdempotencyKey: frozen.providerIdempotencyKey,
    amountMinor: frozen.amountMinor,
    currency: frozen.currency,
    auditLogId: claim.auditLogId,
    ...(claim.attempt.externalReference === null
      ? {}
      : { externalReference: claim.attempt.externalReference }),
  });
  if (command.operation !== "RECONCILE_PAYMENT")
    return defer(runtime, claim, "INVALID_COMMAND");
  let input: unknown;
  try {
    input = await provider.provider.reconcilePayment(command);
  } catch {
    return defer(runtime, claim, "PROVIDER_QUERY_UNAVAILABLE");
  }
  const response = paymentPortResponseSchema.safeParse(input);
  if (
    !response.success ||
    response.data.operation !== "RECONCILE_PAYMENT" ||
    response.data.outcome !== "SUCCESS" ||
    !paymentPortResponseMatchesCommand(command, response.data)
  )
    return defer(runtime, claim, "PROVIDER_QUERY_UNAVAILABLE");
  let record = paymentRuntimeRecordReconcileCommandSchema.parse({
    schemaVersion: 1,
    claim,
    providerEventId: randomUUID(),
    associationId: randomUUID(),
    eventId: randomUUID(),
    outboxEventId: randomUUID(),
    receiptId: randomUUID(),
    retryAfterMs: runtime.configuration.recoveryDelayMs,
    event: response.data.value.event,
  });
  if (
    claim.attempt.status === "UNKNOWN" &&
    record.event.eventType === "PAYMENT_STATUS" &&
    record.event.status === "REQUIRES_ACTION" &&
    record.event.association.status === "MATCHED"
  ) {
    const lookup = paymentPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "GET_PAYMENT",
      providerAccountId: claim.attempt.providerAccountId,
      environment: claim.attempt.environment,
      attemptId: claim.attempt.id,
      externalReference: record.event.association.externalReference,
    });
    if (lookup.operation !== "GET_PAYMENT")
      return defer(runtime, claim, "INVALID_COMMAND");
    try {
      const action = readPaymentRecoveryAction(
        lookup,
        await provider.provider.getPayment(lookup),
        provider.configuration,
        claim.supportedActionTypes,
        {
          providerLocale: claim.attempt.providerLocale,
          fallbackUsed: claim.attempt.providerLocaleFallbackUsed,
        },
      );
      if (action === null)
        return defer(runtime, claim, "PROVIDER_ACTION_UNAVAILABLE");
      record = paymentRuntimeRecordReconcileCommandSchema.parse({
        ...record,
        action: await encryptPaymentAction(runtime, claim.attempt, action),
      });
    } catch {
      return defer(runtime, claim, "PROVIDER_ACTION_UNAVAILABLE");
    }
  }
  return runtime.run(async ({ paymentRuntime }) =>
    paymentRuntimeAttemptRecordSchema.parse(
      await paymentRuntime.recordReconcile(record),
    ),
  );
}

/** The durable claim is acquired before this function; no SQL transaction spans an external call. */
export function executePaymentClaim(
  runtime: PaymentRuntime,
  claim: PaymentRuntimeClaim,
) {
  return claim.mode === "CREATE"
    ? executeCreate(runtime, claim)
    : executeReconcile(runtime, claim);
}
