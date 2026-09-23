import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { URL } from "node:url";
import { acquireLocalWorkspaceLock } from "./local-experience-lock.mjs";
test("two local instances cannot concurrently write the same Next build directory", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fan-local-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const release = await acquireLocalWorkspaceLock(directory, {
    instance: "first",
    instanceId: "id-first",
    runId: "run-first",
    pid: process.pid,
  });
  await assert.rejects(
    acquireLocalWorkspaceLock(directory, {
      instance: "second",
      instanceId: "id-second",
      runId: "run-second",
      pid: process.pid,
    }),
    /first/,
  );
  await release();
  const next = await acquireLocalWorkspaceLock(directory, {
    instance: "second",
    instanceId: "id-second",
    runId: "run-second",
    pid: process.pid,
  });
  await next();
});

test("concurrent stale-lock recovery never gives two callers checkout ownership", async (t) => {
  const { writeFile } = await import("node:fs/promises");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "fan-local-lock-race-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (let attempt = 0; attempt < 128; attempt++) {
    await writeFile(
      path.join(directory, "workspace.lock"),
      JSON.stringify({
        schemaVersion: 1,
        instance: "stale",
        instanceId: "stale",
        runId: "stale",
        pid: 2147483647,
      }),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        acquireLocalWorkspaceLock(directory, {
          instance: "contender-" + index,
          instanceId: "instance-" + index,
          runId: "run-" + index,
          pid: process.pid,
        }),
      ),
    );
    const accepted = results.filter((result) => result.status === "fulfilled");
    const count = accepted.length;
    for (const result of accepted) await result.value().catch(() => undefined);
    assert.equal(
      count,
      1,
      `Exactly one owner must survive stale recovery (attempt ${attempt})`,
    );
  }
});

test("a live choosing claim is a deterministic barrier before either contender can reclaim the old lock", async (t) => {
  const { mkdir, writeFile, readdir, access } =
    await import("node:fs/promises");
  const { setTimeout: delay } = await import("node:timers/promises");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "fan-local-lock-barrier-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const claims = path.join(directory, ".workspace-claims");
  await mkdir(claims);
  const barrier = "00000000-0000-4000-8000-000000000000";
  const marker = path.join(claims, barrier + ".json");
  await writeFile(
    marker,
    JSON.stringify({
      schemaVersion: 1,
      claimId: barrier,
      pid: process.pid,
      ticket: null,
    }),
  );
  await writeFile(
    path.join(directory, "workspace.lock"),
    JSON.stringify({
      schemaVersion: 1,
      instance: "stale",
      instanceId: "stale",
      runId: "stale",
      pid: 2147483647,
    }),
  );
  let settled = 0;
  const acquisitions = ["one", "two"].map((name) =>
    acquireLocalWorkspaceLock(directory, {
      instance: name,
      instanceId: name,
      runId: name,
      pid: process.pid,
    }).finally(() => settled++),
  );
  const all = Promise.allSettled(acquisitions);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (await readdir(claims)).filter((file) => file.endsWith(".json"))
        .length === 3 ||
      settled
    )
      break;
    await delay(5);
  }
  const before = settled;
  await rm(marker);
  const results = await all;
  const accepted = results.filter((result) => result.status === "fulfilled");
  for (const result of accepted) await result.value().catch(() => undefined);
  assert.equal(
    before,
    0,
    "No caller may enter while a live contender is choosing",
  );
  assert.equal(accepted.length, 1);
  await assert.rejects(access(path.join(directory, "workspace.lock")), {
    code: "ENOENT",
  });
});

