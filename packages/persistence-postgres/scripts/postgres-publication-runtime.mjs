#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
} from "@fan-support/content";
import {
  captureDatabaseCatalog,
  runMigrations,
  withEphemeralPostgres,
  loadMigrationManifest,
} from "../dist/index.js";
import { runMigrationCommandOnSession } from "../dist/migrations/runner.js";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";
import { seedPublicationRuntimeFixtures } from "./postgres-publication-runtime-fixtures.mjs";
import { verifyPublicationHeroOrigins } from "./postgres-publication-media-cases.mjs";
import {
  verifyPublicationLegacyJson,
  verifyPublicationReceiptHashes,
  verifyPublicationReceiptHashFailures,
  tamperPublicationReceiptHash,
  tamperPublicationReceiptOffsetHash,
  tamperPublicationReceiptVersion,
} from "./postgres-publication-receipt-hash-cases.mjs";
import { verifyPublicationClockCases } from "./postgres-publication-clock-cases.mjs";
import { verifyPublicationRuntimeCases } from "./postgres-publication-runtime-cases.mjs";
import { verifyPublicationPurgeCases } from "./postgres-publication-purge-cases.mjs";
import { verifyPublicationRevisionProof } from "./postgres-publication-proof-cases.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let assertions = 0,
  stage = "migrations";
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions++;
}

