import { describe, expect, test } from "vitest";

import {
  createTransactionRunner,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

import {
  parsePersistenceTransactionFailure,
  PersistenceTransactionFailureError,
  type PersistencePortFailure,
} from "@fan-support/persistence-port";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve } as const;
}

type QueryPause = Readonly<{
  statement: string;
  entered: ReturnType<typeof deferred>;
  resume: ReturnType<typeof deferred>;
}>;

class RecordingTransactionClient implements TransactionClient {
  public readonly statements: string[] = [];
  public readonly releaseArguments: (boolean | undefined)[] = [];
  public released = false;

  public constructor(
    private readonly commitFailure?: unknown,
    private readonly queryFailures: Readonly<Record<string, unknown>> = {},
    private readonly commitCommand = "COMMIT",
    private readonly queryPause?: QueryPause,
    private readonly commitResult?: unknown,
  ) {}

  public async query(text: string): Promise<unknown> {
    this.statements.push(text);
    if (this.queryPause?.statement === text) {
      this.queryPause.entered.resolve();
      await this.queryPause.resume.promise;
    }
    if (text === "COMMIT" && this.commitFailure !== undefined) {
      throw this.commitFailure;
    }
    if (Object.hasOwn(this.queryFailures, text)) {
      throw this.queryFailures[text];
    }
    return text === "COMMIT"
      ? (this.commitResult ?? { command: this.commitCommand })
      : {};
  }

  public release(destroy?: boolean): void {
    this.released = true;
    this.releaseArguments.push(destroy);
  }
}

