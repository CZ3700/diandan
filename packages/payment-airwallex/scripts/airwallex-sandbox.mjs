// Sandbox verification for the Airwallex adapter. It talks to the Airwallex sandbox only and never
// prints secrets.
//
//   corepack pnpm --filter @fan-support/payment-airwallex sandbox [-- --no-wait]
//     [--launch-port 4243] [--webhook-port 4244]
//
// Reads AIRWALLEX_TEST_CLIENT_ID and AIRWALLEX_TEST_API_KEY (and, with --webhook-port,
// AIRWALLEX_TEST_WEBHOOK_SECRET of a sandbox webhook whose notification URL tunnels to that
// port) from the repository .env file. The Hosted Payment Page can only be opened by
// Airwallex.js in a browser, so the script serves a local launcher page for the test payment.
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  SUPPORTED_LOCALES,
  decodeAirwallexHppClientToken,
} from "@fan-support/contracts";
import { createAirwallexAdapter } from "../dist/index.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const args = process.argv.slice(2);
const wait = !args.includes("--no-wait");
const option = (name, fallback) =>
  args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback;
const launchPort = option("--launch-port", 4243);
const webhookPort = option("--webhook-port", undefined);

async function readDotenv() {
  const values = {};
  const text = await readFile(path.join(root, ".env"), "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^"(.*)"$/u, "$1");
  }
  return values;
}

/** Describes a secret's shape without revealing it, to check the adapter's format rules. */
const shape = (value) => ({
  length: value.length,
  alphabet: [
    /[a-z]/u.test(value) && "a-z",
    /[A-Z]/u.test(value) && "A-Z",
    /[0-9]/u.test(value) && "0-9",
    ...new Set(value.replace(/[A-Za-z0-9]/gu, "")),
  ].filter(Boolean),
});

const env = await readDotenv();
const clientId = env.AIRWALLEX_TEST_CLIENT_ID ?? "";
const apiKey = env.AIRWALLEX_TEST_API_KEY ?? "";
if (!clientId || !apiKey)
  throw new Error(
    "Set AIRWALLEX_TEST_CLIENT_ID and AIRWALLEX_TEST_API_KEY (sandbox) in .env",
  );
const webhookSecret = env.AIRWALLEX_TEST_WEBHOOK_SECRET ?? "";
if (webhookPort !== undefined && !webhookSecret)
  throw new Error("--webhook-port needs AIRWALLEX_TEST_WEBHOOK_SECRET in .env");
const facts = {
  clientId: shape(clientId),
  apiKey: shape(apiKey),
  ...(webhookSecret ? { webhookSecret: shape(webhookSecret) } : {}),
};

const account = "10000000-0000-4000-8000-0000000000ac";
const hppLocales = { "zh-CN": "zh", th: "en" };
const connection = {
  schemaVersion: 1,
  binding: {
    schemaVersion: 1,
    providerAccountId: account,
    providerCode: "airwallex",
    environment: "TEST",
    localeMapping: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        {
          providerLocale: hppLocales[locale] ?? locale,
          fallbackUsed: locale === "th",
        },
      ]),
    ),
    allowedActionOrigins: ["https://checkout.sandbox.airwallex.com"],
  },
  adapterVersion: "1.0.0",
  protocol: "airwallex-hpp-v1",
  apiOrigin: "https://api.sandbox.airwallex.com",
  returnOrigin: "https://example.com",
  merchantAccount: "fan-support-sandbox",
  credentialRef: "secret-ref:v1:env:PAYMENT_SECRET_AIRWALLEX_API",
  timeoutMs: 15000,
  instruments: [
    {
      kind: "CARD",
      paymentMethod: "card",
      brands: ["VISA", "MASTERCARD"],
      authentication: "PSP_MANAGED_3DS",
      capture: "AUTOMATIC",
    },
  ],
};
const credentials = {
  resolve: async (request) => ({
    ...request,
    version: "sandbox",
    values:
      request.purpose === "API_AUTH"
        ? [`${clientId}:${apiKey}`]
        : [webhookSecret],
  }),
};
const adapter = createAirwallexAdapter({ credentials });
const provider = adapter.connector.create(connection).provider;
const identity = {
  schemaVersion: 1,
  providerAccountId: account,
  environment: "TEST",
};
const checks = [];
function check(name, condition, detail = {}) {
  checks.push({ name, pass: Boolean(condition), ...detail });
  console.log(`${condition ? "PASS" : "FAIL"} ${name}`);
  if (!condition) throw new Error(`Sandbox check failed: ${name}`);
}
const errorOf = (response) =>
  response.outcome === "SUCCESS" ? undefined : response.error.code;

