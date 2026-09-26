// Sandbox verification for the Stripe adapter. It talks to Stripe test mode only and never prints secrets.
//
//   corepack pnpm --filter @fan-support/payment-stripe build
//   node packages/payment-stripe/scripts/stripe-sandbox.mjs [--no-wait] [--webhook-port 4242]
//
// Reads STRIPE_TEST_SECRET_KEY (and, with --webhook-port, STRIPE_TEST_WEBHOOK_SECRET printed by
// `stripe listen --forward-to localhost:4242/webhook`) from the repository .env file.
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createStripeAdapter } from "../dist/index.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const args = process.argv.slice(2);
const wait = !args.includes("--no-wait");
const webhookPort = args.includes("--webhook-port")
  ? Number(args[args.indexOf("--webhook-port") + 1])
  : undefined;

async function readDotenv() {
  const values = {};
  const text = await readFile(path.join(root, ".env"), "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^"(.*)"$/u, "$1");
  }
  return values;
}

const env = await readDotenv();
const secretKey = env.STRIPE_TEST_SECRET_KEY;
if (!/^(?:sk|rk)_test_/u.test(secretKey ?? ""))
  throw new Error(
    "Set a Stripe test-mode key as STRIPE_TEST_SECRET_KEY in .env",
  );
const webhookSecret = env.STRIPE_TEST_WEBHOOK_SECRET;
if (webhookPort !== undefined && !/^whsec_/u.test(webhookSecret ?? ""))
  throw new Error(
    "--webhook-port needs STRIPE_TEST_WEBHOOK_SECRET from `stripe listen`",
  );

const account = "10000000-0000-4000-8000-0000000000ab";
const connection = {
  schemaVersion: 1,
  binding: {
    schemaVersion: 1,
    providerAccountId: account,
    providerCode: "stripe",
    environment: "TEST",
    localeMapping: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        {
          providerLocale:
            locale === "zh-CN" ? "zh" : locale === "pt" ? "pt-BR" : locale,
          fallbackUsed: false,
        },
      ]),
    ),
    allowedActionOrigins: ["https://checkout.stripe.com"],
  },
  adapterVersion: "1.0.0",
  protocol: "stripe-checkout-v1",
  apiOrigin: "https://api.stripe.com",
  returnOrigin: "https://example.com",
  merchantAccount: "fan-support-sandbox",
  credentialRef: "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_API",
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
      request.purpose === "API_AUTH" ? [secretKey] : [webhookSecret ?? ""],
  }),
};
const adapter = createStripeAdapter({ credentials });
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

function createCommand(attemptId, amountMinor = 2500) {
  return {
    ...identity,
    operation: "CREATE_PAYMENT",
    attemptId,
    orderId: randomUUID(),
    paymentMethod: "card",
    amountMinor,
    currency: "USD",
    requestedLocale: "en",
    merchantReference: attemptId,
    providerIdempotencyKey: attemptId,
    returnUrl: "https://example.com/return",
    cancelUrl: "https://example.com/cancel",
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

let server;
if (webhookPort !== undefined) {
  const endpointId = "70000000-0000-4000-8000-0000000000ab";
  const verifier = adapter.createWebhookVerifier(
    {
      schemaVersion: 1,
      binding: connection.binding,
      endpointId,
      verificationKeyReferenceHash: "b".repeat(64),
      secretRef: "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_WEBHOOK",
      toleranceSeconds: 300,
      maxBodyBytes: 65536,
    },
    connection,
  );
  server = createServer((request, response) => {
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
        verificationKeyReferenceHash: "b".repeat(64),
        rawBodyBase64: raw.toString("base64url"),
        headers: {
          "stripe-signature": String(request.headers["stripe-signature"] ?? ""),
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
      response.writeHead(result.outcome === "SUCCESS" ? 202 : 400).end();
    });
  });
  await new Promise((resolve) =>
    server.listen(webhookPort, "127.0.0.1", resolve),
  );
  console.log(
    `Listening for forwarded Stripe events on http://127.0.0.1:${webhookPort}/webhook`,
  );
}

try {
  const attemptId = randomUUID();
  const created = await provider.createPayment(createCommand(attemptId));
  check(
    "create returns a hosted Checkout redirect",
    created.outcome === "SUCCESS" && created.value.action?.type === "REDIRECT",
  );
  const replayed = await provider.createPayment(createCommand(attemptId));
  check(
    "same attempt replays the same session",
    replayed.outcome === "SUCCESS" &&
      replayed.value.externalReference === created.value.externalReference,
  );
  const scanned = await provider.reconcilePayment(reconcileCommand(attemptId));
  check(
    "reconcile without a reference finds the open session",
    scanned.outcome === "SUCCESS" &&
      scanned.value.event.association.externalReference ===
        created.value.externalReference,
  );
  if (wait) {
    console.log(
      `\nPay with card 4242 4242 4242 4242 (any future date/CVC):\n${created.value.action.url}\n`,
    );
    let status;
    for (let round = 0; round < 60 && status !== "SUCCEEDED"; round++) {
      await delay(5000);
      const read = await provider.getPayment({
        ...identity,
        operation: "GET_PAYMENT",
        attemptId,
        externalReference: created.value.externalReference,
      });
      status = read.outcome === "SUCCESS" ? read.value.status : read.error.code;
    }
    check("payment succeeds after hosted checkout", status === "SUCCEEDED");
    const withReference = await provider.reconcilePayment(
      reconcileCommand(attemptId, created.value.externalReference),
    );
    check(
      "reconcile reports a matched capture",
      withReference.outcome === "SUCCESS" &&
        withReference.value.event.status === "SUCCEEDED",
    );
    let bySearch;
    for (let round = 0; round < 24; round++) {
      bySearch = await provider.reconcilePayment(reconcileCommand(attemptId));
      if (
        bySearch.outcome === "SUCCESS" &&
        bySearch.value.event.status === "SUCCEEDED"
      )
        break;
      await delay(5000);
    }
    check(
      "reconcile without a reference finds the paid attempt by metadata",
      bySearch?.outcome === "SUCCESS" &&
        bySearch.value.event.status === "SUCCEEDED",
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
    check("partial refund is submitted", refunded.outcome === "SUCCESS");
    const again = await provider.refundPayment(refundCommand);
    check(
      "repeating the refund command never refunds twice",
      again.outcome === "SUCCESS",
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
  const canceled = await provider.cancelPayment({
    ...identity,
    operation: "CANCEL_PAYMENT",
    attemptId: cancelAttempt,
    externalReference: toCancel.value.externalReference,
    idempotencyKey: randomUUID(),
    reasonCode: "SANDBOX_CANCEL",
  });
  check(
    "cancel expires an open session",
    canceled.outcome === "SUCCESS" && canceled.value.status === "CANCELED",
  );
} finally {
  const directory = path.join(root, "output/checks/r1-03-stripe-sandbox");
  await mkdir(directory, { recursive: true });
  const file = path.join(
    directory,
    `${new Date().toISOString().replaceAll(":", "-")}.json`,
  );
  await writeFile(
    file,
    `${JSON.stringify({ schemaVersion: 1, environment: "TEST", waited: wait, checks }, null, 2)}\n`,
  );
  console.log(`Summary written to ${path.relative(root, file)}`);
  if (server) await new Promise((resolve) => server.close(resolve));
}
