import type {
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

export const workspacePackageName = "@fan-support/notification-port" as const;
