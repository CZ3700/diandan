import { canonicalPublicationValue } from "@fan-support/content";
import {
  paymentHealthPolicySchema,
  type PaymentHealthPolicy,
} from "@fan-support/contracts";
export const healthPolicyIdentity = (
  value: Pick<PaymentHealthPolicy, "environment" | "providerAccountId">,
) => `${value.environment}/${value.providerAccountId.toLowerCase()}`;
export const healthPolicyFingerprint = (value: PaymentHealthPolicy) =>
  canonicalPublicationValue(value);
/** Published versions are immutable; a failed refresh never replaces the previous complete snapshot. */
export function createHealthPolicyReader(
  initial: readonly PaymentHealthPolicy[],
  read?: () => readonly PaymentHealthPolicy[],
) {
  function parse(values: readonly PaymentHealthPolicy[]) {
    const policies = values.map((value) =>
      paymentHealthPolicySchema.parse(value),
    );
    const result = new Map(
      policies.map((policy) => [healthPolicyIdentity(policy), policy]),
    );
    if (
      (policies.length === 0 && read === undefined) ||
      policies.length > 100 ||
      result.size !== policies.length
    )
      throw new TypeError("Invalid payment health policies");
    return result;
  }
  let current = parse(initial);
  return () => {
    if (read) {
      const next = parse(read());
      for (const [identity, previous] of current) {
        const policy = next.get(identity);
        if (
          !policy ||
          policy.version < previous.version ||
          (policy.version === previous.version &&
            healthPolicyFingerprint(policy) !==
              healthPolicyFingerprint(previous))
        )
          throw new TypeError("Invalid published payment health policy");
      }
      current = next;
    }
    return current;
  };
}
