import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PersistenceTransactionFailureError } from "../../../packages/persistence-port/dist/index.js";
import { publishedContentResponseSchema } from "@fan-support/contracts";
import { createAcceptanceReadDiagnostics } from "./storefront-acceptance-diagnostics.mjs";
import { createGiftStorefrontFaultGateway } from "./gift-storefront-next.mjs";

const failure = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
};
const command = {
  schemaVersion: 1,
  locale: "ja",
  locator: { kind: "IDOL", handle: "PRIVATE_HANDLE" },
};
async function harness(t, maxFailures) {
  const output = await mkdtemp(
    path.join(os.tmpdir(), "public-read-diagnostics-"),
  );
  t.after(() => rm(output, { recursive: true, force: true }));
  return {
    diagnostics: createAcceptanceReadDiagnostics({ output, maxFailures }),
    output,
  };
}
function persistence(load, after) {
  const manager = {
    async runInPublishedContentTransaction(work) {
      const result = await work({ publishedContent: { load } });
      if (after) await after();
      return result;
    },
  };
  return { publishedContentTransactionManager: manager, close() {} };
}
const run = (value, work) =>
  value.publishedContentTransactionManager.runInPublishedContentTransaction(
    work,
  );

test("records load/work/transaction failure without retrying or changing returned identity", async (t) => {
  const { diagnostics, output } = await harness(t);
  let calls = 0;
  const original = persistence(async (input) => {
    assert.equal(input, command);
    calls++;
    return failure;
  });
  const observed = diagnostics.wrapPersistence(original);
  assert.equal(
    await run(observed, ({ publishedContent }) =>
      publishedContent.load(command),
    ),
    failure,
  );
  assert.equal(calls, 1);
  assert.equal(observed.close, original.close);
  const saved = JSON.parse(
    await readFile(path.join(output, "public-read-diagnostics.json"), "utf8"),
  );
  assert.deepEqual(
    saved.failures.map((event) => event.phase),
    ["LOAD_RETURN", "WORK_RETURN", "TX_RETURN"],
  );
  assert.ok(
    saved.failures.every(
      (event) =>
        event.operationId === 1 && event.code === "CONTENT_UNAVAILABLE",
    ),
  );
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_HANDLE/u);
});

test("captures canonical commit failure after a successful work result and rethrows the identical error", async (t) => {
  const { diagnostics } = await harness(t);
  const error = new PersistenceTransactionFailureError({
    schemaVersion: 1,
    outcome: "FAILURE",
    operation: "RUN_TRANSACTION",
    error: {
      schemaVersion: 1,
      code: "TRANSACTION_ABORTED",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 250,
    },
  });
  const observed = diagnostics.wrapPersistence(
    persistence(
      async () => failure,
      async () => {
        throw error;
      },
    ),
  );
  await assert.rejects(
    run(observed, async () => ({ schemaVersion: 1, outcome: "SUCCESS" })),
    (actual) => actual === error,
  );
  const report = diagnostics.snapshot();
  assert.equal(report.failures.at(-1).phase, "TX_THROW");
  assert.equal(report.failures.at(-1).code, "TRANSACTION_ABORTED");
  assert.equal(report.failures.at(-1).recovery, "RETRY_SAME_COMMAND");
  assert.ok(
    Object.keys(report.counts).some((key) =>
      key.includes("WORK_RETURN:SUCCESS"),
    ),
  );
});

test("schema and thrown Zod paths are allowlisted, bounded and never contain values or unknown keys", async (t) => {
  const { diagnostics } = await harness(t, 3);
  const canary = "PRIVATE_EMAIL_TOKEN_RAW_CONTENT";
  const bad = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    context: { [canary]: canary },
  };
  const observed = diagnostics.wrapPersistence(persistence(async () => bad));
  assert.equal(
    await run(observed, ({ publishedContent }) =>
      publishedContent.load(command),
    ),
    bad,
  );
  const zod = publishedContentResponseSchema.safeParse({
    outcome: canary,
  }).error;
  zod.issues.push({
    code: "custom",
    path: [canary, 0, "context", canary],
    message: canary,
    input: canary,
  });
  const errorObserved = diagnostics.wrapPersistence(
    persistence(async () => {
      throw zod;
    }),
  );
  await assert.rejects(
    run(errorObserved, ({ publishedContent }) =>
      publishedContent.load(command),
    ),
    (actual) => actual === zod,
  );
  const report = diagnostics.snapshot();
  assert.ok(report.failures.length <= 3);
  assert.equal(report.truncated, true);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(canary, "u"));
  assert.ok(
    report.failures.some(
      (event) => event.schema === "INVALID" && event.issues.length > 0,
    ),
  );
});

