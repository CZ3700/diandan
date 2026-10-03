import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import path from "node:path";
import {
  productionAdminEnvironment,
  reserveOwnedOrigin,
  startOwnedTlsProxy,
} from "./production-admin-oidc-fixture.mjs";

/** Serve the already-built Admin with next start. Never compile or touch an existing runtime. */
export async function startProductionAdminNext(input) {
  const environment = productionAdminEnvironment(input);
  const backendPort = new URL(await reserveOwnedOrigin("admin")).port;
  const child = spawn(
    process.execPath,
    [
      "--import",
      new URL("./production-admin-oidc-dns.mjs", import.meta.url).href,
      path.join(
        input.workspaceRoot,
        "apps/admin/node_modules/next/dist/bin/next",
      ),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      backendPort,
    ],
    {
      cwd: path.join(input.workspaceRoot, "apps/admin"),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.once("error", () => input.logs.push("OWNED_NEXT_SPAWN_FAILED"));
  // Collected only in RAM for the final credential scan; never persist native output.
  child.stdout.on("data", (chunk) => input.logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => input.logs.push(String(chunk)));
  let proxy, stopping;
  const stop = () =>
    (stopping ??= (async () => {
      try {
        await proxy?.stop();
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
          await Promise.race([closed, delay(5000)]);
          if (child.exitCode === null && child.signalCode === null)
            child.kill("SIGKILL");
        }
        await closed;
      }
    })());
  try {
    proxy = await startOwnedTlsProxy({
      origin: input.adminOrigin,
      target: `http://127.0.0.1:${backendPort}`,
    });
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        const response = await proxy.fetch(`${input.adminOrigin}/healthz`);
        await response.body?.cancel();
        if (response.ok) return { pin: proxy.pin, fetch: proxy.fetch, stop };
      } catch {
        /* Next is still starting. */
      }
      if (child.exitCode !== null || child.signalCode !== null) break;
      await delay(250);
    }
    throw new Error("Formal Admin Next did not become ready");
  } catch (error) {
    await stop();
    throw error;
  }
}

/** Actual next start must fail its instrumentation validation before health becomes ready. */
export async function verifyInvalidProductionAdminStart(input, check) {
  const results = [];
  const local = input.mode === "LOCAL_ACCOUNT";
  const loginRoute = local
    ? "/api/admin/local-auth/login"
    : "/api/admin/auth/begin";
  for (const [name, patch] of [
    ["missing-key", { FAN_SUPPORT_ADMIN_ACCESS_KEY: undefined }],
    ["http-api", { FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://127.0.0.1:1" }],
  ]) {
    const env = { ...productionAdminEnvironment(input), ...patch };
    const port = new URL(await reserveOwnedOrigin("admin")).port;
    const child = spawn(
      process.execPath,
      [
        path.join(
          input.workspaceRoot,
          "apps/admin/node_modules/next/dist/bin/next",
        ),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        port,
      ],
      {
        cwd: path.join(input.workspaceRoot, "apps/admin"),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let outputText = "";
    const collect = (chunk) => {
      outputText = (outputText + String(chunk)).slice(-32000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let spawnError = false;
    child.once("error", () => {
      spawnError = true;
    });
    const closed = new Promise((resolve) => child.once("close", resolve));
    const observations = [];
    let proxy,
      exitCode,
      cookiesIssued = false;
    const expectedField =
      name === "missing-key"
        ? "FAN_SUPPORT_ADMIN_ACCESS_KEY"
        : "internalApiOrigin";
    try {
      proxy = await startOwnedTlsProxy({
        origin: input.adminOrigin,
        target: `http://127.0.0.1:${port}`,
      });
      for (let i = 0; i < 250; i++) {
        if (
          outputText.includes("ConfigValidationError") ||
          child.exitCode !== null ||
          child.signalCode !== null
        )
          break;
        await delay(100);
      }
      for (const route of ["/healthz", "/en", loginRoute]) {
        try {
          const response = await proxy.fetch(`${input.adminOrigin}${route}`, {
            signal: globalThis.AbortSignal.timeout(1500),
            ...(route === loginRoute
              ? {
                  method: "POST",
                  headers: {
                    origin: input.adminOrigin,
                    "content-type": local
                      ? "application/json"
                      : "application/x-www-form-urlencoded",
                    "sec-fetch-site": "same-origin",
                  },
                  body: local
                    ? JSON.stringify({
                        schemaVersion: 1,
                        locale: "en",
                        loginName: "unprovisioned.fixture",
                        password: "invalid-profile-fixture",
                      })
                    : "locale=en",
                }
              : {}),
          });
          cookiesIssued ||= (response.headers.get("set-cookie") ?? "").includes(
            "__Host-fan-admin-",
          );
          observations.push({ route, status: response.status });
          await response.body?.cancel();
        } catch {
          observations.push({ route, status: "UNAVAILABLE" });
        }
      }
      exitCode = child.exitCode;
    } finally {
      try {
        await proxy?.stop();
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await closed;
      }
    }
    const result = {
      name,
      spawnError,
      exitCode,
      instrumentationError: outputText.includes("instrumentation hook"),
      configError: outputText.includes("ConfigValidationError"),
      expectedField: outputText.includes(expectedField),
      cookiesIssued,
      observations,
    };
    results.push(result);
    check(
      !spawnError &&
        result.instrumentationError &&
        result.configError &&
        result.expectedField &&
        !cookiesIssued &&
        observations.length === 3 &&
        observations.every(
          (item) => item.status === "UNAVAILABLE" || item.status >= 500,
        ),
      `formal next start explicitly rejects ${name} and never serves health, page or login`,
    );
  }
  return results;
}
