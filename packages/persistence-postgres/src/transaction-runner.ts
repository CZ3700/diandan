import { classifyPostgresFailure } from "./errors.js";

import {
  persistencePortResponseSchema,
  PersistenceTransactionFailureError,
  type PersistencePortFailure,
} from "@fan-support/persistence-port";

type TransactionFailure = Omit<
  PersistencePortFailure["error"],
  "schemaVersion"
>;

export interface TransactionClient {
  query(text: string): Promise<unknown>;
  release(destroy?: boolean): void;
}

export type TransactionRunnerOptions = Readonly<{
  schemaVersion: 1;
  isolationLevel: "READ_COMMITTED" | "SERIALIZABLE";
}>;

export type TransactionScopeControl = Readonly<{
  markRollbackOnly(failure: PersistencePortFailure): void;
  trackOperation<Result>(operation: () => Promise<Result>): Promise<Result>;
}>;

export function createPersistenceTransactionFailureError(
  failure: TransactionFailure,
): PersistenceTransactionFailureError {
  return new PersistenceTransactionFailureError({
    schemaVersion: 1,
    operation: "RUN_TRANSACTION",
    outcome: "FAILURE",
    error: { schemaVersion: 1, ...failure },
  });
}

export function persistenceTransactionFailureFromPostgres(
  error: unknown,
): PersistenceTransactionFailureError {
  return createPersistenceTransactionFailureError(
    classifyPostgresFailure(error),
  );
}

function transactionErrorFromCommitFailure(
  error: unknown,
): PersistenceTransactionFailureError {
  const classification = classifyPostgresFailure(error);
  if (
    classification.code === "TRANSACTION_ABORTED" ||
    classification.code === "ALREADY_EXISTS" ||
    classification.code === "INTEGRITY_VIOLATION" ||
    classification.code === "CONFIGURATION_ERROR"
  ) {
    return createPersistenceTransactionFailureError(classification);
  }
  return createPersistenceTransactionFailureError({
    code: "TRANSACTION_OUTCOME_UNKNOWN",
    recovery: "RECONCILE_REQUIRED",
  });
}

type TransactionRunnerDependencies<Repositories> = Readonly<{
  acquireClient: () => Promise<TransactionClient>;
  createRepositories: (
    client: TransactionClient,
    transactionScope: TransactionScopeControl,
  ) => Repositories;
}>;

async function rollback(client: TransactionClient): Promise<void> {
  await client.query("ROLLBACK");
}

function isEnumerableDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & Readonly<{ value: unknown }> {
  return (
    descriptor !== undefined &&
    descriptor.enumerable === true &&
    "value" in descriptor
  );
}

const invalidJsonSnapshot = Symbol("invalid-json-snapshot");

type CanonicalJsonData =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonData[]
  | Readonly<{ [key: string]: CanonicalJsonData }>;

function createCanonicalJsonSnapshot(
  value: unknown,
  ancestors = new Set<object>(),
): CanonicalJsonData | typeof invalidJsonSnapshot {
  try {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : invalidJsonSnapshot;
    }
    if (typeof value !== "object" || ancestors.has(value)) {
      return invalidJsonSnapshot;
    }

    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (!isArray && prototype !== Object.prototype && prototype !== null) {
      return invalidJsonSnapshot;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return invalidJsonSnapshot;
    }

    ancestors.add(value);
    try {
      if (isArray) {
        const names = Object.getOwnPropertyNames(value);
        const lengthDescriptor = Object.getOwnPropertyDescriptor(
          value,
          "length",
        );
        if (
          lengthDescriptor === undefined ||
          !("value" in lengthDescriptor) ||
          typeof lengthDescriptor.value !== "number" ||
          !Number.isInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0 ||
          names.length !== lengthDescriptor.value + 1
        ) {
          return invalidJsonSnapshot;
        }
        const length = lengthDescriptor.value;
        if (
          names.some((name) => {
            if (name === "length") {
              return false;
            }
            const index = Number(name);
            return (
              !Number.isInteger(index) ||
              index < 0 ||
              index >= length ||
              String(index) !== name
            );
          })
        ) {
          return invalidJsonSnapshot;
        }

        const snapshot: CanonicalJsonData[] = new Array<CanonicalJsonData>(
          length,
        );
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, index);
          if (!isEnumerableDataDescriptor(descriptor)) {
            return invalidJsonSnapshot;
          }
          const entrySnapshot = createCanonicalJsonSnapshot(
            descriptor.value,
            ancestors,
          );
          if (entrySnapshot === invalidJsonSnapshot) {
            return invalidJsonSnapshot;
          }
          snapshot[index] = entrySnapshot;
        }
        return Object.freeze(snapshot);
      }

      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== "string")) {
        return invalidJsonSnapshot;
      }
      const snapshot: Record<string, CanonicalJsonData> = {};
      for (const key of (keys as string[]).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!isEnumerableDataDescriptor(descriptor)) {
          return invalidJsonSnapshot;
        }
        const propertySnapshot = createCanonicalJsonSnapshot(
          descriptor.value,
          ancestors,
        );
        if (propertySnapshot === invalidJsonSnapshot) {
          return invalidJsonSnapshot;
        }
        Object.defineProperty(snapshot, key, {
          configurable: false,
          enumerable: true,
          value: propertySnapshot,
          writable: false,
        });
      }
      return Object.freeze(snapshot);
    } finally {
      ancestors.delete(value);
    }
  } catch {
    return invalidJsonSnapshot;
  }
}

