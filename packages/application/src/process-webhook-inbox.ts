import {
  loadWebhookProcessingContextResponseSchema,
  recordWebhookEffectCommandSchema,
  recordWebhookEffectResponseSchema,
  recordWebhookProcessingAttemptCommandSchema,
  recordWebhookProcessingAttemptResponseSchema,
  reliableEventDeliveryContextSchema,
  webhookInboxJobSchema,
  type LoadWebhookProcessingContextResponse,
  type ReliableEventDeliveryContext,
  type WebhookInboxJob,
} from "@fan-support/contracts";
import type {
  ReliableEventTransactionManager,
  ReliableEventTransactionRepositories,
} from "@fan-support/persistence-port";

type ReadyWebhookProcessingContext = Extract<
  LoadWebhookProcessingContextResponse["value"],
  { decision: "READY" }
>;

export type WebhookInboxHandler = Readonly<{
  effect(context: ReadyWebhookProcessingContext): Readonly<{
    effectKey: string;
    subjectId: string;
  }>;
  handle(
    context: ReadyWebhookProcessingContext,
    repositories: ReliableEventTransactionRepositories,
  ): Promise<void>;
}>;

export type ProcessWebhookInboxDependencies = Readonly<{
  transactionManager: ReliableEventTransactionManager;
  handlerForEvent(
    eventType: ReadyWebhookProcessingContext["event"]["eventType"],
  ): WebhookInboxHandler | undefined;
  createId(): string;
  now(): string;
}>;

export type ReliableEventProcessingErrorCode =
  | "INVALID_JOB"
  | "HANDLER_NOT_REGISTERED"
  | "HANDLER_EXECUTION_FAILED"
  | "PERSISTENCE_FAILURE";

export class ReliableEventProcessingError extends Error {
  public constructor(public readonly code: ReliableEventProcessingErrorCode) {
    super("reliable event processing failed");
    this.name = "ReliableEventProcessingError";
  }
}

class HandlerExecutionFailure extends Error {
  public constructor(
    public readonly code: "HANDLER_NOT_REGISTERED" | "HANDLER_EXECUTION_FAILED",
  ) {
    super("reliable event handler failed");
    this.name = "HandlerExecutionFailure";
  }
}

function persistenceFailure(): ReliableEventProcessingError {
  return new ReliableEventProcessingError("PERSISTENCE_FAILURE");
}

function contextMatchesJob(
  context: LoadWebhookProcessingContextResponse["value"],
  job: WebhookInboxJob,
): boolean {
  return context.webhookInboxId === job.webhookInboxId;
}

function effectResponseMatchesCommand(
  response: unknown,
  command: Readonly<{
    webhookInboxId: string;
    effectKey: string;
    subjectId: string;
  }>,
): boolean {
  const parsed = recordWebhookEffectResponseSchema.safeParse(response);
  return (
    parsed.success &&
    parsed.data.value.webhookInboxId === command.webhookInboxId &&
    parsed.data.value.effectKey === command.effectKey &&
    parsed.data.value.subjectId === command.subjectId
  );
}

function attemptResponseMatchesCommand(
  response: unknown,
  command: Readonly<{
    processingAttemptId: string;
    webhookInboxId: string;
    attemptNumber: number;
  }>,
): boolean {
  const parsed =
    recordWebhookProcessingAttemptResponseSchema.safeParse(response);
  return (
    parsed.success &&
    parsed.data.value.processingAttemptId === command.processingAttemptId &&
    parsed.data.value.webhookInboxId === command.webhookInboxId &&
    parsed.data.value.attemptNumber === command.attemptNumber
  );
}

