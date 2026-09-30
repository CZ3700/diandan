import { acquireLocalWorkspaceLock } from "../../../scripts/local-experience-lock.mjs";
import { probeLocalApplications } from "./local-experience-health.mjs";
import { createServer } from "node:http";
import { readFile, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createLocalLifecycle } from "./local-experience-lifecycle.mjs";
import { localControlAuthorized } from "./local-experience-control.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadLocalState,
  writePrivateJson,
} from "../../../scripts/local-experience-state.mjs";
import { startLocalInfrastructure } from "./local-experience-infrastructure.mjs";
import {
  bootstrapLocalBusiness,
  bootstrapLocalPolicies,
} from "./local-experience-bootstrap.mjs";
import { startLocalExperienceServices } from "./local-experience-services.mjs";
import { startLocalWeb } from "./local-experience-web.mjs";
import {
  assertPrebuiltWebCurrent,
  workspaceRevision,
} from "./local-experience-web-build.mjs";
import { startLocalMedia } from "./local-experience-media.mjs";
import { startLocalHomepageBootstrap } from "./local-experience-homepage.mjs";
import { Client } from "pg";
// Rolled-back writes report only SQLSTATE, trigger function and constraint names.
const query = Client.prototype.query;
Client.prototype.query = function (...args) {
  const result = query.apply(this, args);
  if (!result?.catch) return result;
  return result.catch((error) => {
    const name = (value) =>
      /^[a-z_][a-z_0-9]{0,127}$/u.test(value ?? "") ? value : null;
    process.stdout.write(
      JSON.stringify({
        postgresFailure: {
          code: /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : null,
          guard: name(
            /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(
              error?.where ?? "",
            )?.[1],
          ),
          constraint: name(error?.constraint),
        },
      }) + "\n",
    );
    throw error;
  });
};
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const state = await loadLocalState(workspaceRoot, process.argv[2] ?? "default"),
  { config, stateDirectory } = state;
const lock = path.join(stateDirectory, "supervisor.lock"),
  runId = randomUUID(),
  lifecycle = createLocalLifecycle(),
  startupCancellation = new globalThis.AbortController();
let ready = false,
  stage = "starting";
const own = (name, close) => lifecycle.own(name, close);
const progress = (value) => {
  stage = value;
  process.stdout.write(JSON.stringify({ stage }) + "\n");
};
const context = {
  ...state,
  workspaceRoot,
  own,
  progress,
  startupSignal: startupCancellation.signal,
};
try {
  await writeFile(
    lock,
    JSON.stringify({
      schemaVersion: 1,
      instanceId: config.instanceId,
      runId,
      pid: process.pid,
    }),
    { mode: 0o600, flag: "wx" },
  );
} catch {
  throw new Error("An owned supervisor lock already exists");
}
const control = createServer(async (request, response) => {
  if (!localControlAuthorized(request, config.secrets.controlToken)) {
    response.writeHead(404).end();
    return;
  }
  if (request.method === "GET" && request.url === "/status") {
    const health = ready
      ? await probeLocalApplications(config)
      : { ready: false, services: {} };
    response
      .writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      .end(
        JSON.stringify({
          schemaVersion: 1,
          instanceId: config.instanceId,
          runId,
          pid: process.pid,
          ready: health.ready,
          services: health.services,
          stage: ready && !health.ready ? "degraded" : stage,
          origins: config.origins,
        }),
      );
    return;
  }
  if (request.method === "POST" && request.url === "/stop") {
    response.writeHead(202).end();
    void shutdown();
    return;
  }
  response.writeHead(404).end();
});
let shutdownPromise;
function shutdown() {
  return (shutdownPromise ??= (async () => {
    ready = false;
    startupCancellation.abort();
    const failures = await lifecycle.stop();
    await writePrivateJson(path.join(stateDirectory, "last-run.json"), {
      schemaVersion: 1,
      instanceId: config.instanceId,
      runId,
      stopped: true,
      cleanupFailures: failures,
    });
    control.closeAllConnections();
    await new Promise((resolve) => control.close(resolve));
    if (
      failures.length === 0 &&
      JSON.parse(await readFile(lock, "utf8")).runId === runId
    )
      await rm(lock);
    process.exit(failures.length ? 1 : 0);
  })());
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
const startup = lifecycle.start(async () => {
  own(
    "workspace runtime ownership",
    await acquireLocalWorkspaceLock(path.dirname(stateDirectory), {
      instance: config.instance,
      instanceId: config.instanceId,
      runId,
      pid: process.pid,
    }),
  );
  lifecycle.checkStarting();
  // Holding the checkout: no build can run now, and a missing or stale one fails before any process.
  if (config.webMode === "PREBUILT")
    await assertPrebuiltWebCurrent(
      workspaceRoot,
      await workspaceRevision(workspaceRoot),
    );
  await new Promise((resolve, reject) => {
    control.once("error", reject);
    control.listen(config.ports.control, "127.0.0.1", resolve);
  });
  lifecycle.checkStarting();
  progress("persistent PostgreSQL and media");
  Object.assign(context, await startLocalInfrastructure(context));
  lifecycle.checkStarting();
  progress("one-time TEST business setup");
  context.business = await bootstrapLocalBusiness(context);
  lifecycle.checkStarting();
  progress("local identity, hosted TEST payment and private mail");
  context.services = await startLocalExperienceServices(context);
  lifecycle.checkStarting();
  await startLocalMedia(context);
  lifecycle.checkStarting();
  const { startLocalExperienceRuntime } =
    await import("./local-experience-runtime.mjs");
  progress("API and Worker");
  context.runtime = await startLocalExperienceRuntime(context);
  lifecycle.checkStarting();
  context.business = await bootstrapLocalPolicies({
    ...context,
    base: `http://127.0.0.1:${config.ports.api}`,
  });
  lifecycle.checkStarting();
  await startLocalHomepageBootstrap(context);
  lifecycle.checkStarting();
  await startLocalWeb(context);
  lifecycle.checkStarting();
  stage = "ready";
  ready = true;
  progress("ready");
});
try {
  await startup;
} catch (error) {
  // No raw responses, configuration values or token-bearing URLs in process logs.
  process.stderr.write(
    JSON.stringify({
      outcome: "FAIL",
      stage,
      errorName: error.name,
      code: error.code ?? error.cause?.code ?? null,
      message: String(error.message).slice(0, 240),
    }) + "\n",
  );
  await shutdown();
}
