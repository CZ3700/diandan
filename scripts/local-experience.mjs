import { launchLocalBrowser } from "./local-experience-browser-launcher.mjs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, open, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = process.argv.slice(2),
  command = args[0] ?? "status";
const index = args.indexOf("--instance"),
  instance = index < 0 ? "default" : args[index + 1];
if (command === "start" && !args.includes("--skip-build"))
  await promisify(execFile)(
    "corepack",
    [
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
    ],
    { cwd: workspaceRoot, timeout: 300000, maxBuffer: 8 * 1024 * 1024 },
  );

// Compile workspace exports before loading state/config modules on a fresh checkout.
const { loadLocalState } = await import("./local-experience-state.mjs");
const { resetLocalExperience } = await import("./local-experience-reset.mjs");
const { assertLocalStopSucceeded } =
  await import("./local-experience-stop-result.mjs");
const { prepareLocalTls } =
  await import("../apps/api/scripts/local-experience-infrastructure.mjs");
const state = await loadLocalState(workspaceRoot, instance),
  { config, stateDirectory } = state;
async function status() {
  try {
    const r = await globalThis.fetch(
      `http://127.0.0.1:${config.ports.control}/status`,
      {
        headers: { authorization: "Bearer " + config.secrets.controlToken },
        signal: globalThis.AbortSignal.timeout(5000),
      },
    );
    if (!r.ok) return null;
    const value = await r.json();
    return value.instanceId === config.instanceId ? value : null;
  } catch {
    return null;
  }
}
async function clearDeadLock() {
  const file = path.join(stateDirectory, "supervisor.lock");
  let value;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (
    value.instanceId !== config.instanceId ||
    !Number.isInteger(value.pid) ||
    value.pid < 1
  )
    throw new Error("Invalid supervisor ownership record");
  try {
    process.kill(value.pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") {
      await rm(file);
      return;
    }
    throw error;
  }
  throw new Error(
    "An existing supervisor is starting or unhealthy; its data and process were preserved",
  );
}
/** Only the supervisor's own structured stage and failure lines, re-picked field by field. */
async function supervisorOutcome() {
  const text = await readFile(
    path.join(stateDirectory, "supervisor.log"),
    "utf8",
  ).catch(() => "");
  const lines = [];
  for (const line of text.split("\n")) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof value?.stage !== "string") continue;
    lines.push(
      value.outcome === "FAIL"
        ? {
            outcome: "FAIL",
            stage: value.stage.slice(0, 80),
            errorName: String(value.errorName).slice(0, 80),
            code: value.code === null ? null : String(value.code).slice(0, 80),
            message: String(value.message).slice(0, 240),
          }
        : { stage: value.stage.slice(0, 80) },
    );
  }
  return lines.slice(-4);
}
async function openBrowser() {
  const active = await status();
  if (!active?.ready) throw new Error("Start the local experience first");
  await launchLocalBrowser(state);
}

try {
  if (command === "start") {
    let active = await status();
    if (!active) {
      await clearDeadLock();
      await prepareLocalTls(state);
      const log = await open(
        path.join(stateDirectory, "supervisor.log"),
        "a",
        0o600,
      );
      const child = spawn(
        process.execPath,
        [
          path.join(
            workspaceRoot,
            "apps/api/scripts/local-experience-supervisor.mjs",
          ),
          instance,
        ],
        {
          cwd: workspaceRoot,
          detached: true,
          stdio: ["ignore", log.fd, log.fd],
          env: {
            ...process.env,
            NODE_EXTRA_CA_CERTS: config.tls.caCertificatePath,
            NODE_TLS_REJECT_UNAUTHORIZED: "1",
          },
        },
      );
      child.unref();
      await log.close();
      for (let i = 0; i < 240; i++) {
        active = await status();
        if (
          active?.ready ||
          child.exitCode !== null ||
          child.signalCode !== null
        )
          break;
        await delay(500);
      }
    }
    if (!active?.ready)
      throw new Error(
        `Local startup did not finish; see the private supervisor log and preserved data ${JSON.stringify(await supervisorOutcome())}`,
      );
    console.log(
      JSON.stringify(
        {
          ready: true,
          instance,
          front: config.origins.storefront + "/en",
          admin: config.origins.admin,
          open:
            instance === "default"
              ? "pnpm local:open"
              : `pnpm local:open --instance ${instance}`,
        },
        null,
        2,
      ),
    );
    if (args.includes("--open")) await openBrowser();
  } else if (command === "status")
    console.log(
      JSON.stringify((await status()) ?? { ready: false, instance }, null, 2),
    );
  else if (command === "open") await openBrowser();
  else if (command === "stop") {
    const active = await status();
    let expectedRunId = active?.runId;
    if (!expectedRunId) {
      try {
        const previous = JSON.parse(
          await readFile(path.join(stateDirectory, "supervisor.lock"), "utf8"),
        );
        if (
          previous.instanceId !== config.instanceId ||
          typeof previous.runId !== "string"
        )
          throw new Error("Invalid supervisor ownership record");
        expectedRunId = previous.runId;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (active) {
      await globalThis.fetch(`http://127.0.0.1:${config.ports.control}/stop`, {
        method: "POST",
        headers: { authorization: "Bearer " + config.secrets.controlToken },
        signal: globalThis.AbortSignal.timeout(5000),
      });
      for (let i = 0; i < 120; i++) {
        if (!(await status())) break;
        await delay(500);
      }
      if (await status()) throw new Error("Local instance is still stopping");
    }
    await assertLocalStopSucceeded(state, expectedRunId);
    await clearDeadLock();
    console.log("已停止；图片、商品、订单及配置已保留。");
  } else if (command === "reset") {
    if (await status()) throw new Error("Stop the instance before reset");
    await clearDeadLock();
    await resetLocalExperience({
      workspaceRoot,
      instance,
      state,
      confirmation: args[args.indexOf("--confirm") + 1],
    });
    console.log("已清除该本地实例。");
  } else throw new Error("Use start, status, open, stop or reset");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
