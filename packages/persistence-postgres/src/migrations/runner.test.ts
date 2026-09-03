import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { LoadedMigration } from "./manifest.js";
import {
  runMigrationCommandOnSession,
  runMigrations,
  type MigrationDatabaseSession,
} from "./runner.js";

const postgresClientMock = vi.hoisted(() => ({
  calls: [] as Array<Readonly<{ text: string; values: readonly unknown[] }>>,
  constructedWith: [] as unknown[],
  connectFailure: false,
  connectCount: 0,
  endCount: 0,
}));

vi.mock("pg", () => ({
  Client: class MockPostgresClient {
    public constructor(config: unknown) {
      postgresClientMock.constructedWith.push(config);
    }

    public async connect(): Promise<void> {
      postgresClientMock.connectCount += 1;
      if (postgresClientMock.connectFailure) {
        throw new Error("synthetic connection failure");
      }
    }

    public async query(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<Readonly<{ rows: readonly unknown[]; command?: string }>> {
      postgresClientMock.calls.push({ text, values });
      if (text.includes("FROM public.schema_migrations")) {
        return { rows: [] };
      }
      if (text.includes("pg_try_advisory_lock")) {
        return { rows: [{ locked: true }] };
      }
      if (text.includes("pg_advisory_unlock")) {
        return { rows: [{ unlocked: true }] };
      }
      return {
        rows: [],
        ...(text === "COMMIT" ? { command: "COMMIT" } : {}),
      };
    }

    public async end(): Promise<void> {
      postgresClientMock.endCount += 1;
    }
  },
}));

const temporaryRoots: string[] = [];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createMigrationWorkspace(options?: {
  declaredUpHash?: string;
}): Promise<Readonly<{ workspaceRoot: string; upSql: string }>> {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "fan-support-runner-"),
  );
  temporaryRoots.push(workspaceRoot);
  const migrationDirectory = path.join(workspaceRoot, "database/migrations");
  await mkdir(migrationDirectory, { recursive: true });
  const upSql = "CREATE TABLE loaded_from_workspace (id bigint PRIMARY KEY);\n";
  const downSql = "DROP TABLE loaded_from_workspace;\n";
  await Promise.all([
    writeFile(path.join(migrationDirectory, "0001_example.up.sql"), upSql),
    writeFile(path.join(migrationDirectory, "0001_example.down.sql"), downSql),
    writeFile(
      path.join(migrationDirectory, "manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        migrations: [
          {
            version: "0001",
            name: "example",
            up: "database/migrations/0001_example.up.sql",
            down: "database/migrations/0001_example.down.sql",
            sha256: {
              up: options?.declaredUpHash ?? sha256(upSql),
              down: sha256(downSql),
            },
          },
        ],
      })}\n`,
    ),
  ]);
  return { workspaceRoot, upSql };
}

beforeEach(() => {
  postgresClientMock.calls.length = 0;
  postgresClientMock.constructedWith.length = 0;
  postgresClientMock.connectFailure = false;
  postgresClientMock.connectCount = 0;
  postgresClientMock.endCount = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

const migration: LoadedMigration = {
  version: "0001",
  name: "example",
  up: {
    relativePath: "database/migrations/0001_example.up.sql",
    sha256: "a".repeat(64),
    sql: "CREATE TABLE example (id bigint PRIMARY KEY);\n",
  },
  down: {
    relativePath: "database/migrations/0001_example.down.sql",
    sha256: "b".repeat(64),
    sql: "DROP TABLE example;\n",
  },
};

const validClientConfig = {
  host: "database.internal",
  port: 5432,
  database: "fan_support_test",
  user: "fan_support_test",
  password: "fixture-password",
} as const;

class EmptyDatabaseSession implements MigrationDatabaseSession {
  public readonly calls: Array<
    Readonly<{ text: string; values: readonly unknown[] }>
  > = [];

  public async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<Readonly<{ rows: readonly unknown[]; command?: string }>> {
    this.calls.push({ text, values });
    if (text.includes("FROM public.schema_migrations")) {
      return { rows: [] };
    }
    if (text.includes("pg_try_advisory_lock")) {
      return { rows: [{ locked: true }] };
    }
    if (text.includes("pg_advisory_unlock")) {
      return { rows: [{ unlocked: true }] };
    }
    return {
      rows: [],
      ...(text === "COMMIT" ? { command: "COMMIT" } : {}),
    };
  }
}

class HistoryDatabaseSession extends EmptyDatabaseSession {
  public constructor(
    private readonly history: readonly unknown[],
    private readonly unlockResult: boolean = true,
  ) {
    super();
  }

  public override async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<Readonly<{ rows: readonly unknown[]; command?: string }>> {
    this.calls.push({ text, values });
    if (text.includes("FROM public.schema_migrations")) {
      return { rows: this.history };
    }
    if (text.includes("DELETE FROM public.schema_migrations")) {
      return { rows: [{ version: values[0] }] };
    }
    if (text.includes("pg_try_advisory_lock")) {
      return { rows: [{ locked: true }] };
    }
    if (text.includes("pg_advisory_unlock")) {
      return { rows: [{ unlocked: this.unlockResult }] };
    }
    return {
      rows: [],
      ...(text === "COMMIT" ? { command: "COMMIT" } : {}),
    };
  }
}

class FailingMigrationSession extends EmptyDatabaseSession {
  public override async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<Readonly<{ rows: readonly unknown[]; command?: string }>> {
    this.calls.push({ text, values });
    if (text.includes("FROM public.schema_migrations")) {
      return { rows: [] };
    }
    if (text === migration.up.sql) {
      throw new Error("connection failed [SENSITIVE_CONNECTION_DETAIL]");
    }
    if (text.includes("pg_try_advisory_lock")) {
      return { rows: [{ locked: true }] };
    }
    if (text.includes("pg_advisory_unlock")) {
      return { rows: [{ unlocked: true }] };
    }
    return {
      rows: [],
      ...(text === "COMMIT" ? { command: "COMMIT" } : {}),
    };
  }
}

class AmbiguousCommitSession extends EmptyDatabaseSession {
  public committed = false;

  public override async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<Readonly<{ rows: readonly unknown[]; command?: string }>> {
    if (text === "COMMIT") {
      this.calls.push({ text, values });
      this.committed = true;
      throw new Error("commit response was lost");
    }
    return super.query(text, values);
  }
}

class ResolvedRollbackCommitSession extends EmptyDatabaseSession {
  public override async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<Readonly<{ rows: readonly unknown[]; command?: string }>> {
    if (text === "COMMIT") {
      this.calls.push({ text, values });
      return { rows: [], command: "ROLLBACK" };
    }
    return super.query(text, values);
  }
}

describe("runMigrationCommandOnSession", () => {
  test("owns one session lock and atomically records an up migration", async () => {
    const session = new EmptyDatabaseSession();

    await expect(
      runMigrationCommandOnSession(session, [migration], { direction: "up" }),
    ).resolves.toEqual({
      schemaVersion: 1,
      direction: "up",
      appliedVersions: ["0001"],
      revertedVersions: [],
      currentVersion: "0001",
    });

    const statements = session.calls.map(({ text }) => text);
    expect(statements[0]).toBe("SET search_path = pg_catalog, public");
    expect(statements[1]).toContain("pg_try_advisory_lock");
    expect(statements).toContain("BEGIN");
    expect(statements).toContain(migration.up.sql);
    expect(statements.some((text) => text.includes("INSERT INTO"))).toBe(true);
    expect(statements).toContain("COMMIT");
    expect(statements.at(-1)).toContain("pg_advisory_unlock");
    expect(statements.indexOf(migration.up.sql)).toBeLessThan(
      statements.findIndex((text) => text.includes("INSERT INTO")),
    );
  });

  test("stops retrying a busy migration lock at a bounded deadline", async () => {
    vi.useFakeTimers();
    const session = new EmptyDatabaseSession();
    session.query = vi.fn(
      async (text: string, values: readonly unknown[] = []) => {
        session.calls.push({ text, values });
        if (text.includes("pg_try_advisory_lock")) {
          return { rows: [{ locked: false }] };
        }
        return { rows: [] };
      },
    );

    const outcome = runMigrationCommandOnSession(session, [], {
      direction: "up",
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(15_000);
    const failure = await outcome;

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "migration lock remained busy for 15000 ms; another migration may be running",
    );
    expect(session.calls.length).toBeGreaterThan(1);
    expect(
      session.calls.every(({ text }) => !text.includes("pg_advisory_unlock")),
    ).toBe(true);
  });

  test("fails closed when PostgreSQL does not confirm advisory lock release", async () => {
    const session = new HistoryDatabaseSession([], false);

    await expect(
      runMigrationCommandOnSession(session, [], { direction: "up" }),
    ).rejects.toThrow("could not release the migration lock");
  });

  test("rejects drifted history before executing migration SQL", async () => {
    const session = new HistoryDatabaseSession([
      {
        version: "0001",
        name: "example",
        up_sha256: "f".repeat(64),
        down_sha256: migration.down.sha256,
      },
    ]);

    await expect(
      runMigrationCommandOnSession(session, [migration], { direction: "up" }),
    ).rejects.toThrow("history is not a manifest prefix");
    expect(session.calls.map(({ text }) => text)).not.toContain("BEGIN");
    expect(session.calls.at(-1)?.text).toContain("pg_advisory_unlock");
  });

  test("reverts only the confirmed applied head in one transaction", async () => {
    const session = new HistoryDatabaseSession([
      {
        version: migration.version,
        name: migration.name,
        up_sha256: migration.up.sha256,
        down_sha256: migration.down.sha256,
      },
    ]);

    await expect(
      runMigrationCommandOnSession(session, [migration], {
        direction: "down",
        confirmVersion: "0001",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      direction: "down",
      appliedVersions: [],
      revertedVersions: ["0001"],
      currentVersion: null,
    });

    const statements = session.calls.map(({ text }) => text);
    expect(statements).toContain("BEGIN");
    expect(statements).toContain(migration.down.sql);
    expect(statements.some((text) => text.includes("DELETE FROM"))).toBe(true);
    expect(statements).toContain("COMMIT");
  });

  test("requires exact head confirmation before running down SQL", async () => {
    const session = new HistoryDatabaseSession([
      {
        version: migration.version,
        name: migration.name,
        up_sha256: migration.up.sha256,
        down_sha256: migration.down.sha256,
      },
    ]);

    await expect(
      runMigrationCommandOnSession(session, [migration], {
        direction: "down",
        confirmVersion: "0000",
      }),
    ).rejects.toThrow("confirmation must match the applied head");
    expect(session.calls.map(({ text }) => text)).not.toContain(
      migration.down.sql,
    );
  });

  test("rolls back failed SQL and does not expose connection details", async () => {
    const session = new FailingMigrationSession();

    let failure: unknown;
    try {
      await runMigrationCommandOnSession(session, [migration], {
        direction: "up",
      });
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("migration 0001 up failed");
    expect((failure as Error).message).not.toContain(
      "SENSITIVE_CONNECTION_DETAIL",
    );
    expect(session.calls.map(({ text }) => text)).toContain("ROLLBACK");
    expect(session.calls.map(({ text }) => text)).not.toContain("COMMIT");
  });

  test("requires reconciliation when a COMMIT response is lost", async () => {
    const session = new AmbiguousCommitSession();

    await expect(
      runMigrationCommandOnSession(session, [migration], { direction: "up" }),
    ).rejects.toThrow("commit outcome is unknown; reconciliation required");
    expect(session.committed).toBe(true);
    expect(session.calls.map(({ text }) => text)).toContain("ROLLBACK");
  });

  test("does not report success when PostgreSQL resolves COMMIT as ROLLBACK", async () => {
    const session = new ResolvedRollbackCommitSession();

    await expect(
      runMigrationCommandOnSession(session, [migration], { direction: "up" }),
    ).rejects.toThrow("transaction aborted before commit");
  });
});

describe("runMigrations", () => {
  test("loads the verified workspace manifest before opening PostgreSQL", async () => {
    const { workspaceRoot } = await createMigrationWorkspace({
      declaredUpHash: "f".repeat(64),
    });

    await expect(
      runMigrations({
        clientConfig: validClientConfig,
        workspaceRoot,
        command: { direction: "up" },
      }),
    ).rejects.toThrow("checksum does not match");
    expect(postgresClientMock.connectCount).toBe(0);
    expect(postgresClientMock.calls).toEqual([]);
  });

  test("rejects unknown top-level options before loading or connecting", async () => {
    const { workspaceRoot } = await createMigrationWorkspace();

    await expect(
      runMigrations({
        clientConfig: validClientConfig,
        workspaceRoot,
        command: { direction: "up" },
        migrations: [migration],
      } as unknown as Parameters<typeof runMigrations>[0]),
    ).rejects.toThrow("migration configuration is invalid");
    expect(postgresClientMock.constructedWith).toEqual([]);
  });

  test("executes SQL loaded from the workspace without caller migrations", async () => {
    const { workspaceRoot, upSql } = await createMigrationWorkspace();

    await expect(
      runMigrations({
        clientConfig: validClientConfig,
        workspaceRoot,
        command: { direction: "up" },
      } as unknown as Parameters<typeof runMigrations>[0]),
    ).resolves.toEqual({
      schemaVersion: 1,
      direction: "up",
      appliedVersions: ["0001"],
      revertedVersions: [],
      currentVersion: "0001",
    });
    expect(postgresClientMock.connectCount).toBe(1);
    expect(postgresClientMock.endCount).toBe(1);
    expect(postgresClientMock.calls.map(({ text }) => text)).toContain(upSql);
    expect(postgresClientMock.calls[0]?.text).toBe(
      "SET search_path = pg_catalog, public",
    );
    expect(postgresClientMock.constructedWith).toEqual([
      expect.objectContaining({
        host: "database.internal",
        port: 5432,
        ssl: false,
        sslnegotiation: "postgres",
        options: "-c search_path=pg_catalog,public",
        client_encoding: "UTF8",
        replication: "false",
      }),
    ]);
  });

  test.each([
    { label: "empty", clientConfig: {} },
    {
      label: "mixed identity",
      clientConfig: {
        ...validClientConfig,
        connectionString:
          "postgresql://user:pass@database.internal/fan_support_test",
      },
    },
    {
      label: "query override",
      clientConfig: {
        connectionString:
          "postgresql://user:pass@database.internal/fan_support_test?host=%2Ftmp%2Fpg&user=evil",
      },
    },
  ])(
    "rejects $label connection config before constructing a client",
    async ({ clientConfig }) => {
      const { workspaceRoot } = await createMigrationWorkspace();

      await expect(
        runMigrations({
          clientConfig,
          workspaceRoot,
          command: { direction: "up" },
        } as Parameters<typeof runMigrations>[0]),
      ).rejects.toThrow("migration configuration is invalid");
      expect(postgresClientMock.constructedWith).toEqual([]);
      expect(postgresClientMock.connectCount).toBe(0);
    },
  );

  test("rejects an unknown migration direction before any database access", async () => {
    const { workspaceRoot } = await createMigrationWorkspace();

    await expect(
      runMigrations({
        clientConfig: validClientConfig,
        workspaceRoot,
        command: { direction: "typo", confirmVersion: "0001" },
      } as unknown as Parameters<typeof runMigrations>[0]),
    ).rejects.toThrow("migration command is invalid");
    expect(postgresClientMock.constructedWith).toEqual([]);
  });

  test("closes a client whose connection attempt fails", async () => {
    const { workspaceRoot } = await createMigrationWorkspace();
    postgresClientMock.connectFailure = true;

    await expect(
      runMigrations({
        clientConfig: validClientConfig,
        workspaceRoot,
        command: { direction: "up" },
      }),
    ).rejects.toThrow("database connection failed");
    expect(postgresClientMock.connectCount).toBe(1);
    expect(postgresClientMock.endCount).toBe(1);
  });
});