function sameValidatedJsonData(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);
  if (leftIsArray || rightIsArray) {
    if (!leftIsArray || !rightIsArray) {
      return false;
    }
    const leftLength = Object.getOwnPropertyDescriptor(left, "length")?.value;
    const rightLength = Object.getOwnPropertyDescriptor(right, "length")?.value;
    if (
      typeof leftLength !== "number" ||
      typeof rightLength !== "number" ||
      leftLength !== rightLength
    ) {
      return false;
    }
    for (let index = 0; index < leftLength; index += 1) {
      const leftDescriptor = Object.getOwnPropertyDescriptor(left, index);
      const rightDescriptor = Object.getOwnPropertyDescriptor(right, index);
      if (
        !isEnumerableDataDescriptor(leftDescriptor) ||
        !isEnumerableDataDescriptor(rightDescriptor) ||
        !sameValidatedJsonData(leftDescriptor.value, rightDescriptor.value)
      ) {
        return false;
      }
    }
    return true;
  }

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])
  ) {
    return false;
  }
  return leftKeys.every((key) => {
    const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
    const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
    return (
      isEnumerableDataDescriptor(leftDescriptor) &&
      isEnumerableDataDescriptor(rightDescriptor) &&
      sameValidatedJsonData(leftDescriptor.value, rightDescriptor.value)
    );
  });
}

function callbackPropagatesFailure(
  result: unknown,
  failure: PersistencePortFailure,
): boolean {
  try {
    return sameValidatedJsonData(result, failure);
  } catch {
    return false;
  }
}

