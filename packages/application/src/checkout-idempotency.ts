import { createHash } from "node:crypto";
import {
  checkoutPreflightIdSchema,
  type CartRuntimeHeader,
  type CartRuntimeRequestContext,
  type CheckoutPreflightCreateCommand,
  type CheckoutPreflightValidateCommand,
} from "@fan-support/contracts";
import type { CheckoutPreflightRepositories } from "@fan-support/persistence-port";
import {
  checkoutPersistenceSuccess,
  rejectCheckout,
} from "./checkout-transaction.js";

type Command =
  CheckoutPreflightCreateCommand | CheckoutPreflightValidateCommand;
/** The private request is hashed in memory; durable idempotency contains only this hash and a safe result reference. */
export async function beginCheckout(
  repos: CheckoutPreflightRepositories,
  cart: CartRuntimeHeader,
  command: Command,
  context: CartRuntimeRequestContext,
) {
  const identity = {
    schemaVersion: 1 as const,
    actor: `actor-ref:v1:guest:${cart.id}`,
    idempotencyOperation:
      command.operation === "VALIDATE_CHECKOUT"
        ? "checkout.preflight.validate"
        : "checkout.session.create",
    idempotencyKey: context.idempotencyKey!,
    canonicalRequestHash: createHash("sha256")
      .update(JSON.stringify(command), "utf8")
      .digest("hex"),
  };
  const claim = checkoutPersistenceSuccess(
    await repos.idempotency.begin({
      ...identity,
      operation: "BEGIN_IDEMPOTENCY",
      expiresAt: cart.expiresAt,
    }),
  );
  if (claim.operation !== "BEGIN_IDEMPOTENCY")
    return rejectCheckout("TEMPORARY_UNAVAILABLE");
  if (claim.value.decision === "CONFLICT")
    return rejectCheckout("IDEMPOTENCY_CONFLICT");
  if (claim.value.decision === "IN_PROGRESS")
    return rejectCheckout("IN_PROGRESS");
  if (claim.value.decision === "STARTED")
    return { kind: "NEW", identity } as const;
  const prefix = "result-ref:v1:";
  if (!claim.value.safeResultReference.startsWith(prefix))
    return rejectCheckout("TEMPORARY_UNAVAILABLE");
  return {
    kind: "REPLAY",
    reference: checkoutPreflightIdSchema.parse(
      claim.value.safeResultReference.slice(prefix.length),
    ),
  } as const;
}
export async function completeCheckout(
  repos: CheckoutPreflightRepositories,
  identity: Extract<
    Awaited<ReturnType<typeof beginCheckout>>,
    { kind: "NEW" }
  >["identity"],
  reference: string,
): Promise<void> {
  const result = checkoutPersistenceSuccess(
    await repos.idempotency.complete({
      ...identity,
      operation: "COMPLETE_IDEMPOTENCY",
      status: "SUCCEEDED",
      safeResultReference: `result-ref:v1:${reference}`,
    }),
  );
  if (result.operation !== "COMPLETE_IDEMPOTENCY")
    rejectCheckout("TEMPORARY_UNAVAILABLE");
}
