#!/usr/bin/env node
import assert from "node:assert/strict";
import { verifyExceptionProjection } from "./admin-exceptions-projection-cases.mjs";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { withNativeFinancePostgres } from "../../../apps/api/scripts/admin-finance-native-postgres.mjs";
import {
  loadMigrationManifest,
  captureDatabaseCatalog,
  withEphemeralPostgres,
} from "../dist/index.js";
import { runMigrationCommandOnSession } from "../dist/migrations/runner.js";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";
import { createProcessWebhookInbox } from "../../application/dist/process-webhook-inbox.js";
const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  ),
  args = process.argv.slice(2),
  bin = args[args.indexOf("--native-bin") + 1];
const output = path.join(
  root,
  "output/checks/p5-06-exception-operations/storage",
  new Date().toISOString().replaceAll(":", "-"),
);
await mkdir(output, { recursive: true });
let checks = 0,
  stage = "migrations";
const check = (value, label) => {
  stage = label;
  assert.ok(value, label);
  checks++;
};
const hash = (v) =>
    createHash("sha256").update(JSON.stringify(v)).digest("hex"),
  digest = () => randomBytes(32).toString("hex");
const harness = args.includes("--native-bin")
  ? (work) => withNativeFinancePostgres(work, { binDirectory: bin })
  : withEphemeralPostgres;
