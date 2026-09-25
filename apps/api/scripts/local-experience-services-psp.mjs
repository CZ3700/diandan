import { createHmac } from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import { paymentRuntimeProviderBindingSchema } from "@fan-support/contracts";
import { createPaymentTestPspStore } from "./payment-runtime-psp-store.mjs";
import {
  createLocalExperienceFetch,
  escapeHtml,
  htmlPage,
  readBody,
  secretBytes,
  secretEquals,
  startLocalTlsServer,
} from "./local-experience-services-common.mjs";

/** Durable provider facts are the retry source; acknowledgement receipts prevent unnecessary delivery. */
export async function createLocalPspDelivery({ config, pool, store }) {
  const account = config.services.psp.binding.providerAccountId;
  const endpoint = `http://127.0.0.1:${config.ports.api}/api/v1/webhooks/payments/${config.services.psp.webhookEndpointId}`;
  const verificationKey = secretBytes(config.secrets.webhookSecret);
  await pool.query(
    "CREATE TABLE IF NOT EXISTS local_experience_psp_deliveries(event_id text PRIMARY KEY,delivered_at timestamptz NOT NULL DEFAULT clock_timestamp())",
  );
  let stopped = false,
    timer,
    active;
  async function deliver(event) {
    const raw = JSON.stringify(event),
      timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", verificationKey)
      .update(timestamp)
      .update(".")
      .update(raw)
      .digest("hex");
    const response = await globalThis.fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fan-support-timestamp": timestamp,
        "x-fan-support-signature": `v1=${signature}`,
      },
      body: raw,
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(3000),
    });
    await response.body?.cancel();
    if (response.ok)
      await pool.query(
        "INSERT INTO local_experience_psp_deliveries(event_id) VALUES($1) ON CONFLICT DO NOTHING",
        [event.event_id],
      );
  }
  async function run() {
    // A local TEST refund settles automatically. The platform still requires signed evidence.
    const refunds = (
      await pool.query(
        "SELECT refund_id FROM psp_refunds WHERE account_id=$1 AND status='PROCESSING' LIMIT 100",
        [account],
      )
    ).rows;
    for (const row of refunds)
      await store.settleRefund(row.refund_id, "SUCCEEDED");
    const payments = (
      await pool.query(
        "SELECT attempt_id FROM psp_payments p WHERE account_id=$1 AND status<>'REQUIRES_ACTION' AND NOT EXISTS(SELECT 1 FROM local_experience_psp_deliveries d WHERE d.event_id='test-webhook/'||p.attempt_id::text||'/'||p.status) ORDER BY updated_at LIMIT 100",
        [account],
      )
    ).rows;
    for (const row of payments) {
      if (stopped) return;
      await deliver(await store.readWebhook(row.attempt_id));
    }
    const finishedRefunds = (
      await pool.query(
        "SELECT refund_id FROM psp_refunds p WHERE account_id=$1 AND status<>'PROCESSING' AND NOT EXISTS(SELECT 1 FROM local_experience_psp_deliveries d WHERE d.event_id='test-webhook/refund/'||p.refund_id::text||'/'||p.status) ORDER BY updated_at LIMIT 100",
        [account],
      )
    ).rows;
    for (const row of finishedRefunds) {
      if (stopped) return;
      await deliver(await store.readRefundWebhook(row.refund_id));
    }
  }
  const tick = () => {
    if (stopped) return;
    active = run()
      .catch(() => undefined)
      .finally(() => {
        if (!stopped) timer = globalThis.setTimeout(tick, 1000);
      });
  };
  tick();
  return {
    async close() {
      stopped = true;
      globalThis.clearTimeout(timer);
      await active;
      verificationKey.fill(0);
    },
  };
}