async function verifySeoPurgeRollback({
  client,
  clientConfig,
  persistence,
  credentials,
}) {
  const purgeTransaction = (work) =>
    persistence.publicationPurgeTransactionManager.runInPublicationPurgeTransaction(
      work,
    );
  const claimed = await purgeTransaction(({ publicationPurge }) =>
    publicationPurge.claim({ schemaVersion: 1, leaseSeconds: 60 }),
  );
  equal(
    claimed.outcome,
    "SUCCESS",
    "SEO rollback probe claims a real durable job",
  );
  assert.ok(claimed.claim);
  const claim = claimed.claim;
  const failed = await purgeTransaction(({ publicationPurge }) =>
    publicationPurge.record({
      schemaVersion: 1,
      jobId: claim.job.id,
      leaseToken: claim.leaseToken,
      expectedVersion: claim.version,
      result: { kind: "FAILURE", code: "ACCESS_DENIED", retryable: false },
    }),
  );
  equal(
    failed.outcome,
    "SUCCESS",
    "SEO rollback probe persists a normal terminal provider failure",
  );
  equal(failed.job.status, "FAILED", "SEO rollback predecessor is failed");
  const parent = (
    await client.query("SELECT * FROM public.content_purge_jobs WHERE id=$1", [
      failed.job.id,
    ])
  ).rows[0];
  const additions = [
    "/sitemap.xml*",
    `/${parent.locale}/sitemap.xml*`,
    "/api/v1/storefront-seo/*",
  ];
  equal(
    additions.every((path) => parent.paths.includes(path)),
    true,
    "existing job carries all three expanded SEO paths",
  );
  const jobs = async () =>
    (
      await client.query(
        "SELECT jsonb_agg(to_jsonb(j) ORDER BY id) AS jobs FROM public.content_purge_jobs j",
      )
    ).rows[0].jobs;
  const before = await jobs();
  const orderPaymentDown = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "down", confirmVersion: "0027" },
  });
  equal(
    [orderPaymentDown.revertedVersions, orderPaymentDown.currentVersion],
    [["0027"], "0026"],
    "empty order-payment application rolls back before existing history probes",
  );
  const paymentDown = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "down", confirmVersion: "0026" },
  });
  equal(
    [paymentDown.revertedVersions, paymentDown.currentVersion],
    [["0026"], "0025"],
    "empty payment runtime rolls back before preserved checkout history probes",
  );
  equal(
    await jobs(),
    before,
    "payment runtime rollback preserves existing purge jobs exactly",
  );
  const checkoutReverted = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "down", confirmVersion: "0025" },
  });
  equal(
    [checkoutReverted.revertedVersions, checkoutReverted.currentVersion],
    [["0025"], "0024"],
    "0025 rolls back before the existing cart, daily and SEO probes",
  );
  equal(
    await jobs(),
    before,
    "0025 down preserves every existing purge job exactly",
  );
  const editReverted = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "down", confirmVersion: "0024" },
  });
  equal(
    [editReverted.revertedVersions, editReverted.currentVersion],
    [["0024"], "0023"],
    "0024 rolls back before the existing cart, daily and SEO probes",
  );
  equal(
    await jobs(),
    before,
    "0024 down preserves every existing purge job exactly",
  );
  const cartReverted = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "down", confirmVersion: "0023" },
  });
  equal(
    [cartReverted.revertedVersions, cartReverted.currentVersion],
    [["0023"], "0022"],
    "0023 rolls back before the existing daily management and SEO probes",
  );
  equal(
    await jobs(),
    before,
    "0023 down preserves every existing purge job exactly",
  );
  const dailyReverted = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "down", confirmVersion: "0022" },
  });
  equal(
    [dailyReverted.revertedVersions, dailyReverted.currentVersion],
    [["0022"], "0021"],
    "0022 rolls back before the existing SEO purge downgrade probe",
  );
  equal(
    await jobs(),
    before,
    "0022 down preserves every existing purge job exactly",
  );
  const reverted = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "down", confirmVersion: "0021" },
  });
  equal(
    [reverted.revertedVersions, reverted.currentVersion],
    [["0021"], "0020"],
    "0021 rolls back before the existing feature downgrade sequence",
  );
  equal(
    await jobs(),
    before,
    "0021 down preserves every existing purge job exactly",
  );
  for (const [paths, message] of [
    [
      parent.paths.filter((path) => !additions.includes(path)),
      "purge retries require an exact failed predecessor",
    ],
    [
      [...parent.paths, "/*"].sort(),
      "purge jobs require exact publication locale paths and initial state",
    ],
    [
      [...parent.paths].reverse(),
      "purge jobs require exact publication locale paths and initial state",
    ],
  ]) {
    await client.query("BEGIN");
    let observed;
    try {
      await client.query(
        `WITH predecessor AS MATERIALIZED (SELECT *,GREATEST(clock_timestamp(),updated_at) AS at FROM public.content_purge_jobs WHERE id=$1)
        INSERT INTO public.content_purge_jobs(id,publication_id,outbox_event_id,locale,generation,retry_of,paths,created_at,updated_at,next_attempt_at)
        SELECT $2,publication_id,outbox_event_id,locale,generation+1,id,$3,at,at,at FROM predecessor`,
        [parent.id, randomUUID(), paths],
      );
    } catch (error) {
      observed = { code: error.code, message: error.message };
    } finally {
      await client.query("ROLLBACK");
    }
    equal(
      observed,
      { code: "23514", message },
      "down rejects narrowed, broadened or reordered retry paths at the exact path guard",
    );
  }
  const retry =
    await persistence.publicationRuntimeTransactionManager.runInPublicationRuntimeTransaction(
      async ({ authorization, publicationRuntime }) => {
        const authority = await authorization.authorize({
          schemaVersion: 1,
          ...credentials,
          permission: "content.publish",
          locales: SUPPORTED_LOCALES,
        });
        equal(
          authority.outcome,
          "SUCCESS",
          "post-downgrade retry has current authority",
        );
        return publicationRuntime.retry({
          schemaVersion: 1,
          requestId: randomUUID(),
          principal: authority.principal,
          command: {
            schemaVersion: 1,
            action: "RETRY_PURGE",
            publicationId: parent.publication_id,
            purgeJobId: parent.id,
            expectedVersion: Number(parent.version),
            reasonCode: "PG_SEO_ROLLBACK_RETRY",
            idempotencyKey: randomUUID(),
          },
        });
      },
    );
  equal(
    retry.outcome,
    "SUCCESS",
    "existing expanded job can create an exact authorized retry after 0021 down",
  );
  const successor = (
    await client.query(
      "SELECT paths,retry_of,generation FROM public.content_purge_jobs WHERE id=$1",
      [retry.purgeJobId],
    )
  ).rows[0];
  equal(
    successor,
    {
      paths: parent.paths,
      retry_of: parent.id,
      generation: parent.generation + 1,
    },
    "committed post-downgrade retry preserves expanded paths and predecessor lineage",
  );
}
await withEphemeralPostgres(async (clientConfig) => {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: {
      direction: "up",
      targetVersion:
        process.env["PUBLICATION_RUNTIME_RED_BASELINE"] === "1"
          ? "0017"
          : "0018",
    },
  });
  const client = new Client(clientConfig);
  await client.connect();
  try {
    stage = "unreceipted publication insert";
    let failure;
    try {
      await seedCatalogDirectoryFixtures(client, 2);
    } catch (error) {
      failure = error;
    }
    process.stdout.write(
      `${JSON.stringify({ stage, check: "new publication requires manifest", observed: failure?.code ?? "COMMITTED_LEGACY_PUBLICATION" })}\n`,
    );
    assert.ok(
      failure && ["23514", "55000"].includes(failure.code),
      "new publications cannot commit opaque legacy hashes without a canonical manifest",
    );
    assertions++;
    const rows = await client.query(
      "SELECT count(*)::integer AS count FROM public.content_publications",
    );
    assert.equal(
      rows.rows[0].count,
      0,
      "failed publication seed leaves no partial history",
    );
    assertions++;
    process.stdout.write(
      `PostgreSQL publication runtime: ${assertions} assertions PASS\n`,
    );
  } finally {
    await client.end();
  }
});

