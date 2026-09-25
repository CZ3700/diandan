import { randomUUID } from "node:crypto";
import {
  orderPaymentApplyCommandSchema,
  orderPaymentApplyResultSchema,
  orderPaymentListPendingCommandSchema,
  orderPaymentPendingEventsSchema,
  orderPaymentRunResultSchema,
  type OrderPaymentApplyCommand,
  type OrderPaymentApplyResult,
  type OrderPaymentRunResult,
} from "@fan-support/contracts";
import type {
  OrderPaymentApplicationRepository,
  OrderPaymentApplicationTransactionManager,
} from "@fan-support/persistence-port";

export class OrderPaymentApplicationError extends Error {
  constructor(
    readonly code:
      | "INVALID_COMMAND"
      | "INVALID_RESULT"
      | "PERSISTENCE_FAILURE"
      | "EVIDENCE_UNMATCHED",
  ) {
    super("Order payment application failed");
    this.name = "OrderPaymentApplicationError";
  }
}

/** Caller supplies a transaction-scoped repository; never starts a nested transaction. */
export async function applyOrderPaymentInTransaction(
  repository: OrderPaymentApplicationRepository,
  command: OrderPaymentApplyCommand,
): Promise<OrderPaymentApplyResult> {
  const parsed = orderPaymentApplyCommandSchema.safeParse(command);
  if (!parsed.success)
    throw new OrderPaymentApplicationError("INVALID_COMMAND");
  const result = orderPaymentApplyResultSchema.safeParse(
    await repository.apply(parsed.data),
  );
  if (
    !result.success ||
    result.data.providerEventId.toLowerCase() !==
      parsed.data.providerEventId.toLowerCase()
  )
    throw new OrderPaymentApplicationError("INVALID_RESULT");
  return result.data;
}

export function createOrderPaymentApplication({
  transactions,
  createId = randomUUID,
}: {
  transactions: OrderPaymentApplicationTransactionManager;
  createId?: () => string;
}) {
  const apply = async (input: unknown): Promise<OrderPaymentApplyResult> => {
    const command = orderPaymentApplyCommandSchema.safeParse(input);
    if (!command.success)
      throw new OrderPaymentApplicationError("INVALID_COMMAND");
    try {
      return await transactions.runInOrderPaymentApplicationTransaction(
        (repository) =>
          applyOrderPaymentInTransaction(repository, command.data),
      );
    } catch (error) {
      if (error instanceof OrderPaymentApplicationError) throw error;
      throw new OrderPaymentApplicationError("PERSISTENCE_FAILURE");
    }
  };
  const runPending = async (limit: number): Promise<OrderPaymentRunResult> => {
    const command = orderPaymentListPendingCommandSchema.safeParse({
      schemaVersion: 1,
      limit,
    });
    if (!command.success)
      throw new OrderPaymentApplicationError("INVALID_COMMAND");
    let pending;
    try {
      pending = await transactions.runInOrderPaymentApplicationTransaction(
        async (repository) => {
          const events = orderPaymentPendingEventsSchema.parse(
            await repository.listPending(command.data),
          );
          if (events.providerEventIds.length > limit)
            throw new OrderPaymentApplicationError("INVALID_RESULT");
          return events;
        },
      );
    } catch {
      throw new OrderPaymentApplicationError("PERSISTENCE_FAILURE");
    }
    const result = {
      schemaVersion: 1 as const,
      scanned: pending.providerEventIds.length,
      applied: 0,
      replayed: 0,
      unmatched: 0,
      review: 0,
      ignored: 0,
      failed: 0,
    };
    for (const providerEventId of pending.providerEventIds) {
      try {
        const observation = await apply({
          schemaVersion: 1,
          providerEventId,
          requestId: createId(),
          correlationId: createId(),
          taskName: "order-payment-application",
        });
        switch (observation.decision) {
          case "APPLIED":
            result.applied++;
            break;
          case "ALREADY_APPLIED":
            result.replayed++;
            break;
          case "UNMATCHED":
            result.unmatched++;
            break;
          case "REVIEW":
            result.review++;
            break;
          case "IGNORED":
            result.ignored++;
            break;
        }
      } catch {
        result.failed++;
      }
    }
    return orderPaymentRunResultSchema.parse(result);
  };
  return Object.freeze({ apply, runPending });
}
