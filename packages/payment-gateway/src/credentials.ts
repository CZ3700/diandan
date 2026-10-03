import { Buffer } from "node:buffer";
import {
  resolvePaymentCredentials,
  type PaymentCredentialRequest,
  type PaymentCredentialResolver,
} from "@fan-support/payment-port";

export type GatewayCredentialRequest = PaymentCredentialRequest;
export type GatewayCredentialResolver = PaymentCredentialResolver;

function validWebhookKey(value: string) {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/u.test(value)) return false;
  const raw = value.slice(6),
    bytes = Buffer.from(raw, "base64");
  return (
    bytes.length >= 24 && bytes.length <= 64 && bytes.toString("base64") === raw
  );
}
function acceptsGatewayValues(
  purpose: GatewayCredentialRequest["purpose"],
  values: readonly string[],
) {
  return purpose === "API_AUTH"
    ? values.length === 1 && /^[A-Za-z0-9._~+/-]+=*$/u.test(values[0] ?? "")
    : values.every(validWebhookKey);
}
export async function resolveGatewayCredentials(
  resolver: GatewayCredentialResolver,
  request: GatewayCredentialRequest,
  timeoutMs = 10000,
): Promise<readonly string[]> {
  try {
    return await resolvePaymentCredentials(
      resolver,
      request,
      acceptsGatewayValues,
      timeoutMs,
    );
  } catch {
    throw new Error("Gateway credentials unavailable");
  }
}
