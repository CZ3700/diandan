import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, access, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
const execute = promisify(execFile);
export async function resolveLocalPostgresBin(
  workspaceRoot,
  environment = process.env,
) {
  let bin = environment.FAN_SUPPORT_LOCAL_POSTGRES_BIN;
  if (!bin) {
    const candidates = [
      "/opt/homebrew/opt/postgresql@18/bin",
      path.join(
        workspaceRoot,
        "output/checks/p5-03-refund-operations/native-runtime/dist/postgresql@18/18.6/bin",
      ),
    ];
    for (const candidate of candidates) {
      try {
        await access(path.join(candidate, "pg_ctl"));
        bin = candidate;
        break;
      } catch {
        /* Try the next installed runtime. */
      }
    }
  }
  if (!bin || !path.isAbsolute(bin))
    throw new Error(
      "PostgreSQL 18 required: install postgresql@18 or set FAN_SUPPORT_LOCAL_POSTGRES_BIN",
    );
  return bin;
}
export async function startNativePostgres({
  config,
  stateDirectory,
  workspaceRoot,
  own,
}) {
  const bin = await resolveLocalPostgresBin(workspaceRoot);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("PG")),
  );
  env.LC_ALL = "C";
  const run = (binary, args) =>
    execute(path.join(bin, binary), args, {
      env,
      timeout: 45000,
      maxBuffer: 1024 * 1024,
    });
  const version = (await run("postgres", ["--version"])).stdout;
  if (!/PostgreSQL\) 18\./u.test(version))
    throw new Error("Local database requires PostgreSQL 18");
  const directory = path.join(stateDirectory, "postgres");
  let fresh = false;
  try {
    await access(path.join(directory, "PG_VERSION"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    fresh = true;
  }
  const passwordFile = path.join(stateDirectory, "postgres-password.tmp");
  try {
    const prior = await readFile(passwordFile, "utf8");
    if (prior !== config.database.password + "\n")
      throw new Error(
        "Unrecognized PostgreSQL initialization file; data preserved",
      );
    await rm(passwordFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (fresh) {
    await writeFile(passwordFile, config.database.password + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    try {
      await run("initdb", [
        "-D",
        directory,
        "--username=" + config.database.user,
        "--pwfile=" + passwordFile,
        "--auth-host=scram-sha-256",
        "--auth-local=reject",
        "--encoding=UTF8",
        "--locale=C",
      ]);
    } finally {
      await rm(passwordFile, { force: true });
    }
  }
  // initdb may have completed before a prior process could write the fixed runtime settings.
  // Reapplying this generated file is safe and never changes business data or credentials.
  await writeFile(
    path.join(directory, "postgresql.auto.conf"),
    `listen_addresses='127.0.0.1'\nport=${config.ports.postgres}\nunix_socket_directories=''\npassword_encryption='scram-sha-256'\nlog_statement='none'\nlog_min_error_statement='panic'\nlog_min_messages='fatal'\n`,
    { mode: 0o600 },
  );
  const canonical = await realpath(directory);
  const verify = async () => {
    const pid = (
      await readFile(path.join(directory, "postmaster.pid"), "utf8")
    ).split("\n");
    if (pid[1] !== canonical || Number(pid[3]) !== config.ports.postgres)
      throw new Error("Local PostgreSQL ownership mismatch");
  };
  own("persistent PostgreSQL", async () => {
    try {
      await access(path.join(directory, "postmaster.pid"));
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await verify();
    await run("pg_ctl", [
      "-D",
      directory,
      "-m",
      "fast",
      "-w",
      "-t",
      "30",
      "stop",
    ]);
  });
  try {
    await run("pg_ctl", ["-D", directory, "status"]);
  } catch {
    await run("pg_ctl", [
      "-D",
      directory,
      "-l",
      path.join(stateDirectory, "postgres.log"),
      "-w",
      "-t",
      "30",
      "start",
    ]);
  }
  await verify();
  const database = {
    host: "127.0.0.1",
    port: config.ports.postgres,
    ...config.database,
    ssl: false,
    connectionTimeoutMillis: 5000,
  };
  const client = new Client({ ...database, database: "postgres" });
  await client.connect();
  try {
    if (
      !(
        await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [
          database.database,
        ])
      ).rowCount
    )
      await client.query("CREATE DATABASE fan_support_local");
  } finally {
    await client.end();
  }
  return database;
}
