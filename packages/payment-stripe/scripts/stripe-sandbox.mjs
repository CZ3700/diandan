// Stripe test-mode adapter verification only; never verifies the site's DB/worker/order flow.
// Build the adapter first, then run with --check-config, --no-wait, or --webhook-port 4242.
// Process environment overrides the repository .env. Hosted Checkout URLs go to owner-only files.
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import {
  createWebhookEvidence,
  startWebhookServer,
} from "./stripe-sandbox-evidence.mjs";
export {
  createWebhookEvidence,
  startWebhookServer,
} from "./stripe-sandbox-evidence.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export function parseOptions(args) {
  const options = { wait: true, checkConfig: false, webhookTimeoutMs: 30_000 };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error("INVALID_ARGUMENTS");
    seen.add(flag);
    if (flag === "--no-wait") options.wait = false;
    else if (flag === "--check-config") options.checkConfig = true;
    else if (flag === "--webhook-port" || flag === "--webhook-timeout-ms") {
      const value = args[++index];
      const number = Number(value);
      const maximum = flag === "--webhook-port" ? 65_535 : 300_000;
      if (
        !/^\d+$/u.test(value ?? "") ||
        !Number.isSafeInteger(number) ||
        number < 1 ||
        number > maximum
      )
        throw new Error("INVALID_ARGUMENTS");
      options[flag === "--webhook-port" ? "webhookPort" : "webhookTimeoutMs"] =
        number;
    } else throw new Error("INVALID_ARGUMENTS");
  }
  if (seen.has("--webhook-timeout-ms") && options.webhookPort === undefined)
    throw new Error("INVALID_ARGUMENTS");
  if (!options.wait && options.webhookPort !== undefined)
    throw new Error("INVALID_ARGUMENTS");
  return options;
}

