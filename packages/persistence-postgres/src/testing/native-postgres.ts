import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import pg from "pg";

import type { PostgresConnectionConfig } from "../connection-config.js";

export type NativePostgresMetadata = Readonly<{
  directory: string;
  dataDirectory: string;
  runId: string;
  serverVersion: string;
}>;

export type NativePostgresRun = (
  executable: string,
  args: readonly string[],
  options: Readonly<{
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
    encoding: "utf8";
  }>,
) => Promise<Readonly<{ stdout: string }>>;

type NativePostgresClient = {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
};

export type NativePostgresOptions = Readonly<{
  binDirectory: string;
  libraryPath?: string;
  shareDirectory?: string;
  run?: NativePostgresRun;
  createClient?: (
    configuration: PostgresConnectionConfig,
  ) => NativePostgresClient;
}>;

type NativeInvoke = (
  binary: string,
  args: readonly string[],
) => Promise<Readonly<{ stdout: string }>>;

const execute = promisify(execFile);
const allowedOptions = new Set([
  "binDirectory",
  "libraryPath",
  "shareDirectory",
  "run",
  "createClient",
]);

function configuration(options: NativePostgresOptions): NativePostgresOptions {
  if (
    !options ||
    typeof options !== "object" ||
    Object.keys(options).some((key) => !allowedOptions.has(key)) ||
    typeof options.binDirectory !== "string" ||
    !path.isAbsolute(options.binDirectory) ||
    (options.shareDirectory !== undefined &&
      (typeof options.shareDirectory !== "string" ||
        !path.isAbsolute(options.shareDirectory))) ||
    (options.libraryPath !== undefined &&
      typeof options.libraryPath !== "string")
  ) {
    throw new Error("Invalid native TEST PostgreSQL configuration");
  }
  return options;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function existing(file: string) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

async function cleanOwnedCluster({
  directory,
  dataDirectory,
  runId,
  invoke,
}: {
  directory: string;
  dataDirectory: string;
  runId: string;
  invoke: NativeInvoke;
}): Promise<void> {
  const root = await lstat(directory);
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    (await readFile(path.join(directory, "owner"), "utf8")) !== runId
  ) {
    throw new Error("Native TEST PostgreSQL ownership verification failed");
  }
  const data = await existing(dataDirectory);
  if (data && (!data.isDirectory() || data.isSymbolicLink())) {
    throw new Error(
      "Native TEST PostgreSQL data ownership verification failed",
    );
  }
  const pidPath = path.join(dataDirectory, "postmaster.pid");
  const pidFile = await existing(pidPath);
  if (pidFile) {
    const [pid, ownedData] = (await readFile(pidPath, "utf8")).split("\n");
    // PostgreSQL writes the data directory with forward slashes on every platform.
    if (
      pidFile.isSymbolicLink() ||
      !/^[1-9]\d*$/u.test(pid ?? "") ||
      ownedData === undefined ||
      path.resolve(ownedData) !== path.resolve(dataDirectory)
    ) {
      throw new Error(
        "Native TEST PostgreSQL process ownership verification failed",
      );
    }
    await invoke("pg_ctl", [
      "-D",
      dataDirectory,
      "-w",
      "-t",
      "30",
      "stop",
      "-m",
      "fast",
    ]);
    if (await existing(pidPath))
      throw new Error("Native TEST PostgreSQL shutdown not confirmed");
  }
  await rm(directory, { recursive: true });
}

const settleTimeoutMs = 5_000;

/**
 * A pool the operation already closed can still be disconnecting: pg-pool
 * settles end() before its clients' sockets close. A fast shutdown under such
 * a connection reaches its client as 57P01 after the owner stopped listening,
 * so the cluster is stopped only once other client backends have left, or
 * after a short bound for connections an operation never closed.
 */
async function settleClientConnections(
  createClient: NonNullable<NativePostgresOptions["createClient"]>,
  connection: PostgresConnectionConfig,
): Promise<void> {
  const client = createClient({ ...connection, database: "postgres" });
  try {
    await client.connect();
    const deadline = Date.now() + settleTimeoutMs;
    while (Date.now() < deadline) {
      const result = (await client.query(
        "SELECT count(*)::integer AS open FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()",
      )) as { rows?: readonly { open?: unknown }[] } | undefined;
      const open = result?.rows?.[0]?.open;
      if (typeof open !== "number" || open === 0) return;
      await delay(25);
    }
  } catch {
    // Settling is best effort; the owned cluster is stopped either way.
  } finally {
    try {
      await client.end();
    } catch {
      // A failed settle connection may already be closed.
    }
  }
}

