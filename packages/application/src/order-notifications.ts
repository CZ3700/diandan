import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  notificationAttachLinkResultSchema,
  notificationClaimResultSchema,
  notificationConfirmSendResultSchema,
  sourceHashSchema,
  orderNotificationContentSchema,
  notificationEmailDispatchSchema,
  notificationFinishResultSchema,
  notificationListPendingCommandSchema,
  notificationListPendingResultSchema,
  notificationPortResponseSchema,
  notificationRecipientResultSchema,
  notificationRequestCommandSchema,
  notificationRequestResultSchema,
  notificationRuntimeConfigurationSchema,
  notificationSourceCommandSchema,
  notificationSourceResultSchema,
  orderNotificationTemplateSelectionSchema,
  type NotificationRuntimeConfiguration,
  type NotificationFinishResult,
  type NotificationDeliveryPlan,
  type NotificationRunResult,
  type SendNotificationResponse,
} from "@fan-support/contracts";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type {
  NotificationEmailTransport,
  OrderNotificationTemplates,
} from "@fan-support/notification-port";
import {
  NotificationRepositoryError,
  type NotificationTransactionManager,
} from "@fan-support/persistence-port";
import type { OutboxConsumer } from "./dispatch-outbox-event.js";
import { deriveNotificationLink } from "./notification-credentials.js";
import { decryptNotificationRecipient } from "./notification-recipient.js";

export class OrderNotificationApplicationError extends Error {
  constructor() {
    super("Notification processing unavailable");
    this.name = "OrderNotificationApplicationError";
  }
}
type Notice =
  | "NOTIFICATION_LOCALE_FALLBACK"
  | "NOTIFICATION_FAILED"
  | "NOTIFICATION_RETRY_SCHEDULED";
export type OrderNotificationDependencies = Readonly<{
  transactions: NotificationTransactionManager;
  keyManagement: KeyManagementPort;
  templates: OrderNotificationTemplates;
  transportForKey(key: string): NotificationEmailTransport | undefined;
  configuration: NotificationRuntimeConfiguration;
  createId?: () => string;
  createNonce?: () => string;
  onNotice?: (code: Notice) => void;
}>;
const failure = (
  code:
    | "TEMPORARY_UNAVAILABLE"
    | "TIMEOUT_OUTCOME_UNKNOWN"
    | "MALFORMED_PROVIDER_RESPONSE"
    | "TEMPLATE_CONTENT_INVALID"
    | "CONFIGURATION_ERROR"
    | "RECIPIENT_REJECTED",
): SendNotificationResponse => {
  const retryable = [
    "TEMPORARY_UNAVAILABLE",
    "TIMEOUT_OUTCOME_UNKNOWN",
    "MALFORMED_PROVIDER_RESPONSE",
  ].includes(code);
  return notificationPortResponseSchema.parse({
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery: retryable ? "RETRY_SAME_COMMAND" : "NONE",
      ...(retryable ? { retryAfterMs: 1000 } : {}),
    },
  });
};
const skip: NotificationFinishResult = { schemaVersion: 1, decision: "SKIP" };

