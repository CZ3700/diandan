import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
const [name, command, ...args] = process.argv.slice(2);
if (!name || !/^[a-z0-9-]+$/u.test(name) || !command)
  throw new Error("Named check and command are required");
const directory = path.dirname(fileURLToPath(import.meta.url));
const log = createWriteStream(path.join(directory, `${name}.log`));
const startedAt = new Date().toISOString();
const started = performance.now();
const child = spawn(command, args, {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => resolve({ code, signal }));
});
await new Promise((resolve) => log.end(resolve));
const metadata = {
  schemaVersion: 1,
  command: [command, ...args],
  startedAt,
  endedAt: new Date().toISOString(),
  durationSeconds: (performance.now() - started) / 1000,
  ...result,
};
await writeFile(
  path.join(directory, `${name}.json`),
  JSON.stringify(metadata, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(metadata) + "\n");
process.exitCode = result.code ?? 1;
