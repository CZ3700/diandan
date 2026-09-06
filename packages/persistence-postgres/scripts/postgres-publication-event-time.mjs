import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
} from "@fan-support/content";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";
import { seedPublicationRuntimeFixtures } from "./postgres-publication-runtime-fixtures.mjs";
import {
  seedPublicationValidationTimeCase,
  verifyPublicationValidationTimeCase,
} from "./postgres-publication-validation-time-cases.mjs";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let assertions = 0;
const equal = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  assertions++;
};
let mode = "NORMAL",
  observed = 0,
  activeConnection;
const acceptedProbe = new Error("ROLLBACK_ACCEPTED_PROBE");
await withEphemeralPostgres(async (config) => {
  await runMigrations({
    clientConfig: config,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0017" },
  });
  const client = new Client(config);
  await client.connect();
  const persistence = createPostgresPersistenceWithPoolFactory(
    config,
    {},
    (db) => {
      const pool = new Pool(db);
      return {
        end: () => pool.end(),
        on: (...args) => pool.on(...args),
        off: (...args) => pool.off(...args),
        connect: async () => {
          const connection = await pool.connect();
          activeConnection = connection;
          return {
            release: (value) => connection.release(value),
            query: async (sql, values) => {
              const text = typeof sql === "string" ? sql : sql.text;
              const selected =
                mode === "EVENT_CLOCK"
                  ? text.startsWith("WITH event_clock AS MATERIALIZED")
                  : mode === "EVALUATION_CLOCK"
                    ? text.includes(" AS evaluated_at")
                    : mode === "RETRY_CLOCK" &&
                      text.startsWith(
                        "SELECT gen_random_uuid() AS result_id,gen_random_uuid() AS job_id,",
                      );
              const statement = selected
                ? text.replace(
                    "GREATEST(clock_timestamp(),",
                    "GREATEST((clock_timestamp()+interval '2 seconds'),",
                  )
                : text;
              if (selected) observed++;
              try {
                const result = await connection.query(
                  statement === text
                    ? sql
                    : typeof sql === "string"
                      ? statement
                      : { ...sql, text: statement },
                  values,
                );
                return result;
              } catch (error) {
                console.error(
                  JSON.stringify({
                    mode,
                    phase: text === "COMMIT" ? "COMMIT" : "STATEMENT",
                    sqlstate: /^[A-Z0-9]{5}$/u.test(error.code ?? "")
                      ? error.code
                      : "NONE",
                    guard:
                      error.message ===
                      "publication action requires its current active MFA session"
                        ? "PUBLICATION_SESSION_TIME"
                        : "OTHER",
                  }),
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
    const fixtures = await seedPublicationRuntimeFixtures(client, persistence, {
      sessions: [{ name: "publisher", actor: "editor", ...credentials }],
    });
    const validationCase = await seedPublicationValidationTimeCase({
      client,
      persistence,
      fixtures,
    });
    await runMigrations({
      clientConfig: config,
      workspaceRoot,
      command: { direction: "up" },
    });
    await verifyPublicationValidationTimeCase({
      client,
      clientConfig: config,
      credentials,
      fixtureCase: validationCase,
      check: equal,
    });
    const target = {
      owner: fixtures.targets.media,
      revisionId: fixtures.revisions.media,
    };
    const perform = (action) =>
      persistence.publicationRuntimeTransactionManager.runInPublicationRuntimeTransaction(
        async ({ authorization, publicationRuntime }) => {
          const auth = await authorization.authorize({
            schemaVersion: 1,
            ...credentials,
            permission: "content.publish",
            locales: SUPPORTED_LOCALES,
          });
          equal(auth.outcome, "SUCCESS");
          const loaded = await publicationRuntime.load({
            schemaVersion: 1,
            target,
            action: "PUBLISH",
          });
          equal(loaded.outcome, "SUCCESS");
          const context = loaded.context.preflight,
            manifest = buildPublicationManifest(context);
          const result = await publicationRuntime.write({
            schemaVersion: 1,
            requestId: randomUUID(),
            principal: auth.principal,
            command: {
              schemaVersion: 1,
              action,
              target,
              expectedVersion: context.headVersion,
              expectedContentHash: context.snapshot.contentHash,
              reasonCode: "CLOCK_BOUNDARY_PROBE",
              idempotencyKey: randomUUID(),
            },
            manifest,
            manifestHash: computePublicationManifestHash(manifest),
          });
          equal(result.outcome, "SUCCESS");
          if (mode !== "NORMAL") {
            await activeConnection.query("SET CONSTRAINTS ALL IMMEDIATE");
            throw acceptedProbe;
          }
          return result;
        },
      );
    await perform("VALIDATE");
    let failures = 0;
    for (const kind of ["EVENT_CLOCK", "EVALUATION_CLOCK"]) {
      mode = kind;
      observed = 0;
      try {
        await perform("PUBLISH");
      } catch (error) {
        if (error !== acceptedProbe) failures++;
      }
      equal(
        observed,
        kind === "EVENT_CLOCK" ? 1 : 2,
        "each earlier clock observation is selected explicitly",
      );
      equal(
        (
          await client.query(
            "SELECT lifecycle FROM public.media_metadata_revisions WHERE id=$1",
            [target.revisionId],
          )
        ).rows[0].lifecycle,
        "VALIDATED",
        "every isolated publication probe rolls back after real deferred constraints",
      );
    }
    equal(
      failures,
      0,
      "publication uses stable transaction time and immutable causal history under earlier clock observations",
    );
    mode = "NORMAL";
    const published = await perform("PUBLISH");
    const claim =
      await persistence.publicationPurgeTransactionManager.runInPublicationPurgeTransaction(
        ({ publicationPurge }) =>
          publicationPurge.claim({ schemaVersion: 1, leaseSeconds: 60 }),
      );
    equal(claim.outcome, "SUCCESS");
    assert.ok(claim.claim);
    const failed =
      await persistence.publicationPurgeTransactionManager.runInPublicationPurgeTransaction(
        ({ publicationPurge }) =>
          publicationPurge.record({
            schemaVersion: 1,
            jobId: claim.claim.job.id,
            leaseToken: claim.claim.leaseToken,
            expectedVersion: claim.claim.version,
            result: {
              kind: "FAILURE",
              code: "ACCESS_DENIED",
              retryable: false,
            },
          }),
      );
    equal(failed.outcome, "SUCCESS");
    equal(failed.job.status, "FAILED");
    mode = "RETRY_CLOCK";
    observed = 0;
    const retried =
      await persistence.publicationRuntimeTransactionManager.runInPublicationRuntimeTransaction(
        async ({ authorization, publicationRuntime }) => {
          const auth = await authorization.authorize({
            schemaVersion: 1,
            ...credentials,
            permission: "content.publish",
            locales: SUPPORTED_LOCALES,
          });
          equal(auth.outcome, "SUCCESS");
          return publicationRuntime.retry({
            schemaVersion: 1,
            requestId: randomUUID(),
            principal: auth.principal,
            command: {
              schemaVersion: 1,
              action: "RETRY_PURGE",
              publicationId: published.publicationId,
              purgeJobId: failed.job.id,
              expectedVersion: failed.job.version,
              reasonCode: "CLOCK_BOUNDARY_PROBE",
              idempotencyKey: randomUUID(),
            },
          });
        },
      );
    equal(retried.outcome, "SUCCESS");
    equal(observed, 1, "retry earlier clock observation is selected once");
    equal(
      retried.generation,
      2,
      "manual retry creates a new immutable generation",
    );
    equal(
      (
        await client.query(
          "SELECT status FROM public.content_purge_jobs WHERE id=$1",
          [failed.job.id],
        )
      ).rows[0].status,
      "FAILED",
      "retry preserves the failed predecessor",
    );
    console.log(
      `publication event time PostgreSQL: ${assertions} assertions PASS (event clock, preflight observation, manual retry; real guards and expiry unchanged)`,
    );
  } finally {
    await persistence.close();
    await client.end();
  }
});
