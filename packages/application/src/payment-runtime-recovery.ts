import { randomBytes, randomUUID } from "node:crypto";
import {
  paymentRuntimeClaimSchema,
  paymentRuntimeClaimRecoveryCommandSchema,
  cartRuntimeHeaderSchema,
  type CartRuntimeRequestContext,
  type PaymentRuntimeRecoverCommand,
} from "@fan-support/contracts";
import { readAuthorizedPayment } from "./payment-runtime-action.js";
import { executePaymentClaim } from "./payment-runtime-execution.js";
import {
  paymentCommandHash,
  paymentPersistenceSuccess,
  rejectPayment,
  type PaymentRuntime,
} from "./payment-runtime-context.js";

export async function recoverRuntimePayment(
  runtime: PaymentRuntime,
  command: PaymentRuntimeRecoverCommand,
  context: CartRuntimeRequestContext,
) {
  // Authorization and the idempotency receipt share the durable recovery-claim transaction.
  const claim = await runtime.run(
    async ({ cartRuntime, paymentRuntime, idempotency }) => {
      const rawCart = await cartRuntime.findByCredentialForUpdate({
        schemaVersion: 1,
        accesses: context.accesses,
      });
      if (rawCart === null) return rejectPayment("CART_NOT_FOUND");
      const cart = cartRuntimeHeaderSchema.parse(rawCart);
      if (cart.expired || cart.status === "EXPIRED")
        return rejectPayment("CART_EXPIRED");
      const attempt = await paymentRuntime.readAttempt({
        schemaVersion: 1,
        accesses: context.accesses,
        checkoutSessionId: command.checkoutSessionId,
        attemptId: command.attemptId,
      });
      if (!attempt) return rejectPayment("ATTEMPT_NOT_FOUND");
      const identity = {
        schemaVersion: 1 as const,
        actor: `actor-ref:v1:guest:${cart.id}`,
        idempotencyOperation: "payment.attempt.recover",
        idempotencyKey: context.idempotencyKey!,
        canonicalRequestHash: paymentCommandHash(command),
      };
      const begun = paymentPersistenceSuccess(
        await idempotency.begin({
          ...identity,
          operation: "BEGIN_IDEMPOTENCY",
          expiresAt: cart.expiresAt,
        }),
      );
      if (begun.operation !== "BEGIN_IDEMPOTENCY")
        return rejectPayment("TEMPORARY_UNAVAILABLE");
      if (begun.value.decision === "CONFLICT")
        return rejectPayment("IDEMPOTENCY_CONFLICT");
      if (
        begun.value.decision === "REPLAY" ||
        begun.value.decision === "IN_PROGRESS"
      )
        return null;
      const work = await paymentRuntime.claimRecovery(
        paymentRuntimeClaimRecoveryCommandSchema.parse({
          schemaVersion: 1,
          leaseTokenDigest: randomBytes(32).toString("hex"),
          leaseDurationMs: runtime.configuration.leaseMs,
          requestId: context.requestId,
          correlationId: context.correlationId,
          taskName: "payment-runtime-recover",
          auditLogId: randomUUID(),
          target: {
            kind: "CHECKOUT",
            accesses: context.accesses,
            checkoutSessionId: command.checkoutSessionId,
            attemptId: command.attemptId,
          },
        }),
      );
      paymentPersistenceSuccess(
        await idempotency.complete({
          ...identity,
          operation: "COMPLETE_IDEMPOTENCY",
          status: "SUCCEEDED",
          safeResultReference: `result-ref:v1:${command.attemptId}`,
        }),
      );
      return work === null ? null : paymentRuntimeClaimSchema.parse(work);
    },
  );
  if (claim) await executePaymentClaim(runtime, claim);
  return {
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    action: "RECOVERED" as const,
    attempt: await readAuthorizedPayment(
      runtime,
      context,
      command.checkoutSessionId,
      command.attemptId,
    ),
  };
}
export async function recoverNextRuntimePayment(runtime: PaymentRuntime) {
  const claim = await runtime.run(async ({ paymentRuntime }) => {
    const work = await paymentRuntime.claimRecovery(
      paymentRuntimeClaimRecoveryCommandSchema.parse({
        schemaVersion: 1,
        leaseTokenDigest: randomBytes(32).toString("hex"),
        leaseDurationMs: runtime.configuration.leaseMs,
        requestId: randomUUID(),
        correlationId: randomUUID(),
        taskName: "payment-runtime-recovery-worker",
        auditLogId: randomUUID(),
        target: { kind: "DUE" },
      }),
    );
    return work === null ? null : paymentRuntimeClaimSchema.parse(work);
  });
  if (claim) await executePaymentClaim(runtime, claim);
  return {
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    processed: claim !== null,
  };
}
