import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import { startNodeTelemetry } from "@fan-support/observability/node";
import { createFakePaymentWebhookVerifier } from "@fan-support/payment-fake";
import {
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createApiApplication } from "../dist/bootstrap.js";
import { createApiReliableEventsComposition } from "../dist/reliable-events-composition.js";
import { createCartHttpTestKms } from "./cart-http-kms.mjs";
import { prepareOrderPaymentQueue } from "./order-payment-queue.mjs";
import {
  seedOrderPaymentEndpoint,
  waitOrderPaymentReceiptClock,
} from "./order-payment-runtime.mjs";
import { seedPaymentRuntimeConfiguration } from "./payment-runtime-config-fixture.mjs";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("normal TEST endpoint and actual raw HTTP ingress reject changed bytes before persisting an authenticated unmatched observation", async () => {
  let result, assertionFailure;
  await withEphemeralPostgres(async (database) => {
    const client = new Client(database),
      secret = randomBytes(32),
      kms = createCartHttpTestKms();
    let app, composition, telemetry;
    const stages = [];
    try {
      await runMigrations({
        clientConfig: database,
        workspaceRoot,
        command: { direction: "up" },
      });
      await client.connect();
      const manager = randomUUID();
      await client.query(
        "INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required) VALUES($1,'p405-synthetic-webhook-test',$2,'ACTIVE',true)",
        [manager, randomBytes(32)],
      );
      const binding = {
        schemaVersion: 1,
        providerAccountId: randomUUID(),
        providerCode: "fake",
        environment: "TEST",
        allowedActionOrigins: ["https://payments.example.test"],
        localeMapping: Object.fromEntries(
          SUPPORTED_LOCALES.map((locale) => [
            locale,
            { providerLocale: locale, fallbackUsed: false },
          ]),
        ),
      };
      const published = await seedPaymentRuntimeConfiguration({
        client,
        identity: { identities: { identities: { manager } } },
        bindings: [binding],
        configuration: {
          schemaVersion: 1,
          publicStorefrontOrigin: "https://store.example.test",
          leaseMs: 30000,
          recoveryDelayMs: 10000,
          actionTtlMs: 300000,
          returnStateTtlMs: 3600000,
          recoveryBatchSize: 10,
        },
        scope: { country: "US", market: "TEST", currency: "USD" },
        check: assert.ok,
      });
      const endpoint = await seedOrderPaymentEndpoint({
        client,
        published,
        check: assert.ok,
      });
      await prepareOrderPaymentQueue(database);
      telemetry = startNodeTelemetry({ service: "api" });
      const verifier = createFakePaymentWebhookVerifier({
        ...endpoint,
        environment: "TEST",
        verificationSecret: secret,
      });
      const logger = createStructuredLogger({ service: "api", write() {} });
      const environment = preflightEnvironment(database);
      composition = createApiReliableEventsComposition(environment, {
        logger,
        keyManagement: kms.adapter,
        verifierForEndpoint: (adapterKey, endpointId) => {
          const selected =
            adapterKey === "fake" && endpointId === endpoint.endpointId;
          stages.push({ stage: "VERIFIER_SELECTION", selected });
          return selected
            ? {
                verifyPaymentWebhook: async (command) => {
                  const response = await verifier.verifyPaymentWebhook(command);
                  if (response.outcome === "SUCCESS") {
                    const timing = (
                      await client.query(
                        "SELECT (extract(epoch FROM ($1::timestamptz-$2::timestamptz))*1000000)::text AS occurred_minus_received_us",
                        [
                          response.value.candidate.occurredAt,
                          command.receivedAt,
                        ],
                      )
                    ).rows[0];
                    stages.push({ stage: "VERIFIED_TIMING", ...timing });
                  }
                  return response;
                },
              }
            : undefined;
        },
      });
      const route = composition.paymentWebhookRoute;
      app = await createApiApplication(environment, {
        ...composition,
        logger,
        paymentWebhookRoute: {
          ...route,
          endpointPreflight: async (command) => {
            const response = await route.endpointPreflight(command);
            stages.push({ stage: "PREFLIGHT", outcome: response.outcome });
            if (response.outcome !== "ELIGIBLE") {
              const matrix = (
                await client.query(
                  `SELECT count(*)::int AS endpoint_count,count(*) FILTER (WHERE a.status IN ('INTERNAL','ACTIVE'))::int AS account_eligible,count(*) FILTER (WHERE e.status='ACTIVE' AND e.retired_at IS NULL)::int AS endpoint_active,count(*) FILTER (WHERE e.active_from<=$2::timestamptz)::int AS eligible_at_received,min(extract(epoch FROM (e.active_from-$2::timestamptz))*1000000)::text AS active_minus_received_us,(extract(epoch FROM (clock_timestamp()-$2::timestamptz))*1000000)::text AS wall_minus_received_us FROM payment_webhook_endpoints e JOIN payment_provider_accounts a ON a.id=e.provider_account_id AND a.environment=e.environment WHERE e.id=$1::uuid`,
                  [command.endpointId, command.receivedAt],
                )
              ).rows[0];
              stages.push({ stage: "ELIGIBILITY", ...matrix });
            }
            return response;
          },
          receiver: {
            receive: async (command) => {
              const response = await route.receiver.receive(command);
              stages.push({
                stage: "RECEIVE",
                outcome: response.outcome,
                code: response.error?.code ?? null,
              });
              return response;
            },
          },
        },
      });
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      const rawBody = JSON.stringify({
        event_id: `p405-probe/${randomUUID()}`,
        created_at: (
          await client.query(
            `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
          )
        ).rows[0].at,
        resource: {
          kind: "payment",
          payment_reference: `unmatched/${randomUUID()}`,
          state: "captured",
          amount_minor: 1500,
          currency: "USD",
          transaction: {
            kind: "capture",
            reference: `capture/${randomUUID()}`,
          },
        },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", secret)
        .update(`${timestamp}.${rawBody}`)
        .digest("hex");
      await waitOrderPaymentReceiptClock({
        client,
        occurredAt: JSON.parse(rawBody).created_at,
        check: assert.ok,
      });
      const send = async (body, id = endpoint.endpointId) => {
        const response = await globalThis.fetch(
          `${base}/api/v1/webhooks/payments/${id}`,
          {
            method: "POST",
            redirect: "error",
            headers: {
              "content-type": "application/json",
              "x-fan-support-timestamp": timestamp,
              "x-fan-support-signature": `v1=${signature}`,
            },
            body,
            signal: globalThis.AbortSignal.timeout(5000),
          },
        );
        await response.arrayBuffer();
        stages.push({ stage: "HTTP", status: response.status });
        return response.status;
      };
      assert.equal(await send(rawBody + " "), 400);
      assert.equal(await send(rawBody, randomUUID()), 404);
      assert.equal(await send(rawBody), 202);
      const counts = (
        await client.query(
          "SELECT (SELECT count(*)::int FROM provider_events) AS events,(SELECT count(*)::int FROM webhook_inbox) AS inbox,(SELECT count(*)::int FROM orders) AS orders",
        )
      ).rows[0];
      assert.deepEqual(counts, { events: 1, inbox: 1, orders: 0 });
      result = { status: "PASS", counts, stages };
    } catch (error) {
      assertionFailure = error;
      result = {
        status: "FAIL",
        stages,
        name: error.name,
        code: /^[A-Z0-9_]+$/u.test(error.code ?? "") ? error.code : null,
      };
    } finally {
      await app?.close();
      await composition?.reliableEventsRuntime.stop();
      await telemetry?.shutdown();
      await client.end();
      secret.fill(0);
      kms.close();
    }
  });
  console.log(JSON.stringify(result));
  if (assertionFailure) throw assertionFailure;
  assert.equal(result.status, "PASS");
});
