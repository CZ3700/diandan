import { randomUUID } from "node:crypto";
import {
  adminFinanceApplyCommandSchema,
  adminFinanceApplyResultSchema,
  adminFinanceListPendingCommandSchema,
  adminFinancePendingEventsSchema,
  adminFinanceRunResultSchema,
  type AdminFinanceApplyCommand,
} from "@fan-support/contracts";
import type {
  AdminFinanceRepository,
  AdminFinanceTransactionManager,
} from "@fan-support/persistence-port";
/** Receipts, aggregate mutations and outbox append share the caller's transaction. */
export async function applyAdminFinanceInTransaction(
  repository: AdminFinanceRepository,
  input: AdminFinanceApplyCommand,
) {
  const command = adminFinanceApplyCommandSchema.parse(input);
  const result = adminFinanceApplyResultSchema.parse(
    await repository.apply(command),
  );
  if (result.providerEventId !== command.providerEventId)
    throw new TypeError("Mismatched finance evidence application");
  return result;
}
export function createAdminFinanceEventApplication(
  transactions: AdminFinanceTransactionManager,
) {
  const apply = (input: AdminFinanceApplyCommand) =>
    transactions.runInAdminFinanceTransaction((repository) =>
      applyAdminFinanceInTransaction(repository, input),
    );
  async function runPending(limit: number) {
    const command = adminFinanceListPendingCommandSchema.parse({
      schemaVersion: 1,
      limit,
    });
    const pending = await transactions.runInAdminFinanceTransaction(
      async (repository) =>
        adminFinancePendingEventsSchema.parse(
          await repository.listPending(command),
        ),
    );
    if (pending.providerEventIds.length > limit)
      throw new TypeError("Unbounded finance evidence batch");
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
        const observation = await apply(
          adminFinanceApplyCommandSchema.parse({
            schemaVersion: 1,
            providerEventId,
            requestId: randomUUID(),
            correlationId: randomUUID(),
            taskName: "admin-finance-evidence-recovery",
          }),
        );
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
    return adminFinanceRunResultSchema.parse(result);
  }
  return Object.freeze({ apply, runPending });
}
