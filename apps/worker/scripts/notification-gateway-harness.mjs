/* global Headers, Response */
/** Local TEST-only TLS receiver with PostgreSQL receipts; never sends mail. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { request } from "node:https";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { setTimeout, clearTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { Pool } from "pg";
import {
  notificationEmailDispatchSchema,
  notificationGatewayProfileSchema,
} from "@fan-support/contracts";
import { createNotificationGatewayTransport } from "../../../packages/notification-provider/dist/index.js";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function waitMessage(child, kind) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => done(new Error("TEST receiver IPC timeout")),
      15000,
    );
    const message = (value) => {
      if (value?.kind === "failed")
        done(new Error("TEST receiver unavailable"));
      else if (value?.kind === kind) done(undefined, value);
    };
    const exit = () => done(new Error("TEST receiver exited"));
    function done(error, value) {
      clearTimeout(timer);
      child.off("message", message);
      child.off("exit", exit);
      if (error) reject(error);
      else resolve(value);
    }
    child.on("message", message);
    child.once("exit", exit);
  });
}

function trustedFetcher(state) {
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== state.origin)
      throw new Error("TEST TLS target mismatch");
    return new Promise((resolve, reject) => {
      const outgoing = request(
        {
          hostname: "127.0.0.1",
          port: Number(url.port),
          servername: url.hostname,
          rejectUnauthorized: true,
          ca: state.certificateAuthority,
          path: url.pathname + url.search,
          method: init?.method,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            host: url.host,
          },
          signal: init?.signal,
        },
        (response) => {
          const headers = new Headers();
          for (const [name, values] of Object.entries(response.headers))
            for (const value of Array.isArray(values)
              ? values
              : values === undefined
                ? []
                : [values])
              headers.append(name, value);
          resolve(
            new Response(Readable.toWeb(response), {
              status: response.statusCode ?? 500,
              headers,
            }),
          );
        },
      );
      outgoing.on("error", reject);
      if (init?.body) outgoing.write(init.body);
      outgoing.end();
    });
  };
}

export async function createPersistentNotificationGatewayHarness({ context }) {
  const database = context.database;
  if (!database || !["127.0.0.1", "localhost"].includes(database.host))
    throw new Error("TEST mail gateway requires a local PostgreSQL fixture");
  const schema = `p406_mail_${randomUUID().replaceAll("-", "")}`;
  const table = `"${schema}".receipts`;
  const pool = new Pool({ ...database, max: 8 });
  const authorization = randomBytes(32).toString("base64url");
  await pool.query(
    `CREATE SCHEMA "${schema}"; CREATE TABLE ${table}(idempotency_key text PRIMARY KEY,request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),receipt jsonb NOT NULL,retained_until timestamptz NOT NULL)`,
  );
  const profileBase = {
    schemaVersion: 1,
    protocol: "fan-support-mail-v1",
    environment: "TEST",
    fromEmail: "orders@example.test",
    fromName: "TEST Studio",
    replyToEmail: "support@example.test",
    timeoutMs: 2000,
    idempotencyRetentionSeconds: 3600,
  };
  let child,
    state,
    profile,
    transportKey,
    cachedCount = 0,
    closed = false,
    diagnosticBytes = 0;
  const processIds = [];
  async function start(port = 0) {
    child = fork(
      fileURLToPath(
        new URL("./notification-gateway-receiver.mjs", import.meta.url),
      ),
      [],
      { stdio: ["ignore", "pipe", "pipe", "ipc"], execArgv: [] },
    );
    child.stdout.on("data", (bytes) => {
      diagnosticBytes += bytes.length;
    });
    child.stderr.on("data", (bytes) => {
      diagnosticBytes += bytes.length;
    });
    const ready = waitMessage(child, "ready");
    child.send({
      command: "start",
      environment: "TEST",
      database,
      schema,
      authorization,
      profile: profileBase,
      port,
    });
    state = await ready;
    processIds.push(state.pid);
    profile = notificationGatewayProfileSchema.parse({
      ...profileBase,
      apiOrigin: state.origin,
    });
    const expected = hash(profile);
    if (transportKey && transportKey !== expected)
      throw new Error("TEST profile drift after receiver restart");
    transportKey = expected;
    assert.equal(state.profileHash, transportKey);
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const stopping = waitMessage(child, "stopped");
    child.send({ command: "stop" });
    await stopping;
    if (child.exitCode === null)
      await new Promise((resolve) => child.once("exit", resolve));
  }
  async function inspect() {
    const result = await pool.query(
      `SELECT idempotency_key,request_hash,receipt,retained_until FROM ${table} ORDER BY idempotency_key`,
    );
    cachedCount = result.rowCount;
    return result.rows;
  }
  async function close() {
    if (closed) return;
    closed = true;
    try {
      await stop();
    } finally {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  }
  try {
    await start();
  } catch (error) {
    await close();
    throw error;
  }
  const transport = {
    async sendEmail(command) {
      const adapter = createNotificationGatewayTransport({
        profile,
        resolveCredential: async () => authorization,
        fetcher: trustedFetcher(state),
      });
      assert.equal(adapter.transportKey, transportKey);
      try {
        return await adapter.transport.sendEmail(command);
      } finally {
        await inspect();
      }
    },
  };
  const harness = {
    transportKey,
    transport,
    scope:
      "Actual local TLS + PostgreSQL TEST mail receiver; durable receipt acceptance only, no real email. Receiver enforces fixed body/key/profile, absolute cutoff and finite retention.",
    acceptedCount: () => cachedCount,
    async dropNextResponse() {
      const armed = waitMessage(child, "armed");
      child.send({ command: "drop-next" });
      await armed;
    },
    async restart() {
      const port = Number(new URL(state.origin).port);
      await stop();
      await start(port);
    },
    inspect,
    close,
    async verifyPersistenceAndDeadline() {
      const before = cachedCount;
      const fixture = (dispatchNotAfter) => {
        const id = randomUUID();
        return notificationEmailDispatchSchema.parse({
          schemaVersion: 1,
          operation: "SEND_NOTIFICATION",
          channel: "EMAIL",
          recipient: "private-fixture@example.test",
          dispatchNotAfter,
          notification: {
            schemaVersion: 1,
            id,
            orderId: id,
            customerContactId: id,
            eventType: "PAYMENT_CONFIRMED",
            locale: {
              schemaVersion: 1,
              requestedLocale: "en",
              resolvedLocale: "en",
              fallbackUsed: false,
              templateKey: "order.payment.confirmed",
              templateVersion: `v1.${"a".repeat(64)}`,
              contentRevisionIds: [],
            },
            idempotencyKey: `notification:${id}`,
            correlationId: id,
          },
          content: {
            subject: "TEST order",
            preheader: "TEST notification",
            html: "<p>PRIVATE_MAIL_CONTENT_CANARY</p>",
            text: `PRIVATE_MAIL_CONTENT_CANARY https://store.example/en/order-access#token=${"A".repeat(43)}&order=${id}`,
          },
        });
      };
      const pgTime = async () =>
        new Date(
          (await pool.query("SELECT clock_timestamp() now")).rows[0].now,
        ).getTime();
      const first = fixture(new Date((await pgTime()) + 15000).toISOString());
      await harness.dropNextResponse();
      assert.equal(
        (await transport.sendEmail(first)).error?.code,
        "TIMEOUT_OUTCOME_UNKNOWN",
      );
      const acceptedAfterLostResponse = cachedCount - before;
      assert.equal(acceptedAfterLostResponse, 1);
      const oldPid = state.pid,
        oldKey = transportKey;
      await harness.restart();
      assert.notEqual(state.pid, oldPid);
      assert.equal(transportKey, oldKey);
      const recovered = await transport.sendEmail(first);
      assert.equal(recovered.value?.status, "ACCEPTED");
      assert.equal(cachedCount - before, 1);
      const concurrent = fixture(
        new Date((await pgTime()) + 15000).toISOString(),
      );
      const concurrentBefore = cachedCount;
      const results = await Promise.all(
        Array.from({ length: 12 }, () => transport.sendEmail(concurrent)),
      );
      assert(results.every((result) => result.value?.status === "ACCEPTED"));
      assert(
        results.every(
          (result) => JSON.stringify(result) === JSON.stringify(results[0]),
        ),
      );
      const acceptedAfterConcurrentRequests = cachedCount - concurrentBefore;
      assert.equal(acceptedAfterConcurrentRequests, 1);
      const changed = {
        ...concurrent,
        content: { ...concurrent.content, subject: "CHANGED" },
      };
      assert.equal(
        (await transport.sendEmail(changed)).error?.code,
        "IDEMPOTENCY_CONFLICT",
      );
      const cutoff = new Date((await pgTime()) + 400).toISOString();
      const replay = fixture(cutoff),
        neverSent = fixture(cutoff);
      const prior = await transport.sendEmail(replay);
      assert.equal(prior.value?.status, "ACCEPTED");
      while ((await pgTime()) < Date.parse(cutoff)) await delay(25);
      const countAtCutoff = cachedCount;
      const denied = await transport.sendEmail(neverSent);
      assert.equal(denied.error?.code, "CONFIGURATION_ERROR");
      const firstSendAfterDeadline = cachedCount - countAtCutoff;
      assert.equal(firstSendAfterDeadline, 0);
      assert.deepEqual(await transport.sendEmail(replay), prior);
      const outsideRetention = fixture(
        new Date((await pgTime()) + 3601000).toISOString(),
      );
      assert.equal(
        (await transport.sendEmail(outsideRetention)).error?.code,
        "CONFIGURATION_ERROR",
      );
      // Simulated gateway housekeeping removes only TEST provider receipts, never business facts.
      // Once receipt retention ends, the identical expired command still cannot cause a new acceptance.
      await pool.query(`DELETE FROM ${table} WHERE idempotency_key=$1`, [
        replay.notification.idempotencyKey,
      ]);
      assert.equal(
        (await transport.sendEmail(replay)).error?.code,
        "CONFIGURATION_ERROR",
      );
      const persisted = JSON.stringify(await inspect());
      for (const canary of [
        "private-fixture@example.test",
        "PRIVATE_MAIL_CONTENT_CANARY",
        "A".repeat(43),
        "#token=",
        "recipient",
        '"html"',
        '"text"',
      ])
        assert(!persisted.includes(canary));
      assert.equal(
        diagnosticBytes,
        0,
        "receiver does not log request/receipt or process diagnostics",
      );
      return {
        schemaVersion: 1,
        status: "PASS",
        actualPostgres: true,
        actualTls: true,
        processRestarted: true,
        processIds: [...processIds],
        acceptedAfterLostResponse,
        acceptedAfterConcurrentRequests,
        firstSendAfterDeadline,
        privateFieldsPersisted: false,
        immutableConflictRejected: true,
        oldReceiptReplayedAfterDeadline: true,
        expiredReceiptCannotCreateNewSend: true,
        finiteRetentionSeconds: 3600,
        receiptRemovalScope:
          "Only a TEST provider receipt is deleted to simulate finite-retention housekeeping; no order/financial facts or database clocks are changed.",
        actualEmail: false,
      };
    },
  };
  context.own?.("persistent TEST mail gateway", close);
  return Object.freeze(harness);
}
