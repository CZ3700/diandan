import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { loadLocalState } from "../../../scripts/local-experience-state.mjs";
import { startNativePostgres } from "./local-experience-postgres.mjs";
const run = promisify(execFile),
  root = await mkdtemp(path.join(tmpdir(), "fan-local-pg-recovery-"));
const bin = process.env.FAN_SUPPORT_LOCAL_POSTGRES_BIN;
if (!bin)
  throw new Error(
    "Set FAN_SUPPORT_LOCAL_POSTGRES_BIN to PostgreSQL 18 bin for this integration",
  );
let directory;
const cleanups = [];
try {
  const state = await loadLocalState(root, "test");
  directory = path.join(state.stateDirectory, "postgres");
  const password = path.join(state.stateDirectory, "postgres-password.tmp");
  await writeFile(password, state.config.database.password + "\n", {
    mode: 0o600,
  });
  await run(path.join(bin, "initdb"), [
    "-D",
    directory,
    "--username=" + state.config.database.user,
    "--pwfile=" + password,
    "--auth-host=scram-sha-256",
    "--auth-local=reject",
    "--encoding=UTF8",
    "--locale=C",
  ]);
  // Emulate termination after initdb wrote PG_VERSION, before app config/password-file cleanup.
  const database = await startNativePostgres({
    ...state,
    workspaceRoot: root,
    own: (_name, close) => cleanups.push(close),
  });
  const client = new Client(database);
  await client.connect();
  try {
    assert.equal(
      Number((await client.query("SHOW port")).rows[0].port),
      state.config.ports.postgres,
    );
    await client.query("CREATE TABLE local_restart_probe(value text)");
    await client.query("INSERT INTO local_restart_probe VALUES('retained')");
  } finally {
    await client.end();
  }
  await assert.rejects(access(password), (error) => error.code === "ENOENT");
  const originalConfig = await readFile(
    path.join(directory, "postgresql.auto.conf"),
    "utf8",
  );
  await cleanups.pop()();
  const again = await startNativePostgres({
    ...state,
    workspaceRoot: root,
    own: (_name, close) => cleanups.push(close),
  });
  const reopened = new Client(again);
  await reopened.connect();
  try {
    assert.equal(
      (await reopened.query("SELECT value FROM local_restart_probe")).rows[0]
        .value,
      "retained",
    );
  } finally {
    await reopened.end();
  }
  assert.equal(
    await readFile(path.join(directory, "postgresql.auto.conf"), "utf8"),
    originalConfig,
  );
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      status: "PASS",
      assertions: 4,
      scope:
        "actual native PostgreSQL interrupted first initialization and restart retention",
    }),
  );
} finally {
  for (const close of cleanups.reverse()) await close().catch(() => undefined);
  if (directory)
    await run(path.join(bin, "pg_ctl"), [
      "-D",
      directory,
      "-m",
      "fast",
      "-w",
      "stop",
    ]).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
