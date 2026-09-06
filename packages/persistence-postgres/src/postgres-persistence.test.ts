import { expect, test } from "vitest";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import { PersistenceTransactionFailureError } from "@fan-support/persistence-port";

import { createPostgresPersistence } from "./index.js";
import {
  createPostgresPersistenceWithPoolFactory,
  type ManagedPersistencePool,
  type PersistenceFailureNotice,
} from "./postgres-persistence.js";
import type { TransactionClient } from "./transaction-runner.js";

const validConfig = {
  host: "database.internal",
  port: 5432,
  database: "fan_support_test",
  user: "fan_support_test",
  password: "test-password",
} as const;

test("resource management shares authorization, idempotency and the serializable lifecycle", async () => {
  const pool = new TransactionPool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    undefined,
    () => pool,
  );
  expect(persistence).toHaveProperty("resourceManagementTransactionManager");
  await expect(
    persistence.resourceManagementTransactionManager.runInResourceManagementTransaction(
      async (repositories) => Object.keys(repositories).sort(),
    ),
  ).resolves.toEqual(["authorization", "idempotency", "resources"]);
  expect(pool.client.queries).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await persistence.close();
  await expect(
    persistence.resourceManagementTransactionManager.runInResourceManagementTransaction(
      async () => null,
    ),
  ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
});

test("base reviews and preview share authorization, idempotency and the serializable lifecycle", async () => {
  const pool = new TransactionPool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    undefined,
    () => pool,
  );
  expect(persistence).toHaveProperty("baseContentTransactionManager");
  await expect(
    persistence.baseContentTransactionManager.runInBaseContentTransaction(
      async (repositories) => Object.keys(repositories).sort(),
    ),
  ).resolves.toEqual([
    "authorization",
    "baseContentPreviews",
    "baseContentReviews",
    "idempotency",
  ]);
  expect(pool.client.queries).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await persistence.close();
  await expect(
    persistence.baseContentTransactionManager.runInBaseContentTransaction(
      async () => null,
    ),
  ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
});

test("content drafts use a dedicated serializable transaction and respect pool shutdown", async () => {
  const pool = new TransactionPool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    undefined,
    () => pool,
  );
  expect(persistence.contentDraftTransactionManager).toBeDefined();
  await expect(
    persistence.contentDraftTransactionManager.runInContentDraftTransaction(
      async (repositories) => Object.keys(repositories),
    ),
  ).resolves.toEqual(["contentDrafts"]);
  expect(pool.client.queries).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await persistence.close();
  await expect(
    persistence.contentDraftTransactionManager.runInContentDraftTransaction(
      async () => null,
    ),
  ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
});

test("admin authorization and content share one serializable transaction and lifecycle", async () => {
  const pool = new TransactionPool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    undefined,
    () => pool,
  );
  expect(persistence).toHaveProperty("adminContentTransactionManager");
  await expect(
    persistence.adminContentTransactionManager.runInAdminContentTransaction(
      async (repositories) => Object.keys(repositories).sort(),
    ),
  ).resolves.toEqual([
    "authorization",
    "contentDrafts",
    "contentPreviews",
    "contentReviews",
    "idempotency",
  ]);
  expect(pool.client.queries).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await persistence.close();
  await expect(
    persistence.adminContentTransactionManager.runInAdminContentTransaction(
      async () => null,
    ),
  ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
});

test("content authoring shares authorization and idempotency in a serializable transaction", async () => {
  const pool = new TransactionPool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    undefined,
    () => pool,
  );
  expect(persistence).toHaveProperty("contentAuthoringTransactionManager");
  await expect(
    persistence.contentAuthoringTransactionManager.runInContentAuthoringTransaction(
      async (repositories) => Object.keys(repositories).sort(),
    ),
  ).resolves.toEqual(["authorization", "contentAuthoring", "idempotency"]);
  expect(pool.client.queries).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await persistence.close();
  await expect(
    persistence.contentAuthoringTransactionManager.runInContentAuthoringTransaction(
      async () => null,
    ),
  ).rejects.toMatchObject({ name: "PersistenceTransactionFailureError" });
});

function deferred<Result>() {
  let resolve!: (value: Result | PromiseLike<Result>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Result>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject } as const;
}

class RecordingPool implements ManagedPersistencePool {
  public connectCalls = 0;
  public endCalls = 0;
  public readonly listeners = new Set<(failure: unknown) => void>();

  public constructor(private readonly endResult: Promise<void>) {}

  public async connect(): Promise<TransactionClient> {
    this.connectCalls += 1;
    throw new Error("test pool must not connect");
  }

  public end(): Promise<void> {
    this.endCalls += 1;
    return this.endResult;
  }

  public on(event: "error", listener: (failure: unknown) => void): void {
    expect(event).toBe("error");
    this.listeners.add(listener);
  }

  public off(event: "error", listener: (failure: unknown) => void): void {
    expect(event).toBe("error");
    this.listeners.delete(listener);
  }

