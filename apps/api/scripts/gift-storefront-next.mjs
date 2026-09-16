import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** This gateway injects transport errors only. Successful business responses come from the actual API. */
export async function createGiftStorefrontFaultGateway(
  base,
  { observer, captureObserver } = {},
) {
  function observe(captured, event) {
    try {
      captured?.(event);
    } catch {
      /* Diagnostics cannot change the original transport result. */
    }
  }
  let failurePath = null;
  const server = createServer(async (request, response) => {
    let captured = observer;
    try {
      captured = captureObserver?.() ?? observer;
    } catch {
      /* Optional observation must not interfere with forwarding. */
    }
    const url = new globalThis.URL(request.url, base);
    if (failurePath && url.pathname.startsWith(failurePath)) {
      response.writeHead(503, { "cache-control": "no-store" }).end();
      observe(captured, { url, phase: "GATEWAY_FAULT", status: 503 });
      return;
    }
    try {
      const upstream = await globalThis.fetch(url, {
        redirect: "manual",
        signal: globalThis.AbortSignal.timeout(30_000),
      });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      const bytes = Buffer.from(await upstream.arrayBuffer());
      response.end(bytes);
      observe(captured, {
        url,
        phase: "GATEWAY_RESPONSE",
        status: upstream.status,
        bytes,
      });
    } catch (error) {
      response.writeHead(503, { "cache-control": "no-store" }).end();
      observe(captured, {
        url,
        phase: "GATEWAY_TRANSPORT_ERROR",
        status: 503,
        error,
      });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    setFailure(value) {
      failurePath = value;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

/** Retains the exact child handle; never identifies or stops unrelated listeners. */
export function createGiftStorefrontNext({
  workspaceRoot,
  origin,
  proxy,
  gateway,
  output,
  production,
  secrets,
  check,
}) {
  let child = null;
  let generation = 0;
  const binary = path.join(
    workspaceRoot,
    "apps/storefront/node_modules/next/dist/bin/next",
  );
  const cwd = path.join(workspaceRoot, "apps/storefront");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("FAN_SUPPORT_"),
    ),
  );
  Object.assign(environment, {
    NODE_ENV: production ? "test" : "development",
    FAN_SUPPORT_DEPLOYMENT_ENV: production ? "test" : "development",
    FAN_SUPPORT_SITE_ORIGIN: origin,
    FAN_SUPPORT_INTERNAL_API_ORIGIN: proxy.origin,
    FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: gateway.origin,
    FAN_SUPPORT_STOREFRONT_NAME: "FAN SUPPORT",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `${environment.NODE_OPTIONS ?? ""} --import=${new globalThis.URL("./storefront-test-dns.mjs", import.meta.url).href}`,
  });
  function logTo(process_, file) {
    const write = (chunk) => {
      let value = chunk.toString();
      for (const secret of secrets.filter(Boolean))
        value = value.replaceAll(secret, "[REDACTED_SECRET]");
      void appendFile(path.join(output, file), value);
    };
    process_.stdout.on("data", write);
    process_.stderr.on("data", write);
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const owned = child;
    owned.kill("SIGTERM");
    await Promise.race([once(owned, "exit"), delay(5000)]);
    if (owned.exitCode === null && owned.signalCode === null) {
      owned.kill("SIGKILL");
      await once(owned, "exit");
    }
    child = null;
  }
  async function start() {
    await stop();
    generation++;
    if (production) {
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
      logTo(build, `next-build-${generation}.log`);
      const [code] = await once(build, "exit");
      check(
        code === 0,
        "Next artifact builds with the exact current media origin and strict preview configuration",
      );
    }
    child = spawn(
      process.execPath,
      [
        binary,
        production ? "start" : "dev",
        "--hostname",
        "localhost",
        "--port",
        new globalThis.URL(origin).port,
      ],
      {
        cwd,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    logTo(child, `next-runtime-${generation}.log`);
    const deadline = globalThis.performance.now() + 90_000;
    let ready = false;
    while (globalThis.performance.now() < deadline && child.exitCode === null) {
      try {
        const response = await globalThis.fetch(`${origin}/healthz`, {
          signal: globalThis.AbortSignal.timeout(2000),
        });
        await response.body?.cancel();
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Owned Next is still starting. */
      }
      await delay(200);
    }
    check(ready, "actual owned Next serves its health route");
  }
  return { start, stop, generation: () => generation };
}
