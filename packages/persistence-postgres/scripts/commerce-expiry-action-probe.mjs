#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { withEphemeralPostgres } from "../dist/index.js";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../media-s3/scripts/ephemeral-s3-harness.mjs";
import { withOrderAccessFixture } from "../../../apps/api/scripts/order-access-runtime.mjs";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "../../../apps/api/scripts/order-payment-client.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
async function run(database, s3) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p4-06-commerce-expiry",
    `action-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  const save = (name, value) =>
    writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
  const inputs = [
    "packages/persistence-postgres/dist/commerce-expiry-repository.js",
    "packages/persistence-postgres/dist/commerce-expiry-data.js",
    "packages/persistence-postgres/dist/commerce-expiry-inventory.js",
    "packages/persistence-postgres/dist/payment-runtime-recovery.js",
    "packages/persistence-postgres/src/payment-runtime-recovery.ts",
    "packages/persistence-postgres/dist/order-payment-write.js",
    "packages/application/dist/payment-runtime-execution.js",
    "packages/contracts/dist/order-notification.js",
    "database/migrations/0029_notifications.up.sql",
    "packages/persistence-postgres/scripts/commerce-expiry-action-probe.mjs",
  ];
  const fingerprint = () =>
    Promise.all(
      inputs.map(async (name) => ({
        name,
        sha256: createHash("sha256")
          .update(await readFile(path.join(workspaceRoot, name)))
          .digest("hex"),
      })),
    );
  const before = await fingerprint();
  await save("source-before.json", before);
  let assertions = 0,
    stage = "prepare",
    status = "FAIL";
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (value) => {
    stage = value;
    console.log(`Expiry action probe: ${value}`);
  };
  try {
    await withOrderAccessFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (context) => {
        const payment = createOrderPaymentProtocolClient(context);
        const short = await context.createCheckoutApi(8000);
        try {
          const gift = context.fixtures.gifts.find(
            (gift) =>
              gift.status === "active" &&
              gift.variants[0]?.policy === "TRACKED" &&
              gift.variants[0].quantity >= 4,
          );
          check(
            Boolean(gift),
            "probe uses normally published available tracked stock",
          );
          progress(
            "expire UNKNOWN hold before authenticated action recovery and later real capture",
          );
          const value = await payment.fresh({
            lost: true,
            checkoutBase: short.base,
            lines: [{ gift }],
          });
          value.attempt = {
            ...value.attempt,
            action: await context.psp.hostedAction(value.attempt.id),
          };
          const order = (
            await context.client.query(
              "SELECT id,cart_id FROM orders WHERE checkout_session_id=$1::uuid",
              [value.checkout.id],
            )
          ).rows[0];
          await waitForOrderPayment(
            "actual quote expiry elapses",
            async () =>
              (
                await context.client.query(
                  "SELECT quote_expires_at<=clock_timestamp() due FROM orders WHERE id=$1::uuid",
                  [order.id],
                )
              ).rows[0].due,
            check,
            { timeoutMs: 30000 },
          );
          const expiry =
            await context.persistence.commerceExpiryTransactionManager.runInCommerceExpiryTransaction(
              (repo) =>
                repo.expireCart({
                  schemaVersion: 1,
                  cartId: order.cart_id,
                  requestId: randomUUID(),
                  correlationId: randomUUID(),
                  taskName: "expiry-action-probe",
                }),
            );
          check(
            expiry.expiredReservations === 1 && expiry.canceledOrders === 0,
            "UNKNOWN reservation expires while its uncertain order stays open",
          );
          const recovery = await payment.payment.recover(
            value.session,
            value.checkout.id,
            value.attempt.id,
          );
          const recovered = await payment.state(value);
          await payment.settle(value);
          await payment.reconcile(value);
          const signed = await context.signWebhook(value.attempt.id);
          check(
            (await context.sendWebhook(signed)).accepted,
            "later actual capture webhook is accepted with its signature",
          );
          const event = (
            await context.client.query(
              "SELECT id FROM provider_events WHERE provider_account_id=$1::uuid AND environment='TEST' AND provider_event_id=$2",
              [
                context.endpoint.providerAccountId,
                JSON.parse(signed.rawBody).event_id,
              ],
            )
          ).rows[0];
          const result = await payment.apply(event.id);
          const final = await payment.state(value);
          const observation = {
            schemaVersion: 1,
            expiry,
            recovery: {
              attemptStatus: recovered.attempt_status,
              hasAction: Boolean(recovery.data.attempt?.action),
              cartStatus: recovered.cart_status,
              orderStatus: recovered.order_status,
            },
            application: {
              decision: result.decision,
              reasonCode: result.reasonCode ?? null,
              outcome: result.outcome ?? null,
            },
            final: {
              attemptStatus: final.attempt_status,
              paymentStatus: final.payment_status,
              fulfillmentStatus: final.fulfillment_status,
              captures: final.captures,
              committed: final.committed,
              decrements: final.decrements,
            },
            actualPostgres: true,
            ownedTestPsp: true,
            actualPspSandbox: false,
          };
          await save("observation.json", observation);
          console.log(`Expiry action result ${JSON.stringify(observation)}`);
          check(
            recovered.attempt_status === "UNKNOWN" &&
              !observation.recovery.hasAction,
            "expired resources cannot restore a payable action or exit UNKNOWN",
          );
          check(
            final.payment_status === "PAID" &&
              final.fulfillment_status === "ON_HOLD" &&
              final.decrements === 0,
            "later authenticated captured funds remain PAID_REVIEW without consuming expired stock",
          );
          progress(
            "actual quote deadline crosses after readiness but before the guarded action update",
          );
          const boundary = await payment.fresh({
            lost: true,
            checkoutBase: short.base,
            lines: [{ gift }],
          });
          const originalQuery = Client.prototype.query;
          let paused = false,
            guardedUpdateRows = null;
          Client.prototype.query = function (...args) {
            if (
              !paused &&
              typeof args[0] === "string" &&
              args[0].startsWith("UPDATE public.payment_attempts") &&
              args[1]?.[0] === boundary.attempt.id &&
              args[1]?.[1] === "REQUIRES_ACTION"
            ) {
              paused = true;
              return (async () => {
                await waitForOrderPayment(
                  "real deadline elapses while original aggregate locks remain held",
                  async () =>
                    (
                      await originalQuery.call(
                        this,
                        "SELECT quote_expires_at<=clock_timestamp() due FROM orders WHERE checkout_session_id=$1::uuid",
                        [boundary.checkout.id],
                      )
                    ).rows[0].due,
                  check,
                  { timeoutMs: 30000 },
                );
                const result = await originalQuery.apply(this, args);
                guardedUpdateRows = result.rows.length;
                return result;
              })();
            }
            return originalQuery.apply(this, args);
          };
          let boundaryResponse;
          try {
            await waitForOrderPayment(
              "real recovery retry becomes due",
              async () =>
                (
                  await context.client.query(
                    "SELECT next_attempt_at<=clock_timestamp() due FROM payment_runtime_operations WHERE attempt_id=$1::uuid",
                    [boundary.attempt.id],
                  )
                ).rows[0].due,
              check,
            );
            boundaryResponse = await payment.payment.recover(
              boundary.session,
              boundary.checkout.id,
              boundary.attempt.id,
            );
          } finally {
            Client.prototype.query = originalQuery;
          }
          const boundaryState = await payment.state(boundary);
          const boundaryResult = {
            pausedBeforeRealUpdate: paused,
            guardedUpdateRows,
            attemptStatus: boundaryState.attempt_status,
            hasAction: Boolean(boundaryResponse.data.attempt?.action),
            paymentStatus: boundaryState.payment_status,
            captures: boundaryState.captures,
          };
          await save("deadline-boundary.json", boundaryResult);
          check(
            paused && guardedUpdateRows === 0,
            "real conditional action update rejects the elapsed deadline after prior readiness",
          );
          check(
            boundaryResult.attemptStatus === "UNKNOWN" &&
              !boundaryResult.hasAction &&
              boundaryResult.paymentStatus === "PENDING" &&
              boundaryResult.captures === 0,
            "elapsed deadline records no fake action, transition or capture",
          );
        } finally {
          await short.stop();
        }
      },
    });
    status = "PASS";
    console.log(`PASS expiry action probe ${assertions}; ${output}`);
  } catch (error) {
    await save("failure.json", {
      stage,
      assertions,
      name: /^[A-Za-z]{1,64}$/u.test(error?.name ?? "") ? error.name : null,
      code: /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : null,
    });
    throw error;
  } finally {
    const after = await fingerprint();
    await save("source-after.json", after);
    await save("run-result.json", {
      status,
      assertions,
      sourceUnchanged: JSON.stringify(before) === JSON.stringify(after),
      completedAt: new Date().toISOString(),
    });
  }
}
try {
  if (process.argv[2] === "--run-expiry-action-probe") {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) => run(database, s3));
  } else {
    assert.equal(process.argv.length, 2);
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: "--run-expiry-action-probe",
        timeoutMs: 1200000,
      }),
    );
  }
} catch {
  console.error("FAIL expiry action probe; inspect safe evidence");
  process.exitCode = 1;
}
