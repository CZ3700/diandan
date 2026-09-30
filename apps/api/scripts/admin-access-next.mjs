import { URL, pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { request } from "node:https";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTestTlsMaterial } from "../../../packages/identity-oidc/src/test-support/https-idp.mjs";
import { startLocalProxy } from "./local-experience-tls.mjs";

export async function reserveAdminAccessOrigin() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return `https://admin.example.invalid:${port}`;
}
export async function startAdminAccessNext({
  workspaceRoot,
  adminOrigin,
  apiOrigin,
  issuer,
  accessKey,
  logs,
  // LOCAL_ACCOUNT (ADR-021) needs no identity provider.
  mode = "LOCAL_OIDC",
  // The compiled admin (already built) in the test tier behind a TLS proxy, as on stg PREBUILT.
  compiled = false,
}) {
  if (compiled && mode !== "LOCAL_ACCOUNT")
    throw new Error("The compiled test-tier admin runs built-in accounts only");
  const tls = createTestTlsMaterial(new URL(adminOrigin).hostname);
  const declaration = path.join(workspaceRoot, "apps/admin/next-env.d.ts"),
    before = await readFile(declaration, "utf8");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("FAN_SUPPORT_"),
    ),
  );
  Object.assign(environment, {
    NODE_ENV: compiled ? "test" : "development",
    FAN_SUPPORT_DEPLOYMENT_ENV: compiled ? "test" : "development",
    FAN_SUPPORT_SITE_ORIGIN: adminOrigin,
    FAN_SUPPORT_INTERNAL_API_ORIGIN: apiOrigin,
    FAN_SUPPORT_ADMIN_MODE: mode,
    FAN_SUPPORT_ADMIN_ACCESS_KEY: accessKey,
    ...(issuer === undefined ? {} : { FAN_SUPPORT_ADMIN_OIDC_ISSUER: issuer }),
    NEXT_TELEMETRY_DISABLED: "1",
  });
  const backendPort = compiled
    ? new URL(await reserveAdminAccessOrigin()).port
    : undefined;
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(
        path.join(workspaceRoot, "apps/api/scripts/admin-access-test-dns.mjs"),
      ).href,
      path.join(workspaceRoot, "apps/admin/node_modules/next/dist/bin/next"),
      ...(compiled
        ? ["start", "--hostname", "127.0.0.1", "--port", backendPort]
        : [
            "dev",
            "--hostname",
            new URL(adminOrigin).hostname,
            "--port",
            new URL(adminOrigin).port,
            "--experimental-https",
            "--experimental-https-key",
            tls.keyPath,
            "--experimental-https-cert",
            tls.certPath,
          ]),
    ],
    {
      cwd: path.join(workspaceRoot, "apps/admin"),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.on("error", () => logs.push("LOCAL_NEXT_PROCESS_ERROR"));
  // Keep complete native logs in memory for canary assertions; never persist raw credentials.
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  const proxies = [];
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    for (const close of proxies) await close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([closed, delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await closed;
      }
    }
    await closed;
    tls.cleanup();
    const after = await readFile(declaration, "utf8");
    if (
      after.replaceAll(".next/dev/types/", ".next/types/") ===
      before.replaceAll(".next/dev/types/", ".next/types/")
    )
      await writeFile(declaration, before);
  }
  const probe = () =>
    new Promise((resolve, reject) => {
      const req = request(
        `${adminOrigin}/healthz`,
        {
          hostname: "127.0.0.1",
          servername: new URL(adminOrigin).hostname,
          ca: tls.cert,
          timeout: 2000,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy());
      req.end();
    });
  try {
    if (compiled)
      await startLocalProxy({
        config: {
          tls: { certificatePath: tls.certPath, privateKeyPath: tls.keyPath },
        },
        port: Number(new URL(adminOrigin).port),
        origin: adminOrigin,
        target: `http://127.0.0.1:${backendPort}`,
        own: (_name, close) => proxies.push(close),
        name: "compiled admin TLS",
      });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        if (await probe()) return { stop };
      } catch {
        /* Owned Next process is still starting. */
      }
      await delay(250);
    }
    throw new Error("Local admin HTTPS did not start");
  } catch (error) {
    await stop();
    throw error;
  }
}
