import { sql } from "drizzle-orm";
import type {
  PersistencePortCommand,
  PersistencePortFailure,
  PersistencePortResponse,
} from "@fan-support/persistence-port";

import type { PostgresQueryLayer } from "./query-layer.js";
import { repositoryDatabaseFailure } from "./repository-response.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionScopeControl,
} from "./transaction-runner.js";

type PersistenceOperation = PersistencePortCommand["operation"];

type RepositoryOperationQueue = {
  tail: Promise<void>;
  nextSavepointId: bigint;
};

const operationQueues = new WeakMap<
  PostgresQueryLayer,
  RepositoryOperationQueue
>();

function queueFor(database: PostgresQueryLayer): RepositoryOperationQueue {
  const existing = operationQueues.get(database);
  if (existing !== undefined) {
    return existing;
  }
  const created: RepositoryOperationQueue = {
    tail: Promise.resolve(),
    nextSavepointId: 0n,
  };
  operationQueues.set(database, created);
  return created;
}

async function runWithOperationQueue<Response>(
  database: PostgresQueryLayer,
  work: (savepointName: string) => Promise<Response>,
): Promise<Response> {
  const queue = queueFor(database);
  const predecessor = queue.tail;
  let releaseTurn!: () => void;
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const queuedTail = predecessor.then(() => turn);
  queue.tail = queuedTail;
  queue.nextSavepointId += 1n;
  const savepointName = `persistence_repository_operation_${queue.nextSavepointId}`;

  await predecessor;
  try {
    return await work(savepointName);
  } finally {
    releaseTurn();
    if (queue.tail === queuedTail) {
      operationQueues.delete(database);
    }
  }
}

export async function runRepositoryOperation<
  Operation extends PersistenceOperation,
  Response extends PersistencePortResponse,
>(
  database: PostgresQueryLayer,
  transactionScope: TransactionScopeControl,
  operation: Operation,
  work: () => Promise<Response>,
): Promise<Response> {
  return transactionScope.trackOperation(() =>
    runWithOperationQueue(database, async (savepointName) => {
      try {
        await database.execute(sql.raw(`savepoint ${savepointName}`));
      } catch (error: unknown) {
        throw persistenceTransactionFailureFromPostgres(error);
      }

      let response: Response;
      try {
        response = await work();
      } catch (error: unknown) {
        try {
          await database.execute(
            sql.raw(`rollback to savepoint ${savepointName}`),
          );
          await database.execute(sql.raw(`release savepoint ${savepointName}`));
        } catch (boundaryError: unknown) {
          throw persistenceTransactionFailureFromPostgres(boundaryError);
        }
        const failure = repositoryDatabaseFailure(operation, error);
        transactionScope.markRollbackOnly(failure);
        return failure as Response;
      }

      try {
        if (response.outcome === "FAILURE") {
          await database.execute(
            sql.raw(`rollback to savepoint ${savepointName}`),
          );
          transactionScope.markRollbackOnly(response as PersistencePortFailure);
        }
        await database.execute(sql.raw(`release savepoint ${savepointName}`));
      } catch (boundaryError: unknown) {
        throw persistenceTransactionFailureFromPostgres(boundaryError);
      }
      return response;
    }),
  );
}