test("parallel operations keep distinct load/work/transaction identifiers", async (t) => {
  const { diagnostics } = await harness(t);
  const waiters = [];
  const observed = diagnostics.wrapPersistence(
    persistence(() => new Promise((resolve) => waiters.push(resolve))),
  );
  const first = run(observed, ({ publishedContent }) =>
    publishedContent.load(command),
  );
  const second = run(observed, ({ publishedContent }) =>
    publishedContent.load(command),
  );
  waiters[1](failure);
  await second;
  waiters[0](failure);
  await first;
  assert.deepEqual(
    diagnostics.snapshot().failures.map((event) => event.operationId),
    [2, 2, 2, 1, 1, 1],
  );
});

test("gateway opt-in observes the actual failure once while preserving status, headers and bytes", async (t) => {
  const { diagnostics } = await harness(t);
  const bytes = Buffer.from(JSON.stringify(failure));
  let calls = 0;
  const upstream = createServer((_request, response) => {
    calls++;
    response
      .writeHead(503, {
        "content-type": "application/json",
        "x-fixture-header": "same",
      })
      .end(bytes);
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const gateway = await createGiftStorefrontFaultGateway(
    `http://127.0.0.1:${upstream.address().port}`,
    { observer: diagnostics.observeGateway },
  );
  t.after(() => gateway.close());
  const response = await globalThis.fetch(
    `${gateway.origin}/api/v1/idols/private-handle?locale=ja`,
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-fixture-header"), "same");
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(bytes));
  assert.equal(calls, 1);
  const events = diagnostics.snapshot().failures;
  assert.equal(events.length, 1);
  assert.equal(events[0].phase, "GATEWAY_RESPONSE");
  assert.equal(events[0].target, "IDOL");
  assert.equal(events[0].schema, "VALID");
  assert.equal(events[0].code, "CONTENT_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(events), /private-handle/u);
});

test("phase files retain earlier failures and late transactions finish in their original phase", async (t) => {
  const { diagnostics, output } = await harness(t, 1);
  let finish;
  const observed = diagnostics.wrapPersistence(
    persistence(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  diagnostics.beginPhase("protocol");
  const pending = run(observed, ({ publishedContent }) =>
    publishedContent.load(command),
  );
  diagnostics.beginPhase("browser-attempt-1");
  finish(failure);
  await pending;
  assert.equal(diagnostics.snapshot().failures.length, 0);
  const old = JSON.parse(
    await readFile(
      path.join(output, "002-protocol-public-read-diagnostics.json"),
      "utf8",
    ),
  );
  assert.equal(old.phase, "protocol");
  assert.equal(old.failures.length, 1);
  assert.equal(old.failures[0].phase, "TX_RETURN");
  assert.equal(old.droppedFailures, 2);
  assert.throws(
    () => diagnostics.beginPhase("PRIVATE_CONTENT"),
    /Invalid diagnostic phase/u,
  );
});

test("homepage and SEO transactions preserve method arguments, receiver and results", async (t) => {
  const { diagnostics } = await harness(t);
  const homepage = {
    async load(actual) {
      assert.equal(actual, command);
      assert.equal(this, homepage);
      return failure;
    },
  };
  const seo = {
    async loadEntity(actual) {
      assert.equal(actual, command);
      assert.equal(this, seo);
      return failure;
    },
  };
  const observed = diagnostics.wrapPersistence({
    storefrontHomepageTransactionManager: {
      async runInStorefrontHomepageTransaction(work) {
        return work({ storefrontHomepage: homepage });
      },
    },
    storefrontSeoTransactionManager: {
      async runInStorefrontSeoTransaction(work) {
        return work({ storefrontSeo: seo });
      },
    },
  });
  assert.equal(
    await observed.storefrontHomepageTransactionManager.runInStorefrontHomepageTransaction(
      ({ storefrontHomepage }) => storefrontHomepage.load(command),
    ),
    failure,
  );
  assert.equal(
    await observed.storefrontSeoTransactionManager.runInStorefrontSeoTransaction(
      ({ storefrontSeo }) => storefrontSeo.loadEntity(command),
    ),
    failure,
  );
  assert.deepEqual(
    diagnostics.snapshot().failures.map((value) => value.target),
    ["HOMEPAGE", "HOMEPAGE", "HOMEPAGE", "SEO", "SEO", "SEO"],
  );
});

test("API projection writes only public route enums and valid protocol identifiers", async (t) => {
  const { diagnostics, output } = await harness(t);
  const canary = "PRIVATE_MESSAGE_TOKEN_EMAIL_SQL";
  const input = {
    service: "api",
    event: "http.request.completed",
    httpRoute: "/api/v1/idols/:handle",
    httpStatusCode: 503,
    durationMs: 41,
    outcome: "failure",
    requestId: "52a3f5cf-eb74-462b-9832-5ee86715c33b",
    traceId: "2af7651916cd43dd8448eb211c80319c",
    message: canary,
    source: canary,
    error: canary,
    payload: { token: canary },
  };
  diagnostics.observeApiLog(JSON.stringify(input));
  diagnostics.observeApiLog(
    JSON.stringify({ ...input, httpRoute: `/api/v1/idols/${canary}` }),
  );
  diagnostics.observeApiLog(
    JSON.stringify({ ...input, requestId: canary, traceId: canary }),
  );
  const saved = JSON.parse(
    await readFile(
      path.join(output, "public-read-api-diagnostics.json"),
      "utf8",
    ),
  );
  assert.equal(saved.failures.length, 2);
  assert.equal(saved.failures[0].target, "IDOL");
  assert.equal(saved.failures[0].requestId, input.requestId);
  assert.equal(saved.failures[0].durationMs, 41);
  assert.equal(saved.failures[1].requestId, undefined);
  assert.equal(saved.failures[1].traceId, undefined);
  assert.doesNotMatch(
    JSON.stringify(saved),
    /PRIVATE_MESSAGE_TOKEN_EMAIL_SQL|httpRoute|payload|source/u,
  );
});

test("gateway distinguishes JSON rejection, schema rejection and transport failures without raw details", async (t) => {
  const { diagnostics } = await harness(t);
  const url = new globalThis.URL(
    "http://localhost/api/v1/storefront-homepage?locale=vi&token=PRIVATE_TOKEN",
  );
  diagnostics.observeGateway({
    url,
    phase: "GATEWAY_RESPONSE",
    status: 200,
    bytes: Buffer.from("PRIVATE_BAD_JSON"),
  });
  diagnostics.observeGateway({
    url,
    phase: "GATEWAY_RESPONSE",
    status: 200,
    bytes: Buffer.from(
      JSON.stringify({
        outcome: "PRIVATE_OUTCOME",
        privateField: "PRIVATE_CONTENT",
      }),
    ),
  });
  diagnostics.observeGateway({
    url,
    phase: "GATEWAY_TRANSPORT_ERROR",
    status: 503,
    error: new TypeError("PRIVATE_TRANSPORT_ERROR"),
  });
  const events = diagnostics.snapshot().failures;
  assert.equal(events[0].json, "INVALID");
  assert.equal(events[1].schema, "INVALID");
  assert.equal(events[2].errorKind, "TypeError");
  assert.ok(
    events.every(
      (value) => value.target === "HOMEPAGE" && value.locale === "vi",
    ),
  );
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_/u);
});

test("throwing gateway observer cannot change a successful transport response", async (t) => {
  const bytes = Buffer.from("unchanged bytes");
  const upstream = createServer((_request, response) =>
    response.writeHead(200, { "x-fixture-header": "same" }).end(bytes),
  );
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const gateway = await createGiftStorefrontFaultGateway(
    `http://127.0.0.1:${upstream.address().port}`,
    {
      observer() {
        throw new Error("private observer error");
      },
    },
  );
  t.after(() => gateway.close());
  const response = await globalThis.fetch(
    `${gateway.origin}/api/v1/idols/example?locale=en`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-fixture-header"), "same");
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(bytes));
});

test("failure records have generated timestamps and wrappers do not invent repository methods", async (t) => {
  const { diagnostics } = await harness(t);
  const source = {
    async loadEntity() {
      return failure;
    },
  };
  const observed = diagnostics.wrapPersistence({
    storefrontSeoTransactionManager: {
      async runInStorefrontSeoTransaction(work) {
        return work({ storefrontSeo: source });
      },
    },
  });
  await observed.storefrontSeoTransactionManager.runInStorefrontSeoTransaction(
    async ({ storefrontSeo }) => {
      assert.equal(storefrontSeo.readIndex, undefined);
      return storefrontSeo.loadEntity(command);
    },
  );
  assert.ok(
    diagnostics
      .snapshot()
      .failures.every((value) => Number.isFinite(Date.parse(value.observedAt))),
  );
});

test("valid SEO index/catalog snapshots are counted as successful loads", async (t) => {
  const { diagnostics } = await harness(t);
  const index = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    operation: "INDEX",
    catalogVersion: "a".repeat(64),
    candidates: [],
    hasNextPage: false,
  };
  const catalog = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    operation: "CATALOG",
    catalogVersion: "a".repeat(64),
    boundaries: [],
    hasNextPage: false,
  };
  const observed = diagnostics.wrapPersistence({
    storefrontSeoTransactionManager: {
      async runInStorefrontSeoTransaction(work) {
        return work({
          storefrontSeo: {
            async readIndex() {
              return index;
            },
            async readCatalog() {
              return catalog;
            },
          },
        });
      },
    },
  });
  await observed.storefrontSeoTransactionManager.runInStorefrontSeoTransaction(
    async ({ storefrontSeo }) => {
      assert.equal(await storefrontSeo.readIndex(undefined), index);
      assert.equal(await storefrontSeo.readCatalog(undefined), catalog);
      return failure;
    },
  );
  const report = diagnostics.snapshot();
  assert.equal(report.counts["SEO:LOAD_RETURN:SUCCESS:VALID:NONE:NONE"], 2);
  assert.ok(report.failures.every((event) => event.phase !== "LOAD_RETURN"));
});

test("transport codes use bounded own data descriptors without getters or private values", async (t) => {
  const { diagnostics } = await harness(t);
  const url = new globalThis.URL(
    "http://localhost/api/v1/storefront-homepage?locale=en",
  );
  const secret = "PRIVATE_NETWORK_MESSAGE";
  const original = new TypeError(secret, {
    cause: Object.assign(new Error(secret), { code: "UND_ERR_SOCKET" }),
  });
  diagnostics.observeGateway({
    url,
    phase: "GATEWAY_TRANSPORT_ERROR",
    status: 503,
    error: original,
  });
  let getters = 0;
  const hostile = new TypeError(secret);
  Object.defineProperty(hostile, "code", {
    get() {
      getters++;
      return "ECONNRESET";
    },
  });
  Object.defineProperty(hostile, "cause", {
    get() {
      getters++;
      return { code: "ECONNRESET" };
    },
  });
  diagnostics.observeGateway({
    url,
    phase: "GATEWAY_TRANSPORT_ERROR",
    status: 503,
    error: hostile,
  });
  diagnostics.observeGateway({
    url,
    phase: "GATEWAY_TRANSPORT_ERROR",
    status: 503,
    error: {
      name: "TypeError",
      code: secret,
      cause: { cause: { cause: { code: "ECONNREFUSED" } } },
    },
  });
  const observed = diagnostics.wrapPersistence(
    persistence(async () => {
      throw original;
    }),
  );
  await assert.rejects(
    run(observed, ({ publishedContent }) => publishedContent.load(command)),
    (actual) => actual === original,
  );
  const report = diagnostics.snapshot();
  assert.equal(report.failures[0].transportCode, "UND_ERR_SOCKET");
  assert.equal(report.failures[1].transportCode, undefined);
  assert.equal(report.failures[2].transportCode, undefined);
  assert.equal(getters, 0);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_NETWORK_MESSAGE/u);
});

test("gateway late response retains its request-start phase while API logs state completion-only association", async (t) => {
  const { diagnostics, output } = await harness(t);
  let release;
  let started;
  const arrived = new Promise((resolve) => {
    started = resolve;
  });
  const upstream = createServer((_request, response) => {
    release = () =>
      response
        .writeHead(503, { "content-type": "application/json" })
        .end(JSON.stringify(failure));
    started();
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const gateway = await createGiftStorefrontFaultGateway(
    `http://127.0.0.1:${upstream.address().port}`,
    {
      observer: diagnostics.observeGateway,
      captureObserver: diagnostics.captureGatewayObserver,
    },
  );
  t.after(() => gateway.close());
  diagnostics.beginPhase("protocol");
  const pending = globalThis.fetch(
    `${gateway.origin}/api/v1/idols/example?locale=ja`,
  );
  await arrived;
  diagnostics.beginPhase("browser-attempt-1");
  release();
  await (await pending).arrayBuffer();
  assert.equal(diagnostics.snapshot().failures.length, 0);
  const old = JSON.parse(
    await readFile(
      path.join(output, "002-protocol-public-read-diagnostics.json"),
      "utf8",
    ),
  );
  assert.equal(old.failures[0].phase, "GATEWAY_RESPONSE");
  diagnostics.observeApiLog(
    JSON.stringify({
      service: "api",
      event: "http.request.completed",
      httpRoute: "/api/v1/idols/:handle",
      httpStatusCode: 503,
      outcome: "failure",
    }),
  );
  const api = JSON.parse(
    await readFile(
      path.join(output, "public-read-api-diagnostics.json"),
      "utf8",
    ),
  );
  assert.equal(api.phase, "browser-attempt-1");
  assert.equal(api.failures[0].phaseAssociation, "COMPLETION_ONLY");
});
