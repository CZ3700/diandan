import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  resolveAdminRuntimeConfig,
  resolveInternalApiRuntimeConfig,
  resolveServerRuntimeConfig,
  resolveStorefrontPreviewConfig,
} from "@fan-support/config/server";
import { createLocalLifecycle } from "./local-experience-lifecycle.mjs";
import {
  prebuiltWebEnvironment,
  startPrebuiltApp,
} from "./local-experience-web-prebuilt.mjs";

const config = {
  environment: "LOCAL_TEST",
  instance: "stg",
  adminSignIn: "LOCAL_ACCOUNT",
  webMode: "PREBUILT",
  exposure: { mode: "PUBLIC", baseDomain: "stg.example.com" },
  origins: {
    storefront: "https://storefront.stg.example.com",
    admin: "https://admin.stg.example.com",
  },
  ports: {
    storefront: 41001,
    admin: 41002,
    storefrontBackend: 41011,
    adminBackend: 41012,
  },
};
// What local-experience-web.mjs builds for the development servers today.
const development = {
  PATH: "/usr/bin",
  NODE_ENV: "development",
  FAN_SUPPORT_DEPLOYMENT_ENV: "development",
  FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://127.0.0.1:41020",
  FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
    "https://media.stg.example.com",
  FAN_SUPPORT_ADMIN_ORIGIN: config.origins.admin,
  FAN_SUPPORT_ADMIN_MODE: "LOCAL_ACCOUNT",
  FAN_SUPPORT_ADMIN_ACCESS_KEY: "d".repeat(64),
  FAN_SUPPORT_ADMIN_OIDC_ISSUER: "https://oidc.stg.example.com",
  FAN_SUPPORT_STOREFRONT_ORIGIN: config.origins.storefront,
};
const environmentFor = (app) => ({
  ...development,
  FAN_SUPPORT_SITE_ORIGIN: config.origins[app],
});

test("compiled applications run in the test tier; the storefront never receives admin credentials", () => {
  const storefront = prebuiltWebEnvironment(
    "storefront",
    environmentFor("storefront"),
  );
  assert.equal(storefront.NODE_ENV, "test");
  assert.equal(
    resolveServerRuntimeConfig({ environment: storefront })
      .deploymentEnvironment,
    "test",
  );
  assert.deepEqual(
    Object.keys(storefront)
      .filter((key) => key.startsWith("FAN_SUPPORT_ADMIN_"))
      .sort(),
    ["FAN_SUPPORT_ADMIN_MODE", "FAN_SUPPORT_ADMIN_ORIGIN"],
  );
  assert.equal(storefront.FAN_SUPPORT_ADMIN_MODE, "DISABLED");
  assert.equal(
    resolveStorefrontPreviewConfig({ environment: storefront }).adminOrigin,
    config.origins.admin,
  );
  assert.equal(storefront.PATH, "/usr/bin");

  const admin = prebuiltWebEnvironment("admin", environmentFor("admin"));
  assert.equal(admin.NODE_ENV, "test");
  assert.deepEqual(resolveAdminRuntimeConfig({ environment: admin }), {
    schemaVersion: 1,
    mode: "LOCAL_ACCOUNT",
    siteOrigin: config.origins.admin,
    internalApiOrigin: "http://127.0.0.1:41020",
    adminAccessKey: "d".repeat(64),
  });
  assert.equal(
    resolveInternalApiRuntimeConfig({ environment: admin }).origin,
    "http://127.0.0.1:41020",
  );
  assert.equal(admin.FAN_SUPPORT_ADMIN_OIDC_ISSUER, undefined);
  // The supplied environment is never mutated.
  assert.equal(development.NODE_ENV, "development");
});

function fixture({ health = true, exitEarly = false } = {}) {
  const lifecycle = createLocalLifecycle(),
    commands = [],
    events = [],
    attached = [];
  let reads = 0;
  const context = {
    config,
    workspaceRoot: "/home/xiadan/app",
    own: lifecycle.own,
    progress: (value) => events.push(`progress:${value}`),
    fetcher: async (url) => {
      reads++;
      events.push(`health:${url}`);
      return { ok: health, body: { cancel: async () => {} } };
    },
  };
  const ports = {
    wait: async () => {},
    eventLog: { attach: (stream) => attached.push(stream) },
    spawnProcess: (_binary, args, options) => {
      const child = new EventEmitter();
      Object.assign(child, {
        exitCode: exitEarly ? 1 : null,
        signalCode: null,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill(signal) {
          events.push(`kill:${options.cwd}`);
          child.signalCode = signal;
          globalThis.queueMicrotask(() => child.emit("close", null));
        },
      });
      commands.push({ args, options });
      if (exitEarly) globalThis.queueMicrotask(() => child.emit("close", 1));
      return child;
    },
    startProxy: async (options) => {
      events.push(
        `proxy:${options.address}:${options.port}->${options.target}`,
      );
      options.own("fixture TLS", async () => events.push("close:proxy"));
    },
  };
  return {
    lifecycle,
    commands,
    events,
    attached,
    reads: () => reads,
    start: (app) =>
      lifecycle.start(() =>
        startPrebuiltApp(context, app, environmentFor(app), ports),
      ),
  };
}

test("the compiled app is started, never built, behind a TLS proxy on its public loopback address", async () => {
  for (const [app, address, backend] of [
    ["storefront", "127.0.0.2", 41011],
    ["admin", "127.0.0.3", 41012],
  ]) {
    const f = fixture();
    await f.start(app);
    assert.equal(f.commands.length, 1);
    const [{ args, options }] = f.commands;
    assert.match(
      args[0],
      /apps[\\/]+[a-z]+[\\/]+node_modules[\\/]+next[\\/]+dist[\\/]+bin[\\/]+next$/u,
    );
    assert.deepEqual(args.slice(1), [
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(backend),
    ]);
    assert.match(options.cwd, new RegExp(`apps[\\\\/]+${app}$`, "u"));
    assert.equal(options.env.NODE_ENV, "test");
    assert.ok(
      f.events.includes(`proxy:${address}:443->http://127.0.0.1:${backend}`),
    );
    assert.ok(f.events.includes(`health:${config.origins[app]}/healthz`));
    // Both output streams feed the private structured event log; nothing else keeps them.
    assert.equal(f.attached.length, 2);
    assert.deepEqual(await f.lifecycle.stop(), []);
    assert.deepEqual(f.events.slice(-2), [
      "close:proxy",
      `kill:${options.cwd}`,
    ]);
  }
});

test("an unhealthy or exited compiled app fails startup and remains cleanable", async () => {
  for (const options of [{ health: false, exitEarly: true }]) {
    const f = fixture(options);
    await assert.rejects(f.start("admin"), /admin did not become healthy/u);
    assert.deepEqual(await f.lifecycle.stop(), []);
  }
});

test("the compiled mode refuses instances without built-in accounts", async () => {
  const f = fixture();
  await assert.rejects(
    f.lifecycle.start(() =>
      startPrebuiltApp(
        {
          config: { ...config, adminSignIn: "LOCAL_OIDC" },
          workspaceRoot: "/w",
          own: f.lifecycle.own,
          progress: () => {},
          fetcher: async () => ({ ok: true, body: null }),
        },
        "admin",
        environmentFor("admin"),
        {},
      ),
    ),
    /built-in accounts/u,
  );
  assert.equal(f.commands.length, 0);
});
