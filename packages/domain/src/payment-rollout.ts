import {
  paymentRolloutInputSchema,
  type PaymentRolloutDecision,
} from "@fan-support/contracts";

/** Frozen v1 ASCII algorithm, mirrored by payment_rollout_bucket_v1 in PostgreSQL.
 * Non-secret traffic allocation only; this hash never grants authorization.
 */
function bucket(
  scope: "provider" | "rule",
  checkoutId: string,
  targetId: string,
): number {
  const input = `payment-rollout:v1:${scope}:${checkoutId.toLowerCase()}:${targetId.toLowerCase()}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++)
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619) >>> 0;
  for (let round = 0; round < 2; round++)
    hash = Math.imul(hash ^ (hash >>> 16), 73244475) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) % 10000;
}

export function evaluatePaymentRollout(input: unknown): PaymentRolloutDecision {
  const parsed = paymentRolloutInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      schemaVersion: 1,
      kind: "INVALID",
      reason: "INVALID_ROLLOUT_INPUT",
    };
  const value = parsed.data;
  const providerBucket = bucket(
    "provider",
    value.checkoutSessionId,
    value.providerAccountId,
  );
  const ruleBucket = bucket("rule", value.checkoutSessionId, value.routeRuleId);
  return {
    schemaVersion: 1,
    algorithmVersion: 1,
    kind:
      providerBucket < value.providerRolloutBasisPoints &&
      ruleBucket < value.ruleRolloutBasisPoints
        ? "ELIGIBLE"
        : "EXCLUDED",
    providerBucket,
    ruleBucket,
  };
}
