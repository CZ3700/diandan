import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  createWebhookEvidence,
  main,
  parseOptions,
  runSandbox,
  startWebhookServer,
  writeCheckoutLink,
} from "./stripe-sandbox.mjs";

const success = (value) => ({ outcome: "SUCCESS", value });
const failure = (code) => ({ outcome: "FAILURE", error: { code } });
const secret = "sk_test_privateFixture";
const checkoutUrl = "https://checkout.stripe.com/c/pay/private-fixture";
const options = { wait: true, webhookPort: 4242, webhookTimeoutMs: 20 };

function fixture(mode = "both", overrides = {}) {
  const evidence = createWebhookEvidence();
  let attempt;
  let refund;
  const association = () => ({
    status: "MATCHED",
    paymentAttemptId: attempt,
    externalReference: "cs.fixture",
  });
  const paymentEvent = () => ({
    eventType: "PAYMENT_STATUS",
    status: "SUCCEEDED",
    amountMinor: 2500,
    currency: "USD",
    association: association(),
    transaction: { type: "CAPTURE", providerReference: "pi.fixture" },
  });
  const refundEvent = () => ({
    eventType: "REFUND_STATUS",
    status: "SUCCEEDED",
    amountMinor: 500,
    currency: "USD",
    association: association(),
    refundReference: refund.refundReference,
    transaction: { type: "REFUND", providerReference: "re.fixture" },
  });
  const emit = (event, patch = {}) =>
    evidence.accept(
      success({
        candidate: { ...event, externalReference: "cs.fixture", ...patch },
      }),
    );
  const sendEvents = () => {
    if (mode === "unsupported") evidence.accept(failure("UNSUPPORTED_EVENT"));
    if (mode === "invalid-signature")
      evidence.accept(failure("INVALID_SIGNATURE"));
    if (
      [
        "both",
        "payment-only",
        "other-refund",
        "same-name-other-refund",
        "invalid-signature",
        "delayed",
      ].includes(mode)
    )
      emit(paymentEvent());
    if (["both", "invalid-signature", "delayed", "refund-only"].includes(mode))
      emit(refundEvent());
    if (mode === "other-attempt") {
      emit(paymentEvent(), { externalReference: "cs.other" });
      emit(refundEvent(), { externalReference: "cs.other" });
    }
    if (mode === "other-refund")
      emit(refundEvent(), { refundReference: "another-refund" });
    if (mode === "same-name-other-refund")
      emit(refundEvent(), {
        transaction: { type: "REFUND", providerReference: "re.other" },
      });
  };
  const provider = {
    createPayment: async (command) => {
      attempt ??= command.attemptId;
      return success({
        externalReference: "cs.fixture",
        action: { type: "REDIRECT", url: checkoutUrl },
      });
    },
    getPayment: async () => success({ status: "SUCCEEDED" }),
    reconcilePayment: async () => success({ event: paymentEvent() }),
    refundPayment: async (command) => {
      refund = command;
      return success({});
    },
    reconcileRefund: async () => {
      if (mode === "delayed") void delay(10).then(sendEvents);
      else sendEvents();
      return success({ event: refundEvent() });
    },
    cancelPayment: async () => success({ status: "CANCELED" }),
    ...overrides,
  };
  const logs = [];
  const links = [];
  return {
    provider,
    evidence,
    logs,
    links,
    run: (extra = {}) =>
      runSandbox({
        provider,
        options,
        webhook: { evidence, close: async () => {} },
        log: (line) => logs.push(line),
        writeCheckout: async (url) => {
          links.push(url);
          return "/fixture/sandbox-checkout.url";
        },
        pause: async () => {},
        ...extra,
      }),
  };
}

for (const mode of [
  "none",
  "unsupported",
  "other-attempt",
  "payment-only",
  "other-refund",
  "same-name-other-refund",
  "invalid-signature",
]) {
  test(`webhook evidence rejects ${mode}`, async () => {
    const { run } = fixture(mode);
    const result = await run();
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.webhookVerified, false);
    assert.equal(result.report.siteOrderFlowVerified, false);
  });
}

