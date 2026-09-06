#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";
import { seedPublicationPreflightFixtures } from "./postgres-publication-preflight-fixtures.mjs";
import { preflightSnapshot } from "../dist/publication-preflight-data.js";
import { evaluatePublicationPreflight } from "@fan-support/content";
import { verifyPublicationPreflightCases } from "./postgres-publication-preflight-cases.mjs";
import { verifyPublicationPreflightMedia } from "./postgres-publication-preflight-media.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let assertions = 0,
  stage = "migration",
  check = "none";
function equal(actual, expected, label) {
  check = label;
  assert.deepEqual(actual, expected, label);
  assertions++;
}
await withEphemeralPostgres(async (clientConfig) => {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0017" },
  });
  const client = new Client(clientConfig);
  await client.connect();
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
          return {
            release: (error) => connection.release(error),
            query: async (sql, values) => {
              try {
                return await connection.query(sql, values);
              } catch (error) {
                process.stderr.write(
                  `${JSON.stringify({ stage, postgresCode: error.code, position: error.position, constraint: error.constraint, tables: [...String(sql).matchAll(/public\.([a-z_]+)/gu)].map((item) => item[1]) })}\n`,
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
    stage = "normal trigger fixtures";
    const fixtures = await seedPublicationPreflightFixtures(
      client,
      persistence,
      {
        sessions: [
          {
            name: "editor",
            actor: "editor",
            sessionTokenDigest: randomBytes(32).toString("hex"),
            csrfTokenDigest: randomBytes(32).toString("hex"),
          },
        ],
      },
    );
    stage = "exact extension timestamps";
    await client.query("BEGIN");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const exact = await preflightSnapshot(
      client,
      fixtures.targets.idol,
      fixtures.revisions.idol,
    );
    const {
      rows: [aliasTime],
    } = await client.query(
      "SELECT to_char(edited_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS edited_at FROM public.idol_revision_alias_sets WHERE idol_revision_id=$1",
      [fixtures.revisions.idol],
    );
    equal(
      exact.extensions.aliases.editedAt,
      aliasTime.edited_at,
      "alias edit timestamp retains all PostgreSQL microseconds",
    );
    await client.query("ROLLBACK");
    stage = "canonical five-kind load";
    for (const [kind, owner] of Object.entries(fixtures.targets)) {
      const target = { owner, revisionId: fixtures.revisions[kind] };
      stage = `${kind} canonical load`;
      const result =
        await persistence.publicationPreflightTransactionManager.runInPublicationPreflightTransaction(
          ({ publicationPreflight }) =>
            publicationPreflight.load({
              schemaVersion: 1,
              target,
              action: "PUBLISH",
            }),
        );
      equal(result.outcome, "SUCCESS", `${kind} canonical context load`);
      equal(
        result.context.headVersion,
        fixtures.publicationHeadVersions[kind],
        `${kind} actual publication head version`,
      );
      equal(
        result.context.snapshot.revisionId,
        target.revisionId,
        `${kind} requested canonical revision`,
      );
      equal(
        result.context.snapshot.lifecycle.status,
        "DRAFT",
        `${kind} preflight preserves draft lifecycle`,
      );
      equal(
        result.context.approvals.filter((row) => row.objectKind === owner.kind)
          .length >= 7,
        true,
        `${kind} seven actual approvals`,
      );
      const report = evaluatePublicationPreflight(result.context);
      equal(
        report.outcome,
        "SUCCESS",
        `${kind} pure report accepts real context`,
      );
      if (report.outcome === "SUCCESS" && !report.ready)
        process.stderr.write(
          `${JSON.stringify({ stage, issues: report.issues })}\n`,
        );
      equal(
        report.ready,
        true,
        `${kind} fully approved canonical content ready`,
      );
    }
    stage = "negative and read-only cases";
    await verifyPublicationPreflightCases({
      client,
      clientConfig,
      persistence,
      fixtures,
      equal,
    });
    stage = "all current media provenance";
    await verifyPublicationPreflightMedia({
      client,
      persistence,
      fixtures,
      equal,
    });
    process.stdout.write(
      `publication preflight PostgreSQL checks: ${assertions} assertions PASS\n`,
    );
  } finally {
    await persistence.close();
    await client.end();
  }
}).catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ stage, check, assertions, code: error.code ?? "ASSERTION", safeMessage: error instanceof assert.AssertionError ? error.message : String(error.message).slice(0, 150) })}\n`,
  );
  process.exitCode = 1;
});
