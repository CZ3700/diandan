import {
  paymentStablecoinAtomicAmountSchema,
  paymentStablecoinAtomicToDecimalCommandSchema,
  paymentStablecoinDecimalToAtomicCommandSchema,
  paymentStablecoinEvaluationCommandSchema,
  type PaymentStablecoinEvaluation,
} from "@fan-support/contracts";

/** Exact conversion only: never truncate fractional atoms or infer an FX rate. */
export function decimalToAtomic(input: unknown): string {
  const command = paymentStablecoinDecimalToAtomicCommandSchema.parse(input);
  const [whole = "0", fraction = ""] = command.decimalAmount.split(".");
  const scale = 10n ** BigInt(command.decimals);
  const atomic =
    BigInt(whole) * scale +
    BigInt(fraction.padEnd(command.decimals, "0") || "0");
  return paymentStablecoinAtomicAmountSchema.parse(atomic.toString());
}

export function atomicToDecimal(input: unknown): string {
  const command = paymentStablecoinAtomicToDecimalCommandSchema.parse(input);
  const atoms = BigInt(command.atomicAmount);
  const scale = 10n ** BigInt(command.decimals);
  const whole = (atoms / scale).toString();
  if (command.decimals === 0) return whole;
  const fraction = (atoms % scale)
    .toString()
    .padStart(command.decimals, "0")
    .replace(/0+$/u, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

function microseconds(timestamp: string): bigint {
  const [seconds = "", fraction = ""] = timestamp.slice(0, -1).split(".");
  return (
    BigInt(Date.parse(`${seconds}Z`)) * 1_000n + BigInt(fraction.padEnd(6, "0"))
  );
}

type ReviewReason = Extract<
  PaymentStablecoinEvaluation,
  { outcome: "REVIEW" }
>["reason"];
function review(reason: ReviewReason): PaymentStablecoinEvaluation {
  return { schemaVersion: 1, outcome: "REVIEW", reason };
}

/**
 * Financial authority still belongs to persisted, authenticated provider evidence
 * and the transactional payment workflow. Even an exact match here is not PAID.
 * Callers must bind the quote (including fiat amount and exact asset config) to
 * the persisted attempt; two matching, caller-supplied objects prove nothing.
 * Each later observation must be assessed again, including possible reorgs.
 */
export function evaluateStablecoinPayment(
  input: unknown,
): PaymentStablecoinEvaluation {
  const { quote, observation, evaluatedAt } =
    paymentStablecoinEvaluationCommandSchema.parse(input);
  if (
    quote.providerAccountId !== observation.providerAccountId ||
    quote.environment !== observation.environment ||
    quote.attemptId !== observation.attemptId ||
    quote.quoteId !== observation.quoteId
  )
    return review("IDENTITY_MISMATCH");
  if (quote.asset.asset !== observation.asset) return review("ASSET_MISMATCH");
  if (quote.asset.network !== observation.network)
    return review("NETWORK_MISMATCH");
  if (quote.asset.tokenReference !== observation.tokenReference)
    return review("TOKEN_MISMATCH");
  if (quote.asset.decimals !== observation.decimals)
    return review("DECIMALS_MISMATCH");
  if (observation.reorganized) return review("CHAIN_REORGANIZED");

  const now = microseconds(evaluatedAt);
  const issuedAt = microseconds(quote.issuedAt);
  const expiresAt = microseconds(quote.expiresAt);
  if (now < issuedAt) return review("QUOTE_NOT_YET_VALID");
  if (microseconds(observation.observedAt) > now)
    return review("OBSERVATION_FROM_FUTURE");
  const paid = BigInt(observation.paidAtomicAmount);
  if (paid === 0n) {
    return now >= expiresAt
      ? review("QUOTE_EXPIRED")
      : { schemaVersion: 1, outcome: "PENDING", reason: "AWAITING_PAYMENT" };
  }
  // Schema validation requires both dates for nonzero deposits; keep this check
  // explicit so a future schema change cannot silently waive the payment window.
  if (observation.firstPaymentAt === null || observation.lastPaymentAt === null)
    return review("LATE_PAYMENT");
  if (microseconds(observation.firstPaymentAt) < issuedAt)
    return review("PAYMENT_BEFORE_QUOTE");
  if (microseconds(observation.lastPaymentAt) >= expiresAt)
    return review("LATE_PAYMENT");
  const expected = BigInt(quote.atomicAmount);
  if (paid < expected) return review("UNDERPAID");
  if (paid > expected) return review("OVERPAID");
  if (observation.confirmations < quote.asset.minimumConfirmations) {
    return {
      schemaVersion: 1,
      outcome: "PENDING",
      reason: "INSUFFICIENT_CONFIRMATIONS",
    };
  }
  return { schemaVersion: 1, outcome: "MATCHED_EVIDENCE" };
}
