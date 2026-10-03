export const workspacePackageName = "@fan-support/payment-airwallex" as const;
export {
  createAirwallexAdapter,
  type AirwallexAdapter,
  type AirwallexAdapterOptions,
} from "./factory.js";
export {
  AIRWALLEX_ADAPTER_KEY,
  AIRWALLEX_ADAPTER_VERSION,
  AIRWALLEX_CHECKOUT_ORIGINS,
  AIRWALLEX_MAX_ACTION_TTL_MS,
  AIRWALLEX_PROTOCOL,
} from "./connection.js";
export { AIRWALLEX_API_ORIGINS, AIRWALLEX_API_VERSION } from "./transport.js";
export {
  AIRWALLEX_SIGNATURE_HEADER,
  AIRWALLEX_TIMESTAMP_HEADER,
  AIRWALLEX_WEBHOOK_EVENT_TYPES,
} from "./webhook.js";
