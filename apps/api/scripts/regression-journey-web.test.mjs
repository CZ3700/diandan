import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  resolveInternalApiRuntimeConfig,
  resolveServerRuntimeConfig,
} from "@fan-support/config/server";
import { createLocalLifecycle } from "./local-experience-lifecycle.mjs";
import {
  regressionWebMode,
  startRegressionStorefront,
} from "./regression-journey-web.mjs";

const config = {
  environment: "LOCAL_TEST",
  instance: "test-regression-fixture",
  origins: { storefront: "https://storefront.example.invalid:7443" },
  ports: { storefront: 7443, storefrontBackend: 3443 },
};
const environment = {
  NODE_ENV: "development",
  FAN_SUPPORT_DEPLOYMENT_ENV: "development",
  FAN_SUPPORT_SITE_ORIGIN: config.origins.storefront,
  FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://127.0.0.1:3444",
  FAN_SUPPORT_ADMIN_MODE: "LOCAL_OIDC",
  FAN_SUPPORT_ADMIN_ACCESS_KEY: "private-administrator-key",
};

test("compiled regression mode is explicit and rejects ordinary instances before startup", () => {
  assert.equal(regressionWebMode(config, {}), "development");
  assert.equal(
    regressionWebMode(config, {
      FAN_SUPPORT_REGRESSION_WEB_MODE: "production",
    }),
    "production",
  );
  for (const invalid of [
    { ...config, instance: "acceptance-existing" },
    { ...config, environment: "PRODUCTION" },
  ])
    assert.throws(() =>
      regressionWebMode(invalid, {
        FAN_SUPPORT_REGRESSION_WEB_MODE: "production",
      }),
    );
  assert.throws(() =>
    regressionWebMode(config, {
      FAN_SUPPORT_REGRESSION_WEB_MODE: "unknown",
    }),
  );
});

function fixture({
  buildCode = 0,
  health = true,
  proxyFailure = false,
  spawnError = false,
  pendingBuild = false,
} = {}) {
  const lifecycle = createLocalLifecycle(),
    cancellation = new globalThis.AbortController(),
    commands = [],
    events = [];
  let reads = 0;
  const context = {
    config,
    workspaceRoot: "/owned-regression",
    environment,
    startupSignal: cancellation.signal,
    own: lifecycle.own,
    progress: () => {},
    fetcher: async () => {
      reads++;
      return { ok: health, body: { cancel: async () => {} } };
    },
  };
  const ports = {
    wait: async () => {},
    spawnProcess: (_binary, args, options) => {
      const child = new EventEmitter();
      Object.assign(child, {
        exitCode: null,
        signalCode: null,
        stdout: { resume() {} },
        stderr: { resume() {} },
        kill(signal) {
          events.push(`kill:${args[1]}`);
          child.signalCode = signal;
          globalThis.queueMicrotask(() => child.emit("close", null));
        },
      });
      commands.push({ args, options, child });
      if (args[1] === "build" && !pendingBuild)
        globalThis.queueMicrotask(() => {
          if (spawnError) {
            child.emit("error", new Error("private path"));
            child.emit("close", -1);
          } else {
            child.exitCode = buildCode;
            child.emit("close", buildCode);
          }
        });
      return child;
    },
    startProxy: async (options) => {
      events.push("proxy");
      assert.equal(options.target, "http://127.0.0.1:3443");
      if (proxyFailure) throw new Error("fixture proxy failed");
      options.own("fixture TLS", async () => {
        events.push("close:proxy");
      });
    },
  };
  return {
    lifecycle,
    commands,
    events,
    reads: () => reads,
    start: () =>
      lifecycle.start(() => startRegressionStorefront(context, ports)),
    stop: () => {
      cancellation.abort();
      return lifecycle.stop();
    },
  };
}

test("production compilation serves the existing TEST tier through owned strict TLS and cleans in reverse order", async () => {
  const f = fixture();
  await f.start();
  assert.deepEqual(
    f.commands.map((c) => c.args[1]),
    ["build", "start"],
  );
  const [build, runtime] = f.commands.map((c) => c.options.env);
  assert.equal(build.NODE_ENV, "production");
  assert.equal(
    resolveServerRuntimeConfig({ environment: build }).deploymentEnvironment,
    "preview",
  );
  assert.equal(
    resolveServerRuntimeConfig({ environment: runtime }).deploymentEnvironment,
    "test",
  );
  assert.equal(
    resolveInternalApiRuntimeConfig({ environment: runtime }).origin,
    "http://127.0.0.1:3444",
  );
  assert.equal(runtime.FAN_SUPPORT_ADMIN_MODE, "DISABLED");
  assert.equal(runtime.FAN_SUPPORT_ADMIN_ACCESS_KEY, undefined);
  assert.deepEqual(f.commands[1].args.slice(-4), [
    "--hostname",
    "127.0.0.1",
    "--port",
    "3443",
  ]);
  assert.equal(f.reads(), 1);
  assert.deepEqual(await f.lifecycle.stop(), []);
  assert.deepEqual(f.events, ["proxy", "close:proxy", "kill:start"]);
});

test("failed compilation never starts a server or proxy and remains cleanable", async () => {
  for (const options of [{ buildCode: 1 }, { spawnError: true }]) {
    const f = fixture(options);
    await assert.rejects(
      f.start(),
      /^Error: Regression storefront compilation failed$/,
    );
    assert.equal(f.commands.length, 1);
    assert.equal(f.reads(), 0);
    assert.deepEqual(await f.lifecycle.stop(), []);
  }
});

test("proxy and health failures retain ownership so partial startup is stopped", async () => {
  for (const options of [{ proxyFailure: true }, { health: false }]) {
    const f = fixture(options);
    await assert.rejects(f.start());
    assert.deepEqual(await f.lifecycle.stop(), []);
    assert.ok(f.events.includes("kill:start"));
    if (!options.proxyFailure) assert.ok(f.events.includes("close:proxy"));
  }
});

test("stop during a pending compilation terminates the build and never starts the server or proxy", async () => {
  const f = fixture({ pendingBuild: true });
  const startup = f.start().catch(() => "CANCELLED");
  await Promise.resolve();
  const stopped = f.stop();
  const completed = await Promise.race([
    stopped.then(() => true),
    delay(100, false),
  ]);
  if (!completed) {
    // Release the intentionally stalled test fixture after observing the broken wait cycle.
    f.commands[0].child.exitCode = 0;
    f.commands[0].child.emit("close", 0);
    await stopped;
  }
  assert.equal(completed, true, "shutdown must interrupt the startup barrier");
  assert.equal(await startup, "CANCELLED");
  assert.deepEqual(
    f.commands.map((command) => command.args[1]),
    ["build"],
  );
  assert.deepEqual(f.events, ["kill:build"]);
  assert.equal(f.reads(), 0);
});