try {
  await harness(async (database) => {
    const client = new Client(database);
    await client.connect();
    const session = {
      query: async (text, values = []) => client.query(text, [...values]),
    };
    const manifests = await loadMigrationManifest({ workspaceRoot: root });
    await runMigrationCommandOnSession(session, manifests, { direction: "up" });
    check(
      (
        await client.query(
          "SELECT to_regclass('public.admin_exception_receipts') IS NOT NULL available",
        )
      ).rows[0].available,
      "permanent exception receipts exist",
    );
    const capture = () =>
      captureDatabaseCatalog({
        query: async (text, values = []) => ({
          rows: (await client.query(text, [...values])).rows,
        }),
      });
    const before = await capture();
    await runMigrationCommandOnSession(session, manifests, {
      direction: "down",
      confirmVersion: "0037",
    });
    await runMigrationCommandOnSession(session, manifests, {
      direction: "up",
      targetVersion: "0037",
    });
    check(
      JSON.stringify(before) === JSON.stringify(await capture()),
      "0037 up/down/up identical catalog",
    );
    if (args.includes("--write-catalog"))
      await writeFile(
        path.join(root, "database/schema/expected-catalog.json"),
        JSON.stringify(before, null, 2) + "\n",
      );
    check(
      JSON.stringify(before) ===
        JSON.stringify(
          JSON.parse(
            await readFile(
              path.join(root, "database/schema/expected-catalog.json"),
              "utf8",
            ),
          ),
        ),
      "current schema matches reviewed catalog",
    );
    const make = () =>
      createPostgresPersistenceWithPoolFactory(
        database,
        {},
        (cfg) => new Pool(cfg),
      );
    let first = make();
    const second = make();
    const tx = (work, p = first) =>
      p.adminExceptionsTransactionManager.runInAdminExceptionsTransaction(work);
    const actors = [];
    for (const grants of [
      ["exceptions.read", "exceptions.replay"],
      ["exceptions.read"],
      [],
    ]) {
      const id = randomUUID(),
        role = randomUUID(),
        sid = randomUUID(),
        token = digest(),
        csrf = digest();
      await client.query(
        `INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'https://exception-identity.example.test',$2,'ACTIVE')`,
        [id, randomBytes(32)],
      );
      await client.query(
        `INSERT INTO roles(id,role_key,description) VALUES($1,$2,'TEST exception authority')`,
        [role, `exceptions:${randomUUID()}`],
      );
      await client.query(
        `INSERT INTO admin_identity_roles(admin_identity_id,role_id) VALUES($1,$2)`,
        [id, role],
      );
      await client.query(
        `INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key=ANY($2::text[])`,
        [role, grants],
      );
      await client.query(
        `INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,clock_timestamp()+interval '1 hour')`,
        [sid, id, token, csrf],
      );
      actors.push({
        id,
        role,
        sid,
        access: {
          schemaVersion: 1,
          sessionTokenDigest: token,
          csrfTokenDigest: csrf,
          requestId: randomUUID(),
          correlationId: randomUUID(),
        },
      });
    }
    const run = (command, who = 0, p = first) =>
      tx(
        (r) =>
          r.execute({
            schemaVersion: 1,
            access: actors[who].access,
            command: { schemaVersion: 1, ...command },
            requestHash: "idempotencyKey" in command ? hash(command) : null,
          }),
        p,
      );
    const detail = (target) => run({ action: "DETAIL", target });
    const claim = (operationId, p = first, leaseDurationMs = 30000) =>
      tx(
        (r) =>
          r.claim({
            schemaVersion: 1,
            operationId,
            leaseTokenDigest: digest(),
            leaseDurationMs,
            requestId: randomUUID(),
            correlationId: randomUUID(),
          }),
        p,
      );
    const settle = (c, outcome = "FAILED") =>
      tx((r) =>
        r.settle({
          schemaVersion: 1,
          claim: c,
          outcome,
          reasonCode:
            outcome === "SUCCEEDED" ? "PROCESSED" : "PROCESSING_FAILED",
        }),
      );
    const failure = (r, code) =>
      check(r.outcome === "FAILURE" && r.code === code, `reject ${code}`);
    const expectSqlFailure = async (sql, values, code) => {
      let observed;
      await client.query("BEGIN");
      try {
        await client.query(sql, values);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      } catch (error) {
        observed = error.code;
      } finally {
        await client.query("ROLLBACK");
      }
      check(observed === code, `SQL constraint rejects ${code}`);
    };
    // Isolated synthetic historical source identities, with encrypted placeholder bytes.
    // Recovery mutations and application handlers below execute with every production trigger enabled.
    const merchant = randomUUID(),
      account = randomUUID(),
      endpoint = randomUUID(),
      inbox = randomUUID(),
      event = randomUUID(),
      payload = randomUUID(),
      outbox = randomUUID();
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role=replica");
    await client.query(
      `INSERT INTO merchant_entities(id,entity_key,legal_country,status) VALUES($1,$2,'US','ACTIVE')`,
      [merchant, `exceptions-${merchant}`],
    );
    await client.query(
      `INSERT INTO payment_provider_accounts(id,merchant_entity_id,adapter_key,environment,account_reference_digest,credential_secret_ref,status) VALUES($1,$2,'fake_psp','TEST',decode(repeat('61',32),'hex'),'secret-ref:v1:test:exception/provider','ACTIVE')`,
      [account, merchant],
    );
    const endpointAudit = randomUUID();
    await client.query(
      `INSERT INTO audit_logs(id,actor_type,task_name,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome) VALUES($1,'SYSTEM','exception-storage-test','PAYMENT_WEBHOOK_ENDPOINT_ACTIVATED','PAYMENT_WEBHOOK_ENDPOINT',$2,'INITIAL_ENDPOINT',$3,$3,'SUCCEEDED')`,
      [endpointAudit, endpoint, randomUUID()],
    );
    await client.query(
      `INSERT INTO payment_webhook_endpoints(id,provider_account_id,environment,verification_secret_ref,verification_key_reference_hash,status,active_from,lifecycle_audit_log_id) VALUES($1,$2,'TEST','secret-ref:v1:test:exception/webhook',$3,'ACTIVE',clock_timestamp()-interval '1 hour',$4)`,
      [endpoint, account, "6".repeat(64), endpointAudit],
    );
    await client.query(
      `INSERT INTO webhook_payloads(id,payload_ciphertext,encrypted_data_key,encryption_key_version,payload_sha256,status,retention_expires_at) VALUES($1,decode(repeat('01',48),'hex'),decode(repeat('02',48),'hex'),'exception-key-v1',$2,'RETAINED',clock_timestamp()+interval '6 days')`,
      [payload, "6".repeat(64)],
    );
    await client.query(
      `INSERT INTO webhook_inbox(id,provider_account_id,environment,endpoint_id,provider_event_id,webhook_payload_id,payload_sha256,signature_verified,verification_key_reference_hash,signature_timestamp) VALUES($1,$2,'TEST',$3,'test-exception-event',$4,$5,true,$5,transaction_timestamp())`,
      [inbox, account, endpoint, payload, "6".repeat(64)],
    );
    await client.query(
      `INSERT INTO provider_events(id,provider_account_id,environment,provider_event_id,evidence_kind,webhook_inbox_id,event_type,normalized_status,external_payment_reference,amount_minor,currency,occurred_at) VALUES($1,$2,'TEST','test-exception-event','VERIFIED_WEBHOOK',$3,'PAYMENT_STATUS','FAILED','private-provider-reference',100,'USD',transaction_timestamp())`,
      [event, account, inbox],
    );
    await client.query(
      `INSERT INTO provider_event_associations(id,provider_event_id,association_status,reason_code) VALUES($1,$2,'UNMATCHED','EXTERNAL_REFERENCE_PENDING')`,
      [randomUUID(), event],
    );
    await client.query(
      `INSERT INTO outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,idempotency_key,correlation_id,request_id,occurred_at,available_at) VALUES($1,'PAYMENT_CONFIG_PUBLISHED','PAYMENT_CONFIG',$2,1,$2,$3,$4,$4,transaction_timestamp(),transaction_timestamp())`,
      [outbox, randomUUID(), `exception-test:${outbox}`, randomUUID()],
    );
    await client.query("COMMIT");
    await client.query(
      `INSERT INTO webhook_processing_attempts(id,webhook_inbox_id,attempt_number,outcome,error_code,started_at,finished_at) VALUES($1,$2,1,'DEAD_LETTER','HANDLER_EXECUTION_FAILED',clock_timestamp(),clock_timestamp())`,
      [randomUUID(), inbox],
    );
    await client.query(
      `INSERT INTO outbox_dispatch_attempts(id,outbox_event_id,consumer_key,attempt_number,outcome,error_code,started_at,finished_at) VALUES($1,$2,'order-notifications-v1',1,'DEAD_LETTER','HANDLER_EXECUTION_FAILED',clock_timestamp(),clock_timestamp())`,
      [randomUUID(), outbox],
    );
    const target = { kind: "WEBHOOK", id: inbox, consumerKey: null };
    try {
      check(
        (await run({ action: "CONTEXT" })).permissions.canReplayWebhook,
        "authorized context",
      );
      failure(await run({ action: "CONTEXT" }, 2), "FORBIDDEN");
      const invalid = await tx((r) =>
        r.execute({
          schemaVersion: 1,
          access: { ...actors[0].access, csrfTokenDigest: digest() },
          command: { schemaVersion: 1, action: "CONTEXT" },
          requestHash: null,
        }),
      );
      failure(invalid, "CSRF_INVALID");
      const initial = await detail(target);
      check(
        initial.item.allowedAction === "REPLAY_WEBHOOK",
        "failed webhook is recoverable",
      );
      check(
        !JSON.stringify(initial).includes("private-provider-reference"),
        "redacted source excludes provider reference",
      );
      const cmd = {
        action: "REPLAY_WEBHOOK",
        target,
        expectedVersion: initial.item.version,
        idempotencyKey: randomUUID(),
        reasonCode: "RETRY_AFTER_REPAIR",
        confirmed: true,
      };
      failure(await run(cmd, 1), "FORBIDDEN");
      failure(
        await run({ ...cmd, expectedVersion: "0".repeat(64) }),
        "STALE_VERSION",
      );
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          run(cmd, 0, i % 2 ? first : second),
        ),
      );
      check(
        results.every((r) => r.outcome === "SUCCESS"),
        "ten concurrent same-key commands succeed",
      );
      check(
        new Set(results.map((r) => r.operationId)).size === 1 &&
          results.filter((r) => !r.replayed).length === 1,
        "one permanent operation for ten commands",
      );
      const op = results[0].operationId;
      failure(
        await run({ ...cmd, reasonCode: "OPERATOR_REVIEW" }),
        "IDEMPOTENCY_CONFLICT",
      );
      const current = await detail(target);
      check(
        current.item.blockedReason === "IN_PROGRESS",
        "pending operation is visible",
      );
      failure(
        await run({
          ...cmd,
          idempotencyKey: randomUUID(),
          expectedVersion: current.item.version,
        }),
        "SOURCE_IN_PROGRESS",
      );
      const claims = await Promise.all([
        claim(op, first, 1000),
        claim(op, second, 1000),
      ]);
      check(claims.filter(Boolean).length === 1, "one cross-pool lease");
      const old = claims.find(Boolean);
      check(
        (await settle({ ...old, leaseTokenDigest: digest() })).decision ===
          "STALE",
        "wrong lease cannot settle",
      );
      check(
        (await settle(old, "SUCCEEDED")).decision === "STALE",
        "success requires original processing proof",
      );
      await expectSqlFailure(
        `UPDATE admin_exception_operations SET status='SUCCEEDED',reason_code='PROCESSED',lease_token_digest=NULL,lease_expires_at=NULL,version=version+1 WHERE id=$1`,
        [op],
        "23514",
      );
      await new Promise((done) => setTimeout(done, 1100));
      await first.close();
      first = make();
      const renewed = await claim(op);
      check(
        renewed.generation === old.generation + 1,
        "restart reclaims expired lease with new generation",
      );
      check(
        (await settle(old)).decision === "STALE",
        "stale generation cannot settle",
      );
      check(
        (await settle(renewed)).decision === "RECORDED",
        "current lease records failure",
      );
      check(
        (await settle(renewed)).decision === "STALE",
        "completed lease cannot settle again",
      );
      const failed = await detail(target);
      check(
        failed.item.allowedAction === "REPLAY_WEBHOOK",
        "failed recovery can be deliberately retried",
      );
      const secondCmd = {
        ...cmd,
        idempotencyKey: randomUUID(),
        expectedVersion: failed.item.version,
      };
      const secondOp = await run(secondCmd);
      const active = await claim(secondOp.operationId);
      let applied = 0;
      const handler = createProcessWebhookInbox({
        transactionManager: first.reliableEventTransactionManager,
        createId: randomUUID,
        now: () => new Date().toISOString(),
        handlerForEvent: () => ({
          effect: (ctx) => ({
            effectKey: "EXCEPTION_STORAGE_TEST",
            subjectId: ctx.providerEventRowId,
          }),
          handle: async () => {
            applied++;
          },
        }),
      });
      for (let i = 0; i < 10; i++)
        await handler(active.job, {
          schemaVersion: 1,
          jobId: active.operationId,
          attemptNumber: 1,
          maxAttempts: 1,
        });
      check(applied === 1, "ten original-handler replays apply one effect");
      check(
        (await settle(active, "SUCCEEDED")).decision === "RECORDED",
        "trusted success closes recovery",
      );
      const done = await detail(target);
      check(
        done.item.status === "SUCCEEDED" &&
          done.item.blockedReason === "ALREADY_COMPLETE",
        "completed source cannot be resent",
      );
      check(
        (await run(secondCmd)).replayed,
        "lost response recovers permanent original receipt",
      );
      const dlq = {
        kind: "DEAD_LETTER",
        id: outbox,
        consumerKey: "order-notifications-v1",
      };
      const dlqDetail = await detail(dlq);
      check(
        dlqDetail.item.allowedAction === "RETRY_DEAD_LETTER",
        "known dead-letter consumer may retry",
      );
      failure(
        await run({
          action: "RETRY_DEAD_LETTER",
          target: { ...dlq, consumerKey: "invented-consumer" },
          expectedVersion: dlqDetail.item.version,
          idempotencyKey: randomUUID(),
          reasonCode: "RETRY_AFTER_REPAIR",
          confirmed: true,
        }),
        "NOT_FOUND",
      );
      const d = await run({
        action: "RETRY_DEAD_LETTER",
        target: dlq,
        expectedVersion: dlqDetail.item.version,
        idempotencyKey: randomUUID(),
        reasonCode: "RETRY_AFTER_REPAIR",
        confirmed: true,
      });
      check(
        d.outcome === "SUCCESS",
        "dead-letter recovery has durable request",
      );
      const dc = await claim(d.operationId);
      check(
        dc.job.consumerKey === "order-notifications-v1" &&
          dc.job.outboxEventId === outbox,
        "claim preserves consumer and original event",
      );
      await settle(dc);
      await expectSqlFailure(
        `DELETE FROM admin_exception_receipts WHERE operation_id=$1`,
        [op],
        "55000",
      );
      await expectSqlFailure(
        `UPDATE admin_exception_operations SET status='REQUESTED',reason_code=NULL,version=version+1 WHERE id=$1`,
        [op],
        "55000",
      );
      await expectSqlFailure(
        `INSERT INTO admin_exception_operations(id,action,webhook_inbox_id,status,request_id,correlation_id) VALUES($1,'REPLAY_WEBHOOK',$2,'REQUESTED',$3,$3)`,
        [randomUUID(), inbox, randomUUID()],
        "23514",
      );
      // Independently exercise SQL CHECK constraints even if a future guard trigger is changed.
      for (const values of [
        ["RETRY_DEAD_LETTER", null, outbox, null, "REQUESTED", null, null, 0],
        [
          "REPLAY_WEBHOOK",
          inbox,
          null,
          null,
          "PROCESSING",
          null,
          new Date(Date.now() + 10000).toISOString(),
          1,
        ],
        ["REPLAY_WEBHOOK", inbox, null, null, "FAILED", null, null, 1],
      ]) {
        await client.query("BEGIN");
        await client.query(
          "ALTER TABLE admin_exception_operations DISABLE TRIGGER USER",
        );
        try {
          await client.query(
            `INSERT INTO admin_exception_operations(id,action,webhook_inbox_id,outbox_event_id,consumer_key,status,lease_token_digest,lease_expires_at,generation,request_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
            [randomUUID(), ...values, randomUUID()],
          );
          throw new Error("NULL CHECK accepted");
        } catch (error) {
          await client.query("ROLLBACK");
          check(error.code === "23514", "NULL cannot bypass recovery CHECK");
        }
      }
      await client.query("BEGIN");
      await client.query(
        "ALTER TABLE admin_exception_receipts DISABLE TRIGGER USER",
      );
      let receiptCheckCode;
      try {
        await client.query(
          `INSERT INTO admin_exception_receipts(id,actor_id,session_id,action,target_kind,target_id,consumer_key,operation_id,idempotency_key,request_hash,expected_version,confirmed,reason_code,audit_log_id,request_id,correlation_id,created_at)
          SELECT $1,actor_id,session_id,action,target_kind,target_id,NULL,operation_id,$2,request_hash,expected_version,confirmed,reason_code,audit_log_id,request_id,correlation_id,created_at FROM admin_exception_receipts WHERE operation_id=$3`,
          [randomUUID(), randomUUID(), d.operationId],
        );
      } catch (error) {
        receiptCheckCode = error.code;
      } finally {
        await client.query("ROLLBACK");
      }
      check(
        receiptCheckCode === "23514",
        "NULL consumer cannot bypass receipt action binding CHECK",
      );
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan=off");
      try {
        const webhookPlan = await client.query(
          "EXPLAIN(FORMAT JSON) SELECT id,status,version,generation FROM admin_exception_operations WHERE webhook_inbox_id=$1 ORDER BY created_at,id",
          [inbox],
        );
        const outboxPlan = await client.query(
          "EXPLAIN(FORMAT JSON) SELECT id,status,version,generation FROM admin_exception_operations WHERE outbox_event_id=$1 AND consumer_key=$2 ORDER BY created_at,id",
          [outbox, "order-notifications-v1"],
        );
        check(
          JSON.stringify(webhookPlan.rows).includes(
            "admin_exception_webhook_history",
          ),
          "terminal webhook history has usable target index",
        );
        check(
          JSON.stringify(outboxPlan.rows).includes(
            "admin_exception_outbox_history",
          ),
          "terminal outbox history has usable target-consumer index",
        );
      } finally {
        await client.query("ROLLBACK");
      }
      await verifyExceptionProjection({ client, run, check, actor: actors[0] });
      stage = "insert business review evidence";
      const reviewReceipt = randomUUID();
      await client.query(
        `INSERT INTO order_payment_application_receipts(id,provider_event_id,canonical_provider_event_id,decision,reason_code,request_id,correlation_id,task_name,result) VALUES($1::uuid,$2::uuid,$2::uuid,'REVIEW','TEST_REVIEW_REQUIRED',$3,$3,'exception-storage-test',jsonb_build_object('schemaVersion',1,'receiptId',$1::text,'providerEventId',$2::text,'decision','REVIEW','attemptId',NULL,'orderId',NULL,'reasonCode','TEST_REVIEW_REQUIRED'))`,
        [reviewReceipt, event, randomUUID()],
      );
      const review = await detail(target);
      check(
        review.item.status === "REVIEW" &&
          review.item.blockedReason === "MANUAL_REVIEW_REQUIRED",
        "processed webhook retains order payment business REVIEW",
      );
      check(
        review.item.version !== done.item.version,
        "business REVIEW changes source version",
      );
      const open = await run({
        action: "LIST",
        category: "WEBHOOK",
        status: "OPEN",
        page: 1,
        pageSize: 20,
      });
      check(
        open.items.some(
          (item) => item.target.id === inbox && item.status === "REVIEW",
        ),
        "business REVIEW remains in open exceptions",
      );
      await client.query(
        "DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=(SELECT id FROM permissions WHERE permission_key='exceptions.replay')",
        [actors[0].role],
      );
      failure(await run(secondCmd), "FORBIDDEN");
      await client.query(
        "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key='exceptions.replay'",
        [actors[0].role],
      );
      await client.query("BEGIN");
      await client.query(
        `UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1`,
        [actors[0].sid],
      );
      await client.query("COMMIT");
      failure(await run(secondCmd), "UNAUTHENTICATED");
      let blocked = false;
      try {
        await runMigrationCommandOnSession(session, manifests, {
          direction: "down",
          confirmVersion: "0037",
        });
      } catch {
        blocked = true;
      }
      check(blocked, "downgrade refuses permanent recovery history");
      check(
        (
          await client.query(
            "SELECT count(*)::int total FROM admin_exception_receipts",
          )
        ).rows[0].total === 3,
        "receipts survive guarded downgrade",
      );
    } finally {
      await first.close();
      await second.close();
      await client.end();
    }
  });
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        status: "PASS",
        checks,
        stage,
        syntheticHistoricalSourceSetup: true,
        originalHandlersVerified: true,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`PASS exception storage ${checks}; ${output}`);
} catch (error) {
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        status: "FAIL",
        checks,
        stage,
        name: error.name,
        code: error.code ?? null,
        message: error.message,
      },
      null,
      2,
    ) + "\n",
  );
  console.error({
    stage,
    checks,
    name: error.name,
    code: error.code,
    message: error.message,
  });
  throw error;
}
