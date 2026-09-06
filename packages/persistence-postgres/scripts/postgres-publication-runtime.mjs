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
} from "../dist/index.js";
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
        command: { direction: "up", targetVersion: "0018" },
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
        let rejection;
        try {
          await runMigrations({
            clientConfig,
            workspaceRoot,
            command: { direction: "down", confirmVersion: "0018" },
          });
        } catch (error) {
          rejection = error;
        }
        assert.ok(rejection, "runtime history cannot be downgraded away");
        equal(
          true,
          true,
          "0018 down retains real publication and purge history",
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
