import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
} from "@fan-support/content";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";
import { seedContentAuthoringPolicySource } from "./postgres-content-authoring-fixtures.mjs";
import { approvePreflightBase } from "./postgres-publication-preflight-fixtures.mjs";

function success(value, label) {
  assert.equal(
    value.outcome,
    "SUCCESS",
    `${label}: ${value.code ?? "SUCCESS"}`,
  );
  return value;
}

/** Normal migration-0017 history: an approved draft predates another revision's future publication. */
export async function seedPublicationValidationTimeCase({
  client,
  persistence,
  fixtures,
}) {
  assert.equal(
    (
      await client.query(
        "SELECT max(version) AS version FROM public.schema_migrations",
      )
    ).rows[0].version,
    "0017",
    "future history is created under its real historical schema",
  );
  await client.query("BEGIN");
  let source;
  try {
    source = await seedContentAuthoringPolicySource(client, {
      editor: fixtures.editor,
      reviewer: fixtures.reviewer,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  const copied =
    await persistence.contentAuthoringTransactionManager.runInContentAuthoringTransaction(
      async ({ contentAuthoring }) => {
        const read = success(
          await contentAuthoring.read({
            schemaVersion: 1,
            action: "READ",
            target: source.target,
            revisionId: source.revisionId,
          }),
          "historical source read",
        );
        const effectiveAt = (
          await client.query(
            "SELECT to_char((clock_timestamp()+interval '2 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
          )
        ).rows[0].at;
        return success(
          await contentAuthoring.write({
            schemaVersion: 1,
            actorId: fixtures.editor,
            requestId: randomUUID(),
            command: {
              schemaVersion: 1,
              action: "COPY",
              target: source.target,
              sourceRevisionId: source.revisionId,
              expectedSourceHash: read.snapshot.contentHash,
              expectedVersion: read.snapshot.headVersion,
              changes: {
                kind: "POLICY",
                structure: { ...read.snapshot.content.structure, effectiveAt },
              },
              reasonCode: "VALIDATION_TIME_FIXTURE",
              idempotencyKey: randomUUID(),
            },
          }),
          "approved draft copied before future publication",
        );
      },
    );
  await approvePreflightBase(
    persistence,
    fixtures,
    source.target,
    copied.resultId,
  );
  const deadline = performance.now() + 6000;
  while (
    !(
      await client.query(
        "SELECT effective_at<=clock_timestamp() AS effective FROM public.policy_revisions WHERE id=$1",
        [copied.resultId],
      )
    ).rows[0].effective
  ) {
    assert.ok(
      performance.now() < deadline,
      "draft policy becomes currently effective within a bounded wait",
    );
    await delay(20);
  }
  const publicationId = randomUUID(),
    auditId = randomUUID(),
    requestId = randomUUID();
  await client.query("BEGIN");
  try {
    const at = (
      await client.query(
        "SELECT to_char((clock_timestamp()+interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
      )
    ).rows[0].at;
    await client.query(
      "UPDATE public.policy_revisions SET lifecycle='VALIDATED',validated_at=clock_timestamp() WHERE id=$1",
      [source.revisionId],
    );
    await client.query(
      "UPDATE public.policy_revisions SET lifecycle='PUBLISHED',published_at=$2 WHERE id=$1",
      [source.revisionId, at],
    );
    await client.query(
      `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)
      VALUES($1,'ADMIN',$2,'CONTENT_PUBLISH','CONTENT_PUBLICATION',$3,'VALIDATION_TIME_FIXTURE',$4,$4,'SUCCEEDED',$5)`,
      [auditId, fixtures.editor, publicationId, requestId, at],
    );
    await client.query(
      `INSERT INTO public.content_publications(id,content_type,policy_key,policy_revision_id,action,translation_manifest_hash,approval_manifest_hash,published_by,published_at,idempotency_key,audit_log_id)
      VALUES($1,'POLICY',$2,$3,'PUBLISH',$4,$4,$5,$6,$7,$8)`,
      [
        publicationId,
        source.target.policyKey,
        source.revisionId,
        "a".repeat(64),
        fixtures.editor,
        at,
        `validation-time:${publicationId}`,
        auditId,
      ],
    );
    await client.query(
      `INSERT INTO public.policy_publication_heads(id,policy_key,publication_id,policy_revision_id,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$5)`,
      [
        randomUUID(),
        source.target.policyKey,
        publicationId,
        source.revisionId,
        at,
      ],
    );
    for (const locale of SUPPORTED_LOCALES)
      await client.query(
        `INSERT INTO public.outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,secondary_subject_id,locale,idempotency_key,request_id,correlation_id,occurred_at,available_at,created_at)
        VALUES($1,'CONTENT_PUBLICATION_CHANGED','CONTENT_PUBLICATION',$2,1,$2,$3,$4,$5,$6,$6,$7::timestamptz,$7::timestamptz,$7::timestamptz)`,
        [
          randomUUID(),
          publicationId,
          source.revisionId,
          locale,
          `content-publication:${publicationId}:${locale}`,
          requestId,
          at,
        ],
      );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { target: source.target, revisionId: copied.resultId, publicationId };
}

/** Current runtime sees real stored history. No query or clock value is substituted. */
export async function verifyPublicationValidationTimeCase({
  client,
  clientConfig,
  credentials,
  fixtureCase,
  check,
}) {
  let databaseFailure;
  const persistence = createPostgresPersistenceWithPoolFactory(
    clientConfig,
    {},
    (config) => {
      const pool = new Pool(config);
      return {
        end: () => pool.end(),
        on: (event, listener) => pool.on(event, listener),
        off: (event, listener) => pool.off(event, listener),
        async connect() {
          const connection = await pool.connect();
          return {
            release: (destroy) => connection.release(destroy),
            async query(sql, values) {
              try {
                return await connection.query(sql, values);
              } catch (error) {
                databaseFailure = {
                  sqlstate: /^[A-Z0-9]{5}$/u.test(error?.code ?? "")
                    ? error.code
                    : "NONE",
                  guard:
                    error?.message ===
                    "publication action requires its current active MFA session"
                      ? "PUBLICATION_SESSION_TIME"
                      : "OTHER",
                };
                throw error;
              }
            },
          };
        },
      };
    },
  );
  const state = async () =>
    (
      await client.query(
        `SELECT to_jsonb(h.*) AS head,
    (SELECT count(*)::integer FROM public.content_publications WHERE policy_key=$1) AS publications,
    (SELECT count(*)::integer FROM public.outbox_events WHERE aggregate_id=h.publication_id) AS outbox
    FROM public.policy_publication_heads h WHERE policy_key=$1`,
        [fixtureCase.target.policyKey],
      )
    ).rows[0];
  const before = await state();
  try {
    check(
      (
        await client.query(
          "SELECT max(version) AS version FROM public.schema_migrations",
        )
      ).rows[0].version,
      "0021",
      "validation time regression uses the current schema",
    );
    check(
      (
        await client.query(
          `SELECT h.updated_at>clock_timestamp() AS future_head,h.updated_at=p.published_at AS exact_publication,
      p.proof_version=1 AS historical_publication,r.lifecycle='DRAFT' AS draft,
      r.created_at<h.updated_at AS draft_precedes_head,
      (SELECT count(*)=7 FROM public.policy_revision_translations t JOIN LATERAL(SELECT status FROM public.policy_translation_reviews WHERE policy_translation_id=t.id ORDER BY sequence DESC LIMIT 1) review ON true WHERE t.policy_revision_id=r.id AND review.status='APPROVED') AS approved
      FROM public.policy_publication_heads h JOIN public.content_publications p ON p.id=h.publication_id
      JOIN public.policy_revisions r ON r.id=$2 WHERE h.policy_key=$1`,
          [fixtureCase.target.policyKey, fixtureCase.revisionId],
        )
      ).rows[0],
      {
        future_head: true,
        exact_publication: true,
        historical_publication: true,
        draft: true,
        draft_precedes_head: true,
        approved: true,
      },
      "normal historical publication and an earlier approved draft are persisted facts",
    );
    const result =
      await persistence.publicationRuntimeTransactionManager.runInPublicationRuntimeTransaction(
        async ({ authorization, publicationRuntime }) => {
          const authorized = success(
            await authorization.authorize({
              schemaVersion: 1,
              ...credentials,
              permission: "content.publish",
              locales: SUPPORTED_LOCALES,
            }),
            "current real session and grants",
          );
          const target = {
            owner: fixtureCase.target,
            revisionId: fixtureCase.revisionId,
          };
          const loaded = success(
            await publicationRuntime.load({
              schemaVersion: 1,
              target,
              action: "PUBLISH",
            }),
            "current canonical preflight",
          );
          const context = loaded.context.preflight,
            manifest = buildPublicationManifest(context);
          return success(
            await publicationRuntime.write({
              schemaVersion: 1,
              requestId: randomUUID(),
              principal: authorized.principal,
              command: {
                schemaVersion: 1,
                action: "VALIDATE",
                target,
                expectedVersion: context.headVersion,
                expectedContentHash: context.snapshot.contentHash,
                reasonCode: "VALIDATION_TIME_FIXTURE",
                idempotencyKey: randomUUID(),
              },
              manifest,
              manifestHash: computePublicationManifestHash(manifest),
            }),
            "validation of a draft does not advance the publication head clock",
          );
        },
      );
    check(
      result.outcome,
      "SUCCESS",
      "VALIDATE commits with normal session and publication guards",
    );
    check(
      await state(),
      before,
      "VALIDATE leaves the actual publication head and outbox unchanged",
    );
    check(
      (
        await client.query(
          `SELECT r.lifecycle='VALIDATED' AS validated,r.validated_at<h.updated_at AS before_head,
      c.created_at=r.validated_at AS exact_receipt,s.expires_at>clock_timestamp() AND s.expires_at>c.created_at AS current_session
      FROM public.policy_revisions r JOIN public.policy_publication_heads h ON h.policy_key=r.policy_key
      JOIN public.content_publication_receipts c ON c.action='VALIDATE' AND c.manifest_id IN(SELECT id FROM public.content_publication_manifests WHERE policy_revision_id=r.id)
      JOIN public.admin_sessions s ON s.id=c.session_id WHERE r.id=$1`,
          [fixtureCase.revisionId],
        )
      ).rows[0],
      {
        validated: true,
        before_head: true,
        exact_receipt: true,
        current_session: true,
      },
      "validation uses its own causal evidence while the current session remains valid",
    );
  } catch (error) {
    if (databaseFailure)
      console.error(
        JSON.stringify({ probe: "VALIDATE_FUTURE_HEAD", ...databaseFailure }),
      );
    assert.deepEqual(
      await state(),
      before,
      "rejected validation cannot alter its historical publication",
    );
    throw error;
  } finally {
    await persistence.close();
  }
}