function createCommand(attemptId, amountMinor = 2500, requestedLocale = "en") {
  const returnUrl = `https://example.com/${requestedLocale}/checkout/return?session=${randomUUID()}&attempt=${attemptId}`;
  return {
    ...identity,
    operation: "CREATE_PAYMENT",
    attemptId,
    orderId: randomUUID(),
    paymentMethod: "card",
    amountMinor,
    currency: "USD",
    requestedLocale,
    merchantReference: attemptId,
    providerIdempotencyKey: attemptId,
    returnUrl,
    cancelUrl: returnUrl,
  };
}
function reconcileCommand(attemptId, externalReference, amountMinor = 2500) {
  return {
    ...identity,
    operation: "RECONCILE_PAYMENT",
    attemptId,
    merchantReference: attemptId,
    providerIdempotencyKey: attemptId,
    amountMinor,
    currency: "USD",
    auditLogId: randomUUID(),
    ...(externalReference ? { externalReference } : {}),
  };
}

/** The same Airwallex.js call the storefront launcher makes, on a page only this machine can open. */
function launcherPage(launch) {
  const data = JSON.stringify(launch).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Airwallex sandbox</title>
<p>Opening the Airwallex Hosted Payment Page…</p>
<script src="https://static.airwallex.com/components/sdk/v1/index.js"></script>
<script>
(async () => {
  const launch = ${data};
  const { payments } = await window.AirwallexComponentsSDK.init({ env: launch.env, enabledElements: ["payments"] });
  payments.redirectToCheckout({ env: launch.env, mode: "payment", intent_id: launch.intentId,
    client_secret: launch.clientSecret, currency: launch.currency, locale: launch.locale,
    cancelUrl: launch.cancelUrl, methods: ["card", "applepay", "googlepay"] });
})().catch((error) => { document.body.textContent = "Launch failed: " + error; });
</script></html>`;
}

const servers = [];
if (webhookPort !== undefined) {
  const endpointId = "70000000-0000-4000-8000-0000000000ac";
  const hash = "d".repeat(64);
  const verifier = adapter.createWebhookVerifier(
    {
      schemaVersion: 1,
      binding: connection.binding,
      endpointId,
      verificationKeyReferenceHash: hash,
      secretRef: "secret-ref:v1:env:PAYMENT_SECRET_AIRWALLEX_WEBHOOK",
      toleranceSeconds: 300,
      maxBodyBytes: 65536,
    },
    connection,
  );
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const raw = Buffer.concat(chunks);
      const result = await verifier.verifyPaymentWebhook({
        schemaVersion: 1,
        operation: "VERIFY_PAYMENT_WEBHOOK",
        endpointId,
        providerAccountId: account,
        environment: "TEST",
        verificationKeyReferenceHash: hash,
        rawBodyBase64: raw.toString("base64url"),
        headers: {
          "x-signature": String(request.headers["x-signature"] ?? ""),
          "x-timestamp": String(request.headers["x-timestamp"] ?? ""),
        },
        receivedAt: new Date().toISOString(),
      });
      const summary =
        result.outcome === "SUCCESS"
          ? {
              eventType: result.value.candidate.eventType,
              status: result.value.candidate.status,
            }
          : { error: result.error.code };
      checks.push({
        name: "webhook",
        pass:
          result.outcome === "SUCCESS" ||
          result.error.code === "UNSUPPORTED_EVENT",
        ...summary,
      });
      console.log(`WEBHOOK ${JSON.stringify(summary)}`);
      // Airwallex retries anything but 200; unsupported events are acknowledged.
      response
        .writeHead(
          result.outcome === "SUCCESS" ||
            result.error.code === "UNSUPPORTED_EVENT"
            ? 200
            : 400,
        )
        .end();
    });
  });
  await new Promise((resolve) =>
    server.listen(webhookPort, "127.0.0.1", resolve),
  );
  servers.push(server);
  console.log(
    `Verifying webhooks tunnelled to http://127.0.0.1:${webhookPort}/`,
  );
}

