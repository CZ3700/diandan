import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URLSearchParams } from "node:url";
import { Client } from "pg";
import { createPersistentTestPaymentProvider } from "@fan-support/payment-fake/persistent-http";
import { loadLocalState } from "../../../scripts/local-experience-state.mjs";
import { prepareLocalTls } from "./local-experience-infrastructure.mjs";
import { startLocalExperienceServices } from "./local-experience-services.mjs";
import { withNativeFinancePostgres } from "./admin-finance-native-postgres.mjs";

async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error("Local service recovery timed out");
}
/** Actual TLS/PG provider restart proof; full production webhook ingest is separately verified by the experience flow. */
export async function verifyLocalExperienceServices({ binDirectory }) {
  const root = await mkdtemp(path.join(tmpdir(), "fan-local-services-"));
  let proof;
  try {
    const state = await loadLocalState(root, "test");
    await prepareLocalTls(state);
    await withNativeFinancePostgres(
      async (base) => {
        const { config } = state;
        config.ports.postgres = base.port;
        const admin = new Client(base);
        await admin.connect();
        try {
          await admin.query("CREATE DATABASE fan_support_local");
        } finally {
          await admin.end();
        }
        const database = { ...base, database: config.database.database };
        const events = new Set();
        let acknowledge = false,
          received = 0;
        const receiver = createServer(async (request, response) => {
          const parts = [];
          for await (const chunk of request) parts.push(chunk);
          const raw = Buffer.concat(parts).toString("utf8"),
            timestamp = request.headers["x-fan-support-timestamp"];
          const expected = `v1=${createHmac("sha256", Buffer.from(config.secrets.webhookSecret, "base64url")).update(timestamp).update(".").update(raw).digest("hex")}`;
          assert.equal(request.headers["x-fan-support-signature"], expected);
          assert.equal(
            request.url,
            `/api/v1/webhooks/payments/${config.services.psp.webhookEndpointId}`,
          );
          received += 1;
          if (acknowledge) events.add(JSON.parse(raw).event_id);
          response.writeHead(acknowledge ? 200 : 503).end();
        });
        await new Promise((resolve) =>
          receiver.listen(config.ports.api, "127.0.0.1", resolve),
        );
        let services;
        try {
          services = await startLocalExperienceServices({ ...state, database });
          const adapter = () =>
            createPersistentTestPaymentProvider({
              binding: services.psp.binding,
              endpointOrigin: services.psp.origin,
              returnOrigin: config.origins.storefront,
              authorizationToken: config.services.psp.authorizationToken,
              fetcher: services.psp.fetcher,
            });
          const attempt = randomUUID();
          const create = {
            schemaVersion: 1,
            operation: "CREATE_PAYMENT",
            providerAccountId: services.psp.binding.providerAccountId,
            environment: "TEST",
            attemptId: attempt,
            orderId: randomUUID(),
            paymentMethod: "fake_card",
            amountMinor: 1500,
            currency: "USD",
            requestedLocale: "en",
            merchantReference: attempt,
            providerIdempotencyKey: attempt,
            returnUrl: `${config.origins.storefront}/en/checkout/return`,
            cancelUrl: `${config.origins.storefront}/en/checkout/return`,
          };
          const payment = await adapter().createPayment(create);
          assert.equal(payment.outcome, "SUCCESS");
          const hosted = payment.value.action.url,
            page = await (await services.psp.fetcher(hosted)).text(),
            csrf = /name="csrf" value="([^"]+)"/u.exec(page)[1];
          assert.equal(
            (
              await services.psp.fetcher(hosted, {
                method: "POST",
                headers: {
                  origin: services.psp.origin,
                  "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({ csrf, outcome: "SUCCEEDED" }),
              })
            ).status,
            303,
          );
          await until(() => received > 0);
          const mailId = randomUUID();
          const mail = {
            schemaVersion: 1,
            operation: "SEND_NOTIFICATION",
            channel: "EMAIL",
            recipient: "local-test@example.test",
            dispatchNotAfter: new Date(Date.now() + 60000).toISOString(),
            notification: {
              schemaVersion: 1,
              id: mailId,
              orderId: mailId,
              customerContactId: mailId,
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
              idempotencyKey: `notification:${mailId}`,
              correlationId: mailId,
            },
            content: {
              subject: "TEST receipt",
              preheader: "TEST only",
              html: "<p>TEST receipt</p>",
              text: "SYNTHETIC_MAIL_PRIVATE_CANARY",
            },
          };
          const sent = await services.mail.transport.sendEmail(mail);
          assert.equal(sent.value?.status, "ACCEPTED");
          const oldKey = (
            await (
              await services.oidc.fetch(`${services.oidc.issuer}/jwks`)
            ).json()
          ).keys[0];
          await services.close();
          services = undefined;
          acknowledge = true;
          services = await startLocalExperienceServices({ ...state, database });
          await until(() => events.has(`test-webhook/${attempt}/SUCCEEDED`));
          assert.deepEqual(
            (
              await (
                await services.oidc.fetch(`${services.oidc.issuer}/jwks`)
              ).json()
            ).keys[0],
            oldKey,
          );
          assert.equal((await services.psp.counts()).captures, 1);
          assert.deepEqual(await services.mail.transport.sendEmail(mail), sent);
          const session = await services.mail.fetcher(
            `${config.origins.mail}/session`,
            {
              method: "POST",
              headers: {
                origin: config.origins.mail,
                "content-type": "application/json",
              },
              body: JSON.stringify({ token: config.services.mail.viewerToken }),
            },
          );
          assert.equal(session.status, 204);
          const inbox = await (
            await services.mail.fetcher(config.origins.mail, {
              headers: {
                cookie: session.headers.get("set-cookie").split(";")[0],
              },
            })
          ).text();
          assert(inbox.includes("SYNTHETIC_MAIL_PRIVATE_CANARY"));
          assert(
            !(
              await (await services.mail.fetcher(config.origins.mail)).text()
            ).includes("SYNTHETIC_MAIL_PRIVATE_CANARY"),
          );
          const refundId = randomUUID(),
            refund = {
              schemaVersion: 1,
              operation: "REFUND_PAYMENT",
              providerAccountId: services.psp.binding.providerAccountId,
              environment: "TEST",
              refundId,
              paymentAttemptId: attempt,
              externalReference: payment.value.externalReference,
              refundReference: `refund/${refundId}`,
              amountMinor: 900,
              currency: "USD",
              idempotencyKey: refundId,
            };
          assert.equal(
            (await adapter().refundPayment(refund)).value.status,
            "PROCESSING",
          );
          await until(() =>
            events.has(`test-webhook/refund/${refundId}/SUCCEEDED`),
          );
          await services.close();
          services = undefined;
          services = await startLocalExperienceServices({ ...state, database });
          const reconciled = await adapter().reconcileRefund({
            ...refund,
            operation: "RECONCILE_REFUND",
            auditLogId: randomUUID(),
          });
          assert.equal(reconciled.value.event.status, "SUCCEEDED");
          assert.equal((await services.psp.counts()).refunds, 1);
          assert.equal((await services.psp.counts()).refundCalls, 1);
          const provider = new Client({
            ...database,
            database: config.services.psp.databaseName,
          });
          await provider.connect();
          try {
            const rows = await provider.query(
              "SELECT * FROM local_experience_mail",
            );
            assert.equal(rows.rowCount, 1);
            const persisted = JSON.stringify(rows.rows);
            assert(!persisted.includes("SYNTHETIC_MAIL_PRIVATE_CANARY"));
            assert(!persisted.includes(mail.recipient));
          } finally {
            await provider.end();
          }
          proof = {
            schemaVersion: 1,
            status: "PASS",
            actualTls: true,
            actualPostgres: true,
            serviceRestarts: 2,
            paymentCaptures: 1,
            providerRefunds: 1,
            refundCalls: 1,
            signedEventsAfterRecovery: events.size,
            mailReceipts: 1,
            plaintextCapturePersisted: false,
            externalDelivery: false,
          };
        } finally {
          await services?.close();
          receiver.closeAllConnections();
          await new Promise((resolve) => receiver.close(resolve));
        }
      },
      { binDirectory },
    );
    return proof;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const binDirectory = process.env.FAN_SUPPORT_LOCAL_POSTGRES_BIN;
  if (!binDirectory)
    throw new Error(
      "Set FAN_SUPPORT_LOCAL_POSTGRES_BIN to the existing PostgreSQL 18 bin directory",
    );
  console.log(
    JSON.stringify(await verifyLocalExperienceServices({ binDirectory })),
  );
}