/** A new, private TEST cluster only; no existing connection or data-directory input. */
export async function withNativeTestPostgres<Result>(
  operation: (
    configuration: PostgresConnectionConfig,
    metadata: NativePostgresMetadata,
  ) => Promise<Result>,
  supplied: NativePostgresOptions,
): Promise<Result> {
  const options = configuration(supplied);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("PG")),
  );
  env["LC_ALL"] = "C";
  if (options.libraryPath !== undefined)
    env["DYLD_LIBRARY_PATH"] = options.libraryPath;
  const run: NativePostgresRun =
    options.run ??
    ((binary, args, config) => execute(binary, [...args], config));
  const invoke: NativeInvoke = (binary, args) =>
    run(path.join(options.binDirectory, binary), args, {
      env,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
  let serverVersion = "";
  try {
    for (const binary of ["postgres", "initdb", "pg_ctl"]) {
      const { stdout } = await invoke(binary, ["--version"]);
      const version = /\(PostgreSQL\) (18\.\d+)(?:\s|$)/u.exec(stdout)?.[1];
      if (!version || (serverVersion && serverVersion !== version))
        throw new Error("version");
      serverVersion = version;
    }
  } catch {
    throw new Error("Native TEST PostgreSQL 18 tools unavailable");
  }
  const directory = await mkdtemp(path.join(tmpdir(), "fan-finance-pg-"));
  const dataDirectory = path.join(directory, "data"),
    runId = randomUUID();
  await chmod(directory, 0o700);
  await writeFile(path.join(directory, "owner"), runId, {
    mode: 0o600,
    flag: "wx",
  });
  const createClient =
    options.createClient ?? ((config) => new pg.Client(config));
  let connection: PostgresConnectionConfig | undefined;
  let value: Result | undefined;
  let failure: Error | undefined;
  try {
    const password = randomBytes(48).toString("hex"),
      port = await unusedPort();
    const passwordFile = path.join(directory, "password");
    await writeFile(passwordFile, password + "\n", { mode: 0o600, flag: "wx" });
    await invoke("initdb", [
      "-D",
      dataDirectory,
      "--username=fan_support_test",
      `--pwfile=${passwordFile}`,
      "--auth-host=scram-sha-256",
      "--auth-local=reject",
      "--encoding=UTF8",
      "--locale=C",
      ...(options.shareDirectory ? ["-L", options.shareDirectory] : []),
    ]);
    await rm(passwordFile);
    await writeFile(
      path.join(dataDirectory, "postgresql.conf"),
      [
        "listen_addresses = '127.0.0.1'",
        `port = ${port}`,
        "unix_socket_directories = ''",
        "password_encryption = 'scram-sha-256'",
        "log_statement = 'none'",
        "log_min_error_statement = 'panic'",
        "log_min_messages = 'fatal'",
        "",
      ].join("\n"),
      { mode: 0o600, flag: "a" },
    );
    const log = path.join(directory, "postgres.log");
    await writeFile(log, "", { mode: 0o600, flag: "wx" });
    await invoke("pg_ctl", [
      "-D",
      dataDirectory,
      "-l",
      log,
      "-w",
      "-t",
      "30",
      "start",
    ]);
    connection = {
      host: "127.0.0.1",
      port,
      user: "fan_support_test",
      password,
      database: "fan_support_test",
      ssl: false,
      connectionTimeoutMillis: 5000,
    };
    const client = createClient({ ...connection, database: "postgres" });
    try {
      await client.connect();
      await client.query("CREATE DATABASE fan_support_test");
    } finally {
      await client.end();
    }
    value = await operation(connection, {
      directory,
      dataDirectory,
      runId,
      serverVersion,
    });
  } catch {
    failure = new Error(
      "Native TEST PostgreSQL operation failed; inspect safe scenario evidence",
    );
  }
  if (connection !== undefined)
    await settleClientConnections(createClient, connection);
  try {
    await cleanOwnedCluster({ directory, dataDirectory, runId, invoke });
  } catch (error) {
    const ownership =
      error instanceof Error && /ownership/u.test(error.message);
    failure = new Error(
      ownership
        ? "Native TEST PostgreSQL ownership verification failed; cleanup refused"
        : "Native TEST PostgreSQL cleanup failed; owned cluster retained",
    );
  }
  if (failure) throw failure;
  return value as Result;
}
