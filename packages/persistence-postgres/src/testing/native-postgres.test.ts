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
});
