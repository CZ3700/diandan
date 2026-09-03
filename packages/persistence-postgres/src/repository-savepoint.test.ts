import type { PersistencePortResponse } from "@fan-support/persistence-port";
import { PersistenceTransactionFailureError } from "@fan-support/persistence-port";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, test, vi } from "vitest";

import type { PostgresQueryLayer } from "./query-layer.js";
import { repositoryFailure } from "./repository-response.js";
import { runRepositoryOperation } from "./repository-savepoint.js";

const dialect = new PgDialect();

function transactionScope() {
  return {
    markRollbackOnly: vi.fn(),
    trackOperation: <Result>(operation: () => Promise<Result>) => operation(),
  };
}

test("rolls back repository mutations before returning a failure response", async () => {
  const execute = vi.fn(async () => ({ rows: [] }));
  const database = { execute } as unknown as PostgresQueryLayer;
  const scope = transactionScope();

  const response = await runRepositoryOperation(
    database,
    scope,
    "APPLY_INVENTORY_RESERVATION_TRANSITION",
    async () =>
      repositoryFailure(
        "APPLY_INVENTORY_RESERVATION_TRANSITION",
        "VERSION_CONFLICT",
      ) as PersistencePortResponse,
  );

  expect(response).toMatchObject({
    outcome: "FAILURE",
    error: { code: "VERSION_CONFLICT" },
  });
  expect(scope.markRollbackOnly).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledTimes(3);
});

test("escalates a SAVEPOINT creation failure to the transaction boundary", async () => {
  const execute = vi.fn(async () => {
    throw { code: "08006" };
  });
  const database = { execute } as unknown as PostgresQueryLayer;
  const work = vi.fn(async () => {
    throw new Error("work must not run without a savepoint");
  });

  const failure = await runRepositoryOperation(
    database,
    transactionScope(),
    "APPEND_OUTBOX_EVENT",
    work,
  ).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
  expect(failure).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
    recovery: "RETRY_SAME_COMMAND",
  });
  expect(work).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledTimes(1);
});

test.each([
  {
    label: "rollback-to-savepoint",
    failureStatement: /^rollback to savepoint /u,
  },
  {
    label: "release-savepoint",
    failureStatement: /^release savepoint /u,
  },
])(
  "escalates a $label cleanup failure instead of returning a repository failure",
  async ({ failureStatement }) => {
    const execute = vi.fn(async (statement: unknown) => {
      const rendered = dialect.sqlToQuery(statement as never).sql;
      if (failureStatement.test(rendered)) {
        throw { code: "08006" };
      }
      return { rows: [] };
    });
    const database = { execute } as unknown as PostgresQueryLayer;

    const failure = await runRepositoryOperation(
      database,
      transactionScope(),
      "APPLY_INVENTORY_RESERVATION_TRANSITION",
      async () =>
        repositoryFailure(
          "APPLY_INVENTORY_RESERVATION_TRANSITION",
          "VERSION_CONFLICT",
        ) as PersistencePortResponse,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "TEMPORARY_UNAVAILABLE",
      recovery: "RETRY_SAME_COMMAND",
    });
  },
);

test("serializes concurrent repository savepoint scopes on one transaction", async () => {
  const mutations: string[] = [];
  const savepoints = new Map<string, number>();
  const statements: string[] = [];
  const execute = vi.fn(async (statement: unknown) => {
    const rendered = dialect.sqlToQuery(statement as never).sql;
    statements.push(rendered);
    const savepoint = /^savepoint ([a-z0-9_]+)$/u.exec(rendered)?.[1];
    if (savepoint !== undefined) {
      savepoints.set(savepoint, mutations.length);
      return { rows: [] };
    }
    const rollback = /^rollback to savepoint ([a-z0-9_]+)$/u.exec(
      rendered,
    )?.[1];
    if (rollback !== undefined) {
      const snapshot = savepoints.get(rollback);
      if (snapshot === undefined) {
        throw new Error("missing savepoint");
      }
      mutations.length = snapshot;
      return { rows: [] };
    }
    const release = /^release savepoint ([a-z0-9_]+)$/u.exec(rendered)?.[1];
    if (release !== undefined) {
      if (!savepoints.delete(release)) {
        throw new Error("missing savepoint");
      }
      return { rows: [] };
    }
    throw new Error("unexpected statement");
  });
  const database = { execute } as unknown as PostgresQueryLayer;

  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let signalFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    signalFirstStarted = resolve;
  });
  const first = runRepositoryOperation(
    database,
    transactionScope(),
    "APPLY_INVENTORY_RESERVATION_TRANSITION",
    async () => {
      mutations.push("first-partial-mutation");
      signalFirstStarted();
      await firstGate;
      return repositoryFailure(
        "APPLY_INVENTORY_RESERVATION_TRANSITION",
        "VERSION_CONFLICT",
      ) as PersistencePortResponse;
    },
  );
  await firstStarted;

  let secondSettled = false;
  const second = runRepositoryOperation(
    database,
    transactionScope(),
    "APPLY_INVENTORY_RESERVATION_CREATION",
    async () => {
      mutations.push("second-successful-mutation");
      return {
        schemaVersion: 1,
        operation: "APPLY_INVENTORY_RESERVATION_CREATION",
        outcome: "SUCCESS",
        value: {},
      } as unknown as PersistencePortResponse;
    },
  ).finally(() => {
    secondSettled = true;
  });

  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(secondSettled).toBe(false);

  releaseFirst();
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  expect(firstResponse.outcome).toBe("FAILURE");
  expect(secondResponse.outcome).toBe("SUCCESS");
  expect(mutations).toEqual(["second-successful-mutation"]);
  expect(statements).toHaveLength(5);
  expect(
    new Set(statements.filter((value) => value.startsWith("savepoint "))).size,
  ).toBe(2);
});
