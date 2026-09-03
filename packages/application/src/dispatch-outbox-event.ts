import {
  loadOutboxDispatchContextResponseSchema,
  outboxDispatchJobSchema,
  recordOutboxDispatchAttemptCommandSchema,
  recordOutboxDispatchAttemptResponseSchema,
  recordOutboxEffectCommandSchema,
  recordOutboxEffectResponseSchema,
  reliableEventDeliveryContextSchema,
  type LoadOutboxDispatchContextResponse,
  type OutboxDispatchJob,
  type ReliableEventDeliveryContext,
} from "@fan-support/contracts";
import type {
  JsonValue,
  ReliableEventTransactionManager,
} from "@fan-support/persistence-port";

import { ReliableEventProcessingError } from "./process-webhook-inbox.js";
export { ReliableEventProcessingError } from "./process-webhook-inbox.js";

type ReadyOutboxDispatchContext = Extract<
  LoadOutboxDispatchContextResponse["value"],
  { decision: "READY" }
>;

export type OutboxConsumer = Readonly<{
  effect(context: ReadyOutboxDispatchContext): Readonly<{
    effectKey: string;
    subjectId: string;
  }>;
  dispatch(
    context: ReadyOutboxDispatchContext,
    delivery: Readonly<{ schemaVersion: 1; idempotencyKey: string }>,
  ): Promise<void>;
}>;

export type DispatchOutboxEventDependencies = Readonly<{
  transactionManager: ReliableEventTransactionManager;
  consumerForKey(consumerKey: string): OutboxConsumer | undefined;
  createId(): string;
  now(): string;
}>;

function persistenceFailure(): ReliableEventProcessingError {
  return new ReliableEventProcessingError("PERSISTENCE_FAILURE");
}

function contextMatchesJob(
  context: LoadOutboxDispatchContextResponse["value"],
  job: OutboxDispatchJob,
): boolean {
  return (
    context.outboxEventId === job.outboxEventId &&
    context.consumerKey === job.consumerKey
  );
}

function effectResponseMatchesCommand(
  response: unknown,
  command: Readonly<{
    outboxEventId: string;
    consumerKey: string;
    effectKey: string;
    subjectId: string;
  }>,
): boolean {
  const parsed = recordOutboxEffectResponseSchema.safeParse(response);
  return (
    parsed.success &&
    parsed.data.value.outboxEventId === command.outboxEventId &&
    parsed.data.value.consumerKey === command.consumerKey &&
    parsed.data.value.effectKey === command.effectKey &&
    parsed.data.value.subjectId === command.subjectId
  );
}

function attemptResponseMatchesCommand(
  response: unknown,
  command: Readonly<{
    dispatchAttemptId: string;
    outboxEventId: string;
    consumerKey: string;
    attemptNumber: number;
  }>,
): boolean {
  const parsed = recordOutboxDispatchAttemptResponseSchema.safeParse(response);
  return (
    parsed.success &&
    parsed.data.value.outboxEventId === command.outboxEventId &&
    parsed.data.value.consumerKey === command.consumerKey &&
    parsed.data.value.attemptNumber === command.attemptNumber &&
    (parsed.data.value.decision === "REPLAY" ||
      parsed.data.value.dispatchAttemptId === command.dispatchAttemptId)
  );
}

async function loadContext(
  dependencies: DispatchOutboxEventDependencies,
  job: OutboxDispatchJob,
): Promise<LoadOutboxDispatchContextResponse["value"]> {
  try {
    const snapshot =
      await dependencies.transactionManager.runInReliableEventTransaction(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async (repositories) => {
          const result = await repositories.outboxDispatch.loadContext({
            schemaVersion: 1,
            operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
            outboxEventId: job.outboxEventId,
            consumerKey: job.consumerKey,
          });
          const parsed =
            loadOutboxDispatchContextResponseSchema.safeParse(result);
          if (!parsed.success) {
            throw persistenceFailure();
          }
          if (!contextMatchesJob(parsed.data.value, job)) {
            throw persistenceFailure();
          }
          return parsed.data.value as unknown as JsonValue;
        },
      );
    return snapshot as LoadOutboxDispatchContextResponse["value"];
  } catch (error: unknown) {
    if (error instanceof ReliableEventProcessingError) {
      throw error;
    }
    throw persistenceFailure();
  }
}

