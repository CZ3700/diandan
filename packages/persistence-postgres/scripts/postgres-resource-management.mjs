#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";
import { seedResourceManagementFixtures } from "./postgres-resource-management-fixtures.mjs";
import { verifyResourceRepositoryCases } from "./postgres-resource-management-cases.mjs";
import { verifyResourceTimeBoundaries } from "./postgres-resource-management-time.mjs";
import { verifyResourceSqlConstraints } from "./postgres-resource-management-constraints.mjs";
import {
  verifyResourceConcurrency,
  verifyResourceRollback,
} from "./postgres-resource-management-concurrency.mjs";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let assertions = 0;
let stage = "schema";
let check = "none";
function equal(actual, expected, label) {
  check = label;
  assert.deepEqual(actual, expected, label);
  assertions++;
}
async function transaction(client, work) {
  await client.query("BEGIN");
  try {
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
async function rejectsSql(client, label, work) {
  check = label;
  let failure;
  try {
    await transaction(client, work);
  } catch (error) {
    failure = error;
  }
  equal(
    failure !== undefined &&
      ["23514", "23503", "23505", "55000"].includes(failure.code),
    true,
    label,
  );
}
async function audit(client, actor, session, action, subjectType, subjectId) {
  const id = randomUUID(),
    request = randomUUID();
  const time = (
    await client.query(
      `SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
    )
  ).rows[0].now;
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
    VALUES($1,'ADMIN',$2,$3,$4,$5,'RESOURCE_FIXTURE',$6,$6,'SUCCEEDED','RESOURCE_MANAGEMENT',$7)`,
    [id, actor, action, subjectType, subjectId, request, time],
  );
  return { id, time, actor, session };
}

await withEphemeralPostgres(async (clientConfig) => {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: {
      direction: "up",
      targetVersion:
        process.env["RESOURCE_MANAGEMENT_RED_BASELINE"] === "1"
          ? "0016"
          : "0017",
    },
  });
  const client = new Client(clientConfig);
  await client.connect();
  const persistence = createPostgresPersistenceWithPoolFactory(
    clientConfig,
    undefined,
    (config) => {
      const pool = new Pool(config);
      return {
        connect: async () => {
          const connection = await pool.connect();
          return {
            release: () => connection.release(),
            query: async (sql, values) => {
              try {
                return await connection.query(sql, values);
              } catch (error) {
                process.stderr.write(
                  `Safe SQL diagnostic: code=${/^[A-Z0-9]{5}$/.test(error.code ?? "") ? error.code : "unknown"}; position=${/^\d+$/.test(error.position ?? "") ? error.position : "none"}; marker=${sql.match(/\/\* ([a-z:-]+) \*\//)?.[1] ?? "none"}.\n`,
                );
                throw error;
              }
            },
          };
        },
        end: () => pool.end(),
        on: (event, listener) => pool.on(event, listener),
        off: (event, listener) => pool.off(event, listener),
      };
    },
  );
  try {
    for (const table of [
      "policy_registration_receipts",
      "media_upload_reservations",
      "media_rights_events",
      "media_processing_admin_receipts",
    ]) {
      const result = await client.query(
        "SELECT to_regclass($1) IS NOT NULL AS present",
        [`public.${table}`],
      );
      equal(
        result.rows[0].present,
        true,
        `${table} persists exact management evidence`,
      );
    }
    const generation = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='media_processing_jobs' AND column_name IN ('generation','retry_of_job_id') ORDER BY column_name",
    );
    equal(
      generation.rows.map((row) => row.column_name),
      ["generation", "retry_of_job_id"],
      "new retry generations preserve terminal job identity",
    );
    stage = "legacy media round trip";
    const legacy = await seedCatalogDirectoryFixtures(client, 2);
    const priorAssets = (
      await client.query(
        "SELECT jsonb_agg(to_jsonb(a.*) ORDER BY id) AS value FROM public.media_assets a",
      )
    ).rows[0].value;
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0017" },
    });
    equal(
      (
        await client.query(
          "SELECT max(version) AS version FROM public.schema_migrations",
        )
      ).rows[0].version,
      "0016",
      "empty management history can return to its previous migration",
    );
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0017" },
    });
    equal(
      (
        await client.query(
          "SELECT jsonb_agg(to_jsonb(a.*) ORDER BY id) AS value FROM public.media_assets a",
        )
      ).rows[0].value,
      priorAssets,
      "0017 down/up preserves complete legacy source identities",
    );
    stage = "normal fixture";
    const seeds = ["editor", "reviewer", "denied"].map((actor) => ({
      name: actor,
      actor,
      sessionTokenDigest: randomBytes(32).toString("hex"),
      csrfTokenDigest: randomBytes(32).toString("hex"),
    }));
    const fixtures = await seedResourceManagementFixtures(client, {
      catalog: legacy,
      sessions: seeds,
    });
    if (process.env["RESOURCE_SQL_CASE"] === "time") {
      stage = "causal resource time";
      await verifyResourceTimeBoundaries({
        client,
        fixtures,
        seeds,
        equal,
        success: (result, label) => {
          equal(
            result.outcome,
            "SUCCESS",
            `${label}: ${result.code ?? "unexpected response"}`,
          );
          return result;
        },
      });
      process.stdout.write(
        `PostgreSQL resource timing: ${assertions} assertions PASS.\n`,
      );
      return;
    }
    stage = "policy permission";
    const registerPolicy = async (actor, session) => {
      const receiptId = randomUUID(),
        policyKey = `resource-policy-${randomUUID()}`;
      const evidence = await audit(
        client,
        actor,
        session,
        "POLICY_REGISTER",
        "POLICY_REGISTRATION",
        receiptId,
      );
      await client.query(
        "INSERT INTO public.policies(policy_key,kind,created_at) VALUES($1,'DELIVERY',$2)",
        [policyKey, evidence.time],
      );
      await client.query(
        "INSERT INTO public.policy_registration_receipts(id,policy_key,kind,actor_id,session_id,audit_log_id,created_at) VALUES($1,$2,'DELIVERY',$3,$4,$5,$6)",
        [receiptId, policyKey, actor, session, evidence.id, evidence.time],
      );
      return { receiptId, policyKey };
    };
    if (process.env["RESOURCE_SQL_CASE"] !== "same-rights") {
      await rejectsSql(
        client,
        "policy registration requires actual current policy permission",
        () => registerPolicy(fixtures.denied, fixtures.sessions.denied),
      );
    }
    if (process.env["RESOURCE_SQL_CASE"] !== "permission") {
      stage = "same status rights evidence";
      check =
        "approved media can record replacement rights evidence without changing immutable rights_reference";
      const assetId = fixtures.targets.media.mediaAssetId;
      await transaction(client, async () => {
        const eventId = randomUUID();
        const evidence = await audit(
          client,
          fixtures.editor,
          fixtures.sessions.editor,
          "MEDIA_RIGHTS_SET",
          "MEDIA_RIGHTS_EVENT",
          eventId,
        );
        await client.query(
          "INSERT INTO public.media_rights_events(id,asset_id,version,previous_status,new_status,evidence_reference,actor_id,session_id,audit_log_id,created_at,field_paths) VALUES($1,$2,1,'APPROVED','APPROVED','evidence:replacement',$3,$4,$5,$6,ARRAY['rightsEvidence'])",
          [
            eventId,
            assetId,
            fixtures.editor,
            fixtures.sessions.editor,
            evidence.id,
            evidence.time,
          ],
        );
      });
      equal(
        (
          await client.query(
            "SELECT version FROM public.media_rights_events WHERE asset_id=$1",
            [assetId],
          )
        ).rows[0].version,
        1,
        check,
      );
    }
    if (
      !process.env["RESOURCE_SQL_CASE"] ||
      process.env["RESOURCE_SQL_CASE"] === "legacy-enqueue"
    ) {
      stage = "resource repositories";
      const context = await verifyResourceRepositoryCases({
        client,
        persistence,
        fixtures,
        equal,
        success: (result, label) => {
          equal(
            result.outcome,
            "SUCCESS",
            `${label}: ${result.code ?? "unexpected response"}`,
          );
          return result;
        },
      });
      stage = "causal resource time";
      await verifyResourceTimeBoundaries({
        client,
        fixtures,
        seeds,
        equal,
        success: (result, label) => {
          equal(
            result.outcome,
            "SUCCESS",
            `${label}: ${result.code ?? "unexpected response"}`,
          );
          return result;
        },
      });
      stage = "resource SQL constraints";
      await verifyResourceSqlConstraints({
        client,
        fixtures,
        context,
        equal,
        rejectsSql,
        transaction,
        audit,
      });
      stage = "concurrent resource mutations";
      const concurrent = await verifyResourceConcurrency({
        client,
        persistence,
        context,
        equal,
        success: (result, label) => {
          equal(
            result.outcome,
            "SUCCESS",
            `${label}: ${result.code ?? "unexpected response"}`,
          );
          return result;
        },
      });
      stage = "resource audit atomicity";
      await verifyResourceRollback({
        client,
        persistence,
        context,
        equal,
        ...concurrent,
        success: (result, label) => {
          equal(
            result.outcome,
            "SUCCESS",
            `${label}: ${result.code ?? "unexpected response"}`,
          );
          return result;
        },
      });
      stage = "resource history downgrade protection";
      let downRefused = false;
      try {
        await runMigrations({
          clientConfig,
          workspaceRoot,
          command: { direction: "down", confirmVersion: "0017" },
        });
      } catch {
        downRefused = true;
      }
      equal(
        downRefused,
        true,
        "new resource history refuses destructive downgrade",
      );
      equal(
        (
          await client.query(
            "SELECT max(version) AS version FROM public.schema_migrations",
          )
        ).rows[0].version,
        "0017",
        "refused downgrade retains the applied migration head",
      );
    }
    process.stdout.write(
      `PostgreSQL resource management: ${assertions} assertions PASS.\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Resource management failure at ${stage}/${check}; ${assertions} assertions completed.\n`,
    );
    if (error instanceof assert.AssertionError)
      process.stderr.write(
        `Expected ${JSON.stringify(error.expected)}, received ${JSON.stringify(error.actual)}.\n`,
      );
    else if (error && typeof error.code === "string")
      process.stderr.write(
        `SQLSTATE=${error.code}; constraint=${error.constraint ?? "none"}.\n`,
      );
    throw error;
  } finally {
    await persistence.close();
    await client.end();
  }
});
