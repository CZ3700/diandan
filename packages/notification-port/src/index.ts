import type {
  NotificationEmailDispatch,
  OrderNotificationRenderCommand,
  OrderNotificationContent,
  OrderNotificationEventType,
  OrderNotificationTemplateSelection,
  SupportedLocale,
  SendNotificationCommand,
  SendNotificationResponse,
} from "@fan-support/contracts";

export {
  notificationPortCommandSchema,
  notificationPortErrorCodeSchema,
  notificationPortErrorSchema,
  notificationPortOperationSchema,
  notificationPortResponseSchema,
} from "@fan-support/contracts";
export type {
  NotificationPortCommand,
  NotificationPortError,
  NotificationPortFailure,
  NotificationPortResponse,
  SendNotificationCommand,
  SendNotificationResponse,
} from "@fan-support/contracts";

export interface NotificationProvider {
  sendNotification(
    command: SendNotificationCommand,
  ): Promise<SendNotificationResponse>;
}

/** A transport must durably deduplicate identical commands for its configured retention window.
 * Unknown results may only repeat the identical command, key and transport profile within that window.
 */
export interface NotificationEmailTransport {
  sendEmail(
    command: NotificationEmailDispatch,
  ): Promise<SendNotificationResponse>;
}
export interface OrderNotificationTemplates {
  select(
    eventType: OrderNotificationEventType,
    requestedLocale: SupportedLocale,
  ): OrderNotificationTemplateSelection;
  render(command: OrderNotificationRenderCommand): OrderNotificationContent;
}
export type {
  NotificationEmailDispatch,
  OrderNotificationRenderCommand,
  OrderNotificationContent,
  OrderNotificationEventType,
  OrderNotificationTemplateSelection,
} from "@fan-support/contracts";

export const workspacePackageName = "@fan-support/notification-port" as const;
