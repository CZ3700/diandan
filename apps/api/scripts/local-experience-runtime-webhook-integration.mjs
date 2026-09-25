import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath, URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { z } from "zod";
import { loadLocalState } from "../../../scripts/local-experience-state.mjs";
import { parseLocalBusiness } from "./local-experience-bootstrap-state.mjs";
import { startLocalExperienceRuntime } from "./local-experience-runtime.mjs";

/** Re-signs only an existing settled TEST PSP event; never creates, captures or changes a payment directly. */
export async function verifyLocalRuntimeWebhook({
  workspaceRoot,
  instance,
  attemptId,
}) {
  z.uuid().parse(attemptId);
  const state = await loadLocalState(workspaceRoot, instance);
  const config = globalThis.structuredClone(state.config);
  const database = {
    host: "127.0.0.1",
    port: config.ports.postgres,
    ...config.database,
    ssl: false,
  };
  const platform = new Client(database);
  const provider = new Client({
    ...database,
    database: config.services.psp.databaseName,
  });
  await platform.connect();
  await provider.connect();
  const owned = [];
  let checks = 0;
  const check = (value, message) => {
    checks++;
    assert.ok(value, message);
  };
  try {
    const row = (
      await provider.query(
        "SELECT attempt_id,status,external_reference,capture_reference,updated_at,command->>'amountMinor' amount_minor,command->>'currency' currency FROM psp_payments WHERE account_id=$1 AND attempt_id=$2",
        [config.services.psp.binding.providerAccountId, attemptId],
      )
    ).rows[0];
    check(
      row?.status === "SUCCEEDED" && Boolean(row.capture_reference),
      "Only an already captured TEST provider event may be replayed",
    );
    const countCaptures = async () =>
      (
        await provider.query(
          "SELECT count(*)::int n FROM psp_payments WHERE capture_reference IS NOT NULL",
        )
      ).rows[0].n;
    const countLedger = async () =>
      (await platform.query("SELECT count(*)::int n FROM payment_transactions"))
        .rows[0].n;
    const before = {
      captures: await countCaptures(),
      ledger: await countLedger(),
    };
    const business = parseLocalBusiness(
      (
        await platform.query(
          "SELECT state FROM local_experience.bootstrap WHERE id=1",
        )
      ).rows[0].state,
      config,
    );
    const reservation = createServer();
    await new Promise((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", resolve);
    });
    config.ports.api = reservation.address().port;
    await new Promise((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );
    const forbidden = async () => {
      throw new Error(
        "No provider command is permitted during webhook replay verification",
      );
    };
    const runtime = await startLocalExperienceRuntime({
      workspaceRoot,
      stateDirectory: state.stateDirectory,
      config,
      database,
      business,
      s3: { endpoint: `https://localhost:${config.ports.s3}`, ...config.s3 },
      services: {
        oidc: { issuer: config.origins.oidc, fetch: forbidden },
        psp: {
          origin: config.origins.psp,
          binding: config.services.psp.binding,
          fetcher: forbidden,
        },
      },
      own: (_name, stop) => owned.push(stop),
      startWorker: false,
    });
    const event = {
      event_id: `test-webhook/${row.attempt_id}/${row.status}`,
      created_at: new Date(row.updated_at).toISOString(),
      resource: {
        kind: "payment",
        payment_reference: row.external_reference,
        state: "captured",
        amount_minor: Number(row.amount_minor),
        currency: row.currency,
        transaction: { kind: "capture", reference: row.capture_reference },
      },
    };
    const raw = JSON.stringify(event);
    const send = async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac(
        "sha256",
        Buffer.from(config.secrets.webhookSecret, "base64url"),
      )
        .update(timestamp)
        .update(".")
        .update(raw)
        .digest("hex");
      const response = await globalThis.fetch(
        `${runtime.apiOrigin}/api/v1/webhooks/payments/${business.endpoint.endpointId}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-fan-support-timestamp": timestamp,
            "x-fan-support-signature": `v1=${signature}`,
          },
          body: raw,
          signal: globalThis.AbortSignal.timeout(10000),
        },
      );
      await response.body?.cancel();
      checks++;
      assert.equal(
        response.status,
        202,
        "Actual HTTP signed webhook reaches the canonical receiver and durable queue",
      );
    };
    await send();
    await send();
    check(
      (
        await platform.query(
          "SELECT count(*)::int n FROM webhook_inbox WHERE provider_event_id=$1",
          [event.event_id],
        )
      ).rows[0].n === 1,
      "Repeated signed delivery produces one inbox row",
    );
    await delay(1200);
    check(
      (await countCaptures()) === before.captures,
      "Trusted replay cannot create a new provider capture",
    );
    check(
      (await countLedger()) === before.ledger,
      "Trusted replay of the existing settled attempt does not duplicate the money ledger",
    );
    return {
      schemaVersion: 1,
      status: "PASS",
      checks,
      realPostgres: true,
      realHttp: true,
      signedWebhookAccepted: true,
      replayDeduplicated: true,
      newCaptures: 0,
      duplicateLedgerTransactions: 0,
    };
  } finally {
    for (const close of owned.reverse()) await close();
    await provider.end();
    await platform.end();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [instance, attemptId] = process.argv.slice(2);
  if (!instance || !attemptId)
    throw new Error(
      "Pass an explicit running local TEST instance and existing captured attempt ID",
    );
  console.log(
    JSON.stringify(
      await verifyLocalRuntimeWebhook({
        workspaceRoot: fileURLToPath(new URL("../../../", import.meta.url)),
        instance,
        attemptId,
      }),
    ),
  );
}