if (process.env["PUBLICATION_RUNTIME_RED_BASELINE"] !== "1")
  await withEphemeralPostgres(async (clientConfig) => {
    stage = "migration before historical fixtures";
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0017" },
    });
    const client = new Client(clientConfig);
    await client.connect();
    let diagnosticClient, receiptTamper;
    const persistence = createPostgresPersistenceWithPoolFactory(
      clientConfig,
      {},
      (config) => {
        const pool = new Pool(config);
        return {
          end: () => pool.end(),
          on: (event, listener) => pool.on(event, listener),
          off: (event, listener) => pool.off(event, listener),
          connect: async () => {
            const connection = await pool.connect();
            diagnosticClient = connection;
            return {
              release: (error) => connection.release(error),
              query: async (sql, values) => {
                try {
                  return await connection.query(
                    sql,
                    receiptTamper === "head"
                      ? tamperPublicationReceiptVersion(sql, values)
                      : receiptTamper === "offset"
                        ? await tamperPublicationReceiptOffsetHash(
                            connection,
                            sql,
                            values,
                          )
                        : receiptTamper
                          ? tamperPublicationReceiptHash(
                              sql,
                              values,
                              receiptTamper,
                            )
                          : values,
                  );
                } catch (error) {
                  process.stderr.write(
                    `${JSON.stringify({ stage, postgresCode: error.code, constraint: error.constraint, position: error.position, tables: [...String(sql).matchAll(/public\.([a-z_]+)/gu)].map((match) => match[1]) })}\n`,
                  );
                  throw error;
                }
              },
            };
          },
        };
      },
    );
    try {
      const credentials = {
        sessionTokenDigest: randomBytes(32).toString("hex"),
        csrfTokenDigest: randomBytes(32).toString("hex"),
      };
      stage = "normal historical seed";
      const fixtures = await seedPublicationRuntimeFixtures(
        client,
        persistence,
        { sessions: [{ name: "publisher", actor: "editor", ...credentials }] },
      );
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "up" },
      });
      const legacy = await client.query(
        "SELECT count(*)::integer AS count FROM public.content_publications WHERE proof_version<>1",
      );
      equal(
        legacy.rows[0].count,
        0,
        "upgrade preserves actual historical publications as v1",
      );
      await verifyPublicationLegacyJson(client, equal);
      const results = {};
      for (const name of ["idol", "gift", "homepage", "policy", "media"]) {
        const target = {
          owner: fixtures.targets[name],
          revisionId: fixtures.revisions[name],
        };
        for (const action of process.env["PUBLICATION_RUNTIME_PROOF_CASES"] ===
        "1"
          ? ["VALIDATE"]
          : ["VALIDATE", "PUBLISH"]) {
          stage = `${action} ${name}`;
          const perform = () =>
            persistence.publicationRuntimeTransactionManager.runInPublicationRuntimeTransaction(
              async ({ authorization, publicationRuntime }) => {
                const authority = await authorization.authorize({
                  schemaVersion: 1,
                  ...credentials,
                  permission: "content.publish",
                  locales: SUPPORTED_LOCALES,
                });
                equal(
                  authority.outcome,
                  "SUCCESS",
                  "current seven-locale publication authority",
                );
                const loaded = await publicationRuntime.load({
                  schemaVersion: 1,
                  action: "PUBLISH",
                  target,
                });
                equal(
                  loaded.outcome,
                  "SUCCESS",
                  "canonical publication input loads",
                );
                const context = loaded.context.preflight,
                  manifest = buildPublicationManifest(context);
                if (action === "PUBLISH")
                  equal(
                    context.snapshot.contentHash,
                    results[name].contentHash,
                    "returned validation hash equals canonical reloaded lifecycle hash",
                  );
                await verifyPublicationReceiptHashes(
                  diagnosticClient,
                  manifest,
                  context.snapshot,
                  equal,
                );
                if (action === "VALIDATE")
                  await verifyPublicationRevisionProof(
                    diagnosticClient,
                    manifest,
                    equal,
                  );
                if (process.env["PUBLICATION_RUNTIME_PROOF_CASES"] === "1")
                  return { action };
                const input = {
                  schemaVersion: 1,
                  requestId: randomUUID(),
                  principal: authority.principal,
                  command: {
                    schemaVersion: 1,
                    action,
                    target,
                    expectedVersion: context.headVersion,
                    expectedContentHash: context.snapshot.contentHash,
                    reasonCode: "PG_PUBLICATION",
                    idempotencyKey: `publication:${randomUUID()}`,
                  },
                  manifest,
                  manifestHash: computePublicationManifestHash(manifest),
                };
                const value = await publicationRuntime.write(input);
                if (value.outcome === "FAILURE")
                  process.stderr.write(
                    `${JSON.stringify({ stage, failure: value.code, issues: value.issues?.map((item) => item.code) })}\n`,
                  );
                equal(
                  value.outcome,
                  "SUCCESS",
                  "canonical publication mutation succeeds",
                );
                return value;
              },
            );
          if (
            name === "idol" &&
            action === "VALIDATE" &&
            process.env["PUBLICATION_RUNTIME_PROOF_CASES"] !== "1"
          )
            await verifyPublicationReceiptHashFailures({
              client,
              write: perform,
              withTamper: async (field, write) => {
                receiptTamper = field;
                try {
                  return await write();
                } finally {
                  receiptTamper = undefined;
                }
              },
              check: equal,
            });
          const result = await perform();
          equal(result.action, action, "actual mutation action retained");
          results[name] = result;
        }
        if (process.env["PUBLICATION_RUNTIME_PROOF_CASES"] === "1") continue;
        const result = results[name];
        const proof = await client.query(
          `SELECT p.proof_version,(SELECT count(*)::integer FROM public.outbox_events WHERE primary_subject_id=p.id AND event_type='CONTENT_PUBLICATION_CHANGED') AS events,
        (SELECT count(*)::integer FROM public.content_purge_jobs WHERE publication_id=p.id) AS jobs FROM public.content_publications p WHERE p.id=$1`,
          [result.publicationId],
        );
        equal(
          proof.rows[0],
          { proof_version: 2, events: 7, jobs: 7 },
          "publication proof and seven locale jobs/events commit atomically",
        );
      }
      if (process.env["PUBLICATION_RUNTIME_PROOF_CASES"] !== "1") {
        stage = "purge guards and fencing";
        await verifyPublicationPurgeCases({
          client,
          persistence,
          publications: results,
          check: equal,
        });
        stage = "historical rollback and retry";
        await verifyPublicationRuntimeCases({
          client,
          persistence,
          fixtures,
          credentials,
          publications: results,
          check: equal,
        });
        stage = "purge clock boundaries";
        await verifyPublicationClockCases({
          client,
          clientConfig,
          check: equal,
        });
        stage = "hero original identity isolation";
        await verifyPublicationHeroOrigins({
          client,
          persistence,
          fixtures,
          check: equal,
        });
      }
      if (process.env["PUBLICATION_RUNTIME_PROOF_CASES"] !== "1") {
        stage = "history preserving downgrade";
        equal(
          (
            await client.query(
              "SELECT max(version) AS version FROM public.schema_migrations",
            )
          ).rows[0].version,
          "0027",
          "runtime business checks ran against the current migration head",
        );
        equal(
          (
            await client.query(
              "SELECT count(*)::integer AS count FROM public.gift_revisions WHERE profile_version=2",
            )
          ).rows[0].count,
          0,
          "historical runtime fixtures have no new classification history",
        );
        await verifySeoPurgeRollback({
          client,
          clientConfig,
          persistence,
          credentials,
        });
        for (const [version, previous] of [
          ["0020", "0019"],
          ["0019", "0018"],
        ]) {
          const reverted = await runMigrations({
            clientConfig,
            workspaceRoot,
            command: { direction: "down", confirmVersion: version },
          });
          equal(
            [reverted.revertedVersions, reverted.currentVersion],
            [[version], previous],
            `${version}: only an empty later feature migration is reverted`,
          );
        }
        const retainedHistory = async () =>
          (
            await client.query(`SELECT
          (SELECT max(version) FROM public.schema_migrations) AS version,
          (SELECT count(*)::integer FROM public.content_publications WHERE proof_version=2) AS publications,
          (SELECT count(*)::integer FROM public.content_publication_manifests) AS manifests,
          (SELECT count(*)::integer FROM public.content_publication_receipts) AS receipts,
          (SELECT count(*)::integer FROM public.content_purge_jobs) AS jobs,
          (SELECT count(*)::integer FROM public.content_purge_attempts) AS attempts,
          (SELECT jsonb_agg(to_jsonb(h) ORDER BY gift_id) FROM public.gift_publication_heads h) AS gift_heads,
          (SELECT jsonb_agg(to_jsonb(h) ORDER BY idol_id) FROM public.idol_publication_heads h) AS idol_heads`)
          ).rows[0];
        const beforeDown = await retainedHistory();
        const manifest = await loadMigrationManifest({ workspaceRoot });
        const downSql = manifest.find((row) => row.version === "0018").down.sql;
        let observed;
        let rejection;
        try {
          await runMigrationCommandOnSession(
            {
              query: async (sql, values) => {
                try {
                  return await client.query(sql, values);
                } catch (error) {
                  if (sql === downSql)
                    observed = {
                      code: error.code,
                      guard:
                        error.message ===
                        "publication runtime history cannot be discarded"
                          ? "PUBLICATION_RUNTIME_HISTORY"
                          : "OTHER",
                    };
                  throw error;
                }
              },
            },
            manifest,
            { direction: "down", confirmVersion: "0018" },
          );
        } catch (error) {
          rejection = error;
        }
        equal(
          observed,
          { code: "55000", guard: "PUBLICATION_RUNTIME_HISTORY" },
          "0018 actual down SQL rejects retained publication and purge evidence",
        );
        equal(
          rejection?.message,
          "migration 0018 down failed",
          "runner reports the exact guarded migration, not a head mismatch",
        );
        equal(
          await retainedHistory(),
          beforeDown,
          "failed 0018 downgrade preserves migration head and all runtime history",
        );
        const proof = (
          await client.query(
            "SELECT count(*)::integer AS count FROM public.content_publications WHERE proof_version=2",
          )
        ).rows[0];
        equal(
          proof.count,
          7,
          "failed down preserves all five publications and two rollback events",
        );
      }
      process.stdout.write(
        `PostgreSQL publication runtime: ${assertions} assertions PASS\n`,
      );
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({ stage, assertions, code: error.code ?? "ASSERTION", assertion: error instanceof assert.AssertionError ? error.message : undefined })}\n`,
      );
      throw error;
    } finally {
      await persistence.close();
      await client.end();
    }
  });

if (
  !process.env["PUBLICATION_RUNTIME_RED_BASELINE"] &&
  !process.env["PUBLICATION_RUNTIME_PROOF_CASES"]
)
  await withEphemeralPostgres(async (clientConfig) => {
    stage = "empty migration roundtrip";
    const client = new Client(clientConfig);
    await client.connect();
    try {
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "up", targetVersion: "0017" },
      });
      const before = await captureDatabaseCatalog(client);
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "up", targetVersion: "0018" },
      });
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "down", confirmVersion: "0018" },
      });
      equal(
        await captureDatabaseCatalog(client),
        before,
        "empty 0018 up/down restores exact legacy database catalog and extension gate",
      );
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "up", targetVersion: "0018" },
      });
      equal(
        (
          await client.query(
            "SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='content_publications' AND column_name='proof_version'",
          )
        ).rows[0].column_default,
        "2",
        "up after down restores mandatory current proof version",
      );
      process.stdout.write(
        `PostgreSQL publication runtime: ${assertions} assertions PASS\n`,
      );
    } catch (error) {
      process.stderr.write(
        JSON.stringify({ stage, error: error.message }) + "\n",
      );
      throw error;
    } finally {
      await client.end();
    }
  });