try {
  const attemptId = randomUUID();
  const command = createCommand(attemptId, 2500, "zh-CN");
  const created = await provider.createPayment(command);
  check(
    "create returns the Hosted Payment Page component",
    created.outcome === "SUCCESS" &&
      created.value.action?.type === "PROVIDER_COMPONENT",
    { error: errorOf(created) },
  );
  const launch = decodeAirwallexHppClientToken(
    created.value.action.clientToken,
  );
  facts.clientSecretLength = launch?.clientSecret.length;
  facts.clientTokenLength = created.value.action.clientToken.length;
  check(
    "the client token carries the intent, sandbox environment and zh locale",
    launch?.env === "sandbox" &&
      launch.locale === "zh" &&
      created.value.providerLocale === "zh",
  );
  const replayed = await provider.createPayment(command);
  check(
    "repeating the create finds the same intent after duplicate_request",
    replayed.outcome === "SUCCESS" &&
      replayed.value.externalReference === created.value.externalReference,
    { error: errorOf(replayed) },
  );
  const found = await provider.reconcilePayment(reconcileCommand(attemptId));
  check(
    "reconcile without a reference finds the intent by merchant order ID",
    found.outcome === "SUCCESS" &&
      found.value.event.association.externalReference ===
        created.value.externalReference,
    { error: errorOf(found) },
  );
  if (wait) {
    const launcher = createServer((request, response) => {
      response
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        })
        .end(launcherPage(launch));
    });
    await new Promise((resolve) =>
      launcher.listen(launchPort, "127.0.0.1", resolve),
    );
    servers.push(launcher);
    console.log(
      `\nOpen http://127.0.0.1:${launchPort}/ and pay with card 4035 5010 0000 0008 (any future date, any CVC).`,
    );
    console.log(
      "After paying, Airwallex returns to example.com: note whether it added query parameters beyond session and attempt.\n",
    );
    let status;
    for (let round = 0; round < 72 && status !== "SUCCEEDED"; round++) {
      await delay(5000);
      const read = await provider.getPayment({
        ...identity,
        operation: "GET_PAYMENT",
        attemptId,
        externalReference: created.value.externalReference,
      });
      status = read.outcome === "SUCCESS" ? read.value.status : read.error.code;
    }
    check(
      "payment succeeds on the Hosted Payment Page",
      status === "SUCCEEDED",
    );
    const matched = await provider.reconcilePayment(
      reconcileCommand(attemptId, created.value.externalReference),
    );
    check(
      "reconcile reports a matched capture",
      matched.outcome === "SUCCESS" &&
        matched.value.event.status === "SUCCEEDED" &&
        matched.value.event.transaction?.type === "CAPTURE",
    );
    const refundId = randomUUID();
    const refundCommand = {
      ...identity,
      operation: "REFUND_PAYMENT",
      refundId,
      paymentAttemptId: attemptId,
      externalReference: created.value.externalReference,
      refundReference: `sandbox-refund-${refundId.slice(0, 8)}`,
      amountMinor: 500,
      currency: "USD",
      idempotencyKey: refundId,
    };
    const refunded = await provider.refundPayment(refundCommand);
    check("partial refund is submitted", refunded.outcome === "SUCCESS", {
      error: errorOf(refunded),
    });
    const again = await provider.refundPayment(refundCommand);
    check(
      "repeating the refund command finds the same refund",
      again.outcome === "SUCCESS",
      { error: errorOf(again) },
    );
    let refundStatus;
    for (let round = 0; round < 24 && refundStatus !== "SUCCEEDED"; round++) {
      const reconciled = await provider.reconcileRefund({
        ...refundCommand,
        operation: "RECONCILE_REFUND",
        auditLogId: randomUUID(),
      });
      refundStatus =
        reconciled.outcome === "SUCCESS"
          ? reconciled.value.event.status
          : reconciled.error.code;
      if (refundStatus !== "SUCCEEDED") await delay(5000);
    }
    check("refund reconcile reaches SUCCEEDED", refundStatus === "SUCCEEDED");
  }
  const cancelAttempt = randomUUID();
  const toCancel = await provider.createPayment(
    createCommand(cancelAttempt, 1200),
  );
  const cancel = {
    ...identity,
    operation: "CANCEL_PAYMENT",
    attemptId: cancelAttempt,
    externalReference: toCancel.value.externalReference,
    idempotencyKey: randomUUID(),
    reasonCode: "SANDBOX_CANCEL",
  };
  const canceled = await provider.cancelPayment(cancel);
  check(
    "cancel closes an unpaid intent",
    canceled.outcome === "SUCCESS" && canceled.value.status === "CANCELED",
    { error: errorOf(canceled) },
  );
  const recanceled = await provider.cancelPayment(cancel);
  check(
    "repeating the cancel reports the cancellation again",
    recanceled.outcome === "SUCCESS" && recanceled.value.status === "CANCELED",
    { error: errorOf(recanceled) },
  );
} finally {
  const directory = path.join(root, "output/checks/r1-03b-airwallex-sandbox");
  await mkdir(directory, { recursive: true });
  const file = path.join(
    directory,
    `${new Date().toISOString().replaceAll(":", "-")}.json`,
  );
  await writeFile(
    file,
    `${JSON.stringify({ schemaVersion: 1, environment: "TEST", waited: wait, facts, checks }, null, 2)}\n`,
  );
  console.log(`Summary written to ${path.relative(root, file)}`);
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(resolve))),
  );
}
