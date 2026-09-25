export const workspacePackageName = "@fan-support/payment-gateway" as const;
export { createNormalizedGatewayFactory } from "./factory.js";
export { createPaymentConnectorRegistry } from "./registry.js";
export type { PaymentConnectorFactory } from "./registry.js";
export { createGatewayPaymentProvider } from "./client.js";
export type { GatewayPaymentProviderOptions } from "./client.js";
export { createGatewayWebhookVerifier } from "./webhook.js";
export type { GatewayWebhookVerifierOptions } from "./webhook.js";
export type {
  GatewayCredentialRequest,
  GatewayCredentialResolver,
} from "./credentials.js";
export {
  evaluateStablecoinPayment,
  decimalToAtomic,
  atomicToDecimal,
} from "./stablecoin.js";
