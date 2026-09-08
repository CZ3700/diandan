import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createPaymentTestTls } from "../../../apps/api/scripts/payment-runtime-tls.mjs";
import { createPaymentStorefrontTlsGateway } from "../../../apps/api/scripts/payment-runtime-gateway.mjs";
import { paymentNextEnvironment } from "../../../apps/api/scripts/payment-runtime-next.mjs";

const root = process.cwd();
const rebuild = process.argv.includes("--build");
const inspect = process.argv.includes("--inspect-authority");
const tls = await createPaymentTestTls();
let gateway, next;
const report = {
  schemaVersion: 1,
  scope:
    "Existing compiled Next, actual HTTPS gateway, no Cookie, no PG or API stub",
  outcome: "RUNNING",
  nextClosed: false,
  gatewayClosed: false,
};
try {
  gateway = await createPaymentStorefrontTlsGateway(
    tls.certificates["storefront.example.invalid"],
  );
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const internal = `http://127.0.0.1:${port}`;
  gateway.attach(internal);
  const environment = paymentNextEnvironment(
    {
      origin: gateway.origin,
      apiOrigin: "http://127.0.0.1:9",
      mediaOrigin: "https://media.example.invalid",
      pspOrigin: "https://payments.example.invalid",
    },
    process.env,
  );
  if (inspect)
    environment.NODE_OPTIONS += ` --import=${new globalThis.URL("./https-origin-request-preload.mjs", import.meta.url).href}`;
  if (rebuild) {
    const build = spawn(
      process.execPath,
      [
        path.join(root, "apps/storefront/node_modules/next/dist/bin/next"),
        "build",
      ],
      {
        cwd: path.join(root, "apps/storefront"),
        env: {
          ...environment,
          NODE_ENV: "production",
          FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
          FAN_SUPPORT_SITE_ORIGIN: "https://localhost:3443",
          FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://api:3002",
        },
        stdio: "ignore",
      },
    );
    const [code] = await once(build, "exit");
    report.productionBuildExit = code;
    if (code !== 0) throw new Error("OWNED_NEXT_BUILD_FAILED");
  }
  next = spawn(
    process.execPath,
    [
      path.join(root, "apps/storefront/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: path.join(root, "apps/storefront"),
      env: environment,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  report.requestAuthorities = [];
  next.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n"))
      if (line.startsWith("SAFE_AUTHORITY "))
        report.requestAuthorities.push(JSON.parse(line.slice(15)));
  });
  const deadline = globalThis.performance.now() + 30_000;
  let ready = false;
  while (next.exitCode === null && globalThis.performance.now() < deadline) {
    try {
      const response = await globalThis.fetch(internal + "/healthz");
      await response.body?.cancel();
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* Owned process boot. */
    }
    await delay(100);
  }
  if (!ready) throw new Error("OWNED_NEXT_NOT_READY");
  const response = await tls.fetcher(
    gateway.origin + "/api/storefront/cart?presentationLocale=en",
  );
  const body = await response.json();
  Object.assign(report, {
    publicOrigin: gateway.origin,
    internalOrigin: internal,
    category: "READ_CART_WITHOUT_COOKIE",
    httpStatus: response.status,
    code: ["INVALID_ACCESS", "CART_NOT_FOUND"].includes(body.code)
      ? body.code
      : "OTHER",
    hasSetCookie: response.headers.has("set-cookie"),
    outcome: "OBSERVED",
  });
} finally {
  if (next && next.exitCode === null && next.signalCode === null) {
    next.kill("SIGTERM");
    await once(next, "exit");
  }
  report.nextClosed =
    !next || next.exitCode !== null || next.signalCode !== null;
  await gateway?.close();
  report.gatewayClosed = true;
  await tls.close();
  await writeFile(
    new globalThis.URL(
      process.argv.includes("--final")
        ? "./https-origin-final.json"
        : inspect
          ? "./https-origin-inspection.json"
          : rebuild
            ? "./https-origin-diagnostic-green.json"
            : "./https-origin-diagnostic.json",
      import.meta.url,
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(report) + "\n");
}