test("separate processes pass a choosing barrier with only one surviving workspace owner", async (t) => {
  const { fork } = await import("node:child_process");
  const { mkdir, writeFile, readdir, readFile } =
    await import("node:fs/promises");
  const { setTimeout: delay } = await import("node:timers/promises");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "fan-local-lock-processes-"),
  );
  const children = [];
  t.after(async () => {
    await Promise.all(
      children.map(async ({ child, closed }) => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await closed;
      }),
    );
    await rm(directory, { recursive: true, force: true });
  });
  const claims = path.join(directory, ".workspace-claims");
  await mkdir(claims);
  const barrier = "00000000-0000-4000-8000-000000000001";
  const marker = path.join(claims, barrier + ".json");
  await writeFile(
    marker,
    JSON.stringify({
      schemaVersion: 1,
      claimId: barrier,
      pid: process.pid,
      ticket: null,
    }),
  );
  await writeFile(
    path.join(directory, "workspace.lock"),
    JSON.stringify({
      schemaVersion: 1,
      instance: "stale",
      instanceId: "stale",
      runId: "stale",
      pid: 2147483647,
    }),
  );
  const moduleUrl = new URL("./local-experience-lock.mjs", import.meta.url)
    .href;
  const worker = path.join(directory, "contender.mjs");
  await writeFile(
    worker,
    `import {acquireLocalWorkspaceLock} from ${JSON.stringify(moduleUrl)};
const name=process.argv[3];
try {
 const release=await acquireLocalWorkspaceLock(process.argv[2],{instance:name,instanceId:name,runId:name,pid:process.pid});
 process.send({acquired:true});
 await new Promise(resolve=>process.once('message',resolve));
 await release();
 process.disconnect();
} catch { process.send({acquired:false});process.disconnect(); }
`,
  );
  for (let i = 0; i < 8; i++) {
    const child = fork(worker, [directory, "process-" + i], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const closed = new Promise((resolve) => child.once("close", resolve));
    const outcome = new Promise((resolve, reject) => {
      child.once("message", resolve);
      child.once("error", reject);
      child.once("exit", () =>
        reject(new Error("Contender exited before a result")),
      );
    });
    children.push({ child, closed, outcome });
  }
  let selected = false;
  for (let attempt = 0; attempt < 500; attempt++) {
    const files = (await readdir(claims)).filter((file) =>
      file.endsWith(".json"),
    );
    if (files.length === 9) {
      const values = await Promise.all(
        files.map((file) =>
          readFile(path.join(claims, file), "utf8").then(JSON.parse),
        ),
      );
      if (
        values
          .filter((value) => value.claimId !== barrier)
          .every((value) => value.ticket !== null)
      ) {
        selected = true;
        break;
      }
    }
    await delay(5);
  }
  assert.equal(
    selected,
    true,
    "Every independent process reached the choosing barrier",
  );
  assert.equal(
    JSON.parse(await readFile(path.join(directory, "workspace.lock"), "utf8"))
      .instance,
    "stale",
  );
  await rm(marker);
  const outcomes = await Promise.all(children.map((item) => item.outcome));
  assert.equal(outcomes.filter((value) => value.acquired).length, 1);
  children.forEach(({ child }, index) => {
    if (outcomes[index].acquired) child.send("release");
  });
  await Promise.all(children.map((item) => item.closed));
});

test("arbitration recovers a choosing record left by a process that actually exited", async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdir, writeFile, access } = await import("node:fs/promises");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "fan-local-lock-crash-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const claims = path.join(directory, ".workspace-claims");
  await mkdir(claims);
  const id = "00000000-0000-4000-8000-000000000002";
  const marker = path.join(claims, id + ".json");
  await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    `import {writeFile} from 'node:fs/promises';await writeFile(process.argv[1],JSON.stringify({schemaVersion:1,claimId:process.argv[2],pid:process.pid,ticket:null}));`,
    marker,
    id,
  ]);
  await writeFile(
    path.join(directory, "workspace.lock"),
    JSON.stringify({
      schemaVersion: 1,
      instance: "stale",
      instanceId: "stale",
      runId: "stale",
      pid: 2147483647,
    }),
  );
  const release = await acquireLocalWorkspaceLock(directory, {
    instance: "recovered",
    instanceId: "new",
    runId: "new",
    pid: process.pid,
  });
  await assert.rejects(access(marker), { code: "ENOENT" });
  await release();
});