export async function startLocalExperiencePsp({ config, database, pool }) {
  const settings = config.services.psp,
    origin = config.origins.psp;
  const binding = paymentRuntimeProviderBindingSchema.parse(settings.binding);
  if (
    binding.environment !== "TEST" ||
    binding.providerCode !== "fake" ||
    binding.allowedActionOrigins.length !== 1 ||
    binding.allowedActionOrigins[0] !== origin
  )
    throw new TypeError("Invalid local TEST PSP binding");
  const secret = secretBytes(settings.authorizationToken);
  const store = await createPaymentTestPspStore({
    database,
    binding,
    origin,
    returnOrigin: config.origins.storefront,
    secret,
  });
  const formToken = (path) =>
    createHmac("sha256", secret)
      .update(`local-test-payment:${path}`)
      .digest("base64url");
  let server, delivery;
  try {
    server = await startLocalTlsServer({
      origin,
      tls: config.tls,
      async handle(request, response) {
        const url = new URL(request.url, origin);
        if (url.search || url.origin !== origin) {
          response.writeHead(400).end();
          return;
        }
        if (request.method === "POST" && url.pathname === "/v1/commands") {
          if (
            !secretEquals(
              request.headers.authorization,
              `Bearer ${settings.authorizationToken}`,
            ) ||
            request.headers.cookie ||
            request.headers["content-type"] !== "application/json"
          ) {
            request.resume();
            response.writeHead(401).end();
            return;
          }
          const result = await store.execute(
            JSON.parse(await readBody(request)),
          );
          response
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify(result));
          return;
        }
        const match = /^\/hosted\/([a-f\d-]{36})\/([A-Za-z0-9_-]{43})$/iu.exec(
          url.pathname,
        );
        if (!match || !["GET", "POST"].includes(request.method)) {
          request.resume();
          response.writeHead(404).end();
          return;
        }
        const value = await store.readHosted(match[1], match[2]);
        if (request.method === "POST") {
          const form = new URLSearchParams(await readBody(request));
          if (
            request.headers.origin !== origin ||
            !secretEquals(form.get("csrf"), formToken(url.pathname)) ||
            [...form.keys()].sort().join(",") !== "csrf,outcome" ||
            !["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].includes(
              form.get("outcome"),
            )
          ) {
            response.writeHead(403).end();
            return;
          }
          await store.settleHosted(match[1], match[2], form.get("outcome"));
          response
            .writeHead(303, {
              location:
                form.get("outcome") === "CANCELED"
                  ? value.cancelUrl
                  : value.returnUrl,
            })
            .end();
          return;
        }
        const ended = !["REQUIRES_ACTION", "PROCESSING"].includes(value.status);
        response
          .writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "referrer-policy": "strict-origin",
            "content-security-policy": `default-src 'none'; form-action 'self' ${config.origins.storefront}; base-uri 'none'; frame-ancestors 'none'`,
          })
          .end(
            htmlPage(
              "TEST payment — no real charge",
              `<p>Local hosted payment simulator. Do not enter card numbers, security codes or wallet credentials.</p><p>Test card networks: Visa / Mastercard. These controls simulate a result only.</p><p data-test-psp-amount>${escapeHtml(value.currency)} ${escapeHtml(value.amountMinor)} minor units</p><p data-test-psp-status>Provider status: ${escapeHtml(value.status)}</p>${ended ? `<p><a href="${escapeHtml(value.returnUrl)}">Return to the store</a></p>` : `<form method="post"><input type="hidden" name="csrf" value="${formToken(url.pathname)}"><p><button name="outcome" value="SUCCEEDED" data-test-psp-capture>Complete TEST payment</button></p><p><button name="outcome" value="FAILED" data-test-psp-fail>Simulate declined payment</button></p><p><button name="outcome" value="CANCELED" data-test-psp-cancel>Cancel TEST payment</button></p><p><button name="outcome" value="EXPIRED" data-test-psp-expire>Simulate expired payment</button></p></form>`}<p>Payment status in the store changes only after a signed provider event is received.</p>`,
            ),
          );
      },
    });
    delivery = await createLocalPspDelivery({ config, pool, store });
    const fetcher = await createLocalExperienceFetch({
      origins: [origin],
      caCertificatePath: config.tls.caCertificatePath,
    });
    let closing;
    return {
      origin,
      binding,
      fetch: fetcher,
      fetcher,
      counts: () => store.counts(),
      hostedAction: (id) => store.readHostedAction(id),
      close: () =>
        (closing ??= (async () => {
          await server.close();
          await delivery.close();
          await store.close();
          secret.fill(0);
        })()),
    };
  } catch (error) {
    await server?.close();
    await delivery?.close();
    await store.close();
    secret.fill(0);
    throw error;
  }
}
