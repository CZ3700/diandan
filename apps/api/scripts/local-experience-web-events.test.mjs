import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  createWebEventLog,
  structuredEventLine,
} from "./local-experience-web-events.mjs";

const event = {
  schemaVersion: 1,
  timestamp: "2026-09-30T00:00:00.000Z",
  level: "error",
  service: "storefront",
  event: "next.request.failed",
  errorCode: "INTERNAL_ERROR",
  outcome: "failure",
};

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fan-web-events-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "web-events.log");
}

test("only schema-valid structured events survive, re-serialized field by field", () => {
  assert.equal(
    structuredEventLine(JSON.stringify(event)),
    JSON.stringify(event),
  );
  for (const line of [
    "",
    "   ▲ Next.js 16.3.6",
    "Error: failed https://example.invalid/order#token=secret",
    "{not json",
    JSON.stringify({ ...event, message: "free text with an email a@b.c" }),
    JSON.stringify({ ...event, event: "anything.else" }),
    JSON.stringify([event]),
    JSON.stringify("text"),
  ])
    assert.equal(structuredEventLine(line), null, line);
});

test("the private event log keeps structured lines from both streams and discards the rest", async (t) => {
  const file = await fixture(t);
  const log = createWebEventLog({ file, maxBytes: 1_000_000 });
  const stdout = new PassThrough(),
    stderr = new PassThrough();
  log.attach(stdout);
  log.attach(stderr);
  stdout.write("ready on 127.0.0.1\n" + JSON.stringify(event) + "\n");
  stderr.write("TypeError: fetch failed token=secret\n");
  stderr.write(JSON.stringify({ ...event, level: "warn" }) + "\n");
  stdout.end();
  stderr.end();
  await delay(50);
  const lines = (await readFile(file, "utf8")).trim().split("\n");
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).level),
    ["error", "warn"],
  );
  assert.doesNotMatch(await readFile(file, "utf8"), /secret|127\.0\.0\.1/u);
  if (process.platform !== "win32")
    assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("the event log is bounded: it rotates once and keeps a single previous file", async (t) => {
  const file = await fixture(t);
  await writeFile(file + ".1", "stale\n");
  const line = JSON.stringify(event) + "\n";
  const log = createWebEventLog({ file, maxBytes: line.length * 3 });
  const input = new PassThrough();
  log.attach(input);
  for (let i = 0; i < 10; i++) input.write(line);
  input.end();
  await delay(50);
  assert.ok((await stat(file)).size <= line.length * 3);
  assert.ok((await stat(file + ".1")).size <= line.length * 3);
  assert.doesNotMatch(await readFile(file + ".1", "utf8"), /stale/u);
});