test("waits for delayed verified callbacks associated with this payment and exact refund", async () => {
  const { run, links, logs } = fixture("delayed");
  const result = await run({ options: { ...options, webhookTimeoutMs: 200 } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.evidenceLevel, "ADAPTER_TRANSACTION_AND_WEBHOOK");
  assert.equal(result.report.webhookVerified, true);
  assert.equal(result.report.adapterTransactionVerified, true);
  assert.equal(result.report.siteOrderFlowVerified, false);
  assert.deepEqual(links, [checkoutUrl]);
  assert.equal(
    JSON.stringify([result.report, logs]).includes(checkoutUrl),
    false,
  );
});

test("no-wait verifies only the connection smoke test", async () => {
  const { run } = fixture();
  const result = await run({ options: { wait: false }, webhook: undefined });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.connectionSmokeVerified, true);
  assert.equal(result.report.adapterTransactionVerified, false);
  assert.equal(result.report.webhookVerified, false);
  assert.equal(result.report.evidenceLevel, "CONNECTION_SMOKE");
});

test("completed adapter transaction without webhook cannot claim webhook or site verification", async () => {
  const { run } = fixture();
  const result = await run({ options: { wait: true }, webhook: undefined });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.evidenceLevel, "ADAPTER_TRANSACTION");
  assert.equal(result.report.webhookVerified, false);
  assert.equal(result.report.siteOrderFlowVerified, false);
});

for (const method of [
  "createPayment",
  "reconcilePayment",
  "getPayment",
  "refundPayment",
  "reconcileRefund",
  "cancelPayment",
]) {
  test(`a ${method} failure returns nonzero with no raw errors`, async () => {
    const { run, logs } = fixture("both", {
      [method]: async () => {
        throw new Error(`${secret} ${checkoutUrl}`);
      },
    });
    const result = await run();
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.stringify([result.report, logs]).includes(secret), false);
    assert.equal(
      JSON.stringify([result.report, logs]).includes(checkoutUrl),
      false,
    );
  });
}

test("failed checks return nonzero", async () => {
  const { run } = fixture("both", {
    cancelPayment: async () => failure("PROVIDER_UNAVAILABLE"),
  });
  const result = await run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.checks.at(-1).pass, false);
});

test("a listener close failure also fails the run", async () => {
  const { run, evidence } = fixture();
  const result = await run({
    webhook: {
      evidence,
      close: async () => {
        throw new Error(secret);
      },
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.stringify(result.report).includes(secret), false);
});

for (const args of [
  ["--unknown"],
  ["--webhook-port"],
  ["--webhook-port", "0"],
  ["--webhook-port", "65536"],
  ["--webhook-port", "NaN"],
  ["--webhook-port", "1.5"],
  ["--no-wait", "--webhook-port", "4242"],
  ["--webhook-timeout-ms", "-1"],
  ["--webhook-timeout-ms", "Infinity"],
  ["--no-wait", "--no-wait"],
]) {
  test(`invalid arguments fail safely: ${args.join(" ")}`, async () => {
    assert.throws(() => parseOptions(args));
    const logs = [];
    assert.equal(await main({ args, log: (line) => logs.push(line) }), 1);
  });
}

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), "stripe-sandbox-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("configuration check uses process environment before .env and performs no adapter/network work", async (t) => {
  const root = await temporaryRoot(t);
  await writeFile(
    path.join(root, ".env"),
    "STRIPE_TEST_SECRET_KEY=sk_live_invalid\nSTRIPE_TEST_WEBHOOK_SECRET=whsec_localFixture\n",
  );
  const logs = [];
  const result = await main({
    root,
    args: ["--check-config", "--webhook-port", "4242"],
    environment: { STRIPE_TEST_SECRET_KEY: secret },
    log: (line) => logs.push(line),
    loadAdapter: () => {
      assert.fail("configuration check must not load the adapter");
    },
  });
  assert.equal(result, 0);
  assert.deepEqual(JSON.parse(logs[0]), {
    schemaVersion: 1,
    configuration: "READY",
    variables: [],
  });
});

test("configuration output exposes only invalid/missing variable names and status", async (t) => {
  const root = await temporaryRoot(t);
  await writeFile(
    path.join(root, ".env"),
    `STRIPE_TEST_SECRET_KEY=${secret}\n`,
  );
  const logs = [];
  const result = await main({
    root,
    args: ["--check-config", "--webhook-port", "4242"],
    environment: { STRIPE_TEST_SECRET_KEY: "sk_live_privateFixture" },
    log: (line) => logs.push(line),
  });
  assert.equal(result, 1);
  assert.deepEqual(JSON.parse(logs[0]).variables, [
    { name: "STRIPE_TEST_SECRET_KEY", status: "INVALID" },
    { name: "STRIPE_TEST_WEBHOOK_SECRET", status: "MISSING" },
  ]);
  assert.equal(logs.join("").includes("privateFixture"), false);
});

