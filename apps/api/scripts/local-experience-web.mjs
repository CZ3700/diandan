import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { preserveManagementNextDeclarations } from "./management-center-runtime-config.mjs";
import { createLocalExperienceFetch } from "./local-experience-services-common.mjs";
import { localServicePorts } from "./local-experience-config.mjs";
import { localStorefrontIdentity } from "./local-experience-web-config.mjs";
import {
  regressionWebMode,
  startRegressionStorefront,
} from "./regression-journey-web.mjs";

export async function startLocalWeb(context) {
  const { config, workspaceRoot, own, progress } = context;
  const mode = regressionWebMode(config, process.env);
  await preserveManagementNextDeclarations(workspaceRoot, own);
  const fetcher = await createLocalExperienceFetch({
    origins: Object.values(config.origins),
    caCertificatePath: config.tls.caCertificatePath,
    ports: localServicePorts(config),
  });
  for (const app of ["storefront", "admin"]) {
    const port = config.ports[app],
      origin = config.origins[app];
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("FAN_SUPPORT_"),
      ),
    );
    Object.assign(env, {
      ...localStorefrontIdentity(process.env),
      NODE_ENV: "development",
      FAN_SUPPORT_DEPLOYMENT_ENV: "development",
      FAN_SUPPORT_SITE_ORIGIN: origin,
      FAN_SUPPORT_INTERNAL_API_ORIGIN: `http://127.0.0.1:${config.ports.api}`,
      FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: config.origins.media,
      FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON: JSON.stringify([
        config.origins.psp,
      ]),
      FAN_SUPPORT_ADMIN_MODE: "LOCAL_OIDC",
      FAN_SUPPORT_ADMIN_ACCESS_KEY: Buffer.from(
        config.secrets.accessKey,
        "base64url",
      ).toString("hex"),
      FAN_SUPPORT_ADMIN_OIDC_ISSUER: config.origins.oidc,
      FAN_SUPPORT_STOREFRONT_ORIGIN: config.origins.storefront,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${new URL("./local-experience-dns.mjs", import.meta.url).href}`,
    });
    if (app === "storefront" && mode === "production") {
      await startRegressionStorefront({
        ...context,
        environment: env,
        fetcher,
      });
      continue;
    }
    const child = spawn(
      process.execPath,
      [
        path.join(
          workspaceRoot,
          "apps",
          app,
          "node_modules/next/dist/bin/next",
        ),
        "dev",
        "--hostname",
        new URL(origin).hostname,
        "--port",
        String(port),
        "--experimental-https",
        "--experimental-https-key",
        config.tls.privateKeyPath,
        "--experimental-https-cert",
        config.tls.certificatePath,
        "--experimental-https-ca",
        config.tls.caCertificatePath,
      ],
      {
        cwd: path.join(workspaceRoot, "apps", app),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    // Request logs may contain login codes. Consume them without writing or displaying.
    child.stdout.resume();
    child.stderr.resume();
    const closed = new Promise((resolve) => child.once("close", resolve));
    own(app + " Next", async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await Promise.race([closed, delay(5000)]);
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }
      await closed;
    });
    let ready = false;
    for (let i = 0; i < 180; i++) {
      try {
        const result = await fetcher(origin + "/healthz");
        await result.body?.cancel();
        if (result.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Next startup. */
      }
      if (child.exitCode !== null) break;
      await delay(500);
    }
    if (!ready) throw new Error(app + " did not become healthy");
    progress(app + " ready");
  }
}
