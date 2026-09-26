import type {
  PaymentCredentialRequest,
  PaymentCredentialResolver,
} from "@fan-support/payment-port";

const REFERENCE = /^secret-ref:v1:env:(PAYMENT_SECRET_[A-Z0-9_]{1,100})$/u;
const MAX_VALUES = 3;

/**
 * Resolves `secret-ref:v1:env:<NAME>` from secrets the deployment injects as environment
 * variables (ECS `secrets`). Only `PAYMENT_SECRET_*` names are readable, so a wrong reference
 * can never disclose database or storage credentials. Values are read on every call; a
 * comma-separated value lists rotation keys, newest first.
 */
export function createEnvironmentCredentialResolver(
  environment: Readonly<Record<string, string | undefined>>,
): PaymentCredentialResolver {
  return Object.freeze({
    async resolve(request: PaymentCredentialRequest) {
      const name = REFERENCE.exec(request.secretRef)?.[1];
      const raw = name === undefined ? undefined : environment[name];
      if (raw === undefined || raw.length === 0)
        throw new Error("Payment credential unavailable");
      const values = raw.split(",");
      if (values.length > MAX_VALUES)
        throw new Error("Payment credential unavailable");
      return { ...request, version: "env-v1", values };
    },
  });
}