function readCommand(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(result, "command");
    return descriptor !== undefined &&
      descriptor.enumerable === true &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

export function createTransactionRunner<Repositories>(
  dependencies: TransactionRunnerDependencies<Repositories>,
): Readonly<{
  run<Result>(
    options: TransactionRunnerOptions,
    work: (repositories: Repositories) => Promise<Result>,
  ): Promise<Result>;
}> {
  return {
    run: async <Result>(
      options: TransactionRunnerOptions,
      work: (repositories: Repositories) => Promise<Result>,
    ): Promise<Result> => {
      let client: TransactionClient;
      try {
        client = await dependencies.acquireClient();
      } catch (error: unknown) {
        throw persistenceTransactionFailureFromPostgres(error);
      }

      let destroyOnRelease = false;
      let rollbackOnlyFailure: PersistencePortFailure | undefined;
      let scopeLifecycle: "OPEN" | "DRAINING" | "CLOSED" = "OPEN";
      let trackedOperationFailure: unknown;
      const inFlightOperations = new Set<Promise<unknown>>();
      const transactionScope: TransactionScopeControl = Object.freeze({
        markRollbackOnly: (failure) => {
          if (scopeLifecycle === "CLOSED") {
            throw createPersistenceTransactionFailureError({
              code: "CONFIGURATION_ERROR",
              recovery: "NONE",
            });
          }
          const failureSnapshot = createCanonicalJsonSnapshot(failure);
          const parsedFailure =
            failureSnapshot === invalidJsonSnapshot
              ? undefined
              : persistencePortResponseSchema.safeParse(failureSnapshot);
          if (
            parsedFailure === undefined ||
            !parsedFailure.success ||
            parsedFailure.data.outcome !== "FAILURE"
          ) {
            throw createPersistenceTransactionFailureError({
              code: "CONFIGURATION_ERROR",
              recovery: "NONE",
            });
          }
          const parsedFailureSnapshot = createCanonicalJsonSnapshot(
            parsedFailure.data,
          );
          if (parsedFailureSnapshot === invalidJsonSnapshot) {
            throw createPersistenceTransactionFailureError({
              code: "CONFIGURATION_ERROR",
              recovery: "NONE",
            });
          }
          rollbackOnlyFailure ??=
            parsedFailureSnapshot as unknown as PersistencePortFailure;
        },
        trackOperation: <Result>(
          operation: () => Promise<Result>,
        ): Promise<Result> => {
          if (scopeLifecycle !== "OPEN") {
            return Promise.reject(
              createPersistenceTransactionFailureError({
                code: "CONFIGURATION_ERROR",
                recovery: "NONE",
              }),
            );
          }
          let result: Promise<Result>;
          try {
            result = Promise.resolve(operation());
          } catch (error: unknown) {
            result = Promise.reject(error);
          }
          inFlightOperations.add(result);
          void result.then(
            () => {
              inFlightOperations.delete(result);
            },
            (error: unknown) => {
              trackedOperationFailure ??= error;
              inFlightOperations.delete(result);
            },
          );
          return result;
        },
      });
      const closeAndDrainOperations = async (): Promise<void> => {
        scopeLifecycle = "DRAINING";
        while (inFlightOperations.size > 0) {
          await Promise.allSettled([...inFlightOperations]);
        }
        scopeLifecycle = "CLOSED";
        if (trackedOperationFailure !== undefined) {
          throw trackedOperationFailure;
        }
      };
      try {
        const isolationSql =
          options.isolationLevel === "SERIALIZABLE"
            ? "SERIALIZABLE"
            : "READ COMMITTED";
        try {
          await client.query(`BEGIN ISOLATION LEVEL ${isolationSql}`);
        } catch (error: unknown) {
          destroyOnRelease = true;
          throw persistenceTransactionFailureFromPostgres(error);
        }
        try {
          await client.query("SET LOCAL search_path = pg_catalog, public");
        } catch (error: unknown) {
          try {
            await rollback(client);
          } catch (rollbackError: unknown) {
            destroyOnRelease = true;
            throw persistenceTransactionFailureFromPostgres(rollbackError);
          }
          throw persistenceTransactionFailureFromPostgres(error);
        }

        let repositories: Repositories;
        try {
          repositories = dependencies.createRepositories(
            client,
            transactionScope,
          );
        } catch (error: unknown) {
          try {
            await rollback(client);
          } catch (rollbackError: unknown) {
            destroyOnRelease = true;
            throw persistenceTransactionFailureFromPostgres(rollbackError);
          }
          throw persistenceTransactionFailureFromPostgres(error);
        }

        let resultSnapshot!: Result;
        let callbackRejected = false;
        let callbackFailure: unknown;
        try {
          const result = await work(repositories);
          const snapshot = createCanonicalJsonSnapshot(result);
          if (snapshot === invalidJsonSnapshot) {
            throw createPersistenceTransactionFailureError({
              code: "CONFIGURATION_ERROR",
              recovery: "NONE",
            });
          }
          resultSnapshot = snapshot as unknown as Result;
        } catch (error: unknown) {
          callbackRejected = true;
          callbackFailure = error;
        }

        let operationRejected = false;
        let operationFailure: unknown;
        try {
          await closeAndDrainOperations();
        } catch (error: unknown) {
          operationRejected = true;
          operationFailure = error;
        }

        if (callbackRejected || operationRejected) {
          try {
            await rollback(client);
          } catch (rollbackError: unknown) {
            destroyOnRelease = true;
            throw persistenceTransactionFailureFromPostgres(rollbackError);
          }
          throw operationRejected ? operationFailure : callbackFailure;
        }

        if (rollbackOnlyFailure !== undefined) {
          try {
            await rollback(client);
          } catch (error: unknown) {
            destroyOnRelease = true;
            throw persistenceTransactionFailureFromPostgres(error);
          }
          if (callbackPropagatesFailure(resultSnapshot, rollbackOnlyFailure)) {
            return resultSnapshot;
          }
          const { code, recovery, retryAfterMs } = rollbackOnlyFailure.error;
          throw createPersistenceTransactionFailureError({
            code,
            recovery,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          });
        }

        let commitResult: unknown;
        try {
          commitResult = await client.query("COMMIT");
        } catch (error: unknown) {
          try {
            await rollback(client);
          } catch {
            destroyOnRelease = true;
            // The original commit failure determines the stable public classification.
          }
          throw transactionErrorFromCommitFailure(error);
        }
        const commitCommand = readCommand(commitResult);
        if (commitCommand === "ROLLBACK") {
          throw createPersistenceTransactionFailureError({
            code: "TRANSACTION_ABORTED",
            recovery: "RETRY_SAME_COMMAND",
            retryAfterMs: 250,
          });
        }
        if (commitCommand !== "COMMIT") {
          destroyOnRelease = true;
          throw createPersistenceTransactionFailureError({
            code: "TRANSACTION_OUTCOME_UNKNOWN",
            recovery: "RECONCILE_REQUIRED",
          });
        }
        return resultSnapshot;
      } finally {
        client.release(destroyOnRelease);
      }
    },
  };
}
