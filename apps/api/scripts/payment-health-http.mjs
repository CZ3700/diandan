#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { withPaymentRuntimeFixture } from "./payment-runtime-runtime.mjs";
import { createCheckoutProtocolClient } from "./checkout-preflight-client.mjs";
import { createPaymentProtocolClient } from "./payment-runtime-client.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
async function run(database, s3) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p5-04-payment-health",
    `http-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  let assertions = 0,
    stage = "seed",
    status = "FAIL";
  const check = (ok, label) => {
    assertions++;
    if (!ok) stage = label;
    assert.ok(ok, label);
  };
  const progress = (label) => {
    stage = label;
    console.log(`Payment health: ${label}`);
  };
  const save = (name, data) =>
    writeFile(path.join(output, name), JSON.stringify(data, null, 2) + "\n");
  try {
    await withPaymentRuntimeFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (context) => {
        const setupAssertions = assertions;
        const { client, psp, published } = context;
        const providerAccountId = published.routes[0].providerAccountId;
        const healthPolicies = [
          {
            schemaVersion: 1,
            providerAccountId,
            environment: "TEST",
            version: 1,
            failureThreshold: 2,
            failureWindowMs: 60000,
            openDurationMs: 1000,
            probeLeaseMs: 5000,
            probeRetryMs: 1000,
          },
        ];
        const a = await context.createPaymentApi({
          recovery: false,
          healthPolicies,
        });
        const b = await context.createPaymentApi({
          recovery: false,
          healthPolicies,
        });
        const canaries = [
          `private-${randomUUID()}`,
          `name-${randomUUID().slice(0, 12)}`,
          `health-${randomUUID()}@example.invalid`,
        ];
        const checkout = createCheckoutProtocolClient({ ...context, canaries });
        const payment = createPaymentProtocolClient({
          ...context,
          paymentBase: a.base,
          canaries,
        });
        async function acceptedCheckout() {
          const session = await checkout.initialize();
          await checkout.add(session);
          const validated = await checkout.validate(session);
          const created = await checkout.create(
            session,
            validated.data.preflight,
            canaries[2],
          );
          return { session, id: created.data.checkout.id };
        }
        async function health() {
          const {
            rows: [value],
          } = await client.query(
            "SELECT account.health_status,account.version::int,(SELECT count(*)::int FROM payment_provider_health_events event WHERE event.provider_account_id=account.id) events FROM payment_provider_accounts account WHERE id=$1",
            [providerAccountId],
          );
          return value;
        }
        async function waitFor(read, predicate, label, timeoutMs = 20000) {
          const deadline = globalThis.performance.now() + timeoutMs;
          let value;
          do {
            value = await read();
            if (predicate(value)) break;
            await delay(50);
          } while (globalThis.performance.now() < deadline);
          check(predicate(value), label);
          return value;
        }
        progress("two independent APIs observe actual TLS provider faults");
        const fresh = await acceptedCheckout();
        const cap = (await payment.capabilities(fresh.session, fresh.id)).data
          .capabilities.capabilities[0];
        check(
          Boolean(cap),
          "Healthy account has a validated real capability context",
        );
        const before = await psp.counts();
        for (const target of [a.base, b.base]) {
          await psp.arm({ operation: "GET_CAPABILITIES", mode: "BEFORE" });
          const result = await payment.capabilities(fresh.session, fresh.id, {
            target,
          });
          check(
            result.data.capabilities.capabilities.length === 0,
            "Actual TLS disconnect hides payment method",
          );
        }
        let current = await health();
        check(
          current.health_status === "UNAVAILABLE" &&
            current.version === 2 &&
            current.events === 2,
          "Two API failures commit one threshold transition with exact event head",
        );
        const hidden = await payment.capabilities(fresh.session, fresh.id, {
          country: "",
          target: b.base,
        });
        check(
          hidden.data.capabilities.capabilities.length === 0,
          "Second instance immediately sees PostgreSQL circuit state",
        );
        await payment.create(fresh.session, fresh.id, cap, {
          expected: 409,
          code: "CAPABILITY_UNAVAILABLE",
        });
        check(
          JSON.stringify(await psp.counts()) === JSON.stringify(before),
          "Stale capability cannot start any PSP mutation after circuit opens",
        );

        progress("cross-instance read-only recovery probe and API restart");
        const readCount = (await psp.observations()).filter(
          (v) => v.operation === "GET_CAPABILITIES",
        ).length;
        const recoveryA = await context.createPaymentApi({
          recovery: true,
          healthPolicies,
        });
        const recoveryB = await context.createPaymentApi({
          recovery: true,
          healthPolicies,
        });
        await waitFor(
          health,
          (v) => v.health_status === "HEALTHY",
          "Durable due probe restores the channel after process composition restart",
        );
        await recoveryA.stop();
        await recoveryB.stop();
        const recoveredReads =
          (await psp.observations()).filter(
            (v) => v.operation === "GET_CAPABILITIES",
          ).length - readCount;
        check(
          recoveredReads === 1,
          "Two API sweepers issue only one safe recovery capability probe",
        );
        check(
          JSON.stringify(await psp.counts()) === JSON.stringify(before),
          "Health recovery creates no payment, transaction or refund",
        );
        const recoveredCap = (
          await payment.capabilities(fresh.session, fresh.id)
        ).data.capabilities.capabilities[0];
        check(
          Boolean(recoveredCap),
          "New admission returns only after verified safe probe",
        );

        progress("UNKNOWN remains pinned during a later circuit opening");
        const key = randomUUID();
        await psp.arm({ operation: "CREATE_PAYMENT", mode: "AFTER" });
        const unknown = await payment.create(
          fresh.session,
          fresh.id,
          recoveredCap,
          { key },
        );
        check(
          unknown.data.attempt.status === "UNKNOWN",
          "PSP accepted creation with lost TLS response remains UNKNOWN",
        );
        const attemptId = unknown.data.attempt.id;
        const afterUnknown = await psp.counts();
        check(
          afterUnknown.payments === before.payments + 1,
          "TEST PSP durably accepted exactly one payment",
        );
        const other = await acceptedCheckout();
        await psp.arm({ operation: "GET_CAPABILITIES", mode: "BEFORE" });
        await payment.capabilities(other.session, other.id, { target: b.base });
        current = await health();
        check(
          current.health_status === "UNAVAILABLE",
          "Creation uncertainty and another technical failure share the durable window",
        );
        const replay = await payment.create(
          fresh.session,
          fresh.id,
          recoveredCap,
          { key, target: b.base },
        );
        check(
          replay.data.attempt.id === attemptId &&
            replay.data.action === "REPLAYED",
          "Original create key survives circuit opening across API instances",
        );
        await waitFor(
          async () => {
            const {
              rows: [row],
            } = await client.query(
              "SELECT next_attempt_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) due FROM payment_runtime_operations WHERE attempt_id=$1",
              [attemptId],
            );
            return row.due;
          },
          Boolean,
          "UNKNOWN reconcile reaches its existing durable due time",
        );
        const recovered = await payment.recover(
          fresh.session,
          fresh.id,
          attemptId,
          { target: b.base },
        );
        check(
          recovered.data.attempt.id === attemptId &&
            recovered.data.attempt.status === "REQUIRES_ACTION",
          "Authenticated reconciliation recovers the original accepted payment while channel remains open",
        );
        const {
          rows: [pinned],
        } = await client.query(
          "SELECT provider_account_id,merchant_reference,provider_idempotency_key FROM payment_attempts WHERE id=$1",
          [attemptId],
        );
        check(
          pinned.provider_account_id === providerAccountId &&
            pinned.merchant_reference === attemptId &&
            pinned.provider_idempotency_key === attemptId,
          "Frozen account, merchant reference and idempotency key remain unchanged",
        );
        check(
          (await health()).health_status === "UNAVAILABLE",
          "Ordinary late successful reconciliation cannot close the circuit",
        );
        check(
          (await psp.counts()).payments === afterUnknown.payments,
          "No second creation occurs during UNKNOWN recovery",
        );

        progress(
          "immutable policy conflict fails closed and private fields stay absent",
        );
        const conflict = await context.createPaymentApi({
          recovery: false,
          healthPolicies: [{ ...healthPolicies[0], failureThreshold: 99 }],
        });
        const restorer = await context.createPaymentApi({
          recovery: true,
          healthPolicies,
        });
        await waitFor(
          health,
          (v) => v.health_status === "HEALTHY",
          "Second circuit opens and recovers through the same read-only path",
        );
        await restorer.stop();
        const conflicting = await payment.capabilities(
          other.session,
          other.id,
          { target: conflict.base },
        );
        check(
          conflicting.data.capabilities.capabilities.length === 0,
          "Per-instance policy drift cannot silently override the PG policy",
        );
        const { rows: policies } = await client.query(
          "SELECT policy FROM payment_provider_health_policies WHERE provider_account_id=$1",
          [providerAccountId],
        );
        check(
          policies.length === 1 && policies[0].policy.failureThreshold === 2,
          "Policy bootstrap preserves immutable approved values",
        );
        const { rows: observations } = await client.query(
          "SELECT observation FROM payment_provider_health_observations WHERE provider_account_id=$1 ORDER BY recorded_at,observation_id",
          [providerAccountId],
        );
        const publicEvidence = JSON.stringify({
          observations,
          logs: context.logLines,
        });
        check(
          canaries.every((v) => !publicEvidence.includes(v)),
          "Health observation and logs contain no private checkout canary",
        );
        check(
          observations.every(
            (v) =>
              !/"(?:email|fanMessage|displayName|rawBody|headers|authorization|token)"/u.test(
                JSON.stringify(v),
              ),
          ),
          "Stored health observations retain only strict limited fields",
        );
        current = await health();
        check(
          current.events === current.version,
          "Every real health transition has exactly one append-only event",
        );
        await save("protocol-results.json", {
          schemaVersion: 1,
          status: "PASS",
          assertions: assertions - setupAssertions,
          setupAssertions,
          realPostgres: true,
          realApiHttp: true,
          actualTlsTestPsp: true,
          actualMerchant: false,
          twoInstances: true,
          singleRecoveryProbe: recoveredReads,
          health: current,
          observations: observations.length,
          psp: await psp.counts(),
          requests: payment.events,
        });
      },
    });
    status = "PASS";
  } catch (error) {
    await save("failure.json", {
      schemaVersion: 1,
      stage,
      kind: error?.name === "AssertionError" ? "ASSERTION" : "RUNTIME",
      code: /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : null,
    });
    throw error;
  } finally {
    await save("run-result.json", {
      schemaVersion: 1,
      status,
      stage,
      assertions,
      ownedCleanupAttempted: true,
    });
  }
}
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--owned-payment-health") {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) => run(database, s3));
    } else {
      assert.equal(process.argv.length, 2);
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: "--owned-payment-health",
          timeoutMs: 1200000,
        }),
      );
    }
  } catch (error) {
    console.error(
      `FAIL payment health ${error?.name === "AssertionError" ? "ASSERTION" : "RUNTIME"}`,
    );
    process.exitCode = 1;
  }
}