async function recordFailureAttempt(
  dependencies: ProcessWebhookInboxDependencies,
  job: WebhookInboxJob,
  delivery: ReliableEventDeliveryContext,
  startedAt: string,
  code: "HANDLER_NOT_REGISTERED" | "HANDLER_EXECUTION_FAILED",
): Promise<void> {
  try {
    await dependencies.transactionManager.runInReliableEventTransaction(
      { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
      async (repositories) => {
        const contextResult = await repositories.webhookProcessing.loadContext({
          schemaVersion: 1,
          operation: "LOAD_WEBHOOK_PROCESSING_CONTEXT",
          webhookInboxId: job.webhookInboxId,
        });
        const parsedContext =
          loadWebhookProcessingContextResponseSchema.safeParse(contextResult);
        if (!parsedContext.success) {
          throw persistenceFailure();
        }
        if (!contextMatchesJob(parsedContext.data.value, job)) {
          throw persistenceFailure();
        }
        if (parsedContext.data.value.decision === "ALREADY_PROCESSED") {
          return { decision: "ALREADY_PROCESSED" } as const;
        }
        const attemptCommand =
          recordWebhookProcessingAttemptCommandSchema.safeParse({
            schemaVersion: 1,
            operation: "RECORD_WEBHOOK_PROCESSING_ATTEMPT",
            processingAttemptId: dependencies.createId(),
            webhookInboxId: job.webhookInboxId,
            attemptNumber: parsedContext.data.value.nextAttemptNumber,
            outcome:
              delivery.attemptNumber >= delivery.maxAttempts
                ? "DEAD_LETTER"
                : "RETRYABLE_FAILURE",
            errorCode: code,
            startedAt,
            finishedAt: dependencies.now(),
          });
        if (!attemptCommand.success) {
          throw persistenceFailure();
        }
        const attemptResult =
          await repositories.webhookProcessing.recordAttempt(
            attemptCommand.data,
          );
        if (
          !attemptResponseMatchesCommand(attemptResult, attemptCommand.data)
        ) {
          throw persistenceFailure();
        }
        return { decision: "FAILURE_RECORDED" } as const;
      },
    );
  } catch (error: unknown) {
    if (error instanceof ReliableEventProcessingError) {
      throw error;
    }
    throw persistenceFailure();
  }
}

export function createProcessWebhookInbox(
  dependencies: ProcessWebhookInboxDependencies,
): (job: unknown, delivery: unknown) => Promise<void> {
  return async (job, delivery) => {
    const parsedJob = webhookInboxJobSchema.safeParse(job);
    const parsedDelivery =
      reliableEventDeliveryContextSchema.safeParse(delivery);
    if (!parsedJob.success || !parsedDelivery.success) {
      throw new ReliableEventProcessingError("INVALID_JOB");
    }
    const safeJob = parsedJob.data;
    const safeDelivery = parsedDelivery.data;
    const startedAt = dependencies.now();

    try {
      await dependencies.transactionManager.runInReliableEventTransaction(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async (repositories) => {
          const contextResult =
            await repositories.webhookProcessing.loadContext({
              schemaVersion: 1,
              operation: "LOAD_WEBHOOK_PROCESSING_CONTEXT",
              webhookInboxId: safeJob.webhookInboxId,
            });
          const parsedContext =
            loadWebhookProcessingContextResponseSchema.safeParse(contextResult);
          if (!parsedContext.success) {
            throw persistenceFailure();
          }
          if (!contextMatchesJob(parsedContext.data.value, safeJob)) {
            throw persistenceFailure();
          }
          if (parsedContext.data.value.decision === "ALREADY_PROCESSED") {
            return { decision: "ALREADY_PROCESSED" } as const;
          }
          const context = parsedContext.data.value;
          let handler: WebhookInboxHandler | undefined;
          try {
            handler = dependencies.handlerForEvent(context.event.eventType);
          } catch {
            throw new HandlerExecutionFailure("HANDLER_EXECUTION_FAILED");
          }
          if (handler === undefined) {
            throw new HandlerExecutionFailure("HANDLER_NOT_REGISTERED");
          }

          let effectIdentity: Readonly<{
            effectKey: string;
            subjectId: string;
          }>;
          try {
            effectIdentity = handler.effect(context);
          } catch {
            throw new HandlerExecutionFailure("HANDLER_EXECUTION_FAILED");
          }

          const effectCommand = recordWebhookEffectCommandSchema.safeParse({
            schemaVersion: 1,
            operation: "RECORD_WEBHOOK_EFFECT",
            webhookEffectId: dependencies.createId(),
            webhookInboxId: safeJob.webhookInboxId,
            effectKey: effectIdentity.effectKey,
            subjectId: effectIdentity.subjectId,
          });
          if (!effectCommand.success) {
            throw new HandlerExecutionFailure("HANDLER_EXECUTION_FAILED");
          }
          const effectResult =
            await repositories.webhookProcessing.recordEffect(
              effectCommand.data,
            );
          if (!effectResponseMatchesCommand(effectResult, effectCommand.data)) {
            throw persistenceFailure();
          }
          const parsedEffect =
            recordWebhookEffectResponseSchema.parse(effectResult);
          if (parsedEffect.value.decision === "RECORDED") {
            try {
              await handler.handle(context, repositories);
            } catch {
              throw new HandlerExecutionFailure("HANDLER_EXECUTION_FAILED");
            }
          }

          const attemptCommand =
            recordWebhookProcessingAttemptCommandSchema.safeParse({
              schemaVersion: 1,
              operation: "RECORD_WEBHOOK_PROCESSING_ATTEMPT",
              processingAttemptId: dependencies.createId(),
              webhookInboxId: safeJob.webhookInboxId,
              attemptNumber: context.nextAttemptNumber,
              outcome: "SUCCEEDED",
              startedAt,
              finishedAt: dependencies.now(),
            });
          if (!attemptCommand.success) {
            throw persistenceFailure();
          }
          const attemptResult =
            await repositories.webhookProcessing.recordAttempt(
              attemptCommand.data,
            );
          if (
            !attemptResponseMatchesCommand(attemptResult, attemptCommand.data)
          ) {
            throw persistenceFailure();
          }
          return { decision: "PROCESSED" } as const;
        },
      );
    } catch (error: unknown) {
      if (error instanceof HandlerExecutionFailure) {
        await recordFailureAttempt(
          dependencies,
          safeJob,
          safeDelivery,
          startedAt,
          error.code,
        );
        throw new ReliableEventProcessingError(error.code);
      }
      if (error instanceof ReliableEventProcessingError) {
        throw error;
      }
      throw persistenceFailure();
    }
  };
}
