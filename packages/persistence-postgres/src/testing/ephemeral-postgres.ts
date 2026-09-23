import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { Client } from "pg";

import type { PostgresConnectionConfig } from "../connection-config.js";
import { withNativeTestPostgres } from "./native-postgres.js";
import path from "node:path";

const postgresImage =
  "postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af";
const harnessLabel = "com.fan-support.harness";
const runIdLabel = "com.fan-support.run-id";
const harnessLabelValue = "p1-04-postgres";
const databaseName = "fan_support_test";
const databaseUser = "fan_support_test";

export interface DockerCommandExecutor {
  run(
    arguments_: readonly string[],
    environment?: Readonly<Record<string, string | undefined>>,
  ): Promise<Readonly<{ stdout: string }>>;
}

export class EphemeralPostgresError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EphemeralPostgresError";
  }
}

const defaultDockerExecutor: DockerCommandExecutor = {
  run: async (arguments_, environment = {}) =>
    new Promise((resolve, reject) => {
      execFile(
        "docker",
        [...arguments_],
        {
          encoding: "utf8",
          env: { ...process.env, ...environment },
          maxBuffer: 1024 * 1024,
        },
        (error, stdout) => {
          if (error !== null) {
            reject(new EphemeralPostgresError("Docker command failed"));
            return;
          }
          resolve({ stdout });
        },
      );
    }),
};

type ReadinessProbe = (
  clientConfig: PostgresConnectionConfig,
) => Promise<boolean>;

export type TestPostgresRuntimeMetadata = Readonly<{
  kind: "NATIVE_ISOLATED_TEST" | "DOCKER_EPHEMERAL_TEST";
  configuredBy: string;
  serverVersion?: string;
}>;

const defaultReadinessProbe: ReadinessProbe = async (clientConfig) => {
  const client = new Client({
    ...clientConfig,
    connectionTimeoutMillis: 1_000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      // A failed readiness connection may already be closed.
    }
  }
};

function parseLoopbackPort(output: string): number {
  const lines = output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== 1) {
    throw new EphemeralPostgresError(
      "Docker did not return one PostgreSQL port binding",
    );
  }
  const match = /^127\.0\.0\.1:(?<port>\d{1,5})$/u.exec(lines[0] ?? "");
  const parsedPort = Number(match?.groups?.["port"]);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new EphemeralPostgresError(
      "Docker PostgreSQL port is not loopback-bound",
    );
  }
  return parsedPort;
}

function parseLabels(output: string): Readonly<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(output) as unknown;
  } catch {
    throw new EphemeralPostgresError(
      "Docker returned invalid container labels",
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EphemeralPostgresError(
      "Docker returned invalid container labels",
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

async function waitUntilReady(
  clientConfig: PostgresConnectionConfig,
  readinessProbe: ReadinessProbe,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await readinessProbe(clientConfig)) {
      return;
    }
    await delay(200);
  }
  throw new EphemeralPostgresError("PostgreSQL container did not become ready");
}

async function removeOwnedContainer(
  docker: DockerCommandExecutor,
  containerName: string,
  runId: string,
): Promise<void> {
  const inspected = await docker.run([
    "inspect",
    "--format",
    "{{json .Config.Labels}}",
    containerName,
  ]);
  const labels = parseLabels(inspected.stdout);
  if (
    labels[harnessLabel] !== harnessLabelValue ||
    labels[runIdLabel] !== runId
  ) {
    throw new EphemeralPostgresError(
      "refusing to remove a container without exact harness labels",
    );
  }
  await docker.run(["rm", "--force", containerName]);
}

export async function withEphemeralPostgres<Result>(
  operation: (
    clientConfig: PostgresConnectionConfig,
    metadata: TestPostgresRuntimeMetadata,
  ) => Promise<Result>,
  options: Readonly<{
    docker?: DockerCommandExecutor;
    readinessProbe?: ReadinessProbe;
    environment?: Readonly<Record<string, string | undefined>>;
    native?: typeof withNativeTestPostgres;
  }> = {},
): Promise<Result> {
  const environment = options.environment ?? process.env;
  const binDirectory = environment["POSTGRES_TEST_BIN"];
  if (binDirectory !== undefined) {
    if (typeof binDirectory !== "string" || !path.isAbsolute(binDirectory)) {
      throw new EphemeralPostgresError(
        "Invalid native TEST PostgreSQL configuration",
      );
    }
    if (options.docker !== undefined || options.readinessProbe !== undefined) {
      throw new EphemeralPostgresError(
        "Native TEST PostgreSQL selection conflicts with Docker-only options",
      );
    }
    return (options.native ?? withNativeTestPostgres)(
      (configuration, metadata) =>
        operation(configuration, {
          kind: "NATIVE_ISOLATED_TEST",
          configuredBy: "POSTGRES_TEST_BIN",
          serverVersion: metadata.serverVersion,
        }),
      { binDirectory },
    );
  }
  const docker = options.docker ?? defaultDockerExecutor;
  const readinessProbe = options.readinessProbe ?? defaultReadinessProbe;
  const runId = randomUUID();
  const containerName = `fan-support-p1-04-${runId}`;
  const password = randomBytes(32).toString("hex");
  const labels = [
    `${harnessLabel}=${harnessLabelValue}`,
    `${runIdLabel}=${runId}`,
  ] as const;
  let started = false;

  try {
    await docker.run(
      [
        "run",
        "--detach",
        "--name",
        containerName,
        "--label",
        labels[0],
        "--label",
        labels[1],
        "--env",
        "POSTGRES_PASSWORD",
        "--env",
        "POSTGRES_USER",
        "--env",
        "POSTGRES_DB",
        "--publish",
        "127.0.0.1::5432",
        "--tmpfs",
        "/var/lib/postgresql:rw,noexec,nosuid,size=512m",
        postgresImage,
      ],
      {
        POSTGRES_PASSWORD: password,
        POSTGRES_USER: databaseUser,
        POSTGRES_DB: databaseName,
      },
    );
    started = true;
    const portResult = await docker.run(["port", containerName, "5432/tcp"]);
    const clientConfig: PostgresConnectionConfig = {
      host: "127.0.0.1",
      port: parseLoopbackPort(portResult.stdout),
      user: databaseUser,
      password,
      database: databaseName,
      application_name: "fan-support-p1-04-migration-harness",
    };
    await waitUntilReady(clientConfig, readinessProbe);
    return await operation(clientConfig, {
      kind: "DOCKER_EPHEMERAL_TEST",
      configuredBy: "withEphemeralPostgres",
    });
  } catch (error: unknown) {
    if (error instanceof EphemeralPostgresError) {
      throw error;
    }
    throw new EphemeralPostgresError("ephemeral PostgreSQL operation failed");
  } finally {
    if (started) {
      await removeOwnedContainer(docker, containerName, runId);
    }
  }
}
