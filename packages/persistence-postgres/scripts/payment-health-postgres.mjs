#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import ts from "../../../node_modules/typescript/lib/typescript.js";
import { healthTimestamp } from "../dist/payment-health-data.js";
import { setTimeout as delay } from "node:timers/promises";
import { setTimeout, clearTimeout } from "node:timers";
import { performance } from "node:perf_hooks";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { seedPaymentRuntimeConfiguration } from "../../../apps/api/scripts/payment-runtime-config-fixture.mjs";
import { changePaymentRuntimeTestHealth } from "./payment-runtime-health-fixture.mjs";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let checks = 0;
let stage = "migrations";
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
function ok(value, label) {
  assert.ok(value, label);
  checks++;
}
await withEphemeralPostgres(async (database) => {
  await runMigrations({
    clientConfig: database,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(database);
  const first = createPostgresPersistence(database);
  const second = createPostgresPersistence(database);
  await client.connect();
  try {
    stage = "actual-postgres-query-parameters";
    let prepared = 0;
    for (const name of ["data", "context", "probe", "repository"]) {
      const source = await readFile(
        new URL(`../src/payment-health-${name}.ts`, import.meta.url),
        "utf8",
      );
      const ast = ts.createSourceFile(
        name,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const queries = [];
      function visit(node) {
        if (
          (ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateExpression(node)) &&
          node.getText(ast).includes("public.")
        ) {
          const sql = Function(
            "healthTimestamp",
            `return ${node.getText(ast)}`,
          )(healthTimestamp);
          if (/^(SELECT|UPDATE|INSERT)/u.test(sql)) queries.push(sql);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
      for (const sql of queries) {
        await client.query(`PREPARE payment_health_${prepared++} AS ${sql}`);
        checks++;
      }
    }
    ok(
      prepared >= 15,
      "all new fixed SQL statements use valid inferred PostgreSQL parameter types",
    );
    stage = "new-health-transaction-manager";
    equal(
      typeof first.paymentHealthTransactionManager
        ?.runInPaymentHealthTransaction,
      "function",
      "durable provider health transaction manager is implemented",
    );
    const run = (method, command, instance = first) =>
      instance.paymentHealthTransactionManager.runInPaymentHealthTransaction(
        (repository) => repository[method](command),
      );
    async function waitForDatabase(predicate, values, label) {
      const deadline = performance.now() + 15000;
      while (true) {
        if ((await client.query(predicate, values)).rows[0]?.ready === true) {
          checks++;
          return;
        }
        assert.ok(performance.now() < deadline, label);
        await delay(25);
      }
    }
    const waitProbeDue = (providerAccountId) =>
      waitForDatabase(
        "SELECT probe_due_at<=clock_timestamp() AND (probe_expires_at IS NULL OR probe_expires_at<=clock_timestamp()) ready FROM payment_provider_health_state WHERE provider_account_id=$1",
        [providerAccountId],
        "PostgreSQL probe due deadline advances within bounded local test wait",
      );
    const merchantId = randomUUID();
    const accountId = randomUUID();
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO merchant_entities(id,entity_key,legal_country,status) VALUES($1,$2,'US','ACTIVE')",
      [merchantId, `health-${randomUUID()}`],
    );
    await client.query(
      "INSERT INTO payment_provider_accounts(id,merchant_entity_id,adapter_key,environment,account_reference_digest,credential_secret_ref,status) VALUES($1,$2,'fake','TEST',$3,$4,'ACTIVE')",
      [
        accountId,
        merchantId,
        randomBytes(32),
        `secret-ref:v1:aws-sm:test/payment/${accountId}`,
      ],
    );
    await client.query(
      "INSERT INTO payment_provider_health_events(id,provider_account_id,sequence,from_status,to_status,observer_kind,task_name,reason_code,request_id,correlation_id) VALUES($1,$2,1,NULL,'HEALTHY','SYSTEM','payment-health-test','SYNTHETIC_TEST_HEALTH',$3,$4)",
      [randomUUID(), accountId, randomUUID(), randomUUID()],
    );
    await client.query("COMMIT");
    const policy = {
      schemaVersion: 1,
      providerAccountId: accountId,
      environment: "TEST",
      version: 1,
      failureThreshold: 3,
      failureWindowMs: 60000,
      openDurationMs: 1000,
      probeLeaseMs: 1000,
      probeRetryMs: 1000,
    };
    const observation = (
      classification = "TECHNICAL_FAILURE",
      overrides = {},
    ) => ({
      schemaVersion: 1,
      observationId: randomUUID(),
      providerAccountId: accountId,
      environment: "TEST",
      operation: "CREATE_PAYMENT",
      classification,
      code: classification === "SUCCESS" ? null : "TEMPORARY_UNAVAILABLE",
      probeContext: null,
      ...overrides,
    });
    stage = "bootstrap-and-policy-conflict";
    const initialized = await run("initialize", policy);
    equal(
      initialized.healthStatus,
      "HEALTHY",
      "initial policy preserves canonical health",
    );
    equal(
      await run("initialize", policy, second),
      initialized,
      "same policy bootstraps idempotently across instances",
    );
    await assert.rejects(
      run("initialize", { ...policy, failureThreshold: 4 }),
      (error) => error.code === "POLICY_CONFLICT",
    );
    checks++;
    await assert.rejects(
      run("initialize", { ...policy, environment: "LIVE" }),
      (error) => error.code === "NOT_CONFIGURED",
    );
    checks++;
    stage = "observation-deduplication-and-threshold";
    const failure = observation();
    equal(
      (await run("record", failure)).recorded,
      true,
      "first technical observation persisted",
    );
    const replay = await Promise.all([
      run("record", failure),
      run("record", failure, second),
    ]);
    ok(
      replay.every((result) => result.recorded === false),
      "independent instances do not count a duplicate twice",
    );
    await assert.rejects(
      run("record", { ...failure, operation: "GET_PAYMENT" }),
      (error) => error.code === "OBSERVATION_CONFLICT",
    );
    checks++;
    await run("record", observation("SUCCESS"));
    equal(
      (await run("initialize", policy)).failureCount,
      1,
      "ordinary success does not reset failure history",
    );
    equal(
      (await run("record", observation())).healthStatus,
      "HEALTHY",
      "below threshold remains available",
    );
    equal(
      (await run("record", observation())).healthStatus,
      "UNAVAILABLE",
      "threshold opens canonical account",
    );
    const head = (
      await client.query(
        "SELECT a.health_status,a.version::int,(SELECT count(*)::int FROM payment_provider_health_events e WHERE e.provider_account_id=a.id) events FROM payment_provider_accounts a WHERE a.id=$1",
        [accountId],
      )
    ).rows[0];
    equal(
      head,
      { health_status: "UNAVAILABLE", version: 2, events: 2 },
      "exactly one versioned health event is committed",
    );
    await run("record", observation("SUCCESS"));
    equal(
      (await run("initialize", policy)).healthStatus,
      "UNAVAILABLE",
      "ordinary success cannot recover an open circuit",
    );
    equal(
      await run("claimProbe", {
        schemaVersion: 1,
        accounts: [{ providerAccountId: accountId, environment: "TEST" }],
      }),
      null,
      "no synthetic business context is invented for a probe",
    );
    stage = "atomic-rollback";
    const before = await run("initialize", policy);
    await assert.rejects(
      first.paymentHealthTransactionManager.runInPaymentHealthTransaction(
        async (repository) => {
          await repository.record(observation());
          throw new Error("synthetic rollback");
        },
      ),
    );
    checks++;
    equal(
      await run("initialize", policy),
      before,
      "outer transaction rollback retains prior counter and due state",
    );
    stage = "published-safe-probe-context";
    const manager = randomUUID(),
      probeAccount = randomUUID(),
      healthyAccount = randomUUID();
    await client.query(
      "INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required) VALUES($1,'payment-health-test-manager',$2,'ACTIVE',true)",
      [manager, randomBytes(32)],
    );
    const configuration = await seedPaymentRuntimeConfiguration({
      client,
      identity: { identities: { identities: { manager } } },
      bindings: [probeAccount, healthyAccount].map((providerAccountId) => ({
        schemaVersion: 1,
        providerAccountId,
        providerCode: "fake",
        environment: "TEST",
        allowedActionOrigins: ["https://payments.example.test"],
        localeMapping: Object.fromEntries(
          SUPPORTED_LOCALES.map((locale) => [
            locale,
            { providerLocale: locale, fallbackUsed: false },
          ]),
        ),
      })),
      configuration: {
        schemaVersion: 1,
        publicStorefrontOrigin: "https://store.example.test",
        leaseMs: 30000,
        recoveryDelayMs: 10000,
        actionTtlMs: 300000,
        returnStateTtlMs: 3600000,
        recoveryBatchSize: 10,
      },
      rollout: { providerBasisPoints: 5000, ruleBasisPoints: 5000 },
      scope: { country: "US", market: "TEST", currency: "USD" },
      check: ok,
    });
    equal(
      (
        await client.query(
          "SELECT rollout_basis_points::int value FROM payment_route_rules WHERE id=$1",
          [configuration.routes[0].capabilityId],
        )
      ).rows[0].value,
      5000,
      "actual immutable publication carries the partial rollout fixture",
    );
    const probePolicy = {
      ...policy,
      providerAccountId: probeAccount,
      failureThreshold: 1,
    };
    const healthyPolicy = {
      ...policy,
      providerAccountId: healthyAccount,
      failureWindowMs: 1000,
    };
    await run("initialize", probePolicy);
    await run("initialize", healthyPolicy);
    const context = {
      schemaVersion: 1,
      routeId: configuration.routes[0].capabilityId,
      configVersion: configuration.configVersion,
      ruleVersion: configuration.ruleVersion,
      command: {
        schemaVersion: 1,
        operation: "GET_CAPABILITIES",
        providerAccountId: probeAccount,
        environment: "TEST",
        market: "TEST",
        country: "US",
        currency: "USD",
        amountMinor: 1000,
        requestedLocale: "en",
        supportedActionTypes: ["REDIRECT"],
      },
    };
    const capabilityObservation = (classification = "TECHNICAL_FAILURE") =>
      observation(classification, {
        providerAccountId: probeAccount,
        operation: "GET_CAPABILITIES",
        probeContext: context,
      });
    await assert.rejects(
      run("record", {
        ...capabilityObservation(),
        probeContext: { ...context, configVersion: context.configVersion + 1 },
      }),
      (error) => error.code === "CONTEXT_UNAVAILABLE",
    );
    checks++;
    await run("record", capabilityObservation());
    equal(
      (await run("initialize", healthyPolicy)).healthStatus,
      "HEALTHY",
      "failure is isolated from another published account",
    );
    const claim = {
      schemaVersion: 1,
      accounts: [{ providerAccountId: probeAccount, environment: "TEST" }],
    };
    const completion = (lease, classification = "SUCCESS") => ({
      schemaVersion: 1,
      lease,
      classification,
      code: classification === "SUCCESS" ? null : "TEMPORARY_UNAVAILABLE",
    });
    equal(
      await run("claimProbe", claim),
      null,
      "open duration prevents early probes",
    );
    await waitProbeDue(probeAccount);
    stage = "independent-probe-claims";
    const claims = await Promise.all([
      run("claimProbe", claim),
      run("claimProbe", claim, second),
    ]);
    equal(
      claims.filter(Boolean).length,
      1,
      "two processes acquire only one active probe lease",
    );
    const lease = claims.find(Boolean);
    equal(
      lease.context,
      context,
      "probe reuses the actual published capability context",
    );
    await run("record", capabilityObservation());
    equal(
      (await run("completeProbe", completion(lease))).applied,
      false,
      "newer technical failure fences an in-flight success",
    );
    await waitProbeDue(probeAccount);
    const expired = await run("claimProbe", claim);
    ok(expired, "a later due probe can be acquired after invalidation");
    await waitForDatabase(
      "SELECT probe_expires_at<=clock_timestamp() ready FROM payment_provider_health_state WHERE provider_account_id=$1 AND probe_id=$2",
      [probeAccount, expired.probeId],
      "PostgreSQL expired lease is observed before completion",
    );
    equal(
      (await run("completeProbe", completion(expired))).applied,
      false,
      "expired lease cannot recover availability",
    );
    const replacement = await run("claimProbe", claim, second);
    ok(
      replacement && replacement.generation > expired.generation,
      "another process recovers an expired lease with a greater fence",
    );
    equal(
      await run("completeProbe", completion(replacement, "TECHNICAL_FAILURE")),
      { schemaVersion: 1, applied: true, healthStatus: "UNAVAILABLE" },
      "failed safe probe keeps account open and schedules retry",
    );
    await waitProbeDue(probeAccount);
    const staleAccount = await run("claimProbe", claim);
    await changePaymentRuntimeTestHealth({
      clientConfig: database,
      providerAccountId: probeAccount,
      healthStatus: "HEALTHY",
    });
    await changePaymentRuntimeTestHealth({
      clientConfig: database,
      providerAccountId: probeAccount,
      healthStatus: "UNAVAILABLE",
    });
    equal(
      (await run("completeProbe", completion(staleAccount))).applied,
      false,
      "independent account health transitions invalidate an old probe even without changing its generation",
    );
    await waitProbeDue(probeAccount);
    const recovery = await run("claimProbe", claim, second);
    equal(
      await run("completeProbe", completion(recovery)),
      { schemaVersion: 1, applied: true, healthStatus: "HEALTHY" },
      "successful fenced safe query restores original account",
    );
    equal(
      (await run("completeProbe", completion(recovery))).applied,
      false,
      "replayed completion cannot append a second recovery event",
    );
    const recovered = await run("initialize", probePolicy);
    equal(recovered.failureCount, 0, "probe recovery resets failure window");
    equal(
      recovered.probeDueAt,
      null,
      "healthy account has no recovery work pending",
    );
    equal(
      (await client.query("SELECT count(*)::int count FROM payment_attempts"))
        .rows[0].count,
      0,
      "health observation and safe probe never create payments",
    );
    stage = "durable-probe-evidence";
    const proof = (
      await client.query(
        "SELECT observation_id,source,probe_generation::int,lease_account_version::int,observation->>'classification' classification,observation->>'code' code FROM payment_provider_health_observations WHERE provider_account_id=$1 AND source='PROBE' ORDER BY recorded_at",
        [probeAccount],
      )
    ).rows;
    equal(
      proof.length,
      2,
      "one failed and one successful valid probe are retained, expired completions are excluded",
    );
    equal(
      proof.map((entry) => entry.classification),
      ["TECHNICAL_FAILURE", "SUCCESS"],
      "bounded classifications preserve actual probe outcomes",
    );
    equal(
      proof[0].observation_id,
      replacement.probeId,
      "failed query receipt keeps the probe identity",
    );
    equal(
      proof[1].observation_id,
      recovery.probeId,
      "recovery query receipt keeps the probe identity",
    );
    equal(
      (
        await client.query(
          "SELECT count(*)::int count FROM payment_provider_health_events event JOIN payment_provider_health_observations observation ON observation.observation_id=event.request_id AND observation.provider_account_id=event.provider_account_id WHERE event.provider_account_id=$1 AND event.reason_code='RECOVERY_PROBE_SUCCEEDED' AND observation.source='PROBE' AND observation.observation->>'classification'='SUCCESS'",
          [probeAccount],
        )
      ).rows[0].count,
      1,
      "restored account event is bound to its permanent safe query evidence",
    );
    equal(
      (await run("completeProbe", completion(replacement, "TECHNICAL_FAILURE")))
        .applied,
      false,
      "failed probe replay cannot duplicate retained evidence",
    );
    stage = "fixed-window-expiry";
    const firstShortFailure = observation("TECHNICAL_FAILURE", {
      providerAccountId: healthyAccount,
    });
    await run("record", firstShortFailure);
    await run(
      "record",
      observation("BUSINESS_OUTCOME", {
        providerAccountId: healthyAccount,
        code: "PROVIDER_DECLINED",
      }),
    );
    await run(
      "record",
      observation("CONFIGURATION_ERROR", {
        providerAccountId: healthyAccount,
        code: "AUTHENTICATION_FAILED",
      }),
    );
    equal(
      (await run("initialize", healthyPolicy)).failureCount,
      1,
      "decline and configuration failure do not count as technical outages",
    );
    await waitForDatabase(
      "SELECT window_started_at + $2::bigint * interval '1 millisecond' <= clock_timestamp() ready FROM payment_provider_health_state WHERE provider_account_id=$1",
      [healthyAccount, healthyPolicy.failureWindowMs],
      "fixed failure window expires on PostgreSQL clock",
    );
    await run(
      "record",
      observation("TECHNICAL_FAILURE", { providerAccountId: healthyAccount }),
    );
    equal(
      (await run("initialize", healthyPolicy)).failureCount,
      1,
      "elapsed fixed window resets only on the next technical observation",
    );
    const lostReply = observation("SUCCESS", {
      providerAccountId: healthyAccount,
    });
    await assert.rejects(
      (async () => {
        await run("record", lostReply);
        throw new Error("TEST response lost after real COMMIT");
      })(),
    );
    checks++;
    equal(
      (await run("record", lostReply, second)).recorded,
      false,
      "lost committed response is safely replayed in another application instance",
    );
    stage = "same-transaction-concurrency";
    await first.paymentHealthTransactionManager.runInPaymentHealthTransaction(
      (repository) =>
        Promise.all([
          repository.record(
            observation("TECHNICAL_FAILURE", {
              providerAccountId: healthyAccount,
            }),
          ),
          repository.record(
            observation("TECHNICAL_FAILURE", {
              providerAccountId: healthyAccount,
            }),
          ),
        ]),
    );
    equal(
      (await run("initialize", healthyPolicy)).failureCount,
      3,
      "parallel calls inside one transaction serialize accounting without lost observations",
    );
    equal(
      (await run("initialize", healthyPolicy)).healthStatus,
      "UNAVAILABLE",
      "same transaction threshold still writes exactly one canonical health transition",
    );
    stage = "policy-history";
    const futurePolicy = { ...healthyPolicy, version: 2 };
    await client.query(
      "INSERT INTO payment_provider_health_policies(provider_account_id,environment,policy_version,policy,policy_hash) VALUES($1,'TEST',2,$2::jsonb,encode(sha256(convert_to(public.canonical_publication_json($2::jsonb),'UTF8')),'hex'))",
      [healthyAccount, JSON.stringify(futurePolicy)],
    );
    equal(
      (await run("initialize", healthyPolicy)).policyVersion,
      1,
      "retaining a new immutable policy does not change the active version",
    );
    await assert.rejects(
      run("initialize", futurePolicy),
      (error) => error.code === "POLICY_CONFLICT",
    );
    checks++;
    equal(
      (
        await client.query(
          "SELECT count(*)::int count FROM payment_provider_health_policies WHERE provider_account_id=$1",
          [healthyAccount],
        )
      ).rows[0].count,
      2,
      "immutable versions coexist without overwriting policy history",
    );
    await assert.rejects(
      run(
        "record",
        observation("TECHNICAL_FAILURE", {
          providerAccountId: probeAccount,
          environment: "LIVE",
        }),
      ),
      (error) => error.code === "NOT_CONFIGURED",
    );
    checks++;
    stage = "database-envelope-validation";
    async function rejectRawObservation(payload) {
      await assert.rejects(
        client.query(
          "INSERT INTO payment_provider_health_observations(observation_id,provider_account_id,environment,policy_version,observation,observation_hash) VALUES($1,$2,'TEST',1,$3::jsonb,encode(sha256(convert_to(public.canonical_publication_json($3::jsonb),'UTF8')),'hex'))",
          [
            payload.observationId,
            payload.providerAccountId,
            JSON.stringify(payload),
          ],
        ),
        (error) => ["23514", "22P02"].includes(error.code),
      );
      checks++;
    }
    await rejectRawObservation(
      observation("TECHNICAL_FAILURE", { code: "PROVIDER_DECLINED" }),
    );
    await rejectRawObservation(
      observation("SUCCESS", { code: "TEMPORARY_UNAVAILABLE" }),
    );
    await rejectRawObservation({
      ...observation(),
      raw: "forbidden-provider-payload",
    });
    await rejectRawObservation({
      ...capabilityObservation(),
      probeContext: {
        ...context,
        command: { ...context.command, raw: "forbidden-provider-payload" },
      },
    });
    await assert.rejects(
      client.query(
        "UPDATE payment_provider_health_policies SET policy_version=3 WHERE provider_account_id=$1",
        [healthyAccount],
      ),
      (error) => error.code === "55000",
    );
    checks++;
    await assert.rejects(
      client.query(
        await readFile(
          new URL(
            "../../../database/migrations/0033_payment-provider-health.down.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
      (error) => error.code === "55000",
    );
    checks++;
    stage = "append-only-evidence";
    await assert.rejects(
      client.query(
        "DELETE FROM payment_provider_health_observations WHERE provider_account_id=$1",
        [accountId],
      ),
      (error) => error.code === "55000",
    );
    checks++;
    stage = "bounded-health-database-wait";
    const blocker = new Client(database);
    await blocker.connect();
    const blockedObservation = observation("SUCCESS", {
      providerAccountId: probeAccount,
    });
    let escape;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM payment_provider_accounts WHERE id=$1 FOR UPDATE",
        [probeAccount],
      );
      escape = setTimeout(() => {
        void blocker.query("ROLLBACK").catch(() => undefined);
      }, 3500);
      await assert.rejects(
        run("record", blockedObservation),
        (error) => error.failure?.error?.code === "TEMPORARY_UNAVAILABLE",
      );
      checks++;
    } finally {
      clearTimeout(escape);
      await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end();
    }
    equal(
      (
        await client.query(
          "SELECT count(*)::int count FROM payment_provider_health_observations WHERE observation_id=$1",
          [blockedObservation.observationId],
        )
      ).rows[0].count,
      0,
      "timed out account wait cannot later persist an observation in the background",
    );
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        outcome: "PASS",
        scope: "real PostgreSQL local TEST payment health",
        checks,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        outcome: "FAIL",
        stage,
        message: error.message,
        code: error.code,
        checks,
      }),
    );
    throw error;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await Promise.allSettled([first.close(), second.close(), client.end()]);
  }
}).catch((error) => {
  console.error(
    JSON.stringify({
      outcome: "FAIL",
      stage,
      name: error.name,
      message: error.message,
      code: error.code,
      checks,
    }),
  );
  process.exitCode = 1;
});
