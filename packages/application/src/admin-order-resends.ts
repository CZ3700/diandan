import {
  createOrderNotificationUseCases,
  type OrderNotificationDependencies,
} from "./order-notifications.js";

/** Only dispatch already-authorized durable jobs; management owns request creation. */
export function createAdminOrderResendUseCases(
  dependencies: OrderNotificationDependencies,
) {
  const sender = createOrderNotificationUseCases(dependencies);
  return Object.freeze({
    deliver: sender.deliver,
    runPending: sender.runPending,
  });
}
