#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { runMigrationCommandOnSession } from "../dist/migrations/runner.js";
import { evaluatePublicationPreflight } from "@fan-support/content";
import {
  createPostgresPersistence,
  runMigrations,
  loadMigrationManifest,
  withEphemeralPostgres,
} from "../dist/index.js";
import { seedPublicationPreflightFixtures } from "./postgres-publication-preflight-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let assertions = 0,
  stage = "migration";
const equal = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  assertions++;
};

/** Historical price publications use all ordinary constraints, before the new administrative boundary. */
async function publishPriceEvidence(client, editor, head, revision, action) {
  const publicationId = randomUUID(),
    auditId = randomUUID(),
    requestId = randomUUID();
  // Use text directly so the existing strict head timestamp ordering retains microseconds.
  const {
    rows: [time],
  } = await client.query(
    "SELECT to_char(GREATEST(transaction_timestamp(),updated_at+interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at FROM price_book_publication_heads WHERE id=$1",
    [head.id],
  );
  await client.query(
    "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at) VALUES($1,'ADMIN',$2,$3,'PRICE_BOOK_PUBLICATION',$4,'PRICE_ROLLBACK_FIXTURE',$5,$5,'SUCCEEDED',$6)",
    [
      auditId,
      editor,
      action === "PUBLISH" ? "PRICE_BOOK_PUBLISH" : "PRICE_BOOK_ROLLBACK",
      publicationId,
      requestId,
      time.at,
    ],
  );
  await client.query(
    "INSERT INTO price_book_publications(id,price_book_id,price_book_revision,market_id,market,currency,action,replaces_publication_id,manifest_hash,published_by,audit_log_id,published_at,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,repeat('a',64),$9,$10,$11,$12)",
    [
      publicationId,
      head.price_book_id,
      revision,
      head.market_id,
      head.market,
      head.currency,
      action,
      head.publication_id,
      editor,
      auditId,
      time.at,
      randomUUID(),
    ],
  );
  await client.query(
    "UPDATE price_book_publication_heads SET publication_id=$2,price_book_revision=$3,version=version+1,updated_at=$4 WHERE id=$1",
    [head.id, publicationId, revision, time.at],
  );
  await client.query(
    "INSERT INTO outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,secondary_subject_id,market,currency,idempotency_key,request_id,correlation_id,occurred_at,available_at,created_at) VALUES($1,'PRICE_BOOK_PUBLISHED','PRICE_BOOK',$2,$3,$4,$2,$5,$6,$7,$8,$8,$9::timestamptz,$9::timestamptz,$9::timestamptz)",
    [
      randomUUID(),
      head.price_book_id,
      revision,
      publicationId,
      head.market,
      head.currency,
      `price-book-publication:${publicationId}`,
      requestId,
      time.at,
    ],
  );
  return { ...head, publication_id: publicationId };
}

