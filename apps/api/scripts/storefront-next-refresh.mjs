import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const run = promisify(execFile);
const stateKey = Symbol.for("fan-support.storefront.test-next-refresh");

/** Rebuild the exact owned Next listener while retaining the real PG/API/S3 fixture. */
export async function refreshStorefrontNext({
  origin,
  proxy,
  gateway,
  output,
  check,
}) {
  const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const port = new globalThis.URL(origin).port;
  const lookup = await run("lsof", [
    "-t",
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
  ]);
  const pids = [...new Set(lookup.stdout.trim().split(/\s+/u).map(Number))];
  check(
    pids.length === 1 && Number.isSafeInteger(pids[0]),
    "Next refresh identifies exactly one listener on its owned fixture port",
  );
  const owner = await run("ps", ["-o", "ppid=", "-p", String(pids[0])]);
  check(
    Number(owner.stdout.trim()) === process.pid,
    "Next refresh refuses any listener not directly owned by this harness process",
  );
  process.kill(pids[0], "SIGTERM");
  const deadline = globalThis.performance.now() + 10_000;
  while (globalThis.performance.now() < deadline) {
    try {
      process.kill(pids[0], 0);
      await delay(100);
    } catch {
      break;
    }
  }
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("FAN_SUPPORT_"),
    ),
  );
  Object.assign(environment, {
    NODE_ENV: "test",
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    FAN_SUPPORT_SITE_ORIGIN: origin,
    FAN_SUPPORT_INTERNAL_API_ORIGIN: proxy.origin,
    FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: gateway.origin,
    FAN_SUPPORT_STOREFRONT_NAME: "FAN SUPPORT",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `${environment.NODE_OPTIONS ?? ""} --import=${new globalThis.URL("./storefront-test-dns.mjs", import.meta.url).href}`,
  });
  const binary = path.join(
    workspaceRoot,
    "apps/storefront/node_modules/next/dist/bin/next",
  );
  const buildLog = path.join(output, "next-production-build.log");
  await writeFile(buildLog, "");
  const build = spawn(process.execPath, [binary, "build"], {
    cwd: path.join(workspaceRoot, "apps/storefront"),
    env: {
      ...environment,
      NODE_ENV: "production",
      FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
      FAN_SUPPORT_SITE_ORIGIN: "https://localhost:3443",
      FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://api:3002",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const buildOutput = (chunk) => void appendFile(buildLog, chunk.toString());
  build.stdout.on("data", buildOutput);
  build.stderr.on("data", buildOutput);
  const [exitCode] = await once(build, "exit");
  check(
    exitCode === 0,
    "same-fixture refreshed production artifact builds from current source",
  );
  const next = spawn(
    process.execPath,
    [binary, "start", "--hostname", "localhost", "--port", port],
    {
      cwd: path.join(workspaceRoot, "apps/storefront"),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const outputLine = (chunk) =>
    void appendFile(path.join(output, "next-local.log"), chunk.toString());
  next.stdout.on("data", outputLine);
  next.stderr.on("data", outputLine);
  let state = globalThis[stateKey];
  if (!state) {
    state = { child: next };
    globalThis[stateKey] = state;
    process.once("SIGTERM", () => state.child?.kill("SIGTERM"));
    process.once("SIGINT", () => state.child?.kill("SIGTERM"));
    process.once("exit", () => state.child?.kill("SIGTERM"));
  } else state.child = next;
  let healthy = false;
  const readyDeadline = globalThis.performance.now() + 60_000;
  while (
    globalThis.performance.now() < readyDeadline &&
    next.exitCode === null
  ) {
    try {
      const response = await globalThis.fetch(`${origin}/healthz`, {
        signal: globalThis.AbortSignal.timeout(2000),
      });
      await response.body?.cancel();
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* Owned Next is starting. */
    }
    await delay(100);
  }
  if (!healthy) next.kill("SIGTERM");
  check(healthy, "refreshed Next artifact serves the same fixture origin");
  console.log(`LOCAL_STOREFRONT_REBUILT ${origin}/en ownerPID=${process.pid}`);
}
