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
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import pg from "pg";

const execute = promisify(execFile);
const allowedOptions = new Set([
  "binDirectory",
  "libraryPath",
  "shareDirectory",
  "run",
  "createClient",
]);

function configuration(options) {
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

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function existing(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function cleanOwnedCluster({ directory, dataDirectory, runId, invoke }) {
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
    if (
      pidFile.isSymbolicLink() ||
      !/^[1-9]\d*$/u.test(pid) ||
      ownedData !== dataDirectory
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

/** A new, private TEST cluster only; no existing connection or data-directory input. */
export async function withNativeFinancePostgres(operation, supplied) {
  const options = configuration(supplied);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("PG")),
  );
  env.LC_ALL = "C";
  if (options.libraryPath !== undefined)
    env.DYLD_LIBRARY_PATH = options.libraryPath;
  const run = options.run ?? execute;
  const invoke = (binary, args) =>
    run(path.join(options.binDirectory, binary), args, {
      env,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
  let serverVersion;
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
  let value, failure;
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
    const connection = {
      host: "127.0.0.1",
      port,
      user: "fan_support_test",
      password,
      database: "fan_support_test",
      ssl: false,
      connectionTimeoutMillis: 5000,
    };
    const client = (
      options.createClient ?? ((config) => new pg.Client(config))
    )({ ...connection, database: "postgres" });
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
  try {
    await cleanOwnedCluster({ directory, dataDirectory, runId, invoke });
  } catch (error) {
    const ownership = /ownership/u.test(error.message);
    failure = new Error(
      ownership
        ? "Native TEST PostgreSQL ownership verification failed; cleanup refused"
        : "Native TEST PostgreSQL cleanup failed; owned cluster retained",
    );
  }
  if (failure) throw failure;
  return value;
}
