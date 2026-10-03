import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { localServiceTarget } from "./local-experience-config.mjs";
import { startLocalProxy } from "./local-experience-tls.mjs";

/**
 * The compiled applications run in the test tier. The storefront keeps only the public admin
 * origin its preview embedding needs, never the administrative credentials.
 */
export function prebuiltWebEnvironment(app, environment) {
  const runtime = {
    ...Object.fromEntries(
      Object.entries(environment).filter(([key]) =>
        app === "admin"
          ? key !== "FAN_SUPPORT_ADMIN_OIDC_ISSUER"
          : key === "FAN_SUPPORT_ADMIN_ORIGIN" ||
            !key.startsWith("FAN_SUPPORT_ADMIN_"),
      ),
    ),
    NODE_ENV: "test",
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
  };
  if (app === "storefront") runtime.FAN_SUPPORT_ADMIN_MODE = "DISABLED";
  return runtime;
}

/**
 * next start on the app's private backend port, with the instance's own TLS proxy on the address
 * the development server used to hold. Never compiles; the supervisor checked the build stamp.
 */
export async function startPrebuiltApp(context, app, environment, supplied) {
  const ports = {
    spawnProcess: spawn,
    startProxy: startLocalProxy,
    wait: delay,
    ...supplied,
  };
  const { config, workspaceRoot, own, progress, fetcher } = context;
  if (config.webMode !== "PREBUILT" || config.adminSignIn !== "LOCAL_ACCOUNT")
    throw new Error("Compiled web requires built-in accounts");
  const backend = config.ports[`${app}Backend`],
    origin = config.origins[app],
    target = localServiceTarget(config, app),
    cwd = path.join(workspaceRoot, "apps", app);
  const child = ports.spawnProcess(
    process.execPath,
    [
      path.join(cwd, "node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(backend),
    ],
    {
      cwd,
      env: prebuiltWebEnvironment(app, environment),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // Raw output can contain order links or login codes: only structured events are kept.
  ports.eventLog.attach(child.stdout);
  ports.eventLog.attach(child.stderr);
  let spawnFailed = false;
  child.once("error", () => {
    spawnFailed = true;
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  const running = () =>
    !spawnFailed && child.exitCode === null && child.signalCode === null;
  own(`${app} compiled Next`, async () => {
    if (running()) {
      child.kill("SIGTERM");
      await Promise.race([closed, ports.wait(5000)]);
      if (running()) child.kill("SIGKILL");
    }
    await closed;
  });
  await ports.startProxy({
    config,
    address: target.address,
    port: target.port,
    origin,
    target: `http://127.0.0.1:${backend}`,
    own,
    name: `${app} TLS`,
  });
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      const response = await fetcher(origin + "/healthz");
      await response.body?.cancel();
      if (response.ok) {
        progress(`${app} ready (compiled)`);
        return;
      }
    } catch {
      /* next start is still binding. */
    }
    if (!running()) break;
    await ports.wait(500);
  }
  throw new Error(`${app} did not become healthy`);
}
