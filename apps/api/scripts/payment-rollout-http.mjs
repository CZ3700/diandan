#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { evaluatePaymentRollout } from "../../../packages/domain/dist/index.js";
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
const rollout = { providerBasisPoints: 10000, ruleBasisPoints: 5000 };
const maximumCheckouts = 30;

export async function runPaymentRollout(database, s3) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p5-04-payment-health",
    `rollout-http-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  let assertions = 0,
    stage = "fixture",
    status = "FAIL";
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (label) => {
    stage = label;
    console.log(`Payment rollout: ${label}`);
  };
  const save = (name, value) =>
    writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
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
  try {
    await withPaymentRuntimeFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      paymentRollout: rollout,
      verify: async (context) => {
        const setupAssertions = assertions;
        const { client, psp, published } = context;
        const route = published.routes[0];
        const providerAccountId = route.providerAccountId;
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
          `rollout-${randomUUID()}@example.invalid`,
        ];
        const checkout = createCheckoutProtocolClient({ ...context, canaries });
        const payment = createPaymentProtocolClient({
          ...context,
          paymentBase: a.base,
          canaries,
        });
        const cohorts = [];
        const before = await psp.counts();
        let admitted, excluded;
        const actual = (
          await client.query(
            "SELECT provider.rollout_basis_points provider,rule.rollout_basis_points rule FROM payment_route_rules rule JOIN payment_provider_configs provider ON provider.id=rule.provider_config_id WHERE rule.id=$1",
            [route.capabilityId],
          )
        ).rows[0];
        check(
          actual.provider === rollout.providerBasisPoints &&
            actual.rule === rollout.ruleBasisPoints,
          "The immutable published PostgreSQL configuration uses an actual 50 percent rule",
        );
        progress(
          "bounded real checkouts exercise admitted and excluded cohorts",
        );
        for (
          let ordinal = 1;
          ordinal <= maximumCheckouts && (!admitted || !excluded);
          ordinal++
        ) {
          const session = await checkout.initialize();
          await checkout.add(session);
          const preflight = await checkout.validate(session);
          const created = await checkout.create(
            session,
            preflight.data.preflight,
            canaries[2],
          );
          check(
            created.data.action === "CREATED",
            "Cohort identity comes from an ordinary real checkout transaction",
          );
          const value = {
            session,
            id: created.data.checkout.id,
            checkout: created.data.checkout,
          };
          const decision = evaluatePaymentRollout({
            schemaVersion: 1,
            checkoutSessionId: value.id,
            providerAccountId,
            routeRuleId: route.capabilityId,
            providerRolloutBasisPoints: actual.provider,
            ruleRolloutBasisPoints: actual.rule,
          });
          check(
            decision.kind !== "INVALID",
            "Actual persisted identities satisfy the internal rollout contract",
          );
          cohorts.push({ ordinal, ...decision });
          for (const target of [a.base, b.base]) {
            const response = await payment.capabilities(session, value.id, {
              country: "",
              target,
            });
            const view = response.data.capabilities;
            const eligible = decision.kind === "ELIGIBLE";
            check(
              view.countrySelectionRequired === false &&
                view.country === (eligible ? "US" : null) &&
                view.capabilities.length === (eligible ? 1 : 0) &&
                (!eligible || view.capabilities[0].id === route.capabilityId),
              "Country-free discovery resolves the published route only for the admitted cohort",
            );
            check(
              response.data.capabilities.countries.includes("US") ===
                (decision.kind === "ELIGIBLE"),
              "Two independent APIs reproduce the deterministic cohort for the same server-issued checkout",
            );
          }
          check(
            (
              await client.query(
                "SELECT count(*)::int count FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.checkout_session_id=$1",
                [value.id],
              )
            ).rows[0].count === 0,
            "Capability discovery creates no PostgreSQL payment attempt for either cohort",
          );
          if (decision.kind === "ELIGIBLE") admitted ??= value;
          else excluded ??= value;
        }
        check(
          Boolean(admitted && excluded),
          "At most 30 real checkouts provide both rollout cohorts without fabricating or retrying identities",
        );
        await save("cohort-checkpoint.json", {
          schemaVersion: 1,
          status: "PASS",
          maximumCheckouts,
          cohorts,
          actualRollout: actual,
        });

        progress(
          "language presentation and two API instances retain cohort membership",
        );
        let capability;
        for (const locale of SUPPORTED_LOCALES) {
          const accepted = await payment.capabilities(
            admitted.session,
            admitted.id,
            { locale, target: a.base },
          );
          const repeated = await payment.capabilities(
            admitted.session,
            admitted.id,
            { locale, target: b.base },
          );
          check(
            accepted.data.capabilities.capabilities.length === 1 &&
              repeated.data.capabilities.capabilities.length === 1,
            "Admitted cohort remains available across all seven presentation locales and both instances",
          );
          const current = accepted.data.capabilities.capabilities[0];
          check(
            current.id === route.capabilityId &&
              current.configVersion === published.configVersion &&
              current.ruleVersion === published.ruleVersion,
            "Locale presentation keeps the same published provider rule and versions",
          );
          check(
            accepted.data.capabilities.amountMinor ===
              admitted.checkout.amount.totalAmountMinor &&
              accepted.data.capabilities.currency ===
                admitted.checkout.currency,
            "Locale presentation cannot change the authoritative checkout amount or currency",
          );
          capability ??= current;
          const hidden = await payment.capabilities(
            excluded.session,
            excluded.id,
            { locale, country: "", target: b.base },
          );
          check(
            hidden.data.capabilities.capabilities.length === 0 &&
              hidden.data.capabilities.countries.length === 0,
            "Excluded cohort stays excluded in every language without inventing an alternate country",
          );
        }
        const observations = (
          await client.query(
            "SELECT observation->'probeContext'->'command'->>'requestedLocale' locale FROM payment_provider_health_observations WHERE provider_account_id=$1 AND observation->>'operation'='GET_CAPABILITIES' AND observation->'probeContext'<>'null'::jsonb",
            [providerAccountId],
          )
        ).rows;
        check(
          observations.length >= SUPPORTED_LOCALES.length * 2 &&
            observations.every((value) => value.locale === "en"),
          "Persisted provider capability command contexts retain the checkout consent language despite presentation changes",
        );
        check(
          JSON.stringify(await psp.counts()) === JSON.stringify(before),
          "Country-free and localized discovery cause zero PSP financial side effects",
        );

        progress(
          "forged rule and rollout seed cannot authorize excluded checkout",
        );
        for (const target of [a.base, b.base]) {
          await payment.capabilities(excluded.session, excluded.id, {
            target,
            expected: 409,
            code: "CAPABILITY_UNAVAILABLE",
          });
          await payment.create(excluded.session, excluded.id, capability, {
            target,
            expected: 409,
            code: "CAPABILITY_UNAVAILABLE",
          });
        }
        await payment.create(excluded.session, excluded.id, capability, {
          expected: 400,
          code: "INVALID_COMMAND",
          body: { ...payment.createBody(capability), rolloutSeed: admitted.id },
        });
        await payment.request(
          "FORGED_ROLLOUT_QUERY",
          `/api/v1/checkout/sessions/${excluded.id}/capabilities?presentationLocale=en&country=US&supportedActionTypes=REDIRECT&rolloutSeed=${admitted.id}`,
          { session: excluded.session, expected: 400, code: "INVALID_COMMAND" },
        );
        check(
          JSON.stringify(await psp.counts()) === JSON.stringify(before),
          "Excluded or forged requests cause zero PSP financial side effects",
        );
        check(
          (
            await client.query(
              "SELECT count(*)::int count FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.checkout_session_id=$1",
              [excluded.id],
            )
          ).rows[0].count === 0,
          "The excluded checkout has no payment attempt in canonical PostgreSQL",
        );

        progress(
          "repository admission and deferred PostgreSQL guard independently reject bypasses",
        );
        const guardProof = await (
          await import("./payment-rollout-guard-proof.mjs")
        ).verifyRolloutGuards({
          context,
          excluded,
          capability,
          healthPolicies,
          check,
          paymentClient: payment,
        });

        progress(
          "partial rollout persists health observations and recovers with one safe probe",
        );
        const health = async () =>
          (
            await client.query(
              "SELECT health_status,version::int FROM payment_provider_accounts WHERE id=$1",
              [providerAccountId],
            )
          ).rows[0];
        for (const target of [a.base, b.base]) {
          await psp.arm({ operation: "GET_CAPABILITIES", mode: "BEFORE" });
          const failed = await payment.capabilities(
            admitted.session,
            admitted.id,
            { target },
          );
          check(
            failed.data.capabilities.capabilities.length === 0,
            "Real TLS capability fault closes this currently admitted option",
          );
        }
        check(
          (await health()).health_status === "UNAVAILABLE",
          "Partial-rollout context admits bounded observations that open the actual PG circuit",
        );
        const readsBefore = (await psp.observations()).filter(
          (value) => value.operation === "GET_CAPABILITIES",
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
          (value) => value.health_status === "HEALTHY",
          "A safe probe recovers the partially enabled account",
        );
        await recoveryA.stop();
        await recoveryB.stop();
        const recoveryReads =
          (await psp.observations()).filter(
            (value) => value.operation === "GET_CAPABILITIES",
          ).length - readsBefore;
        check(
          recoveryReads === 1,
          "Independent sweepers perform exactly one fenced safe probe for the partial rollout",
        );
        check(
          JSON.stringify(await psp.counts()) === JSON.stringify(before),
          "Health probe does not create payment or refund funds",
        );

        progress(
          "accepted UNKNOWN replays and reconciles on the same account across instances",
        );
        const recoveredCapability = (
          await payment.capabilities(admitted.session, admitted.id)
        ).data.capabilities.capabilities[0];
        check(
          Boolean(recoveredCapability),
          "Admitted checkout retains cohort after health recovery",
        );
        const key = randomUUID();
        await psp.arm({ operation: "CREATE_PAYMENT", mode: "AFTER" });
        const created = await payment.create(
          admitted.session,
          admitted.id,
          recoveredCapability,
          { key },
        );
        check(
          created.data.attempt.status === "UNKNOWN",
          "Actual accepted TEST PSP creation with lost TLS response remains UNKNOWN",
        );
        const attemptId = created.data.attempt.id;
        const acceptedCounts = await psp.counts();
        check(
          acceptedCounts.payments === before.payments + 1,
          "Admitted cohort produces exactly one actual TEST PSP payment",
        );
        progress(
          "a new zero-rollout publication blocks new checkouts while the existing UNKNOWN keeps its original route",
        );
        const closedPublication = await (
          await import("./payment-rollout-publish-fixture.mjs")
        ).publishClosedPaymentRollout({ context, check });
        const closedRoute = closedPublication.routes.find(
          (value) => value.providerAccountId === providerAccountId,
        );
        check(
          Boolean(closedRoute) && closedPublication.oldRowsUnchanged === true,
          "A normally validated new publication closes this account without rewriting its historical route",
        );
        const nextSession = await checkout.initialize();
        await checkout.add(nextSession);
        const nextPreflight = await checkout.validate(nextSession);
        const nextCheckout = await checkout.create(
          nextSession,
          nextPreflight.data.preflight,
          canaries[2],
        );
        const nextId = nextCheckout.data.checkout.id;
        const closed = await payment.capabilities(nextSession, nextId, {
          country: "",
          target: b.base,
        });
        check(
          closed.data.capabilities.countries.length === 0 &&
            closed.data.capabilities.capabilities.length === 0,
          "A real new checkout sees no available country or capability after zero rollout is published",
        );
        await payment.create(
          nextSession,
          nextId,
          {
            ...recoveredCapability,
            id: closedRoute.capabilityId,
            configVersion: closedPublication.configVersion,
            ruleVersion: closedPublication.ruleVersion,
          },
          { target: b.base, expected: 409, code: "CAPABILITY_UNAVAILABLE" },
        );
        check(
          JSON.stringify(await psp.counts()) === JSON.stringify(acceptedCounts),
          "Current zero-rollout rule and versions cannot produce a new PSP financial mutation",
        );
        const replay = await payment.create(
          admitted.session,
          admitted.id,
          recoveredCapability,
          { key, target: b.base },
        );
        check(
          replay.data.action === "REPLAYED" &&
            replay.data.attempt.id === attemptId,
          "Same original creation key replays across an independent API without another provider create",
        );
        await waitFor(
          async () =>
            (
              await client.query(
                "SELECT next_attempt_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) due FROM payment_runtime_operations WHERE attempt_id=$1",
                [attemptId],
              )
            ).rows[0].due,
          Boolean,
          "UNKNOWN reaches its persisted recovery due time",
        );
        const recovered = await payment.recover(
          admitted.session,
          admitted.id,
          attemptId,
          { target: b.base },
        );
        check(
          recovered.data.attempt.id === attemptId &&
            recovered.data.attempt.status === "REQUIRES_ACTION",
          "Authenticated reconcile restores the existing accepted payment",
        );
        const pinned = (
          await client.query(
            "SELECT provider_account_id,merchant_reference,provider_idempotency_key,route_rule_id,config_version::int,rule_version::int,amount_minor::text,currency FROM payment_attempts WHERE id=$1",
            [attemptId],
          )
        ).rows[0];
        check(
          pinned.provider_account_id === providerAccountId &&
            pinned.merchant_reference === attemptId &&
            pinned.provider_idempotency_key === attemptId &&
            pinned.route_rule_id === route.capabilityId &&
            pinned.config_version === published.configVersion &&
            pinned.rule_version === published.ruleVersion &&
            pinned.amount_minor ===
              String(admitted.checkout.amount.totalAmountMinor) &&
            pinned.currency === admitted.checkout.currency,
          "UNKNOWN keeps its frozen provider account, route versions, amount and original PSP identity",
        );
        check(
          (await psp.counts()).payments === acceptedCounts.payments,
          "Reconciliation does not create a second payment",
        );
        const healthEvidence = (
          await client.query(
            "SELECT observation FROM payment_provider_health_observations WHERE provider_account_id=$1",
            [providerAccountId],
          )
        ).rows;
        check(
          canaries.every(
            (value) =>
              !JSON.stringify({
                healthEvidence,
                logs: context.logLines,
              }).includes(value),
          ),
          "Health evidence and application logs omit private checkout canaries",
        );
        await save("protocol-results.json", {
          schemaVersion: 1,
          status: "PASS",
          assertions: assertions - setupAssertions,
          setupAssertions,
          actualPostgres: true,
          actualApiHttp: true,
          actualTlsTestPsp: true,
          actualMerchant: false,
          actualRollout: actual,
          maximumCheckouts,
          cohorts,
          presentationLocales: SUPPORTED_LOCALES,
          twoInstances: true,
          recoveryReads,
          guardProof,
          closedPublication: {
            configVersion: closedPublication.configVersion,
            ruleVersion: closedPublication.ruleVersion,
            rollout: closedPublication.rollout,
            oldRowsUnchanged: closedPublication.oldRowsUnchanged,
          },
          healthObservations: healthEvidence.length,
          paymentCounts: await psp.counts(),
          requests: payment.events,
        });
      },
    });
    status = "PASS";
    console.log(`PASS payment rollout ${assertions} assertions; ${output}`);
  } catch (error) {
    await save("failure.json", {
      schemaVersion: 1,
      status: "FAIL",
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
      ownedFixtureCleanupAttempted: true,
    });
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--owned-payment-rollout") {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) =>
        runPaymentRollout(database, s3),
      );
    } else {
      assert.equal(process.argv.length, 2);
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: "--owned-payment-rollout",
          timeoutMs: 1200000,
        }),
      );
    }
  } catch (error) {
    console.error(
      `FAIL payment rollout ${error?.name === "AssertionError" ? "ASSERTION" : "RUNTIME"}`,
    );
    process.exitCode = 1;
  }
}