async function readEnvironment(root, environment) {
  let text = "";
  try {
    text = await readFile(path.join(root, ".env"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { ...parseEnv(text), ...environment };
}

function configurationStatus(env, options) {
  const required = [
    ["STRIPE_TEST_SECRET_KEY", /^(?:sk|rk)_test_[A-Za-z0-9]+$/u],
  ];
  if (options.webhookPort !== undefined)
    required.push(["STRIPE_TEST_WEBHOOK_SECRET", /^whsec_[A-Za-z0-9]+$/u]);
  const variables = required.flatMap(([name, pattern]) => {
    const value = env[name];
    if (!value) return [{ name, status: "MISSING" }];
    return pattern.test(value) ? [] : [{ name, status: "INVALID" }];
  });
  return {
    schemaVersion: 1,
    configuration: variables.length ? "MISSING_OR_INVALID" : "READY",
    variables,
  };
}

export async function writeCheckoutLink(root, url) {
  const directory = path.join(root, "output/checks/r1-03-stripe-sandbox");
  await mkdir(directory, { recursive: true });
  const privateDirectory = await mkdtemp(
    path.join(directory, "sandbox-checkout-"),
  );
  const file = path.join(privateDirectory, "checkout.url");
  await writeFile(file, `${url}\n`, { mode: 0o600, flag: "wx" });
  return file;
}

const account = "10000000-0000-4000-8000-0000000000ab";

function createRuntime(createStripeAdapter, env, SUPPORTED_LOCALES) {
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

  const adapter = createStripeAdapter({
    credentials: {
      resolve: async (request) => ({
        ...request,
        version: "sandbox",
        values:
          request.purpose === "API_AUTH"
            ? [env.STRIPE_TEST_SECRET_KEY]
            : [env.STRIPE_TEST_WEBHOOK_SECRET ?? ""],
      }),
    },
  });
  return {
    adapter,
    connection,
    provider: adapter.connector.create(connection).provider,
  };
}
const identity = {
  schemaVersion: 1,
  providerAccountId: account,
  environment: "TEST",
};
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

export async function runSandbox({
  provider,
  options,
  webhook,
  writeCheckout,
  log = console.log,
  pause = delay,
}) {
  const report = {
    schemaVersion: 1,
    environment: "TEST",
    result: "FAILED",
    waited: options.wait,
    evidenceLevel: "NONE",
    connectionSmokeVerified: false,
    adapterTransactionVerified: false,
    webhookVerified: false,
    siteOrderFlowVerified: false,
    checks: [],
  };
  function check(name, condition) {
    report.checks.push({ name, pass: Boolean(condition) });
    log(`${condition ? "PASS" : "FAIL"} ${name}`);
    if (!condition) throw new Error("CHECK_FAILED");
  }
  let failed = false;
  try {
    const attemptId = randomUUID();
    const command = createCommand(attemptId);
    const created = await provider.createPayment(command);
    check(
      "create returns a hosted Checkout redirect",
      created.outcome === "SUCCESS" &&
        created.value.action?.type === "REDIRECT",
    );
    const externalReference = created.value.externalReference;
    const replayed = await provider.createPayment(command);
    check(
      "same attempt replays the same session",
      replayed.outcome === "SUCCESS" &&
        replayed.value.externalReference === externalReference,
    );
    const scanned = await provider.reconcilePayment(
      reconcileCommand(attemptId),
    );
    const matched = (result) =>
      result.outcome === "SUCCESS" &&
      result.value.event.association.status === "MATCHED" &&
      result.value.event.association.paymentAttemptId === attemptId &&
      result.value.event.association.externalReference === externalReference;
    check(
      "reconcile without a reference finds the open session",
      matched(scanned),
    );
    if (options.wait) {
      const checkoutFile = await writeCheckout(created.value.action.url);
      log(`Open the private Checkout link file: ${checkoutFile}`);
      let status;
      for (let round = 0; round < 60 && status !== "SUCCEEDED"; round++) {
        await pause(5000);
        const read = await provider.getPayment({
          ...identity,
          operation: "GET_PAYMENT",
          attemptId,
          externalReference,
        });
        status = read.outcome === "SUCCESS" ? read.value.status : undefined;
      }
      check("payment succeeds after hosted checkout", status === "SUCCEEDED");
      const withReference = await provider.reconcilePayment(
        reconcileCommand(attemptId, externalReference),
      );
      check(
        "reconcile reports a matched capture",
        matched(withReference) &&
          withReference.value.event.status === "SUCCEEDED" &&
          withReference.value.event.transaction?.type === "CAPTURE" &&
          Boolean(withReference.value.event.transaction.providerReference),
      );
      let bySearch;
      for (let round = 0; round < 24; round++) {
        bySearch = await provider.reconcilePayment(reconcileCommand(attemptId));
        if (matched(bySearch) && bySearch.value.event.status === "SUCCEEDED")
          break;
        await pause(5000);
      }
      check(
        "reconcile without a reference finds the paid attempt by metadata",
        matched(bySearch) && bySearch.value.event.status === "SUCCEEDED",
      );
      const refundId = randomUUID();
      const refundCommand = {
        ...identity,
        operation: "REFUND_PAYMENT",
        refundId,
        paymentAttemptId: attemptId,
        externalReference,
        refundReference: `sandbox-refund-${refundId}`,
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
      let reconciled;
      for (let round = 0; round < 24; round++) {
        reconciled = await provider.reconcileRefund({
          ...refundCommand,
          operation: "RECONCILE_REFUND",
          auditLogId: randomUUID(),
        });
        if (
          reconciled.outcome === "SUCCESS" &&
          reconciled.value.event.status === "SUCCEEDED"
        )
          break;
        await pause(5000);
      }
      check(
        "refund reconcile reaches SUCCEEDED for this refund",
        matched(reconciled) &&
          reconciled.value.event.status === "SUCCEEDED" &&
          reconciled.value.event.refundReference ===
            refundCommand.refundReference &&
          reconciled.value.event.transaction?.type === "REFUND" &&
          Boolean(reconciled.value.event.transaction.providerReference),
      );
      report.adapterTransactionVerified = true;
      if (webhook) {
        const verified = await webhook.evidence.waitFor(
          {
            externalReference,
            currency: command.currency,
            paymentAmountMinor: command.amountMinor,
            captureReference:
              withReference.value.event.transaction.providerReference,
            refundReference: refundCommand.refundReference,
            refundAmountMinor: refundCommand.amountMinor,
            refundTransactionReference:
              reconciled.value.event.transaction.providerReference,
          },
          options.webhookTimeoutMs,
        );
        check("verified webhooks match this payment and this refund", verified);
        report.webhookVerified = true;
      }
    }
    const cancelAttempt = randomUUID();
    const toCancel = await provider.createPayment(
      createCommand(cancelAttempt, 1200),
    );
    check(
      "create returns an open session for cancellation",
      toCancel.outcome === "SUCCESS",
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
    report.connectionSmokeVerified = true;
  } catch {
    failed = true;
    report.checks.push({
      name: "sandbox run completes without an exception",
      pass: false,
    });
  } finally {
    if (webhook) {
      try {
        await webhook.close();
      } catch {
        webhook.evidence.fail();
      }
      if (webhook.evidence.hasFailures()) {
        failed = true;
        report.webhookVerified = false;
        report.checks.push({
          name: "webhook receiver completes without verification or transport failures",
          pass: false,
        });
      }
    }
  }
  report.result = failed ? "FAILED" : "PASSED";
  if (report.webhookVerified)
    report.evidenceLevel = "ADAPTER_TRANSACTION_AND_WEBHOOK";
  else if (report.adapterTransactionVerified)
    report.evidenceLevel = "ADAPTER_TRANSACTION";
  else if (report.connectionSmokeVerified)
    report.evidenceLevel = "CONNECTION_SMOKE";
  return { exitCode: failed ? 1 : 0, report };
}

async function loadStripeAdapter() {
  const [{ createStripeAdapter }, { SUPPORTED_LOCALES }] = await Promise.all([
    import("../dist/index.js"),
    import("@fan-support/contracts"),
  ]);
  return { createStripeAdapter, SUPPORTED_LOCALES };
}

export async function main({
  args = process.argv.slice(2),
  root = repositoryRoot,
  environment = process.env,
  log = console.log,
  loadAdapter = loadStripeAdapter,
} = {}) {
  let options;
  try {
    options = parseOptions(args);
  } catch {
    log("FAIL INVALID_ARGUMENTS");
    return 1;
  }
  try {
    const env = await readEnvironment(root, environment);
    const configuration = configurationStatus(env, options);
    if (options.checkConfig || configuration.configuration !== "READY") {
      log(JSON.stringify(configuration));
      return configuration.configuration === "READY" ? 0 : 1;
    }
    const { createStripeAdapter, SUPPORTED_LOCALES } = await loadAdapter();
    const { provider, adapter, connection } = createRuntime(
      createStripeAdapter,
      env,
      SUPPORTED_LOCALES,
    );
    let webhook;
    if (options.webhookPort !== undefined) {
      const verificationCommand = {
        ...identity,
        operation: "VERIFY_PAYMENT_WEBHOOK",
        endpointId: "70000000-0000-4000-8000-0000000000ab",
        verificationKeyReferenceHash: "b".repeat(64),
      };
      const verifier = adapter.createWebhookVerifier(
        {
          schemaVersion: 1,
          binding: connection.binding,
          endpointId: verificationCommand.endpointId,
          verificationKeyReferenceHash:
            verificationCommand.verificationKeyReferenceHash,
          secretRef: "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_WEBHOOK",
          toleranceSeconds: 300,
          maxBodyBytes: 65_536,
        },
        connection,
      );
      webhook = await startWebhookServer({
        port: options.webhookPort,
        verifier,
        verificationCommand,
        evidence: createWebhookEvidence(),
      });
      log(
        `Listening for forwarded Stripe events on http://127.0.0.1:${webhook.port}/webhook`,
      );
    }
    const { exitCode, report } = await runSandbox({
      provider,
      options,
      webhook,
      writeCheckout: (url) => writeCheckoutLink(root, url),
      log,
    });
    const directory = path.join(root, "output/checks/r1-03-stripe-sandbox");
    await mkdir(directory, { recursive: true });
    const file = path.join(
      directory,
      `sandbox-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.json`,
    );
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    log(
      `${report.result} evidence=${report.evidenceLevel}; siteOrderFlowVerified=false`,
    );
    log(`Summary written to ${file}`);
    return exitCode;
  } catch {
    log("FAIL SANDBOX_SETUP_OR_OUTPUT_ERROR");
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  process.exitCode = await main();