  public emitFailure(failure: unknown): void {
    for (const listener of this.listeners) {
      listener(failure);
    }
  }
}

class TransactionClientStub implements TransactionClient {
  public readonly queries: string[] = [];
  public released = false;

  public async query(text: string): Promise<unknown> {
    this.queries.push(text);
    return /^commit$/iu.test(text.trim())
      ? { command: "COMMIT" }
      : { rows: [] };
  }

  public release(): void {
    this.released = true;
  }
}

class TransactionPool implements ManagedPersistencePool {
  public readonly client = new TransactionClientStub();

  public async connect(): Promise<TransactionClient> {
    return this.client;
  }

  public async end(): Promise<void> {}

  public on(): void {}

  public off(): void {}
}

test("rejects invalid transaction options before acquiring a connection", async () => {
  const persistence = createPostgresPersistence({
    host: "invalid.invalid",
    port: 5432,
    database: "fan_support_test",
    user: "fan_support_test",
    password: "not-used-because-options-fail-first",
    connectionTimeoutMillis: 1,
  });
  let callbackInvoked = false;
  try {
    const failure = await persistence.transactionManager
      .runInTransaction(
        {
          schemaVersion: 2,
          isolationLevel: "READ_COMMITTED",
        } as never,
        async () => {
          callbackInvoked = true;
          return null;
        },
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "INVALID_COMMAND",
      recovery: "NONE",
    });
    expect(callbackInvoked).toBe(false);
  } finally {
    await persistence.close();
  }
});

test("adds a reliable-event manager without changing legacy repository keys", async () => {
  const pool = new TransactionPool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    {
      publishWebhookInbox: async () => undefined,
    },
    () => pool,
  );

  try {
    await expect(
      persistence.transactionManager.runInTransaction(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async (repositories) => Object.keys(repositories).sort(),
      ),
    ).resolves.toEqual(["idempotency", "inventory", "outbox"]);
    await expect(
      persistence.reliableEventTransactionManager.runInReliableEventTransaction(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async (repositories) => Object.keys(repositories).sort(),
      ),
    ).resolves.toEqual([
      "outbox",
      "outboxDispatch",
      "paymentWebhookEndpoints",
      "verifiedWebhookReceipts",
      "webhookPayloadRetention",
      "webhookProcessing",
    ]);
  } finally {
    await persistence.close();
  }
  expect(pool.client.released).toBe(true);
});

test("rejects invalid reliable-event transaction options before acquiring a connection", async () => {
  const pool = new RecordingPool(Promise.resolve());
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    { publishWebhookInbox: async () => undefined },
    () => pool,
  );
  try {
    const failure = await persistence.reliableEventTransactionManager
      .runInReliableEventTransaction(
        { schemaVersion: 2, isolationLevel: "READ_COMMITTED" } as never,
        async () => null,
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "INVALID_COMMAND",
      recovery: "NONE",
    });
    expect(pool.connectCalls).toBe(0);
  } finally {
    await persistence.close();
  }
});

test("tracks an invalid reliable-event operation even when the callback forgets to await it", async () => {
  const pool = new TransactionPool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    { publishWebhookInbox: async () => undefined },
    () => pool,
  );
  try {
    const failure = await persistence.reliableEventTransactionManager
      .runInReliableEventTransaction(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async (repositories) => {
          void repositories.paymentWebhookEndpoints
            .load({ schemaVersion: 2 } as never)
            .catch(() => undefined);
          return null;
        },
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
    expect(failure).toMatchObject({
      code: "INVALID_COMMAND",
      recovery: "NONE",
    });
    expect(pool.client.queries).toContain("ROLLBACK");
    expect(pool.client.queries).not.toContain("COMMIT");
  } finally {
    await persistence.close();
  }
});

test("fails closed before Pool construction when connection identity is incomplete", () => {
  const failure = (() => {
    try {
      createPostgresPersistence({});
    } catch (error: unknown) {
      return error;
    }
    return undefined;
  })();

  expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
  expect(failure).toMatchObject({
    code: "CONFIGURATION_ERROR",
    recovery: "NONE",
  });
});

test("consumes idle pool errors and reports only a provider-neutral classification", async () => {
  const endResult = Promise.resolve();
  const pool = new RecordingPool(endResult);
  const observed: PersistenceFailureNotice[] = [];
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    {
      onInfrastructureFailure: (failure) => {
        observed.push(failure);
      },
    },
    () => pool,
  );

  expect(pool.listeners.size).toBe(1);
  pool.emitFailure({
    code: "08006",
    message: "connection string and raw client details must stay private",
  });
  expect(observed).toEqual([
    {
      code: "TEMPORARY_UNAVAILABLE",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 250,
    },
  ]);
  expect(JSON.stringify(observed)).not.toContain("connection string");

  await persistence.close();
});

