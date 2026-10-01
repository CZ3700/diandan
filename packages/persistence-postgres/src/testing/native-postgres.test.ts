import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  withNativeTestPostgres,
  type NativePostgresRun,
} from "./native-postgres.js";

describe("native TEST PostgreSQL tools", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  test.each([
    ["17.9", "17.9", "17.9"],
    ["18.6", "18.7", "18.6"],
    ["18.6", "18.6", "19.0"],
  ])(
    "rejects unsupported or mixed versions %j before creating a cluster",
    async (...versions) => {
      let checks = 0;
      const run: NativePostgresRun = async (binary, args) => {
        expect(args).toEqual(["--version"]);
        return {
          stdout: `${path.basename(binary)} (PostgreSQL) ${versions[checks++]}\n`,
        };
      };
      const work = vi.fn();
      await expect(
        withNativeTestPostgres(work, {
          binDirectory: "/owned/postgres/bin",
          run,
        }),
      ).rejects.toThrow("Native TEST PostgreSQL 18 tools unavailable");
      expect(work).not.toHaveBeenCalled();
      expect(checks).toBeGreaterThan(0);
    },
  );

  test("removes ambient PG connection settings from tool processes and redacts tool errors", async () => {
    vi.stubEnv("PGHOST", "private-existing-host");
    vi.stubEnv("PGPASSWORD", "private-existing-password");
    vi.stubEnv("PGDATA", "/private/existing/cluster");
    const run: NativePostgresRun = async (_binary, _args, options) => {
      expect(
        Object.keys(options.env).filter((key) => key.startsWith("PG")),
      ).toEqual([]);
      expect(options.env["LC_ALL"]).toBe("C");
      throw new Error("private-existing-password");
    };
    await expect(
      withNativeTestPostgres(async () => "unexpected", {
        binDirectory: "/owned/postgres/bin",
        run,
      }),
    ).rejects.toThrow("Native TEST PostgreSQL 18 tools unavailable");
  });

  test("accepts the pid file data directory in PostgreSQL's forward-slash form and stops the owned cluster", async () => {
    const { mkdir, rm, writeFile } = await import("node:fs/promises");
    const calls: string[] = [];
    let dataDirectory = "";
    const run: NativePostgresRun = async (binary, args) => {
      const tool = path.basename(binary);
      if (args[0] === "--version")
        return { stdout: `${tool} (PostgreSQL) 18.6\n` };
      calls.push(
        `${tool} ${args.includes("stop") ? "stop" : args.includes("start") ? "start" : args[0]}`,
      );
      if (tool === "initdb") {
        dataDirectory = args[args.indexOf("-D") + 1]!;
        await mkdir(dataDirectory);
      } else if (tool === "pg_ctl" && args.includes("start")) {
        // PostgreSQL always writes this line with forward slashes, even on Windows.
        const canonical = dataDirectory.split(path.sep).join("/");
        await writeFile(
          path.join(dataDirectory, "postmaster.pid"),
          `4242\n${canonical}\n1790000000\n5432\n\n127.0.0.1\n\nready   \n`,
        );
      } else if (tool === "pg_ctl" && args.includes("stop")) {
        await rm(path.join(dataDirectory, "postmaster.pid"));
      }
      return { stdout: "" };
    };
    const client = { connect: vi.fn(), query: vi.fn(), end: vi.fn() };
    const result = await withNativeTestPostgres(
      async (configuration) => `served:${configuration.database}`,
      {
        binDirectory: path.resolve("/owned/postgres/bin"),
        run,
        createClient: () => client,
      },
    );
    expect(result).toBe("served:fan_support_test");
    expect(calls).toEqual(["initdb -D", "pg_ctl start", "pg_ctl stop"]);
    expect(client.query).toHaveBeenCalledWith(
      "CREATE DATABASE fan_support_test",
    );
  });

  test("stops the cluster only after connections the operation closed have left", async () => {
    const { mkdir, rm, writeFile } = await import("node:fs/promises");
    const events: string[] = [];
    let dataDirectory = "";
    const run: NativePostgresRun = async (binary, args) => {
      const tool = path.basename(binary);
      if (args[0] === "--version")
        return { stdout: `${tool} (PostgreSQL) 18.6\n` };
      if (tool === "initdb") {
        dataDirectory = args[args.indexOf("-D") + 1]!;
        await mkdir(dataDirectory);
      } else if (args.includes("start")) {
        const canonical = dataDirectory.split(path.sep).join("/");
        await writeFile(
          path.join(dataDirectory, "postmaster.pid"),
          `4242\n${canonical}\n1790000000\n5432\n\n127.0.0.1\n\nready   \n`,
        );
      } else if (args.includes("stop")) {
        events.push("stop");
        await rm(path.join(dataDirectory, "postmaster.pid"));
      }
      return { stdout: "" };
    };
    // A closed pool's two connections are still leaving when the operation returns.
    const open = [2, 1, 0];
    const client = {
      connect: vi.fn(),
      end: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (!sql.includes("pg_stat_activity")) return { rows: [] };
        const count = open.shift() ?? 0;
        events.push(`open ${count}`);
        return { rows: [{ open: count }] };
      }),
    };
    await withNativeTestPostgres(async () => "served", {
      binDirectory: path.resolve("/owned/postgres/bin"),
      run,
      createClient: () => client,
    });
    expect(events).toEqual(["open 2", "open 1", "open 0", "stop"]);
  });

  test.each(["connect", "query", "end"] as const)(
    "bounds a stalled settle %s by one five-second deadline and consumes late rejection",
    async (stage) => {
      const entered = deferred<void>();
      const stalled = deferred<unknown>();
      const client = settleClient();
      client[stage].mockImplementation(() => {
        entered.resolve();
        return stalled.promise;
      });
      const harness = await ownedClusterHarness(client);
      const pending = withNativeTestPostgres(async () => {
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
        return "served";
      }, harness.options);
      try {
        await entered.promise;
        await vi.advanceTimersByTimeAsync(4_999);
        expect(client.abort).not.toHaveBeenCalled();
        expect(harness.stopped).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(client.abort).toHaveBeenCalledOnce();
        await expect(pending).resolves.toBe("served");
        expect(client.end).toHaveBeenCalledOnce();
        expect(harness.stopped).toHaveBeenCalledOnce();
        await harness.expectRemoved();
        stalled.reject(new Error("late settle failure"));
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        // Also releases the unbounded old implementation when the RED assertion fails.
        stalled.resolve({ rows: [{ open: 0 }] });
        await pending;
      }
    },
  );

  test("settles departing clients and closes its probe within the same deadline", async () => {
    const entered = deferred<void>();
    const client = settleClient();
    const counts = [2, 1, 0];
    client.query.mockImplementation(async () => {
      entered.resolve();
      return { rows: [{ open: counts.shift() }] };
    });
    const harness = await ownedClusterHarness(client);
    const pending = withNativeTestPostgres(async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      return "served";
    }, harness.options);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toBe("served");
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.end).toHaveBeenCalledOnce();
    expect(client.abort).not.toHaveBeenCalled();
    expect(harness.stopped).toHaveBeenCalledOnce();
    await harness.expectRemoved();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("does not restart the deadline when connect hands off to query", async () => {
    const entered = deferred<void>();
    const connected = deferred<unknown>();
    const queried = deferred<unknown>();
    const client = settleClient();
    client.connect.mockImplementation(() => {
      entered.resolve();
      return connected.promise;
    });
    client.query.mockReturnValue(queried.promise);
    const harness = await ownedClusterHarness(client);
    const pending = withNativeTestPostgres(async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      return "served";
    }, harness.options);
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(3_000);
      connected.resolve(undefined);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(client.query).toHaveBeenCalledOnce();
      expect(client.abort).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(client.abort).toHaveBeenCalledOnce();
      await expect(pending).resolves.toBe("served");
      expect(harness.stopped).toHaveBeenCalledOnce();
      await harness.expectRemoved();
    } finally {
      queried.resolve({ rows: [{ open: 0 }] });
      await pending;
    }
  });

  test.each(["connect", "query", "end"] as const)(
    "cleans up after a settle %s failure without hiding the operation failure",
    async (stage) => {
      const client = settleClient();
      client[stage].mockRejectedValue(new Error("probe-only failure"));
      const harness = await ownedClusterHarness(client);
      await expect(
        withNativeTestPostgres(async () => {
          throw new Error("private operation failure");
        }, harness.options),
      ).rejects.toThrow("Native TEST PostgreSQL operation failed");
      expect(client.end).toHaveBeenCalledOnce();
      expect(harness.stopped).toHaveBeenCalledOnce();
      await harness.expectRemoved();
    },
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function settleClient() {
  return {
    connect: vi.fn<() => Promise<unknown>>(async () => undefined),
    query: vi.fn<() => Promise<unknown>>(async () => ({ rows: [{ open: 0 }] })),
    end: vi.fn<() => Promise<unknown>>(async () => undefined),
    abort: vi.fn(),
  };
}

async function ownedClusterHarness(client: ReturnType<typeof settleClient>) {
  const { lstat, mkdir, rm, writeFile } = await import("node:fs/promises");
  let dataDirectory = "";
  const stopped = vi.fn();
  const run: NativePostgresRun = async (binary, args) => {
    const tool = path.basename(binary);
    if (args[0] === "--version")
      return { stdout: `${tool} (PostgreSQL) 18.6\n` };
    if (tool === "initdb") {
      dataDirectory = args[args.indexOf("-D") + 1]!;
      await mkdir(dataDirectory);
    } else if (args.includes("start")) {
      await writeFile(
        path.join(dataDirectory, "postmaster.pid"),
        `4242\n${dataDirectory.split(path.sep).join("/")}\n`,
      );
    } else if (args.includes("stop")) {
      stopped();
      await rm(path.join(dataDirectory, "postmaster.pid"));
    }
    return { stdout: "" };
  };
  let clients = 0;
  return {
    stopped,
    options: {
      binDirectory: path.resolve("/owned/postgres/bin"),
      run,
      createClient: () => (clients++ === 0 ? settleClient() : client),
    },
    expectRemoved: async () => {
      await expect(lstat(path.dirname(dataDirectory))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  };
}
