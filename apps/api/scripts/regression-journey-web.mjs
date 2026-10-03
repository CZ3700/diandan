import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startLocalProxy } from "./local-experience-tls.mjs";

/** Opt-in for owned regression instances; ordinary local experience remains development. */
export function regressionWebMode(config, environment) {
  const mode = environment.FAN_SUPPORT_REGRESSION_WEB_MODE;
  if (mode === undefined) return "development";
  if (
    mode !== "production" ||
    config.environment !== "LOCAL_TEST" ||
    !/^test-regression-[a-z0-9-]+$/u.test(config.instance) ||
    config.instance.length > 32
  )
    throw new Error("Compiled regression web requires an owned TEST instance");
  return mode;
}

function ownedNext(context, args, environment, ports) {
  const { workspaceRoot, own, startupSignal } = context;
  const child = ports.spawnProcess(
    process.execPath,
    [
      path.join(
        workspaceRoot,
        "apps/storefront/node_modules/next/dist/bin/next",
      ),
      ...args,
    ],
    {
      cwd: path.join(workspaceRoot, "apps/storefront"),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // Even failed navigation can contain private order links. Never persist raw Next output.
  child.stdout.resume();
  child.stderr.resume();
  let spawnFailed = false;
  child.once("error", () => {
    spawnFailed = true;
  });
  const closed = new Promise((resolve) =>
    child.once("close", (code) => resolve(spawnFailed ? null : code)),
  );
  const running = () =>
    !spawnFailed && child.exitCode === null && child.signalCode === null;
  let stopping;
  const stop = () =>
    (stopping ??= (async () => {
      if (running()) {
        child.kill("SIGTERM");
        await Promise.race([closed, ports.wait(5000)]);
        if (running()) child.kill("SIGKILL");
      }
      await closed;
    })());
  const cancel = () => {
    void stop();
  };
  startupSignal?.addEventListener("abort", cancel, { once: true });
  void closed.then(() => startupSignal?.removeEventListener("abort", cancel));
  own(`regression storefront ${args[0]}`, stop);
  if (startupSignal?.aborted) cancel();
  return { closed, running };
}

function checkStarting(signal) {
  if (signal?.aborted)
    throw new Error("Regression storefront startup cancelled");
}

/** Compile the actual storefront, then serve it in the existing isolated TEST runtime tier. */
export async function startRegressionStorefront(context, supplied = {}) {
  const ports = {
    spawnProcess: spawn,
    startProxy: startLocalProxy,
    wait: delay,
    ...supplied,
  };
  const { config, environment, fetcher, progress, own, startupSignal } =
    context;
  regressionWebMode(config, { FAN_SUPPORT_REGRESSION_WEB_MODE: "production" });
  checkStarting(startupSignal);
  const runtime = {
    ...Object.fromEntries(
      Object.entries(environment).filter(
        // Preview needs its public embedding origin, never the administrative credentials.
        ([key]) =>
          key === "FAN_SUPPORT_ADMIN_ORIGIN" ||
          !key.startsWith("FAN_SUPPORT_ADMIN_"),
      ),
    ),
    NODE_ENV: "test",
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    FAN_SUPPORT_ADMIN_MODE: "DISABLED",
  };
  progress("compiling regression storefront");
  const build = ownedNext(
    context,
    ["build"],
    {
      ...runtime,
      NODE_ENV: "production",
      // Existing preview build contract, also used by payment-runtime-next.mjs.
      // Its API origin is exact-match validated by @fan-support/config.
      // Runtime origins below remain those allocated to this owned TEST instance.
      FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
      FAN_SUPPORT_SITE_ORIGIN: "https://localhost:3443",
      FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://api:3002",
    },
    ports,
  );
  const buildCode = await build.closed;
  checkStarting(startupSignal);
  if (buildCode !== 0)
    throw new Error("Regression storefront compilation failed");
  const server = ownedNext(
    context,
    [
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(config.ports.storefrontBackend),
    ],
    runtime,
    ports,
  );
  await ports.startProxy({
    config,
    port: config.ports.storefront,
    origin: config.origins.storefront,
    target: `http://127.0.0.1:${config.ports.storefrontBackend}`,
    own,
    name: "regression storefront TLS",
  });
  for (let attempt = 0; attempt < 180; attempt++) {
    checkStarting(startupSignal);
    try {
      const response = await fetcher(config.origins.storefront + "/healthz");
      await response.body?.cancel();
      checkStarting(startupSignal);
      if (response.ok) {
        progress("production-compiled TEST storefront ready");
        return;
      }
    } catch {
      /* Owned Next is still starting. */
    }
    if (!server.running()) break;
    await ports.wait(500);
  }
  throw new Error("Compiled regression storefront did not become healthy");
}