test("explicit empty process configuration overrides a configured .env value", async (t) => {
  const root = await temporaryRoot(t);
  await writeFile(
    path.join(root, ".env"),
    `STRIPE_TEST_SECRET_KEY=${secret}\n`,
  );
  const logs = [];
  assert.equal(
    await main({
      root,
      args: ["--check-config"],
      environment: { STRIPE_TEST_SECRET_KEY: "" },
      log: (line) => logs.push(line),
    }),
    1,
  );
  assert.deepEqual(JSON.parse(logs[0]).variables, [
    { name: "STRIPE_TEST_SECRET_KEY", status: "MISSING" },
  ]);
});

test("Checkout link is saved to an ignored local file with owner-only permissions", async (t) => {
  const root = await temporaryRoot(t);
  const file = await writeCheckoutLink(root, checkoutUrl);
  assert.ok(file.startsWith(path.join(root, "output", "checks")));
  assert.equal(await readFile(file, "utf8"), `${checkoutUrl}\n`);
  // Windows has no POSIX permission bits: stat always reports 0o666/0o777 there.
  if (process.platform === "win32") return;
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
});

test("HTTP callback rejects verification failures and catches verifier exceptions", async (t) => {
  const evidence = createWebhookEvidence();
  let calls = 0;
  const server = await startWebhookServer({
    port: 0,
    evidence,
    verifier: {
      verifyPaymentWebhook: async () => {
        calls++;
        if (calls === 1) throw new Error(secret);
        return failure("INVALID_SIGNATURE");
      },
    },
    verificationCommand: {},
  });
  t.after(server.close);
  for (let i = 0; i < 2; i++) {
    const response = await globalThis.fetch(
      `http://127.0.0.1:${server.port}/webhook`,
      {
        method: "POST",
        body: secret,
      },
    );
    assert.equal(response.status, 400);
    assert.equal((await response.text()).includes(secret), false);
  }
  assert.equal(evidence.hasFailures(), true);
});

test("webhook HTTP listener processes verified candidates and ignores unsupported events", async (t) => {
  const evidence = createWebhookEvidence();
  const observed = [];
  const server = await startWebhookServer({
    port: 0,
    evidence,
    verificationCommand: { operation: "VERIFY_PAYMENT_WEBHOOK" },
    verifier: {
      verifyPaymentWebhook: async (command) => {
        observed.push(command);
        return failure("UNSUPPORTED_EVENT");
      },
    },
  });
  t.after(server.close);
  const response = await globalThis.fetch(
    `http://127.0.0.1:${server.port}/webhook`,
    {
      method: "POST",
      headers: { "stripe-signature": "fixture-signature" },
      body: "fixture-body",
    },
  );
  assert.equal(response.status, 202);
  assert.equal(observed[0].headers["stripe-signature"], "fixture-signature");
  assert.equal(
    observed[0].rawBodyBase64,
    Buffer.from("fixture-body").toString("base64url"),
  );
  assert.equal(evidence.hasFailures(), false);
});

for (const method of [
  "createPayment",
  "reconcilePayment",
  "getPayment",
  "refundPayment",
  "reconcileRefund",
  "cancelPayment",
]) {
  test(`a ${method} failure response cannot pass`, async () => {
    const { run } = fixture("both", {
      [method]: async () => failure("PROVIDER_UNAVAILABLE"),
    });
    assert.equal((await run()).exitCode, 1);
  });
}

test("CLI invalid arguments result in an actual nonzero process exit", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./stripe-sandbox.mjs", import.meta.url)),
      "--webhook-port",
      "0",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), "FAIL INVALID_ARGUMENTS");
  assert.equal(result.stderr, "");
});

test("webhook failures arriving during shutdown cannot pass", async () => {
  const { run, evidence } = fixture();
  const result = await run({
    webhook: {
      evidence,
      close: async () => evidence.accept(failure("INVALID_SIGNATURE")),
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.webhookVerified, false);
});

test("a successful callback from a different capture cannot satisfy payment evidence", async () => {
  const { run, evidence } = fixture("refund-only");
  evidence.accept(
    success({
      candidate: {
        eventType: "PAYMENT_STATUS",
        status: "SUCCEEDED",
        externalReference: "cs.fixture",
        amountMinor: 2500,
        currency: "USD",
        transaction: { type: "CAPTURE", providerReference: "pi.other" },
        rawBody: secret,
      },
    }),
  );
  const result = await run();
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.stringify(result.report).includes(secret), false);
});
