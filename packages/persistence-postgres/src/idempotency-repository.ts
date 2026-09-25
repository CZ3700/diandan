import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import type {
  BeginIdempotencyCommand,
  BeginIdempotencyResponse,
  CompleteIdempotencyCommand,
  CompleteIdempotencyResponse,
  IdempotencyRepository,
} from "@fan-support/persistence-port";

import type { PostgresQueryLayer } from "./query-layer.js";
import {
  parseRepositoryCommand,
  repositoryFailure,
  repositorySuccess,
} from "./repository-response.js";
import { runRepositoryOperation } from "./repository-savepoint.js";
import type { TransactionScopeControl } from "./transaction-runner.js";
import { idempotencyRecords } from "./schema.js";

type IdempotencyRow = typeof idempotencyRecords.$inferSelect &
  Readonly<{ expired: boolean }>;

function scopeWhere(
  command: BeginIdempotencyCommand | CompleteIdempotencyCommand,
) {
  return and(
    eq(idempotencyRecords.actor, command.actor),
    eq(idempotencyRecords.operation, command.idempotencyOperation),
    eq(idempotencyRecords.idempotencyKey, command.idempotencyKey),
  );
}

async function loadScopedForUpdate(
  database: PostgresQueryLayer,
  command: BeginIdempotencyCommand | CompleteIdempotencyCommand,
): Promise<IdempotencyRow | undefined> {
  const [row] = await database
    .select({
      id: idempotencyRecords.id,
      schemaVersion: idempotencyRecords.schemaVersion,
      actor: idempotencyRecords.actor,
      operation: idempotencyRecords.operation,
      idempotencyKey: idempotencyRecords.idempotencyKey,
      canonicalRequestHash: idempotencyRecords.canonicalRequestHash,
      status: idempotencyRecords.status,
      safeResultReference: idempotencyRecords.safeResultReference,
      expiresAt: idempotencyRecords.expiresAt,
      createdAt: idempotencyRecords.createdAt,
      updatedAt: idempotencyRecords.updatedAt,
      expired: sql<boolean>`${idempotencyRecords.expiresAt} <= transaction_timestamp()`,
    })
    .from(idempotencyRecords)
    .where(scopeWhere(command))
    .for("update");
  return row;
}

export function createIdempotencyRepository(
  database: PostgresQueryLayer,
  transactionScope: TransactionScopeControl,
): IdempotencyRepository {
  return {
    async begin(command): Promise<BeginIdempotencyResponse> {
      const parsed = parseRepositoryCommand<
        "BEGIN_IDEMPOTENCY",
        BeginIdempotencyCommand
      >(command, "BEGIN_IDEMPOTENCY");
      if (parsed === undefined) {
        const failure = repositoryFailure(
          "BEGIN_IDEMPOTENCY",
          "INVALID_COMMAND",
        );
        transactionScope.markRollbackOnly(failure);
        return failure;
      }

      return runRepositoryOperation(
        database,
        transactionScope,
        "BEGIN_IDEMPOTENCY",
        async () => {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const [inserted] = await database
              .insert(idempotencyRecords)
              .values({
                id: randomUUID(),
                actor: parsed.actor,
                operation: parsed.idempotencyOperation,
                idempotencyKey: parsed.idempotencyKey,
                canonicalRequestHash: parsed.canonicalRequestHash,
                status: "IN_PROGRESS",
                expiresAt: parsed.expiresAt,
              })
              .onConflictDoNothing({
                target: [
                  idempotencyRecords.actor,
                  idempotencyRecords.operation,
                  idempotencyRecords.idempotencyKey,
                ],
              })
              .returning({ id: idempotencyRecords.id });
            if (inserted !== undefined) {
              return repositorySuccess("BEGIN_IDEMPOTENCY", {
                decision: "STARTED",
              });
            }

            const existing = await loadScopedForUpdate(database, parsed);
            if (existing === undefined) {
              continue;
            }
            if (existing.expired) {
              await database
                .delete(idempotencyRecords)
                .where(eq(idempotencyRecords.id, existing.id));
              continue;
            }
            if (existing.canonicalRequestHash !== parsed.canonicalRequestHash) {
              return repositorySuccess("BEGIN_IDEMPOTENCY", {
                decision: "CONFLICT",
              });
            }
            if (existing.status === "IN_PROGRESS") {
              return repositorySuccess("BEGIN_IDEMPOTENCY", {
                decision: "IN_PROGRESS",
              });
            }
            if (existing.safeResultReference === null) {
              return repositoryFailure(
                "BEGIN_IDEMPOTENCY",
                "INTEGRITY_VIOLATION",
              );
            }
            return repositorySuccess("BEGIN_IDEMPOTENCY", {
              decision: "REPLAY",
              safeResultReference: existing.safeResultReference,
            });
          }
          return repositoryFailure("BEGIN_IDEMPOTENCY", "TRANSACTION_ABORTED");
        },
      );
    },

    async complete(command): Promise<CompleteIdempotencyResponse> {
      const parsed = parseRepositoryCommand<
        "COMPLETE_IDEMPOTENCY",
        CompleteIdempotencyCommand
      >(command, "COMPLETE_IDEMPOTENCY");
      if (parsed === undefined) {
        const failure = repositoryFailure(
          "COMPLETE_IDEMPOTENCY",
          "INVALID_COMMAND",
        );
        transactionScope.markRollbackOnly(failure);
        return failure;
      }

      return runRepositoryOperation(
        database,
        transactionScope,
        "COMPLETE_IDEMPOTENCY",
        async () => {
          const existing = await loadScopedForUpdate(database, parsed);
          if (existing === undefined) {
            return repositoryFailure("COMPLETE_IDEMPOTENCY", "NOT_FOUND");
          }
          if (
            existing.expired ||
            existing.canonicalRequestHash !== parsed.canonicalRequestHash
          ) {
            return repositoryFailure(
              "COMPLETE_IDEMPOTENCY",
              "IDEMPOTENCY_CONFLICT",
            );
          }
          if (existing.status !== "IN_PROGRESS") {
            if (
              existing.status === parsed.status &&
              existing.safeResultReference === parsed.safeResultReference
            ) {
              return repositorySuccess("COMPLETE_IDEMPOTENCY", {
                completed: true,
              });
            }
            return repositoryFailure(
              "COMPLETE_IDEMPOTENCY",
              "IDEMPOTENCY_CONFLICT",
            );
          }

          const [updated] = await database
            .update(idempotencyRecords)
            .set({
              status: parsed.status,
              safeResultReference: parsed.safeResultReference,
              updatedAt: sql`transaction_timestamp()`,
            })
            .where(
              and(
                eq(idempotencyRecords.id, existing.id),
                eq(idempotencyRecords.status, "IN_PROGRESS"),
              ),
            )
            .returning({ id: idempotencyRecords.id });
          if (updated === undefined) {
            return repositoryFailure(
              "COMPLETE_IDEMPOTENCY",
              "VERSION_CONFLICT",
            );
          }
          return repositorySuccess("COMPLETE_IDEMPOTENCY", {
            completed: true,
          });
        },
      );
    },
  };
}
