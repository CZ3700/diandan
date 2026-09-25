import { randomBytes, randomUUID } from "node:crypto";
import {
  DEFAULT_LOCALE,
  paymentRuntimeCreateReceiptSchema,
  paymentRuntimeBeginCreateCommandSchema,
  paymentRuntimeBeginCreateResultSchema,
  type CartRuntimeRequestContext,
  type PaymentRuntimeCreateCommand,
} from "@fan-support/contracts";
import { PaymentRuntimeRepositoryError } from "@fan-support/persistence-port";
import { readAuthorizedPayment } from "./payment-runtime-action.js";
import {
  availablePaymentActions,
  eligiblePaymentRoute,
  loadPaymentContext,
} from "./payment-runtime-capabilities.js";
import { findPaymentProvider } from "./payment-runtime-provider.js";
import { executePaymentClaim } from "./payment-runtime-execution.js";
import {
  paymentCommandHash,
  rejectPayment,
  type PaymentRuntime,
} from "./payment-runtime-context.js";

async function replayCreateReceipt(
  runtime: PaymentRuntime,
  command: PaymentRuntimeCreateCommand,
  context: CartRuntimeRequestContext,
  canonicalRequestHash: string,
) {
  const receipt = await runtime.run(async ({ paymentRuntime }) => {
    const stored = await paymentRuntime.findCreateReceipt({
      schemaVersion: 1,
      accesses: context.accesses,
      checkoutSessionId: command.checkoutSessionId,
      idempotencyKey: context.idempotencyKey!,
    });
    return stored === null
      ? null
      : paymentRuntimeCreateReceiptSchema.parse(stored);
  });
  if (receipt !== null) {
    if (receipt.canonicalRequestHash !== canonicalRequestHash)
      return rejectPayment("IDEMPOTENCY_CONFLICT");
    return {
      schemaVersion: 1 as const,
      outcome: "SUCCESS" as const,
      action: "REPLAYED" as const,
      attempt: await readAuthorizedPayment(
        runtime,
        context,
        command.checkoutSessionId,
        receipt.attemptId,
      ),
    };
  }
  return null;
}

export async function createRuntimePayment(
  runtime: PaymentRuntime,
  command: PaymentRuntimeCreateCommand,
  context: CartRuntimeRequestContext,
) {
  const canonicalRequestHash = paymentCommandHash(command);
  const replay = await replayCreateReceipt(
    runtime,
    command,
    context,
    canonicalRequestHash,
  );
  if (replay !== null) return replay;
  const current = await loadPaymentContext(
    runtime,
    {
      schemaVersion: 1,
      operation: "READ_PAYMENT_CAPABILITIES",
      checkoutSessionId: command.checkoutSessionId,
      presentationLocale: DEFAULT_LOCALE,
      country: command.country,
      supportedActionTypes: command.supportedActionTypes,
    },
    context,
  );
  if (current.currentAttempt && !current.currentAttempt.canRetry)
    return rejectPayment("PAYMENT_IN_PROGRESS");
  if (current.readiness !== "READY") return rejectPayment(current.readiness);
  const routing = current.routing;
  if (routing === null || routing.configVersion !== command.configVersion)
    return rejectPayment("STALE_CONFIGURATION");
  const route = routing.routes.find(
    (entry) =>
      entry.rule.id.toLowerCase() === command.capabilityId.toLowerCase() &&
      entry.ruleVersion === command.ruleVersion,
  );
  if (
    !route ||
    !eligiblePaymentRoute(
      runtime,
      current,
      route,
      command.country,
      command.supportedActionTypes,
    )
  )
    return rejectPayment("CAPABILITY_UNAVAILABLE");
  if (
    (
      await availablePaymentActions(
        runtime,
        current,
        route,
        command.country,
        command.supportedActionTypes,
      )
    ).length === 0
  )
    return rejectPayment("CAPABILITY_UNAVAILABLE");
  const provider = findPaymentProvider(runtime.providers, {
    providerAccountId: route.rule.providerAccountId,
    environment: route.environment,
    adapterKey: route.adapterKey,
  });
  if (!provider) return rejectPayment("PROVIDER_UNAVAILABLE");
  const attemptId = randomUUID();
  const locale = current.checkout.observation.consent.presentationLocale;
  const mapping = provider.configuration.localeMapping[locale];
  const returnUrl = new URL(
    `/${locale}/checkout/return`,
    runtime.configuration.publicStorefrontOrigin,
  );
  returnUrl.searchParams.set("session", command.checkoutSessionId);
  returnUrl.searchParams.set("attempt", attemptId);
  const plan = paymentRuntimeBeginCreateCommandSchema.parse({
    schemaVersion: 1,
    accesses: context.accesses,
    checkoutSessionId: command.checkoutSessionId,
    requestId: context.requestId,
    correlationId: context.correlationId,
    taskName: "payment-runtime-create",
    leaseTokenDigest: randomBytes(32).toString("hex"),
    leaseDurationMs: runtime.configuration.leaseMs,
    expectedOrderVersion: current.orderVersion,
    receiptId: randomUUID(),
    operationId: randomUUID(),
    attemptId,
    idempotencyKey: context.idempotencyKey,
    canonicalRequestHash,
    configPublicationId: routing.publicationId,
    configVersionId: routing.configVersionId,
    configVersion: routing.configVersion,
    routeRuleId: route.rule.id,
    ruleVersion: route.ruleVersion,
    country: command.country,
    supportedActionTypes: command.supportedActionTypes,
    providerLocale: mapping.providerLocale,
    providerLocaleFallbackUsed: mapping.fallbackUsed,
    createCommand: {
      schemaVersion: 1,
      operation: "CREATE_PAYMENT",
      providerAccountId: route.rule.providerAccountId,
      environment: route.environment,
      attemptId,
      orderId: current.checkout.receipt.orderId,
      paymentMethod: route.rule.paymentMethod,
      amountMinor: current.checkout.observation.quote.amount.totalAmountMinor,
      currency: current.cart.currency,
      requestedLocale: locale,
      merchantReference: attemptId,
      providerIdempotencyKey: attemptId,
      returnUrl: returnUrl.href,
      cancelUrl: returnUrl.href,
    },
    // Return URLs use the protected cart session; this reserved digest grants no standalone access.
    returnStateDigest: randomBytes(32).toString("hex"),
    returnStateExpiresAt: new Date(
      Date.parse(current.evaluatedAt) + runtime.configuration.returnStateTtlMs,
    ).toISOString(),
    attemptEventId: randomUUID(),
    orderEventId: randomUUID(),
    outboxEventId: randomUUID(),
  });
  let created;
  try {
    created = await runtime.run(async ({ paymentRuntime }) =>
      paymentRuntimeBeginCreateResultSchema.parse(
        await paymentRuntime.beginCreate(plan),
      ),
    );
  } catch (error) {
    if (
      error instanceof PaymentRuntimeRepositoryError &&
      error.code === "STALE_CLAIM"
    ) {
      const concurrentReplay = await replayCreateReceipt(
        runtime,
        command,
        context,
        canonicalRequestHash,
      );
      if (concurrentReplay !== null) return concurrentReplay;
    }
    throw error;
  }
  await executePaymentClaim(runtime, created.claim);
  return {
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    action: "CREATED" as const,
    attempt: await readAuthorizedPayment(
      runtime,
      context,
      command.checkoutSessionId,
      created.receipt.attemptId,
    ),
  };
}
