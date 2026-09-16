import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { channel } from "node:diagnostics_channel";
import { createServer } from "node:http";
import test from "node:test";
import { resolveServerRuntimeConfig } from "@fan-support/config/server";
import { installStorefrontTestFetchDiagnostics } from "./storefront-test-fetch-diagnostics.mjs";

const prefix = "STOREFRONT_TEST_FETCH_DIAGNOSTIC ";
const canary = "private-diagnostic-canary";

function environment(origin, overrides = {}) {
  return {
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    STOREFRONT_TEST_FETCH_DIAGNOSTICS: "1",
    STOREFRONT_TEST_FETCH_DIAGNOSTICS_ORIGIN: origin,
    ...overrides,
  };
}

test("diagnostic child environment remains compatible with the real storefront runtime configuration", () => {
  const origin = "http://127.0.0.1:1234";
  const childEnvironment = {
    NODE_ENV: "test",
    FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3100",
    FAN_SUPPORT_INTERNAL_API_ORIGIN: origin,
    ...environment(origin),
  };
  assert.doesNotThrow(() =>
    resolveServerRuntimeConfig({ environment: childEnvironment }),
  );
  assert.equal(
    resolveServerRuntimeConfig({ environment: childEnvironment })
      .deploymentEnvironment,
    "test",
  );
});