await withEphemeralPostgres(async (clientConfig) => {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0017" },
  });
  const client = new Client(clientConfig);
  await client.connect();
  const persistence = createPostgresPersistence(clientConfig);
  try {
    stage = "normal trigger source";
    const fixtures = await seedPublicationPreflightFixtures(
      client,
      persistence,
    );
    const load = () =>
      persistence.publicationPreflightTransactionManager.runInPublicationPreflightTransaction(
        ({ publicationPreflight }) =>
          publicationPreflight.load({
            schemaVersion: 1,
            action: "PUBLISH",
            target: {
              owner: fixtures.targets.gift,
              revisionId: fixtures.revisions.gift,
            },
          }),
      );
    const initial = await load();
    equal(initial.outcome, "SUCCESS", "canonical source loads");
    equal(
      evaluatePublicationPreflight(initial.context).ready,
      true,
      "initial gift is publishable",
    );
    stage = "price publication and rollback";
    await client.query("BEGIN");
    const { rows: heads } = await client.query(
      "SELECT * FROM price_book_publication_heads ORDER BY market,currency FOR UPDATE",
    );
    for (const head of heads) {
      await client.query(
        "INSERT INTO price_books(id,market_id,market,currency,revision,lifecycle,valid_from,valid_until,created_by) SELECT id,market_id,market,currency,2,'DRAFT',valid_from,valid_until,created_by FROM price_books WHERE id=$1 AND revision=1",
        [head.price_book_id],
      );
      await client.query(
        "INSERT INTO prices(id,price_book_id,price_book_revision,market,currency,gift_variant_id,revision,amount_minor,valid_from,valid_to,status) SELECT gen_random_uuid(),price_book_id,2,market,currency,gift_variant_id,2,amount_minor+1,valid_from,valid_to,'DRAFT' FROM prices WHERE price_book_id=$1 AND price_book_revision=1",
        [head.price_book_id],
      );
      await client.query(
        "UPDATE price_books SET lifecycle='SUPERSEDED',superseded_at=transaction_timestamp() WHERE id=$1 AND revision=1",
        [head.price_book_id],
      );
      await client.query(
        "UPDATE prices SET status='SUPERSEDED' WHERE price_book_id=$1 AND price_book_revision=1",
        [head.price_book_id],
      );
      await client.query(
        "UPDATE price_books SET lifecycle='VALIDATED',validated_at=transaction_timestamp() WHERE id=$1 AND revision=2",
        [head.price_book_id],
      );
      await client.query(
        "UPDATE price_books SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE id=$1 AND revision=2",
        [head.price_book_id],
      );
      await client.query(
        "UPDATE prices SET status='PUBLISHED' WHERE price_book_id=$1 AND price_book_revision=2",
        [head.price_book_id],
      );
      await publishPriceEvidence(client, fixtures.editor, head, 2, "PUBLISH");
    }
    await client.query("COMMIT");
    await client.query("BEGIN");
    const { rows: currentHeads } = await client.query(
      "SELECT * FROM price_book_publication_heads ORDER BY market,currency FOR UPDATE",
    );
    for (const head of currentHeads) {
      await client.query(
        "UPDATE price_books SET lifecycle='SUPERSEDED',superseded_at=transaction_timestamp() WHERE id=$1 AND revision=2",
        [head.price_book_id],
      );
      await client.query(
        "UPDATE prices SET status='SUPERSEDED' WHERE price_book_id=$1 AND price_book_revision=2",
        [head.price_book_id],
      );
      await publishPriceEvidence(client, fixtures.editor, head, 1, "ROLLBACK");
    }
    await client.query("COMMIT");
    stage = "upgrade current";
    await runMigrationCommandOnSession(
      {
        query: async (sql, values) => {
          try {
            return await client.query(sql, values);
          } catch (error) {
            process.stderr.write(
              `${JSON.stringify({ phase: "MIGRATION", code: error.code, position: error.position, constraint: error.constraint })}\n`,
            );
            throw error;
          }
        },
      },
      await loadMigrationManifest({ workspaceRoot }),
      { direction: "up" },
    );
    stage = "preflight after real rollback";
    const rollback = await load();
    equal(rollback.outcome, "SUCCESS", "rollback candidate loads");
    const report = evaluatePublicationPreflight(rollback.context);
    if (!report.ready)
      process.stderr.write(
        `${JSON.stringify({ stage, issues: report.issues?.map((issue) => issue.code) ?? [report.code] })}\n`,
      );
    equal(
      report.ready,
      true,
      "current historical price head remains valid for gift preflight",
    );
    equal(
      (
        await client.query(
          "SELECT bool_and(lifecycle='SUPERSEDED') AS historical FROM price_books WHERE revision=1",
        )
      ).rows[0].historical,
      true,
      "rollback preserves immutable historical lifecycle",
    );
    equal(
      (
        await client.query(
          "SELECT bool_and(price_book_revision=1 AND version=3) AS correct FROM price_book_publication_heads",
        )
      ).rows[0].correct,
      true,
      "rollback changes publication head version independently of book revision",
    );
    process.stdout.write(
      `gift commerce price rollback PostgreSQL: ${assertions} assertions PASS\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ stage, assertions, code: error.code ?? error.failure?.error?.code ?? "ASSERTION", constraint: error.constraint, position: error.position })}\n`,
    );
    throw error;
  } finally {
    await client.query("ROLLBACK");
    await persistence.close();
    await client.end();
  }
}).catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ stage, assertions, code: error.code ?? error.failure?.error?.code ?? "ASSERTION", type: error.name, causeCode: error.cause?.code })}\n`,
  );
  process.exitCode = 1;
});