describe("transaction runner", () => {
  test("uses one acquired client through callback and commit", async () => {
    const client = new RecordingTransactionClient();
    const repositories = { marker: "same-client-repositories" } as const;
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (transactionClient) => {
        expect(transactionClient).toBe(client);
        expect(client.statements).toEqual([
          "BEGIN ISOLATION LEVEL SERIALIZABLE",
          "SET LOCAL search_path = pg_catalog, public",
        ]);
        return repositories;
      },
    });

    await expect(
      runner.run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        async (receivedRepositories) => {
          expect(receivedRepositories).toBe(repositories);
          return { committed: true };
        },
      ),
    ).resolves.toEqual({ committed: true });
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
    ]);
    expect(client.released).toBe(true);
    expect(client.releaseArguments).toEqual([false]);
  });

  test.each([
    ["NaN", () => Number.NaN],
    ["positive Infinity", () => Number.POSITIVE_INFINITY],
    ["negative Infinity", () => Number.NEGATIVE_INFINITY],
    ["Date", () => new Date("2026-09-03T00:00:00.000Z")],
    ["Map", () => new Map([["key", "value"]])],
    ["BigInt", () => 1n],
    ["undefined", () => undefined],
    [
      "a sparse array",
      () => {
        const result: unknown[] = [];
        result.length = 1;
        return result;
      },
    ],
    ["a top-level symbol", () => Symbol("transaction-result")],
    [
      "an object with a symbol key",
      () => ({ [Symbol("non-json-property")]: true }),
    ],
    [
      "an object with a non-enumerable property",
      () => {
        const result = {};
        Object.defineProperty(result, "hidden", {
          enumerable: false,
          value: true,
        });
        return result;
      },
    ],
    [
      "a cyclic object",
      () => {
        const result: Record<string, unknown> = {};
        result["self"] = result;
        return result;
      },
    ],
  ] as readonly (readonly [string, () => unknown])[])(
    "rolls back instead of committing when the callback returns %s",
    async (_label, createResult) => {
      const client = new RecordingTransactionClient();
      const runner = createTransactionRunner({
        acquireClient: async () => client,
        createRepositories: () => ({ marker: "repositories" }),
      });

      const failure = await runner
        .run({ schemaVersion: 1, isolationLevel: "READ_COMMITTED" }, async () =>
          createResult(),
        )
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
      expect(failure).toMatchObject({
        code: "CONFIGURATION_ERROR",
        recovery: "NONE",
      });
      expect(client.statements).toEqual([
        "BEGIN ISOLATION LEVEL READ COMMITTED",
        "SET LOCAL search_path = pg_catalog, public",
        "ROLLBACK",
      ]);
      expect(client.releaseArguments).toEqual([false]);
    },
  );

  test("rejects an accessor result without executing its getter", async () => {
    const client = new RecordingTransactionClient();
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });
    let getterCalls = 0;
    const accessorResult = {};
    Object.defineProperty(accessorResult, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "must not execute";
      },
    });

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async () => accessorResult,
      )
      .catch((error: unknown) => error);

    expect(getterCalls).toBe(0);
    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "CONFIGURATION_ERROR",
      recovery: "NONE",
    });
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "ROLLBACK",
    ]);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("commits dense JSON arrays and null-prototype records", async () => {
    const client = new RecordingTransactionClient();
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });
    const nullPrototypeRecord = Object.create(null) as Record<string, unknown>;
    nullPrototypeRecord["nested"] = [null, true, 42, "value"];
    const result = {
      data: nullPrototypeRecord,
      list: [{ finite: -1.5 }],
    };

    const transactionResult = await runner.run(
      { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
      async () => result,
    );

    expect(transactionResult).toEqual(result);
    expect(transactionResult).not.toBe(result);
    expect(transactionResult.data).not.toBe(result.data);
    expect(Object.isFrozen(transactionResult)).toBe(true);
    expect(Object.isFrozen(transactionResult.data)).toBe(true);
    expect(Object.isFrozen(transactionResult.data["nested"])).toBe(true);
    expect(Object.isFrozen(transactionResult.list)).toBe(true);
    expect(Object.isFrozen(transactionResult.list[0])).toBe(true);
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
    ]);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("normalizes a custom-prototype array without invoking inherited toJSON", async () => {
    const client = new RecordingTransactionClient();
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });
    let toJsonCalls = 0;
    const customArrayPrototype = Object.create(Array.prototype) as object;
    Object.defineProperty(customArrayPrototype, "toJSON", {
      value: () => {
        toJsonCalls += 1;
        return ["impostor"];
      },
    });
    const callbackResult = ["canonical", { nested: true }];
    Object.setPrototypeOf(callbackResult, customArrayPrototype);

    const transactionResult = await runner.run(
      { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
      async () => callbackResult,
    );

    expect(transactionResult).toEqual(["canonical", { nested: true }]);
    expect(transactionResult).not.toBe(callbackResult);
    expect(Object.getPrototypeOf(transactionResult)).toBe(Array.prototype);
    expect("toJSON" in transactionResult).toBe(false);
    expect(toJsonCalls).toBe(0);
    expect(Object.isFrozen(transactionResult)).toBe(true);
    expect(Object.isFrozen(transactionResult[1])).toBe(true);
  });

  test("snapshots the callback result before draining tracked operations", async () => {
    const client = new RecordingTransactionClient();
    const callbackResult = { finite: 1 };
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (_transactionClient, transactionScope) => ({
        mutateWhileDraining: () =>
          transactionScope.trackOperation(
            () =>
              new Promise<void>((resolve) => {
                setTimeout(() => {
                  callbackResult.finite = Number.NaN;
                  resolve();
                }, 0);
              }),
          ),
      }),
    });

    const transactionResult = await runner.run(
      { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
      async (repositories) => {
        void repositories.mutateWhileDraining();
        return callbackResult;
      },
    );

    expect(transactionResult).toEqual({ finite: 1 });
    expect(transactionResult).not.toBe(callbackResult);
    expect(Object.isFrozen(transactionResult)).toBe(true);
    expect(callbackResult.finite).toBe(Number.NaN);
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
    ]);
  });

  test("returns the frozen snapshot when the source mutates during COMMIT", async () => {
    const commitEntered = deferred();
    const resumeCommit = deferred();
    const client = new RecordingTransactionClient(undefined, {}, "COMMIT", {
      statement: "COMMIT",
      entered: commitEntered,
      resume: resumeCommit,
    });
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });
    const callbackResult = { finite: 1 };

    const pendingResult = runner.run(
      { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
      async () => callbackResult,
    );
    await commitEntered.promise;
    callbackResult.finite = Number.NaN;
    resumeCommit.resolve();

    const transactionResult = await pendingResult;
    expect(transactionResult).toEqual({ finite: 1 });
    expect(transactionResult).not.toBe(callbackResult);
    expect(Object.isFrozen(transactionResult)).toBe(true);
    expect(callbackResult.finite).toBe(Number.NaN);
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
    ]);
  });

  test("rolls back the whole unit of work when a repository marks it rollback-only", async () => {
    const client = new RecordingTransactionClient();
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (_transactionClient, transactionScope) =>
        transactionScope,
    });
    const repositoryFailure = {
      schemaVersion: 1,
      operation: "APPEND_OUTBOX_EVENT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      },
    } as const;

    const transactionResult = await runner.run(
      { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
      async (transactionScope) => {
        transactionScope.markRollbackOnly(repositoryFailure);
        return repositoryFailure;
      },
    );

    expect(transactionResult).toEqual(repositoryFailure);
    expect(transactionResult).not.toBe(repositoryFailure);
    expect(transactionResult.error).not.toBe(repositoryFailure.error);
    expect(Object.isFrozen(transactionResult)).toBe(true);
    expect(Object.isFrozen(transactionResult.error)).toBe(true);
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SET LOCAL search_path = pg_catalog, public",
      "ROLLBACK",
    ]);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("returns the failure snapshot when the source mutates during ROLLBACK", async () => {
    const rollbackEntered = deferred();
    const resumeRollback = deferred();
    const client = new RecordingTransactionClient(undefined, {}, "COMMIT", {
      statement: "ROLLBACK",
      entered: rollbackEntered,
      resume: resumeRollback,
    });
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (_transactionClient, transactionScope) =>
        transactionScope,
    });
    const repositoryFailure: PersistencePortFailure = {
      schemaVersion: 1,
      operation: "APPEND_OUTBOX_EVENT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      },
    };

    const pendingResult = runner.run(
      { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
      async (transactionScope) => {
        transactionScope.markRollbackOnly(repositoryFailure);
        return repositoryFailure;
      },
    );
    await rollbackEntered.promise;
    (repositoryFailure as { outcome: string }).outcome = "SUCCESS";
    resumeRollback.resolve();

    const transactionResult = await pendingResult;
    expect(transactionResult).toEqual({
      schemaVersion: 1,
      operation: "APPEND_OUTBOX_EVENT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      },
    });
    expect(transactionResult).not.toBe(repositoryFailure);
    expect(Object.isFrozen(transactionResult)).toBe(true);
    expect(Object.isFrozen(transactionResult.error)).toBe(true);
    expect(repositoryFailure.outcome).toBe("SUCCESS");
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SET LOCAL search_path = pg_catalog, public",
      "ROLLBACK",
    ]);
  });

  test("does not let synchronous mutation turn rollback-only failure into success", async () => {
    const client = new RecordingTransactionClient();
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (_transactionClient, transactionScope) =>
        transactionScope,
    });
    const repositoryFailure: PersistencePortFailure = {
      schemaVersion: 1,
      operation: "APPEND_OUTBOX_EVENT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      },
    };

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        async (transactionScope) => {
          transactionScope.markRollbackOnly(repositoryFailure);
          (repositoryFailure as { outcome: string }).outcome = "SUCCESS";
          return repositoryFailure;
        },
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "TEMPORARY_UNAVAILABLE",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 250,
    });
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SET LOCAL search_path = pg_catalog, public",
      "ROLLBACK",
    ]);
  });

  test("rejects an invalid rollback-only failure at mark time", async () => {
    const client = new RecordingTransactionClient();
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (_transactionClient, transactionScope) =>
        transactionScope,
    });
    const invalidFailure = {
      schemaVersion: 1,
      operation: "APPEND_OUTBOX_EVENT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "NOT_A_PERSISTENCE_ERROR",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      },
    } as unknown as PersistencePortFailure;

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        async (transactionScope) => {
          transactionScope.markRollbackOnly(invalidFailure);
          return { acknowledged: true };
        },
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "CONFIGURATION_ERROR",
      recovery: "NONE",
    });
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SET LOCAL search_path = pg_catalog, public",
      "ROLLBACK",
    ]);
  });

  test("recognizes a reordered JSON copy of a rollback-only failure", async () => {
    const client = new RecordingTransactionClient();
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (_transactionClient, transactionScope) =>
        transactionScope,
    });
    const repositoryFailure = {
      schemaVersion: 1,
      operation: "APPEND_OUTBOX_EVENT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      },
    } as const;
    const reorderedFailure = {
      error: {
        retryAfterMs: 250,
        recovery: "RETRY_SAME_COMMAND",
        code: "TEMPORARY_UNAVAILABLE",
        schemaVersion: 1,
      },
      outcome: "FAILURE",
      operation: "APPEND_OUTBOX_EVENT",
      schemaVersion: 1,
    } as const;

    const transactionResult = await runner.run(
      { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
      async (transactionScope) => {
        transactionScope.markRollbackOnly(repositoryFailure);
        return reorderedFailure;
      },
    );

    expect(transactionResult).toEqual(reorderedFailure);
    expect(transactionResult).not.toBe(reorderedFailure);
    expect(Object.isFrozen(transactionResult)).toBe(true);
    expect(Object.isFrozen(transactionResult.error)).toBe(true);
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SET LOCAL search_path = pg_catalog, public",
      "ROLLBACK",
    ]);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("does not let toJSON impersonate a rollback-only failure", async () => {
    const client = new RecordingTransactionClient();
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (_transactionClient, transactionScope) =>
        transactionScope,
    });
    const repositoryFailure = {
      schemaVersion: 1,
      operation: "APPEND_OUTBOX_EVENT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      },
    } as const;
    let toJsonCalls = 0;
    const impostor = {
      acknowledged: true,
      toJSON() {
        toJsonCalls += 1;
        return repositoryFailure;
      },
    };

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        async (transactionScope) => {
          transactionScope.markRollbackOnly(repositoryFailure);
          return impostor;
        },
      )
      .catch((error: unknown) => error);

    expect(toJsonCalls).toBe(0);
    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "CONFIGURATION_ERROR",
      recovery: "NONE",
    });
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SET LOCAL search_path = pg_catalog, public",
      "ROLLBACK",
    ]);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("rejects a false success when work ignores a rollback-only repository failure", async () => {
    const client = new RecordingTransactionClient();
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (_transactionClient, transactionScope) =>
        transactionScope,
    });
    const repositoryFailure = {
      schemaVersion: 1,
      operation: "APPEND_OUTBOX_EVENT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      },
    } as const;

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "SERIALIZABLE" },
        async (transactionScope) => {
          transactionScope.markRollbackOnly(repositoryFailure);
          return { acknowledged: true };
        },
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "TEMPORARY_UNAVAILABLE",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 250,
    });
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SET LOCAL search_path = pg_catalog, public",
      "ROLLBACK",
    ]);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("drains a floated repository operation before committing and releasing", async () => {
    const client = new RecordingTransactionClient();
    const started = deferred();
    const releaseOperation = deferred();
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (_transactionClient, transactionScope) => ({
        start: () =>
          transactionScope.trackOperation(async () => {
            await client.query("REPOSITORY START");
            started.resolve();
            await releaseOperation.promise;
            await client.query("REPOSITORY FINISH");
          }),
      }),
    });

    const result = runner.run(
      { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
      async (repositories) => {
        void repositories.start();
        return { acknowledged: true };
      },
    );
    await started.promise;
    await Promise.resolve();
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "REPOSITORY START",
    ]);
    expect(client.releaseArguments).toEqual([]);

    releaseOperation.resolve();
    await expect(result).resolves.toEqual({ acknowledged: true });
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "REPOSITORY START",
      "REPOSITORY FINISH",
      "COMMIT",
    ]);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("rolls back a tracked boundary failure even when the callback catches it", async () => {
    const client = new RecordingTransactionClient();
    const boundaryFailure = new PersistenceTransactionFailureError({
      schemaVersion: 1,
      operation: "RUN_TRANSACTION",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "CONFIGURATION_ERROR",
        recovery: "NONE",
      },
    });
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (_transactionClient, transactionScope) => ({
        fail: () =>
          transactionScope.trackOperation(async () => {
            throw boundaryFailure;
          }),
      }),
    });

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async (repositories) => {
          await repositories.fail().catch(() => undefined);
          return { acknowledged: true };
        },
      )
      .catch((error: unknown) => error);

    expect(failure).toBe(boundaryFailure);
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "ROLLBACK",
    ]);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("rejects repository work started after its transaction scope closes", async () => {
    const client = new RecordingTransactionClient();
    let escapedScope: TransactionScopeControl | undefined;
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: (_transactionClient, transactionScope) => {
        escapedScope = transactionScope;
        return { marker: "repositories" };
      },
    });

    await runner.run(
      { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
      async () => ({ committed: true }),
    );
    expect(escapedScope).toBeDefined();
    let invoked = false;
    const failure = await escapedScope!
      .trackOperation(async () => {
        invoked = true;
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "CONFIGURATION_ERROR",
      recovery: "NONE",
    });
    expect(invoked).toBe(false);
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
    ]);
  });

  test("treats a deferred constraint failure at COMMIT as transaction failure", async () => {
    const client = new RecordingTransactionClient({
      code: "23514",
      message: "deferred constraint failed [SENSITIVE_DATABASE_DETAIL]",
      constraint: "private_constraint_name",
    });
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async () => ({ repositoryReportedSuccess: true }),
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "INTEGRITY_VIOLATION",
      recovery: "NONE",
    });
    expect((failure as Error).message).not.toContain("SENSITIVE");
    expect((failure as Error).message).not.toContain("private_constraint_name");
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(client.released).toBe(true);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("requires reconciliation when a COMMIT connection failure hides the outcome", async () => {
    const client = new RecordingTransactionClient({
      code: "08006",
      message: "connection lost after COMMIT was sent",
    });
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async () => ({ repositoryReportedSuccess: true }),
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      recovery: "RECONCILE_REQUIRED",
    });
    expect(failure).not.toHaveProperty("retryAfterMs");
    const serialized = JSON.parse(JSON.stringify(failure)) as unknown;
    expect(parsePersistenceTransactionFailure(serialized)).toEqual({
      schemaVersion: 1,
      operation: "RUN_TRANSACTION",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TRANSACTION_OUTCOME_UNKNOWN",
        recovery: "RECONCILE_REQUIRED",
      },
    });
    expect(JSON.stringify(serialized)).not.toContain("connection lost");
    expect(client.releaseArguments).toEqual([false]);
  });

  test("does not execute a SQLSTATE accessor after COMMIT was sent", async () => {
    let getterCalls = 0;
    const commitFailure = {};
    Object.defineProperty(commitFailure, "code", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("RAW_COMMIT_CODE_GETTER");
      },
    });
    const client = new RecordingTransactionClient(commitFailure);
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async () => ({ repositoryReportedSuccess: true }),
      )
      .catch((error: unknown) => error);

    expect(getterCalls).toBe(0);
    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      recovery: "RECONCILE_REQUIRED",
    });
    expect((failure as Error).message).not.toContain("RAW_COMMIT_CODE_GETTER");
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("retries only a COMMIT failure that proves the transaction aborted", async () => {
    const client = new RecordingTransactionClient({ code: "40001" });
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });

    const failure = await runner
      .run({ schemaVersion: 1, isolationLevel: "SERIALIZABLE" }, async () => ({
        repositoryReportedSuccess: true,
      }))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "TRANSACTION_ABORTED",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 250,
    });
  });

  test("rejects a resolved COMMIT that PostgreSQL reports as ROLLBACK", async () => {
    const client = new RecordingTransactionClient(undefined, {}, "ROLLBACK");
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async () => ({
          repositoryReportedSuccess: true,
        }),
      )
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "TRANSACTION_ABORTED",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 250,
    });
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
    ]);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("does not execute an accessor on a resolved COMMIT result", async () => {
    let getterCalls = 0;
    const commitResult = {};
    Object.defineProperty(commitResult, "command", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("RAW_COMMIT_GETTER");
      },
    });
    const client = new RecordingTransactionClient(
      undefined,
      {},
      "COMMIT",
      undefined,
      commitResult,
    );
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async () => ({ repositoryReportedSuccess: true }),
      )
      .catch((error: unknown) => error);

    expect(getterCalls).toBe(0);
    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      recovery: "RECONCILE_REQUIRED",
    });
    expect((failure as Error).message).not.toContain("RAW_COMMIT_GETTER");
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
    ]);
    expect(client.releaseArguments).toEqual([true]);
  });

  test("does not trust an inherited command on a resolved COMMIT result", async () => {
    const commitResult = Object.create({ command: "COMMIT" }) as object;
    const client = new RecordingTransactionClient(
      undefined,
      {},
      "COMMIT",
      undefined,
      commitResult,
    );
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async () => ({ repositoryReportedSuccess: true }),
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      recovery: "RECONCILE_REQUIRED",
    });
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
    ]);
    expect(client.releaseArguments).toEqual([true]);
  });

  test("fails closed when a resolved COMMIT proxy rejects descriptor inspection", async () => {
    const commitResult = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("RAW_COMMIT_DESCRIPTOR_TRAP");
        },
      },
    );
    const client = new RecordingTransactionClient(
      undefined,
      {},
      "COMMIT",
      undefined,
      commitResult,
    );
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });

    const failure = await runner
      .run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async () => ({ repositoryReportedSuccess: true }),
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      recovery: "RECONCILE_REQUIRED",
    });
    expect((failure as Error).message).not.toContain(
      "RAW_COMMIT_DESCRIPTOR_TRAP",
    );
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "COMMIT",
    ]);
    expect(client.releaseArguments).toEqual([true]);
  });

  test.each(["42P01", "42883"])(
    "preserves deterministic configuration failure %s from COMMIT",
    async (sqlState) => {
      const client = new RecordingTransactionClient({ code: sqlState });
      const runner = createTransactionRunner({
        acquireClient: async () => client,
        createRepositories: () => ({ marker: "repositories" }),
      });

      const failure = await runner
        .run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          async () => null,
        )
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "CONFIGURATION_ERROR",
        recovery: "NONE",
      });
      expect(failure).not.toHaveProperty("retryAfterMs");
      expect(client.releaseArguments).toEqual([false]);
    },
  );

  test("rolls back callback failures without replacing the application error", async () => {
    const client = new RecordingTransactionClient();
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });
    const applicationError = new Error("application rejected the command");

    await expect(
      runner.run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async () => {
          throw applicationError;
        },
      ),
    ).rejects.toBe(applicationError);
    expect(client.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL search_path = pg_catalog, public",
      "ROLLBACK",
    ]);
    expect(client.released).toBe(true);
    expect(client.releaseArguments).toEqual([false]);
  });

  test("destroys a client whose BEGIN failed before rollback was possible", async () => {
    const beginStatement = "BEGIN ISOLATION LEVEL READ COMMITTED";
    const client = new RecordingTransactionClient(undefined, {
      [beginStatement]: { code: "08006" },
    });
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });

    await expect(
      runner.run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async () => null,
      ),
    ).rejects.toBeInstanceOf(PersistenceTransactionFailureError);
    expect(client.statements).toEqual([beginStatement]);
    expect(client.releaseArguments).toEqual([true]);
  });

  test.each([
    {
      label: "transaction setup",
      queryFailures: {
        "SET LOCAL search_path = pg_catalog, public": { code: "08006" },
        ROLLBACK: { code: "08006" },
      },
      createRepositories: () => ({ marker: "repositories" }),
      work: async (): Promise<null> => null,
    },
    {
      label: "repository construction",
      queryFailures: { ROLLBACK: { code: "08006" } },
      createRepositories: () => {
        throw new Error("repository construction failed");
      },
      work: async (): Promise<null> => null,
    },
    {
      label: "application work",
      queryFailures: { ROLLBACK: { code: "08006" } },
      createRepositories: () => ({ marker: "repositories" }),
      work: async (): Promise<null> => {
        throw new Error("application work failed");
      },
    },
  ])(
    "destroys a client when $label fails and rollback also fails",
    async ({ queryFailures, createRepositories, work }) => {
      const client = new RecordingTransactionClient(undefined, queryFailures);
      const runner = createTransactionRunner({
        acquireClient: async () => client,
        createRepositories,
      });

      await expect(
        runner.run(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          work,
        ),
      ).rejects.toBeDefined();
      expect(client.releaseArguments).toEqual([true]);
    },
  );

  test("destroys a client when COMMIT and the recovery rollback both fail", async () => {
    const client = new RecordingTransactionClient(
      { code: "08006" },
      { ROLLBACK: { code: "08006" } },
    );
    const runner = createTransactionRunner({
      acquireClient: async () => client,
      createRepositories: () => ({ marker: "repositories" }),
    });

    const failure = await runner
      .run({ schemaVersion: 1, isolationLevel: "READ_COMMITTED" }, async () =>
        Promise.resolve(null),
      )
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
      recovery: "RECONCILE_REQUIRED",
    });
    expect(client.releaseArguments).toEqual([true]);
  });
});