async function serverFor(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

function observe(t, origin, overrides = {}, write) {
  const lines = [];
  const stop = installStorefrontTestFetchDiagnostics({
    environment: environment(origin, overrides),
    write: write ?? ((line) => lines.push(line)),
  });
  t.after(stop);
  return {
    lines,
    records: () => lines.map((line) => JSON.parse(line.slice(prefix.length))),
  };
}

test("real HTTP success preserves fetch, body and response headers; matches only owned home/artist GET", async (t) => {
  const origin = await serverFor(t, (_request, response) =>
    response
      .writeHead(200, {
        "content-type": "text/plain",
        "x-private-canary": canary,
      })
      .end(canary),
  );
  const otherOrigin = await serverFor(t, (_request, response) =>
    response.end(canary),
  );
  const originalFetch = globalThis.fetch;
  const observed = observe(t, origin);
  for (const pathname of [
    "/api/v1/storefront-homepage",
    `/api/v1/idols/${canary}`,
  ]) {
    const response = await globalThis.fetch(
      `${origin}${pathname}?private=${canary}`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-private-canary"), canary);
    assert.equal(await response.text(), canary);
  }
  for (const [url, options] of [
    [`${otherOrigin}/api/v1/storefront-homepage`],
    [`${origin}/api/v1/gifts`],
    [`${origin}/api/v1/idols/one/private`],
    [`${origin}/api/v1/storefront-homepage`, { method: "POST", body: canary }],
  ])
    await (await globalThis.fetch(url, options)).text();
  assert.equal(globalThis.fetch, originalFetch);
  const records = observed.records();
  assert.deepEqual(
    records.map(({ target, stage }) => [target, stage]),
    [
      ["HOMEPAGE", "CREATE"],
      ["HOMEPAGE", "HEADERS"],
      ["HOMEPAGE", "COMPLETE"],
      ["IDOL", "CREATE"],
      ["IDOL", "HEADERS"],
      ["IDOL", "COMPLETE"],
    ],
  );
  assert.ok(
    records.every(
      (record) =>
        record.schemaVersion === 1 && Number.isFinite(record.durationMs),
    ),
  );
  assert.deepEqual(
    records
      .filter(({ stage }) => stage === "HEADERS")
      .map(({ status }) => status),
    [200, 200],
  );
  assert.equal(observed.lines.join("").includes(canary), false);
  assert.equal(observed.lines.join("").includes(origin), false);
});

test("real upstream disconnect records safe transport code and keeps the native fetch rejection", async (t) => {
  const origin = await serverFor(t, (request) => request.socket.destroy());
  const observed = observe(t, origin);
  await assert.rejects(
    globalThis.fetch(`${origin}/api/v1/storefront-homepage`),
    { name: "TypeError" },
  );
  const failure = observed.records().find(({ stage }) => stage === "ERROR");
  assert.ok(failure, "the native Undici request error must be observed");
  assert.equal(failure.transportCode, "UND_ERR_SOCKET");
  assert.equal(failure.errorName, "SocketError");
});

test("real caller abort remains an abort and the observer does not consume or retry the request", async (t) => {
  let notify;
  const received = new Promise((resolve) => {
    notify = resolve;
  });
  let requests = 0;
  const origin = await serverFor(t, () => {
    requests++;
    notify();
  });
  const observed = observe(t, origin);
  const controller = new globalThis.AbortController();
  const pending = globalThis.fetch(`${origin}/api/v1/idols/example`, {
    signal: controller.signal,
  });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await received;
  controller.abort();
  await rejected;
  assert.equal(requests, 1);
  assert.equal(
    observed.records().find(({ stage }) => stage === "ERROR")?.errorName,
    "AbortError",
  );
});

test("default off, non-TEST and invalid owned origins install no diagnostic subscriptions", (t) => {
  for (const overrides of [
    { STOREFRONT_TEST_FETCH_DIAGNOSTICS: undefined },
    { FAN_SUPPORT_DEPLOYMENT_ENV: "production" },
    { STOREFRONT_TEST_FETCH_DIAGNOSTICS_ORIGIN: "https://example.com" },
    {
      STOREFRONT_TEST_FETCH_DIAGNOSTICS_ORIGIN: "http://127.0.0.1:1234/private",
    },
  ]) {
    const observed = observe(t, "http://127.0.0.1:1234", overrides);
    channel("undici:request:create").publish({
      request: {
        origin: "http://127.0.0.1:1234",
        method: "GET",
        path: "/api/v1/storefront-homepage",
      },
    });
    assert.equal(observed.lines.length, 0);
  }
});

test("bounded diagnostic records truncate explicitly and never evaluate error getters or leak arbitrary fields", (t) => {
  const origin = "http://127.0.0.1:1234";
  const observed = observe(t, origin);
  let getters = 0;
  const request = {
    origin,
    method: "GET",
    path: `/api/v1/idols/${canary}?secret=${canary}`,
  };
  channel("undici:request:create").publish({ request });
  const error = Object.defineProperties(
    { message: canary, stack: canary, cause: { code: "ECONNRESET" } },
    {
      name: {
        get() {
          getters++;
          return canary;
        },
      },
      code: {
        get() {
          getters++;
          return canary;
        },
      },
    },
  );
  channel("undici:request:error").publish({ request, error });
  const failure = observed.records().find(({ stage }) => stage === "ERROR");
  assert.equal(failure?.transportCode, "ECONNRESET");
  assert.equal(getters, 0);
  for (let index = 0; index < 400; index++) {
    const next = { origin, method: "GET", path: "/api/v1/storefront-homepage" };
    channel("undici:request:create").publish({ request: next });
    channel("undici:request:headers").publish({
      request: next,
      response: { statusCode: 200 },
    });
    channel("undici:request:trailers").publish({ request: next });
  }
  assert.equal(
    observed.records().filter(({ stage }) => stage === "TRUNCATED").length,
    1,
  );
  assert.ok(observed.lines.length <= 769);
  assert.equal(observed.lines.join("").includes(canary), false);
});

test("a failed diagnostic sink never changes real HTTP delivery", async (t) => {
  const origin = await serverFor(t, (_request, response) =>
    response.end("unchanged"),
  );
  let writes = 0;
  observe(t, origin, {}, () => {
    writes++;
    throw new Error(canary);
  });
  assert.equal(
    await (
      await globalThis.fetch(`${origin}/api/v1/storefront-homepage`)
    ).text(),
    "unchanged",
  );
  assert.ok(writes > 0);
});

test("the real --import preload is silent by default and activates only in explicitly enabled TEST", async (t) => {
  const origin = await serverFor(t, (_request, response) =>
    response.end("unchanged"),
  );
  const preload = new globalThis.URL(
    "./storefront-test-fetch-diagnostics.mjs",
    import.meta.url,
  ).href;
  for (const enabled of [false, true]) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("FAN_SUPPORT_"),
      ),
    );
    Object.assign(
      env,
      environment(origin, {
        STOREFRONT_TEST_FETCH_DIAGNOSTICS: enabled ? "1" : "0",
      }),
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        preload,
        "--input-type=module",
        "-e",
        `const response = await fetch(${JSON.stringify(`${origin}/api/v1/storefront-homepage`)}); if (await response.text() !== "unchanged") process.exitCode = 1;`,
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (bytes) => {
      stdout += bytes.toString();
    });
    child.stderr.on("data", (bytes) => {
      stderr += bytes.toString();
    });
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 0, stderr);
    assert.equal(stderr, "");
    const lines = stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, enabled ? 3 : 0);
    assert.ok(lines.every((line) => line.startsWith(prefix)));
  }
});
