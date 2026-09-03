export const workspacePackageName = "@fan-support/application" as const;

export {
  createReceivePaymentWebhook,
  type ReceivePaymentWebhookDependencies,
} from "./receive-payment-webhook.js";
export {
  createProcessWebhookInbox,
  type ProcessWebhookInboxDependencies,
  ReliableEventProcessingError,
  type ReliableEventProcessingErrorCode,
  type WebhookInboxHandler,
} from "./process-webhook-inbox.js";
export {
  createDispatchOutboxEvent,
  type DispatchOutboxEventDependencies,
  type OutboxConsumer,
} from "./dispatch-outbox-event.js";
export {
  createListReadyOutboxJobs,
  createPurgeExpiredWebhookPayloads,
  type ReliableEventMaintenanceDependencies,
} from "./reliable-event-maintenance.js";
export {
  createPaymentWebhookEndpointPreflight,
  type PaymentWebhookEndpointPreflightDependencies,
  type PaymentWebhookEndpointPreflightResult,
} from "./payment-webhook-endpoint-preflight.js";