async function recordFailureAttempt(
  dependencies: DispatchOutboxEventDependencies,
  job: OutboxDispatchJob,
  delivery: ReliableEventDeliveryContext,
  startedAt: string,
  errorCode: "HANDLER_NOT_REGISTERED" | "HANDLER_EXECUTION_FAILED",
): Promise<void> {
  try {
    await dependencies.transactionManager.runInReliableEventTransaction(
      { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
      async (repositories) => {
        const loaded = await repositories.outboxDispatch.loadContext({
          schemaVersion: 1,
          operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
          outboxEventId: job.outboxEventId,
          consumerKey: job.consumerKey,
        });
        const parsed =
          loadOutboxDispatchContextResponseSchema.safeParse(loaded);
        if (!parsed.success) {
          throw persistenceFailure();
        }
        if (!contextMatchesJob(parsed.data.value, job)) {
          throw persistenceFailure();
        }
        if (parsed.data.value.decision === "ALREADY_DISPATCHED") {
          return { decision: "ALREADY_DISPATCHED" } as const;
        }
        const attempt = recordOutboxDispatchAttemptCommandSchema.safeParse({
          schemaVersion: 1,
          operation: "RECORD_OUTBOX_DISPATCH_ATTEMPT",
          dispatchAttemptId: dependencies.createId(),
          outboxEventId: job.outboxEventId,
          consumerKey: job.consumerKey,
          attemptNumber: parsed.data.value.nextAttemptNumber,
          outcome:
            delivery.attemptNumber >= delivery.maxAttempts
              ? "DEAD_LETTER"
              : "RETRYABLE_FAILURE",
          errorCode,
          startedAt,
          finishedAt: dependencies.now(),
        });
        if (!attempt.success) {
          throw persistenceFailure();
        }
        const recorded = await repositories.outboxDispatch.recordAttempt(
          attempt.data,
        );
        if (!attemptResponseMatchesCommand(recorded, attempt.data)) {
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

export function createDispatchOutboxEvent(
  dependencies: DispatchOutboxEventDependencies,
): (job: unknown, delivery: unknown) => Promise<void> {
  return async (job, delivery) => {
    const parsedJob = outboxDispatchJobSchema.safeParse(job);
    const parsedDelivery =
      reliableEventDeliveryContextSchema.safeParse(delivery);
    if (!parsedJob.success || !parsedDelivery.success) {
      throw new ReliableEventProcessingError("INVALID_JOB");
    }
    const safeJob = parsedJob.data;
    const safeDelivery = parsedDelivery.data;
    const startedAt = dependencies.now();
    const context = await loadContext(dependencies, safeJob);
    if (context.decision === "ALREADY_DISPATCHED") {
      return;
    }
    let consumer: OutboxConsumer | undefined;
    try {
      consumer = dependencies.consumerForKey(safeJob.consumerKey);
    } catch {
      await recordFailureAttempt(
        dependencies,
        safeJob,
        safeDelivery,
        startedAt,
        "HANDLER_EXECUTION_FAILED",
      );
      throw new ReliableEventProcessingError("HANDLER_EXECUTION_FAILED");
    }
    if (consumer === undefined) {
      await recordFailureAttempt(
        dependencies,
        safeJob,
        safeDelivery,
        startedAt,
        "HANDLER_NOT_REGISTERED",
      );
      throw new ReliableEventProcessingError("HANDLER_NOT_REGISTERED");
    }

    let effectCommand: ReturnType<
      typeof recordOutboxEffectCommandSchema.safeParse
    >;
    try {
      const effectIdentity = consumer.effect(context);
      effectCommand = recordOutboxEffectCommandSchema.safeParse({
        schemaVersion: 1,
        operation: "RECORD_OUTBOX_EFFECT",
        outboxEffectId: dependencies.createId(),
        outboxEventId: safeJob.outboxEventId,
        consumerKey: safeJob.consumerKey,
        effectKey: effectIdentity.effectKey,
        subjectId: effectIdentity.subjectId,
      });
      if (!effectCommand.success) {
        throw new Error("invalid outbox effect identity");
      }
    } catch {
      await recordFailureAttempt(
        dependencies,
        safeJob,
        safeDelivery,
        startedAt,
        "HANDLER_EXECUTION_FAILED",
      );
      throw new ReliableEventProcessingError("HANDLER_EXECUTION_FAILED");
    }

    try {
      await consumer.dispatch(context, {
        schemaVersion: 1,
        idempotencyKey: `${safeJob.outboxEventId}:${safeJob.consumerKey}`,
      });
    } catch {
      await recordFailureAttempt(
        dependencies,
        safeJob,
        safeDelivery,
        startedAt,
        "HANDLER_EXECUTION_FAILED",
      );
      throw new ReliableEventProcessingError("HANDLER_EXECUTION_FAILED");
    }

    try {
      await dependencies.transactionManager.runInReliableEventTransaction(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async (repositories) => {
          const latest = await repositories.outboxDispatch.loadContext({
            schemaVersion: 1,
            operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
            outboxEventId: safeJob.outboxEventId,
            consumerKey: safeJob.consumerKey,
          });
          const parsedLatest =
            loadOutboxDispatchContextResponseSchema.safeParse(latest);
          if (!parsedLatest.success) {
            throw persistenceFailure();
          }
          if (!contextMatchesJob(parsedLatest.data.value, safeJob)) {
            throw persistenceFailure();
          }
          if (parsedLatest.data.value.decision === "ALREADY_DISPATCHED") {
            return { decision: "ALREADY_DISPATCHED" } as const;
          }
          const effectResult = await repositories.outboxDispatch.recordEffect(
            effectCommand.data,
          );
          if (!effectResponseMatchesCommand(effectResult, effectCommand.data)) {
            throw persistenceFailure();
          }

          const attempt = recordOutboxDispatchAttemptCommandSchema.safeParse({
            schemaVersion: 1,
            operation: "RECORD_OUTBOX_DISPATCH_ATTEMPT",
            dispatchAttemptId: dependencies.createId(),
            outboxEventId: safeJob.outboxEventId,
            consumerKey: safeJob.consumerKey,
            attemptNumber: parsedLatest.data.value.nextAttemptNumber,
            outcome: "SUCCEEDED",
            startedAt,
            finishedAt: dependencies.now(),
          });
          if (!attempt.success) {
            throw persistenceFailure();
          }
          const attemptResult = await repositories.outboxDispatch.recordAttempt(
            attempt.data,
          );
          if (!attemptResponseMatchesCommand(attemptResult, attempt.data)) {
            throw persistenceFailure();
          }
          return { decision: "DISPATCHED" } as const;
        },
      );
    } catch (error: unknown) {
      if (error instanceof ReliableEventProcessingError) {
        throw error;
      }
      throw persistenceFailure();
    }
  };
}
