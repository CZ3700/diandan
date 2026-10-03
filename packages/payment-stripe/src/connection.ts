import {
  paymentAccountConnectionSchema,
  type PaymentAccountConnection,
} from "@fan-support/contracts";
import {
  resolvePaymentCredentials,
  type PaymentCredentialRequest,
  type PaymentCredentialResolver,
} from "@fan-support/payment-port";

import { STRIPE_API_ORIGIN } from "./transport.js";

export const STRIPE_ADAPTER_KEY = "stripe";
export const STRIPE_ADAPTER_VERSION = "1.0.0";
export const STRIPE_PROTOCOL = "stripe-checkout-v1";
export const STRIPE_CHECKOUT_ORIGIN = "https://checkout.stripe.com";

/** Only hosted Checkout card accounts on the public Stripe API are accepted. */
export function parseStripeConnection(
  input: unknown,
): PaymentAccountConnection {
  const parsed = paymentAccountConnectionSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.binding.providerCode !== STRIPE_ADAPTER_KEY ||
    parsed.data.protocol !== STRIPE_PROTOCOL ||
    parsed.data.adapterVersion !== STRIPE_ADAPTER_VERSION ||
    parsed.data.apiOrigin !== STRIPE_API_ORIGIN ||
    parsed.data.binding.allowedActionOrigins.length !== 1 ||
    parsed.data.binding.allowedActionOrigins[0] !== STRIPE_CHECKOUT_ORIGIN ||
    parsed.data.instruments.some((instrument) => instrument.kind !== "CARD")
  )
    throw new TypeError("Invalid Stripe connection");
  return parsed.data;
}

function acceptsStripeValues(environment: "TEST" | "LIVE") {
  const mode = environment === "LIVE" ? "live" : "test";
  const apiKey = new RegExp(`^(?:sk|rk)_${mode}_[A-Za-z0-9]{16,247}$`, "u");
  return (
    purpose: PaymentCredentialRequest["purpose"],
    values: readonly string[],
  ) =>
    purpose === "API_AUTH"
      ? values.length === 1 && apiKey.test(values[0] ?? "")
      : values.every((value) => /^whsec_[A-Za-z0-9]{16,250}$/u.test(value));
}

/** A key for the other Stripe mode can never authenticate this account's environment. */
export async function resolveStripeSecretKey(
  credentials: PaymentCredentialResolver,
  connection: PaymentAccountConnection,
  timeoutMs: number,
): Promise<string> {
  const [value] = await resolvePaymentCredentials(
    credentials,
    {
      schemaVersion: 1,
      secretRef: connection.credentialRef,
      providerAccountId: connection.binding.providerAccountId,
      environment: connection.binding.environment,
      purpose: "API_AUTH",
    },
    acceptsStripeValues(connection.binding.environment),
    timeoutMs,
  );
  return value!;
}

export async function resolveStripeWebhookSecrets(
  credentials: PaymentCredentialResolver,
  connection: PaymentAccountConnection,
  secretRef: string,
  timeoutMs: number,
): Promise<readonly string[]> {
  return resolvePaymentCredentials(
    credentials,
    {
      schemaVersion: 1,
      secretRef,
      providerAccountId: connection.binding.providerAccountId,
      environment: connection.binding.environment,
      purpose: "WEBHOOK_VERIFY",
    },
    acceptsStripeValues(connection.binding.environment),
    timeoutMs,
  );
}
