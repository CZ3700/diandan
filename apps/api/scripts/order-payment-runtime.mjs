import { createHash, randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { createFakePaymentWebhookVerifier } from "@fan-support/payment-fake";
import { createStructuredLogger } from "@fan-support/observability";
import { startNodeTelemetry } from "@fan-support/observability/node";
import { createApiApplication } from "../dist/bootstrap.js";
import { createApiReliableEventsComposition } from "../dist/reliable-events-composition.js";
import { createWorkerReliableEventsComposition } from "../../worker/dist/reliable-events-composition.js";
import { createReliableEventsWorkerRuntime } from "../../worker/dist/reliable-events-runtime.js";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { publicationMediaEnvironment } from "./publication-runtime-http-media.mjs";
import { withPaymentRuntimeFixture } from "./payment-runtime-runtime.mjs";
import { prepareOrderPaymentQueue } from "./order-payment-queue.mjs";

/** The independent TEST PSP and HTTP process must reach the same real causal instant. */
export async function waitOrderPaymentReceiptClock({
  client,
  occurredAt,
  check,
}) {
  const started = performance.now();
  let ready = false;
  while (performance.now() - started < 10000) {
    ready =
      (
        await client.query(
          `SELECT $1::timestamptz <= $2::timestamptz AND $1::timestamptz <= clock_timestamp() AS ready`,
          [occurredAt, new Date().toISOString()],
        )
      ).rows[0]?.ready === true;
    if (ready) break;
    await delay(10);
  }
  check(
    ready,
    "Real HTTP receipt clock reaches the original signed TEST PSP event instant without modifying its bytes or timestamp",
  );
}

/** Only TEST endpoint configuration is seeded; orders/evidence/effects use normal HTTP and workers. */
export async function seedOrderPaymentEndpoint({ client, published, check }) {
  const endpointId = randomUUID(),
    auditId = randomUUID();
  const providerAccountId = published.routes[0].providerAccountId;
  const secretRef = `secret-ref:v1:test:p405/webhook/${endpointId}`;
  const verificationKeyReferenceHash = createHash("sha256")
    .update(secretRef)
    .digest("hex");
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO audit_logs(id,actor_type,task_name,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome) VALUES($1::uuid,'SYSTEM','order-payment-test','PAYMENT_WEBHOOK_ENDPOINT_ACTIVATED','PAYMENT_WEBHOOK_ENDPOINT',$2::uuid,'INITIAL_ENDPOINT',$3::uuid,$4::uuid,'SUCCEEDED')`,
      [auditId, endpointId, randomUUID(), randomUUID()],
    );
    await client.query(
      `INSERT INTO payment_webhook_endpoints(id,provider_account_id,environment,verification_secret_ref,verification_key_reference_hash,status,active_from,lifecycle_audit_log_id) VALUES($1::uuid,$2::uuid,'TEST',$3,$4,'ACTIVE',transaction_timestamp(),$5::uuid)`,
      [
        endpointId,
        providerAccountId,
        secretRef,
        verificationKeyReferenceHash,
        auditId,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  check(
    true,
    "TEST endpoint and lifecycle audit commit under ordinary database guards",
  );
  const started = performance.now();
  let eligible = false;
  while (performance.now() - started < 10000) {
    eligible =
      (
        await client.query(
          `SELECT active_from<=$2::timestamptz AS eligible FROM payment_webhook_endpoints WHERE id=$1::uuid`,
          [endpointId, new Date().toISOString()],
        )
      ).rows[0]?.eligible === true;
    if (eligible) break;
    await delay(10);
  }
  check(
    eligible,
    "Real HTTP receipt clock reaches the normally committed TEST endpoint activation without changing either clock",
  );
  return { endpointId, providerAccountId, verificationKeyReferenceHash };
}

export async function withOrderPaymentFixture(options) {
  return withPaymentRuntimeFixture({
    ...options,
    verify: async (context) => {
      context.progress("normal TEST webhook endpoint configuration");
      const endpoint = await seedOrderPaymentEndpoint(context);
      context.progress(
        "provision owned durable event queue before VERIFY runtimes",
      );
      await prepareOrderPaymentQueue(context.database);
      const telemetry = startNodeTelemetry({ service: "api" });
      context.own("order payment API and worker telemetry", () =>
        telemetry.shutdown(),
      );
      const secret = randomBytes(32);
      context.own("TEST webhook signing key", () => secret.fill(0));
      const verifier = createFakePaymentWebhookVerifier({
        ...endpoint,
        environment: "TEST",
        verificationSecret: secret,
      });
      const environment = {
        ...publicationMediaEnvironment(
          preflightEnvironment(context.database),
          options.s3,
        ),
        FAN_SUPPORT_SITE_ORIGIN: context.origin,
        FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: context.gateway.origin,
      };
      const logger = createStructuredLogger({
        service: "api",
        write: (entry) => context.logLines.push(entry),
      });
      const ingress = createApiReliableEventsComposition(environment, {
        logger,
        keyManagement: context.kms.adapter,
        verifierForEndpoint: (adapterKey, endpointId) =>
          adapterKey === "fake" && endpointId === endpoint.endpointId
            ? verifier
            : undefined,
      });
      context.progress("start actual signed webhook HTTP ingress");
      context.own("order payment webhook ingress composition", () =>
        ingress.reliableEventsRuntime.stop(),
      );
      const app = await createApiApplication(environment, {
        ...ingress,
        logger,
      });
      context.own("order payment webhook HTTP", () => app.close());
      await app.listen(0, "127.0.0.1");
      const webhookBase = await app.getUrl();
      async function createOrderWorker() {
        let runtime;
        const composition = createWorkerReliableEventsComposition(environment, {
          logger: createStructuredLogger({
            service: "worker",
            write: (entry) => context.logLines.push(entry),
          }),
          factories: {
            createRuntime(configuration) {
              runtime = createReliableEventsWorkerRuntime({
                ...configuration,
                schedule: () => ({ cancel() {} }),
              });
              return runtime;
            },
          },
        });
        context.own("order payment real worker", () => composition.stop());
        await composition.start();
        return {
          stop: () => composition.stop(),
          maintenance: () => runtime.runMaintenanceOnce(),
        };
      }
      return options.verify({
        ...context,
        endpoint,
        webhookBase,
        createOrderWorker,
        signDisputeWebhook: async (disputeId) => {
          const signed = await context.psp.webhook({
            disputeId,
            verificationSecret: secret.toString("base64url"),
          });
          await waitOrderPaymentReceiptClock({
            client: context.client,
            occurredAt: JSON.parse(signed.rawBody).created_at,
            check: context.check,
          });
          return signed;
        },
        signRefundWebhook: async (refundId) => {
          const signed = await context.psp.webhook({
            refundId,
            verificationSecret: secret.toString("base64url"),
          });
          await waitOrderPaymentReceiptClock({
            client: context.client,
            occurredAt: JSON.parse(signed.rawBody).created_at,
            check: context.check,
          });
          return signed;
        },
        signWebhook: async (attemptId) => {
          const signed = await context.psp.webhook({
            attemptId,
            verificationSecret: secret.toString("base64url"),
          });
          await waitOrderPaymentReceiptClock({
            client: context.client,
            occurredAt: JSON.parse(signed.rawBody).created_at,
            check: context.check,
          });
          return signed;
        },
        async sendWebhook(
          signed,
          {
            endpointId = endpoint.endpointId,
            rawBody = signed.rawBody,
            headers = signed.headers,
          } = {},
        ) {
          const response = await globalThis.fetch(
            `${webhookBase}/api/v1/webhooks/payments/${endpointId}`,
            {
              method: "POST",
              redirect: "error",
              headers: { "content-type": "application/json", ...headers },
              body: rawBody,
              signal: globalThis.AbortSignal.timeout(30_000),
            },
          );
          const body = await response.text();
          console.log(
            `Order payment webhook HTTP ${JSON.stringify({ status: response.status })}`,
          );
          return {
            status: response.status,
            accepted:
              response.status === 202 && JSON.parse(body).status === "accepted",
            body,
          };
        },
      });
    },
  });
}