export function createOrderNotificationUseCases(
  dependencies: OrderNotificationDependencies,
) {
  const configuration = notificationRuntimeConfigurationSchema.parse(
    dependencies.configuration,
  );
  const { transactions, keyManagement, templates } = dependencies;
  const createId = dependencies.createId ?? randomUUID;
  const createNonce =
    dependencies.createNonce ?? (() => randomBytes(32).toString("hex"));
  const notice = (code: Notice) => {
    try {
      dependencies.onNotice?.(code);
    } catch {
      /* Durable incidents remain in PostgreSQL. */
    }
  };
  const request = async (outboxEventId: string) => {
    try {
      const command = notificationSourceCommandSchema.parse({
        schemaVersion: 1,
        outboxEventId,
      });
      const result = await transactions.runInNotificationTransaction(
        async (repo) => {
          const source = notificationSourceResultSchema.parse(
            await repo.source(command),
          );
          if (source.decision === "IGNORED")
            return notificationRequestResultSchema.parse(source);
          const selection = orderNotificationTemplateSelectionSchema.parse(
            templates.select(source.eventType, source.requestedLocale),
          );
          if (
            selection.eventType !== source.eventType ||
            selection.requestedLocale !== source.requestedLocale
          )
            throw new OrderNotificationApplicationError();
          return notificationRequestResultSchema.parse(
            await repo.request(
              notificationRequestCommandSchema.parse({
                schemaVersion: 1,
                outboxEventId,
                notificationId: createId(),
                selection,
                siteName: configuration.siteName,
                publicStorefrontOrigin: configuration.publicStorefrontOrigin,
                transportKey: configuration.transportKey,
                linkNonce: createNonce(),
                linkPepperVersion: configuration.linkPepperVersion,
                linkTtlSeconds: configuration.linkTtlSeconds,
                idempotencyRetentionSeconds:
                  configuration.idempotencyRetentionSeconds,
              }),
            ),
          );
        },
      );
      if (result.decision === "CREATED" && result.fallbackUsed)
        notice("NOTIFICATION_LOCALE_FALLBACK");
      return result;
    } catch {
      throw new OrderNotificationApplicationError();
    }
  };
  const dispatch = async (
    plan: NotificationDeliveryPlan,
  ): Promise<SendNotificationResponse | "FAILED" | undefined> => {
    const command = {
      schemaVersion: 1 as const,
      notificationId: plan.notification.id,
      leaseToken: plan.leaseToken,
    };
    const transport = dependencies.transportForKey(plan.transportKey);
    if (!transport) return failure("CONFIGURATION_ERROR");
    const { token, credential } = await deriveNotificationLink(
      keyManagement,
      plan,
    );
    const orderUrl = `${plan.publicStorefrontOrigin}/${plan.notification.locale.resolvedLocale}/order-access#token=${token}&order=${plan.baseVariables.publicOrderId}`;
    let rendered;
    try {
      rendered = templates.render({
        schemaVersion: 1,
        eventType: plan.notification.eventType,
        locale: plan.notification.locale,
        variables: { ...plan.baseVariables, orderUrl },
      });
    } catch {
      return failure("TEMPLATE_CONTENT_INVALID");
    }
    if (!orderNotificationContentSchema.safeParse(rendered).success)
      return failure("TEMPLATE_CONTENT_INVALID");
    const contact = await transactions.runInNotificationTransaction(
      async (repo) =>
        notificationRecipientResultSchema.parse(await repo.recipient(command)),
    );
    if (
      contact.customerContactId.toLowerCase() !==
      plan.notification.customerContactId.toLowerCase()
    )
      throw new OrderNotificationApplicationError();
    const recipient = await decryptNotificationRecipient(
      keyManagement,
      contact,
    );
    const email = notificationEmailDispatchSchema.safeParse({
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      notification: plan.notification,
      channel: "EMAIL",
      content: rendered,
      recipient,
      dispatchNotAfter: plan.dedupeUntil,
    });
    if (!email.success) return failure("TEMPLATE_CONTENT_INVALID");
    const grant = await transactions.runInNotificationTransaction(
      async (repo) =>
        notificationAttachLinkResultSchema.parse(
          await repo.attachLink({ ...command, credential }),
        ),
    );
    if (
      grant.publicOrderId.toLowerCase() !==
      plan.baseVariables.publicOrderId.toLowerCase()
    )
      throw new OrderNotificationApplicationError();
    const contentHash = sourceHashSchema.parse(
      createHash("sha256").update(JSON.stringify(email.data)).digest("hex"),
    );
    const confirmed = await transactions.runInNotificationTransaction(
      async (repo) =>
        notificationConfirmSendResultSchema.parse(
          await repo.confirmSend({ ...command, contentHash }),
        ),
    );
    if (confirmed.decision === "SKIP") return undefined;
    if (confirmed.decision === "FAILED") return "FAILED";
    try {
      const result = notificationPortResponseSchema.safeParse(
        await transport.sendEmail(email.data),
      );
      return result.success
        ? result.data
        : failure("MALFORMED_PROVIDER_RESPONSE");
    } catch {
      return failure("TIMEOUT_OUTCOME_UNKNOWN");
    }
  };
  const deliver = async (
    notificationId: string,
  ): Promise<NotificationFinishResult> => {
    let plan: NotificationDeliveryPlan;
    try {
      const leaseToken = createId();
      const claim = await transactions.runInNotificationTransaction(
        async (repo) =>
          notificationClaimResultSchema.parse(
            await repo.claim({
              schemaVersion: 1,
              notificationId,
              leaseToken,
              leaseSeconds: configuration.leaseSeconds,
              maxAttempts: configuration.maxAttempts,
            }),
          ),
      );
      if (claim.decision === "SKIP") return skip;
      if (claim.decision === "FAILED") {
        notice("NOTIFICATION_FAILED");
        return { schemaVersion: 1, decision: "FAILED" };
      }
      plan = claim.plan;
      if (
        plan.notification.id.toLowerCase() !== notificationId.toLowerCase() ||
        plan.leaseToken.toLowerCase() !== leaseToken.toLowerCase()
      )
        throw new OrderNotificationApplicationError();
    } catch {
      throw new OrderNotificationApplicationError();
    }
    let result: SendNotificationResponse | "FAILED" | undefined;
    try {
      result = await dispatch(plan);
    } catch (error) {
      if (
        error instanceof NotificationRepositoryError &&
        error.code === "LEASE_LOST"
      )
        return skip;
      result = failure(
        error instanceof NotificationRepositoryError &&
          error.code === "CONTACT_UNAVAILABLE"
          ? "RECIPIENT_REJECTED"
          : "TEMPORARY_UNAVAILABLE",
      );
    }
    if (result === undefined) return skip;
    if (result === "FAILED") {
      notice("NOTIFICATION_FAILED");
      return { schemaVersion: 1, decision: "FAILED" };
    }
    const providerResult = result;
    try {
      const completed = await transactions.runInNotificationTransaction(
        async (repo) =>
          notificationFinishResultSchema.parse(
            await repo.finish({
              schemaVersion: 1,
              notificationId,
              leaseToken: plan.leaseToken,
              result: providerResult,
              retryDelaySeconds: Math.min(
                86400,
                Math.max(
                  configuration.retryDelaySeconds,
                  providerResult.outcome === "FAILURE"
                    ? Math.ceil((providerResult.error.retryAfterMs ?? 0) / 1000)
                    : 0,
                ),
              ),
              maxAttempts: configuration.maxAttempts,
            }),
          ),
      );
      if (completed.decision === "FAILED") notice("NOTIFICATION_FAILED");
      if (completed.decision === "RETRY_SCHEDULED")
        notice("NOTIFICATION_RETRY_SCHEDULED");
      return completed;
    } catch {
      throw new OrderNotificationApplicationError();
    }
  };
  const runPending = async (limit: number): Promise<NotificationRunResult> => {
    let ids: string[];
    try {
      const command = notificationListPendingCommandSchema.parse({
        schemaVersion: 1,
        limit,
      });
      const listed = await transactions.runInNotificationTransaction(
        async (repo) =>
          notificationListPendingResultSchema.parse(
            await repo.listPending(command),
          ),
      );
      ids = listed.notificationIds;
      if (ids.length > limit || new Set(ids).size !== ids.length)
        throw new OrderNotificationApplicationError();
    } catch {
      throw new OrderNotificationApplicationError();
    }
    const result: NotificationRunResult = {
      schemaVersion: 1,
      scanned: ids.length,
      sent: 0,
      scheduled: 0,
      failed: 0,
      skipped: 0,
    };
    for (const id of ids) {
      try {
        const outcome = await deliver(id);
        if (outcome.decision === "SENT") result.sent++;
        else if (outcome.decision === "RETRY_SCHEDULED") result.scheduled++;
        else if (outcome.decision === "FAILED") result.failed++;
        else result.skipped++;
      } catch {
        result.failed++;
        notice("NOTIFICATION_FAILED");
      }
    }
    return result;
  };
  const consumer: OutboxConsumer = {
    effect: (context) => ({
      effectKey: "ORDER_NOTIFICATION:DISPATCH",
      subjectId: context.event.aggregateId,
    }),
    dispatch: async (context) => {
      if (context.event.eventType === "NOTIFICATION_REQUESTED")
        await deliver(context.event.payload.notificationDeliveryId);
      else if (
        context.event.eventType === "ORDER_PAYMENT_CONFIRMED" ||
        context.event.eventType === "FULFILLMENT_STATUS_CHANGED"
      )
        await request(context.outboxEventId);
    },
  };
  return Object.freeze({ request, deliver, runPending, consumer });
}
