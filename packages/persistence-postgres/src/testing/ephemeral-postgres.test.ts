import { afterEach, describe, expect, test, vi } from "vitest";

import type { PostgresConnectionConfig } from "../connection-config.js";

// A missing selector branch must fail without starting any real host service.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(() => {
    throw new Error("No process launch permitted in selector unit tests");
  }),
}));

import {
  withEphemeralPostgres,
  type DockerCommandExecutor,
} from "./ephemeral-postgres.js";

describe("withEphemeralPostgres", () => {
  test("keeps credentials out of Docker arguments and removes only its labelled container", async () => {
    const calls: Array<
      Readonly<{
        arguments_: readonly string[];
        environment: Readonly<Record<string, string | undefined>>;
      }>
    > = [];
    let expectedLabels: Readonly<Record<string, string>> = {};
    const docker: DockerCommandExecutor = {
      run: async (arguments_, environment = {}) => {
        calls.push({ arguments_, environment });
        if (arguments_[0] === "run") {
          const labelValues = arguments_
            .map((value, index) =>
              arguments_[index - 1] === "--label" ? value : undefined,
            )
            .filter((value): value is string => value !== undefined)
            .map((value) => value.split("=", 2))
            .filter((parts): parts is [string, string] => parts.length === 2);
          expectedLabels = Object.fromEntries(labelValues);
          return { stdout: "container-id\n" };
        }
        if (arguments_[0] === "port") {
          return { stdout: "127.0.0.1:49152\n" };
        }
        if (arguments_[0] === "inspect") {
          return { stdout: `${JSON.stringify(expectedLabels)}\n` };
        }
        if (arguments_[0] === "rm") {
          return { stdout: "removed\n" };
        }
        throw new Error("unexpected docker call");
      },
    };

    await expect(
      withEphemeralPostgres(
        async (clientConfig, metadata) => {
          expect(clientConfig).toMatchObject({
            host: "127.0.0.1",
            port: 49_152,
            user: "fan_support_test",
            database: "fan_support_test",
          });
          expect(clientConfig.password).toMatch(/^[a-f0-9]{64}$/u);
          expect(metadata).toEqual({
            kind: "DOCKER_EPHEMERAL_TEST",
            configuredBy: "withEphemeralPostgres",
          });
          return "verified";
        },
        {
          docker,
          readinessProbe: async () => true,
          environment: {},
        },
      ),
    ).resolves.toBe("verified");

    const runCall = calls.find(({ arguments_ }) => arguments_[0] === "run");
    expect(runCall?.arguments_).toContain("127.0.0.1::5432");
    expect(runCall?.arguments_).not.toContain("--rm");
    expect(runCall?.arguments_.join(" ")).not.toContain(
      String(runCall?.environment["POSTGRES_PASSWORD"]),
    );
    expect(runCall?.arguments_).toContain("POSTGRES_PASSWORD");
    expect(runCall?.arguments_).toContain("--tmpfs");
    expect(runCall?.arguments_).toContain(
      "/var/lib/postgresql:rw,noexec,nosuid,size=512m",
    );

    const inspectIndex = calls.findIndex(
      ({ arguments_ }) => arguments_[0] === "inspect",
    );
    const removeIndex = calls.findIndex(
      ({ arguments_ }) => arguments_[0] === "rm",
    );
    expect(inspectIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(inspectIndex);
    expect(calls[removeIndex]?.arguments_[1]).toBe("--force");
  });
});

const privateMetadata = {
  directory: "/private/owned",
  dataDirectory: "/private/owned/data",
  runId: "private-run-id",
  serverVersion: "18.6",
};
const nativeConnection = {
  host: "127.0.0.1",
  port: 54321,
  user: "fan_support_test",
  database: "fan_support_test",
  password: "private-password",
};
type NativeWork<Result> = (
  configuration: PostgresConnectionConfig,
  metadata: typeof privateMetadata,
) => Promise<Result>;

describe("explicit TEST PostgreSQL runtime selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("uses the explicit native tool and exposes only safe runtime metadata", async () => {
    const calls: string[] = [];
    const result = await withEphemeralPostgres(
      async (configuration, metadata) => {
        expect(configuration).toEqual(nativeConnection);
        expect(metadata).toEqual({
          kind: "NATIVE_ISOLATED_TEST",
          configuredBy: "POSTGRES_TEST_BIN",
          serverVersion: "18.6",
        });
        return "accepted";
      },
      {
        environment: { POSTGRES_TEST_BIN: "/owned/postgres/bin" },
        native: async <Result>(
          work: NativeWork<Result>,
          options: { binDirectory: string },
        ) => {
          calls.push(options.binDirectory);
          return work(nativeConnection, privateMetadata);
        },
      },
    );
    expect(result).toBe("accepted");
    expect(calls).toEqual(["/owned/postgres/bin"]);
  });

  test.each(["", "relative"])(
    "rejects invalid explicit native selector %j before invoking a runtime",
    async (binDirectory) => {
      const native = vi.fn();
      await expect(
        withEphemeralPostgres(async () => "unexpected", {
          environment: { POSTGRES_TEST_BIN: binDirectory },
          native,
        }),
      ).rejects.toThrow(/configuration/u);
      expect(native).not.toHaveBeenCalled();
    },
  );

  test.each(["tools", "start", "operation", "cleanup"])(
    "does not fall back after native %s failure",
    async (stage) => {
      const failure = new Error(`safe native ${stage} failure`);
      await expect(
        withEphemeralPostgres(async () => "unexpected", {
          environment: { POSTGRES_TEST_BIN: "/owned/postgres/bin" },
          native: async () => {
            throw failure;
          },
        }),
      ).rejects.toBe(failure);
    },
  );

  test.each(["docker", "readinessProbe"] as const)(
    "rejects native selection combined with explicit Docker-only option %s",
    async (option) => {
      const native = vi.fn();
      await expect(
        withEphemeralPostgres(async () => "unexpected", {
          environment: { POSTGRES_TEST_BIN: "/owned/postgres/bin" },
          native,
          ...(option === "docker"
            ? { docker: { run: vi.fn() } }
            : { readinessProbe: vi.fn() }),
        }),
      ).rejects.toThrow(/conflict/u);
      expect(native).not.toHaveBeenCalled();
    },
  );

  test("defaults to the process selector only when no environment was supplied", async () => {
    vi.stubEnv("POSTGRES_TEST_BIN", "/ambient/postgres/bin");
    const native = async <Result>(
      work: NativeWork<Result>,
      options: { binDirectory: string },
    ) => {
      expect(options.binDirectory).toBe("/ambient/postgres/bin");
      return work(nativeConnection, privateMetadata);
    };
    await expect(
      withEphemeralPostgres(async () => "native", { native }),
    ).resolves.toBe("native");
    const docker = {
      run: vi.fn(async () => {
        throw new Error("explicit Docker stand-in reached");
      }),
    };
    await expect(
      withEphemeralPostgres(async () => "unexpected", {
        environment: {},
        native: vi.fn(),
        docker,
      }),
    ).rejects.toThrow("ephemeral PostgreSQL operation failed");
    expect(docker.run).toHaveBeenCalledTimes(1);
  });
});