test("contains a throwing pool-failure observer and still consumes the event", async () => {
  const pool = new RecordingPool(Promise.resolve());
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    {
      onInfrastructureFailure: () => {
        throw new Error("observer failure must be contained");
      },
    },
    () => pool,
  );

  expect(() => pool.emitFailure({ code: "08006" })).not.toThrow();
  await persistence.close();

  const unobservedPool = new RecordingPool(Promise.resolve());
  const unobserved = createPostgresPersistenceWithPoolFactory(
    validConfig,
    undefined,
    () => unobservedPool,
  );
  expect(() => unobservedPool.emitFailure({ code: "08006" })).not.toThrow();
  await unobserved.close();
});

test("consumes an asynchronously rejected pool-failure observer", async () => {
  const pool = new RecordingPool(Promise.resolve());
  const unhandled: unknown[] = [];
  const recordUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", recordUnhandled);
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    {
      onInfrastructureFailure: async () => {
        throw new Error("async observer rejection must be consumed");
      },
    },
    () => pool,
  );

  try {
    pool.emitFailure({ code: "08006" });
    await yieldToEventLoop();
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", recordUnhandled);
    await persistence.close();
  }
});

test("closes once, rejects new work while closing, and removes the listener after settle", async () => {
  const end = deferred<void>();
  const pool = new RecordingPool(end.promise);
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    undefined,
    () => pool,
  );

  const firstClose = persistence.close();
  const secondClose = persistence.close();
  expect(firstClose).toBe(secondClose);
  expect(pool.endCalls).toBe(1);
  expect(pool.listeners.size).toBe(1);

  const failure = await persistence.transactionManager
    .runInTransaction(
      { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
      async () => null,
    )
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
  expect(failure).toMatchObject({
    code: "CONFIGURATION_ERROR",
    recovery: "NONE",
  });
  expect(pool.connectCalls).toBe(0);

  end.resolve();
  await firstClose;
  expect(pool.listeners.size).toBe(0);
  await persistence.close();
  expect(pool.endCalls).toBe(1);
});

test("normalizes close failures without leaking the raw pool error", async () => {
  const end = deferred<void>();
  const pool = new RecordingPool(end.promise);
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    undefined,
    () => pool,
  );

  const close = persistence.close();
  end.reject(
    new Error("raw pool shutdown failure with connection credentials"),
  );
  const failure = await close.catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(PersistenceTransactionFailureError);
  expect(failure).toMatchObject({
    code: "CONFIGURATION_ERROR",
    recovery: "NONE",
  });
  expect((failure as Error).message).toBe("persistence transaction failed");
  expect(pool.listeners.size).toBe(1);
  expect(() => pool.emitFailure({ code: "08006" })).not.toThrow();
  expect(persistence.close()).toBe(close);
});

test("isolates catalog reads in a serializable snapshot and closes the boundary with its pool", async () => {
  const pool = new TransactionPool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    {
      catalogPublicMediaBaseUrl: "https://media.example.com",
    },
    () => pool,
  );
  const manager = persistence.contentReadTransactionManager;
  await expect(
    manager.runInContentReadTransaction(async (repositories) =>
      Object.keys(repositories),
    ),
  ).resolves.toEqual(["catalogDirectory"]);
  expect(pool.client.queries).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await persistence.close();
  await expect(
    manager.runInContentReadTransaction(async () => []),
  ).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
});

test("requires a configured public media origin for the content read boundary", async () => {
  for (const value of [
    "http://media.example.com",
    "https://media.example.com/catalog/",
    "https://media.example.com?width=20",
    "https://10.0.0.1",
  ]) {
    expect(() =>
      createPostgresPersistenceWithPoolFactory(
        validConfig,
        { catalogPublicMediaBaseUrl: value },
        () => new TransactionPool(),
      ),
    ).toThrow(PersistenceTransactionFailureError);
  }
  const pool = new TransactionPool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    undefined,
    () => pool,
  );
  try {
    await expect(
      persistence.contentReadTransactionManager.runInContentReadTransaction(
        async () => null,
      ),
    ).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    expect(pool.client.queries).toEqual([]);
  } finally {
    await persistence.close();
  }
});

test("provides a dedicated short media transaction boundary and refuses work after close", async () => {
  const pool = new TransactionPool();
  const persistence = createPostgresPersistenceWithPoolFactory(
    validConfig,
    undefined,
    () => pool,
  );
  expect(persistence.mediaProcessingTransactionManager).toBeDefined();
  await expect(
    persistence.mediaProcessingTransactionManager.runInMediaProcessingTransaction(
      async (repositories) => Object.keys(repositories),
    ),
  ).resolves.toEqual(["mediaProcessing"]);
  expect(pool.client.queries).toContain("BEGIN ISOLATION LEVEL READ COMMITTED");
  await persistence.close();
  await expect(
    persistence.mediaProcessingTransactionManager.runInMediaProcessingTransaction(
      async () => null,
    ),
  ).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
});
