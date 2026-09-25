import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, stat, access, rm } from "node:fs/promises";
import path from "node:path";
import { withNativeFinancePostgres } from "./admin-finance-native-postgres.mjs";

// The native TEST cluster relies on POSIX file modes and Unix-socket settings.
const posixOnlySkip =
  process.platform === "win32"
    ? "native PostgreSQL TEST harness requires POSIX file modes; run on Linux/macOS or CI"
    : "";

function fakeNative({ failStart = false } = {}) {
  const calls = [];
  let directory, password;
  const run = async (executable, args) => {
    calls.push({ executable, args });
    const name = path.basename(executable);
    if (args[0] === "--version")
      return { stdout: `${name} (PostgreSQL) 18.6\n` };
    const data = args[args.indexOf("-D") + 1];
    directory = path.dirname(data);
    if (name === "initdb") {
      const pass = args.find((v) => v.startsWith("--pwfile=")).slice(9);
      password = (await readFile(pass, "utf8")).trim();
      assert.equal((await stat(pass)).mode & 0o777, 0o600);
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.ok(args.includes("--auth-host=scram-sha-256"));
      assert.ok(args.includes("--auth-local=reject"));
      await mkdir(data, { mode: 0o700 });
      await writeFile(path.join(data, "postgresql.conf"), "");
      return { stdout: "" };
    }
    if (args.includes("start")) {
      await writeFile(path.join(data, "postmaster.pid"), `12345\n${data}\n`);
      if (failStart) throw new Error(password);
    }
    if (args.includes("stop")) await rm(path.join(data, "postmaster.pid"));
    return { stdout: "" };
  };
  const clients = [];
  const createClient = (config) => {
    clients.push(config);
    return {
      connect: async () => {},
      query: async (sql) => {
        assert.match(sql, /^CREATE DATABASE/u);
      },
      end: async () => {},
    };
  };
  return {
    run,
    createClient,
    calls,
    clients,
    get directory() {
      return directory;
    },
    get password() {
      return password;
    },
  };
}

test("native TEST cluster is newly owned, private, loopback-only, password-authenticated and always removed", async (context) => {
  if (posixOnlySkip) return context.skip(posixOnlySkip);
  const h = fakeNative();
  const value = await withNativeFinancePostgres(
    async (config, metadata) => {
      assert.equal(config.host, "127.0.0.1");
      assert.equal(config.database, "fan_support_test");
      assert.ok(config.password.length >= 64);
      assert.equal(config.password, h.password);
      assert.ok(config.port > 0);
      const conf = await readFile(
        path.join(metadata.dataDirectory, "postgresql.conf"),
        "utf8",
      );
      assert.match(conf, /listen_addresses = '127\.0\.0\.1'/u);
      assert.match(conf, /unix_socket_directories = ''/u);
      return "accepted";
    },
    {
      binDirectory: "/approved/postgresql@18/bin",
      run: h.run,
      createClient: h.createClient,
    },
  );
  assert.equal(value, "accepted");
  assert.equal(h.calls.filter((v) => v.args.includes("stop")).length, 1);
  await assert.rejects(access(h.directory));
  assert.ok(
    h.calls.every((v) => !v.args.includes(h.password)),
    "password is never a process argument",
  );
});

test("a partially started native cluster is stopped and cleaned while command details stay private", async (context) => {
  if (posixOnlySkip) return context.skip(posixOnlySkip);
  const h = fakeNative({ failStart: true });
  await assert.rejects(
    withNativeFinancePostgres(async () => assert.fail("start failed"), {
      binDirectory: "/approved/postgresql@18/bin",
      run: h.run,
      createClient: h.createClient,
    }),
    (error) => !error.message.includes(h.password),
  );
  assert.equal(h.calls.filter((v) => v.args.includes("stop")).length, 1);
  await assert.rejects(access(h.directory));
});

test("native callback failure preserves no password and still shuts down only its new cluster", async (context) => {
  if (posixOnlySkip) return context.skip(posixOnlySkip);
  const h = fakeNative();
  await assert.rejects(
    withNativeFinancePostgres(
      async (config) => {
        throw new Error(config.password);
      },
      {
        binDirectory: "/approved/postgresql@18/bin",
        run: h.run,
        createClient: h.createClient,
      },
    ),
    (error) => !error.message.includes(h.password),
  );
  assert.equal(h.calls.filter((v) => v.args.includes("stop")).length, 1);
  await assert.rejects(access(h.directory));
});

test("native harness refuses cleanup when its exact ownership marker changed", async (context) => {
  if (posixOnlySkip) return context.skip(posixOnlySkip);
  const h = fakeNative();
  let metadata;
  try {
    await assert.rejects(
      withNativeFinancePostgres(
        async (_config, value) => {
          metadata = value;
          await writeFile(path.join(value.directory, "owner"), "unrelated");
        },
        {
          binDirectory: "/approved/postgresql@18/bin",
          run: h.run,
          createClient: h.createClient,
        },
      ),
      /ownership/u,
    );
    assert.equal(h.calls.filter((v) => v.args.includes("stop")).length, 0);
    await access(metadata.directory);
  } finally {
    if (metadata)
      await rm(metadata.directory, { recursive: true, force: true });
  }
});

test("native harness accepts no existing database or relative binary selector", async () => {
  await assert.rejects(
    withNativeFinancePostgres(async () => {}, { binDirectory: "relative" }),
    /configuration/u,
  );
  await assert.rejects(
    withNativeFinancePostgres(async () => {}, {
      binDirectory: "/approved/postgresql@18/bin",
      database: { host: "remote" },
    }),
    /configuration/u,
  );
});
