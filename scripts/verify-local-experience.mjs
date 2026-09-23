import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { glob, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLocalAcceptance } from "./local-experience-acceptance.mjs";
import { resolveLocalPostgresBin } from "../apps/api/scripts/local-experience-postgres.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log(
    "Usage: pnpm verify:local-experience [--keep]\nRuns local unit/PG/TLS/browser/restart acceptance in a new owned instance. Requires Docker, native PostgreSQL 18 and Chrome. No external mail, real money or cloud calls. Success cleans its own instance unless --keep; failure retains data. Stop any existing local experience first.",
  );
  process.exit(0);
}
if (args.length > 1 || (args.length === 1 && args[0] !== "--keep"))
  throw new Error("Unsupported option; use --help");
const instance = "acceptance-" + randomUUID().replaceAll("-", "").slice(0, 20);
const output = path.join(
  root,
  "output/checks/p5-08-local-deployment/acceptance",
  instance,
);
await mkdir(output, { recursive: true });
const report = {
  schemaVersion: 1,
  instance,
  status: "RUNNING",
  commands: [],
  acceptance: null,
};
let step = 0;
let commandEnvironment = process.env;
async function command(label, executable, commandArgs) {
  const evidence = `${++step}-${label}.txt`;
  console.log(`[local acceptance] ${label}`);
  const chunks = [];
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(executable, commandArgs, {
      cwd: root,
      env: commandEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  await writeFile(path.join(output, evidence), Buffer.concat(chunks));
  report.commands.push({
    label,
    executable: path.basename(executable),
    args: commandArgs,
    ...exit,
    evidence,
  });
  if (exit.code !== 0 || exit.signal)
    throw new Error(
      `Local acceptance failed at ${label}; inspect safe evidence`,
    );
}
async function fingerprint(state) {
  const files = [
    "config.json",
    "tls/ca.crt",
    "tls/server.crt",
    "tls/server.key",
  ];
  // Paths come from validated configuration; private file bytes/hashes never enter reports.
  const hashes = {};
  for (const filename of files)
    hashes[filename] = createHash("sha256")
      .update(await readFile(path.join(state.stateDirectory, filename)))
      .digest("hex");
  hashes.oidc = createHash("sha256")
    .update(await readFile(state.config.services.oidc.signingPrivateKeyPath))
    .digest("hex");
  async function media(directory, prefix = "") {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.join(prefix, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Acceptance media cannot contain symbolic links");
      if (entry.isDirectory())
        await media(path.join(directory, entry.name), relative);
      else if (entry.isFile())
        hashes["media/" + relative] = createHash("sha256")
          .update(await readFile(path.join(directory, entry.name)))
          .digest("hex");
    }
  }
  await media(path.join(state.stateDirectory, "media/s3"));
  return hashes;
}
try {
  commandEnvironment = {
    ...process.env,
    FAN_SUPPORT_LOCAL_POSTGRES_BIN: await resolveLocalPostgresBin(root),
  };
  await command("build-runtime", "corepack", [
    "pnpm",
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=@fan-support/api...",
    "--filter=@fan-support/worker...",
    "--filter=@fan-support/admin^...",
    "--filter=@fan-support/storefront^...",
    "--output-logs=errors-only",
  ]);
  const tests = [];
  for await (const filename of glob(
    [
      "scripts/local-experience*.test.mjs",
      "apps/api/scripts/local-experience*.test.mjs",
    ],
    { cwd: root },
  ))
    tests.push(filename);
  await command("unit", process.execPath, ["--test", ...tests.sort()]);
  const { loadLocalState } = await import("./local-experience-state.mjs");
  for (const integration of [
    "postgres-integration",
    "services-integration",
    "bootstrap-postgres",
  ])
    await command(integration, process.execPath, [
      `apps/api/scripts/local-experience-${integration}.mjs`,
    ]);
  let state;
  const cli = (action, extra = []) =>
    command(action, process.execPath, [
      "scripts/local-experience.mjs",
      action,
      "--instance",
      instance,
      ...extra,
    ]);
  const { verifyLocalExperienceBrowser } =
    await import("../apps/api/scripts/local-experience-browser.mjs");
  report.acceptance = await runLocalAcceptance(
    {
      initialize: async () => {
        state = await loadLocalState(root, instance);
      },
      start: () => cli("start", ["--skip-build"]),
      snapshot: () => fingerprint(state),
      browser: (resumeFacts) =>
        verifyLocalExperienceBrowser({
          workspaceRoot: root,
          instance,
          ...(resumeFacts ? { resumeFacts } : {}),
        }),
      stop: () => cli("stop"),
      reset: () => cli("reset", ["--confirm", state.config.instanceId]),
    },
    { keep: args.includes("--keep") },
  );
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = {
    name: error.name,
    stage: report.commands.at(-1)?.label ?? "initialization",
    dataPreserved: true,
  };
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      instance,
      report: path.join(output, "report.json"),
    }),
  );
}
