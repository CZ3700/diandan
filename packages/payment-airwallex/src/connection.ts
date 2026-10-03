import {
  AIRWALLEX_HPP_LOCALES,
  paymentAccountConnectionSchema,
  type PaymentAccountConnection,
} from "@fan-support/contracts";
import {
  resolvePaymentCredentials,
  type PaymentCredentialRequest,
  type PaymentCredentialResolver,
} from "@fan-support/payment-port";

import { AIRWALLEX_API_ORIGINS, type AirwallexApiOrigin } from "./transport.js";

export const AIRWALLEX_ADAPTER_KEY = "airwallex";
export const AIRWALLEX_ADAPTER_VERSION = "1.0.0";
export const AIRWALLEX_PROTOCOL = "airwallex-hpp-v1";
/** Hosted Payment Page origins; the Airwallex.js environment table maps TEST to `sandbox`. */
export const AIRWALLEX_CHECKOUT_ORIGINS = Object.freeze({
  TEST: "https://checkout.sandbox.airwallex.com",
  LIVE: "https://checkout.airwallex.com",
} as const);

/**
 * A PaymentIntent client secret opens the Hosted Payment Page for 60 minutes. A stored action
 * must expire before it; five minutes cover clock skew and the gap between creating the
 * intent and storing its action.
 */
export const AIRWALLEX_MAX_ACTION_TTL_MS = 3_300_000;

const hppLocales: readonly string[] = AIRWALLEX_HPP_LOCALES;

/** Only Hosted Payment Page card accounts on the environment's own API origin are accepted. */
export function parseAirwallexConnection(
  input: unknown,
): PaymentAccountConnection {
  const parsed = paymentAccountConnectionSchema.safeParse(input);
  if (!parsed.success) throw new TypeError("Invalid Airwallex connection");
  const connection = parsed.data;
  const environment = connection.binding.environment;
  if (
    connection.binding.providerCode !== AIRWALLEX_ADAPTER_KEY ||
    connection.protocol !== AIRWALLEX_PROTOCOL ||
    connection.adapterVersion !== AIRWALLEX_ADAPTER_VERSION ||
    connection.apiOrigin !== AIRWALLEX_API_ORIGINS[environment] ||
    connection.binding.allowedActionOrigins.length !== 1 ||
    connection.binding.allowedActionOrigins[0] !==
      AIRWALLEX_CHECKOUT_ORIGINS[environment] ||
    connection.instruments.some((instrument) => instrument.kind !== "CARD") ||
    Object.values(connection.binding.localeMapping).some(
      (entry) => !hppLocales.includes(entry.providerLocale),
    )
  )
    throw new TypeError("Invalid Airwallex connection");
  return connection;
}

export function apiOriginOf(
  connection: PaymentAccountConnection,
): AirwallexApiOrigin {
  return AIRWALLEX_API_ORIGINS[connection.binding.environment];
}

/** One secret value holds the API client pair: `<client_id>:<api_key>`. */
const API_CREDENTIAL = /^([A-Za-z0-9_-]{8,128}):([A-Za-z0-9._~+/=-]{16,512})$/u;
const WEBHOOK_SECRET = /^[A-Za-z0-9._~+/=-]{16,512}$/u;

const acceptsAirwallexValues = (
  purpose: PaymentCredentialRequest["purpose"],
  values: readonly string[],
) =>
  purpose === "API_AUTH"
    ? values.length === 1 && API_CREDENTIAL.test(values[0] ?? "")
    : values.every((value) => WEBHOOK_SECRET.test(value));

export type AirwallexApiCredentials = Readonly<{
  clientId: string;
  apiKey: string;
}>;

export async function resolveAirwallexApiCredentials(
  credentials: PaymentCredentialResolver,
  connection: PaymentAccountConnection,
  timeoutMs: number,
): Promise<AirwallexApiCredentials> {
  const [value] = await resolvePaymentCredentials(
    credentials,
    {
      schemaVersion: 1,
      secretRef: connection.credentialRef,
      providerAccountId: connection.binding.providerAccountId,
      environment: connection.binding.environment,
      purpose: "API_AUTH",
    },
    acceptsAirwallexValues,
    timeoutMs,
  );
  const [, clientId, apiKey] = API_CREDENTIAL.exec(value!)!;
  return { clientId: clientId!, apiKey: apiKey! };
}

export async function resolveAirwallexWebhookSecrets(
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
    acceptsAirwallexValues,
    timeoutMs,
  );
}
