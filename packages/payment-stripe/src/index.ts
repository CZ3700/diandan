export const workspacePackageName = "@fan-support/payment-stripe" as const;
export {
  createStripeAdapter,
  type StripeAdapter,
  type StripeAdapterOptions,
} from "./factory.js";
export {
  STRIPE_ADAPTER_KEY,
  STRIPE_ADAPTER_VERSION,
  STRIPE_CHECKOUT_ORIGIN,
  STRIPE_PROTOCOL,
} from "./connection.js";
export { STRIPE_API_ORIGIN, STRIPE_API_VERSION } from "./transport.js";
export {
  STRIPE_SIGNATURE_HEADER,
  STRIPE_WEBHOOK_EVENT_TYPES,
} from "./webhook.js";
