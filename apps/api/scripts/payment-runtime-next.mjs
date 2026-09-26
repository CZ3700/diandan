import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function createPaymentRuntimeNext(context) {
  const {
    workspaceRoot,
    origin,
    proxy,
    gateway,
    output,
    storefront,
    psp,
    check,
  } = context;
  let child,
    generation = 0,
    logWrites = Promise.resolve();
  const secrets = [
    context.database.password,
    context.identity.tokenPepper,
    ...Object.values(context.identity.credentials).flatMap((entry) => [
      entry.token,
      entry.csrf,
    ]),
  ].filter(Boolean);
  const binary = path.join(
    workspaceRoot,
    "apps/storefront/node_modules/next/dist/bin/next",
  );
  const cwd = path.join(workspaceRoot, "apps/storefront");
  const environment = paymentNextEnvironment(
    {
      origin,
      apiOrigin: proxy.origin,
      mediaOrigin: gateway.origin,
      pspOrigin: psp.origin,
    },
    process.env,
  );
  function attachLog(process_, file) {
    const write = (chunk) => {
      let value = chunk.toString();
      for (const secret of secrets)
        value = value.replaceAll(secret, "[REDACTED_SECRET]");
      logWrites = logWrites.then(() =>
        appendFile(path.join(output, file), value),
      );
    };
    process_.stdout.on("data", write);
    process_.stderr.on("data", write);
  }
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const owned = child;
      owned.kill("SIGTERM");
      await Promise.race([once(owned, "exit"), delay(5000)]);
      if (owned.exitCode === null && owned.signalCode === null) {
        owned.kill("SIGKILL");
        await once(owned, "exit");
      }
    }
    child = undefined;
    await logWrites;
  }
  async function start() {
    await stop();
    generation++;
    const build = spawn(process.execPath, [binary, "build"], {
      cwd,
      env: {
        ...environment,
        NODE_ENV: "production",
        FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
        FAN_SUPPORT_SITE_ORIGIN: "https://localhost:3443",
        FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://api:3002",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Redacted build output; .txt lets the regression collector keep it for CI diagnosis.
    attachLog(build, `next-build-${generation}.txt`);
    const [code] = await once(build, "exit");
    await logWrites;
    check(
      code === 0,
      "Payment UI is compiled from the current exact production source",
    );
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const internalOrigin = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [binary, "start", "--hostname", "127.0.0.1", "--port", String(port)],
      { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    attachLog(child, `next-runtime-${generation}.log`);
    storefront.attach(internalOrigin);
    const deadline = globalThis.performance.now() + 90_000;
    let ready = false;
    do {
      try {
        const response = await globalThis.fetch(internalOrigin + "/healthz", {
          signal: globalThis.AbortSignal.timeout(2000),
        });
        await response.body?.cancel();
        if (response.status === 200) {
          ready = true;
          break;
        }
      } catch {
        /* Owned process is still starting. */
      }
      await delay(200);
    } while (
      child.exitCode === null &&
      globalThis.performance.now() < deadline
    );
    check(ready, "Owned production Next serves its actual health route");
    const response = await context.tls.fetcher(origin + "/healthz");
    await response.body?.cancel();
    check(
      response.status === 200,
      "Strict configured HTTPS storefront gateway reaches the owned compiled Next",
    );
  }
  return { start, stop };
}

export function paymentNextEnvironment(
  { origin, apiOrigin, mediaOrigin, pspOrigin },
  inherited = {},
) {
  const environment = Object.fromEntries(
    Object.entries(inherited).filter(
      ([key]) => !key.startsWith("FAN_SUPPORT_"),
    ),
  );
  Object.assign(environment, {
    NODE_ENV: "test",
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    FAN_SUPPORT_SITE_ORIGIN: origin,
    FAN_SUPPORT_INTERNAL_API_ORIGIN: apiOrigin,
    FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: mediaOrigin,
    FAN_SUPPORT_STOREFRONT_NAME: "FAN SUPPORT",
    FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON: JSON.stringify([pspOrigin]),
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `${environment.NODE_OPTIONS ?? ""} --import=${new globalThis.URL("./storefront-test-dns.mjs", import.meta.url).href}`,
  });
  return environment;
}
