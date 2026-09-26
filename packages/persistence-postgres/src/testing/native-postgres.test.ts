import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  withNativeTestPostgres,
  type NativePostgresRun,
} from "./native-postgres.js";

describe("native TEST PostgreSQL tools", () => {
  afterEach(() => vi.unstubAllEnvs());

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
});
