#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";
import {
  seedContentAuthoringFixtures,
  seedContentAuthoringPolicySource,
} from "./postgres-content-authoring-fixtures.mjs";
import {
  revokeAdminContentLocaleGrant,
  grantAdminContentLocale,
} from "./postgres-admin-content-fixtures.mjs";

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
function ok(value, label) {
  check = label;
  assert.ok(value, label);
  assertions++;
}
function success(result, label) {
  equal(
    result.outcome,
    "SUCCESS",
    `${label}: ${result.code ?? "unexpected response"}`,
  );
  return result;
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
  let error;
  try {
    await transaction(client, work);
  } catch (caught) {
    error = caught;
  }
  ok(error && ["23514", "23503", "23505", "55000"].includes(error.code), label);
}
const digest = () => randomBytes(32).toString("hex");
const sessionFixtures = ["editor", "reviewer"].map((actor) => ({
  name: actor,
  actor,
  sessionTokenDigest: digest(),
  csrfTokenDigest: digest(),
}));
await withEphemeralPostgres(async (clientConfig) => {
  const migrate = (command) =>
    runMigrations({ clientConfig, workspaceRoot, command });
  await migrate({
    direction: "up",
    targetVersion:
      process.env["BASE_CONTENT_RED_BASELINE"] === "1" ? "0015" : "0016",
  });
  const client = new Client(clientConfig);
  await client.connect();
  const persistence = createPostgresPersistence(clientConfig);
  const run = (work) =>
    persistence.baseContentTransactionManager.runInBaseContentTransaction(work);
  const author = (work) =>
    persistence.contentAuthoringTransactionManager.runInContentAuthoringTransaction(
      work,
    );
  let fixtures;
  const read = (target) =>
    run(({ baseContentReviews }) =>
      baseContentReviews.read({ schemaVersion: 1, target }),
    );
  const command = (context, action, actorId, changes = {}) => ({
    schemaVersion: 1,
    action,
    target: context.target,
    expectedVersion: context.audit.reviewSequence,
    expectedContentHash: context.audit.sourceHash,
    expectedSourceHash: context.currentEnglishSourceHash,
    actorId,
    reasonCode: "BASE_CONTENT_FIXTURE",
    requestId: randomUUID(),
    ...changes,
  });
  const append = (input) =>
    run(({ baseContentReviews }) => baseContentReviews.append(input));
  const write = (input, actorId = fixtures.editor) =>
    author(({ contentAuthoring }) =>
      contentAuthoring.write({
        schemaVersion: 1,
        command: input,
        actorId,
        requestId: randomUUID(),
      }),
    );
  const create = async (key, content = fixtures.content[key]) => {
    const owner = fixtures.targets[key];
    const source = success(
      await author(({ contentAuthoring }) =>
        contentAuthoring.read({
          schemaVersion: 1,
          action: "READ",
          target: owner,
          revisionId: fixtures.approvedSourceRevisionIds[key],
        }),
      ),
      `${key} canonical head`,
    );
    return success(
      await write({
        schemaVersion: 1,
        action: "CREATE",
        target: owner,
        content,
        expectedVersion: source.snapshot.headVersion,
        reasonCode: "BASE_CONTENT_FIXTURE",
        idempotencyKey: randomUUID(),
      }),
      `${key} authored create`,
    ).resultId;
  };
  const issue = (target, tokenDigest = digest(), changes = {}) =>
    run(({ baseContentPreviews }) =>
      baseContentPreviews.issue({
        schemaVersion: 1,
        target,
        tokenDigest,
        actorId: fixtures.editor,
        sessionId: fixtures.sessions.editor,
        ttlSeconds: 60,
        reasonCode: "BASE_PREVIEW_FIXTURE",
        requestId: randomUUID(),
        ...changes,
      }),
    );
  const preview = (target, tokenDigest) =>
    run(({ baseContentPreviews }) =>
      baseContentPreviews.read({ schemaVersion: 1, target, tokenDigest }),
    );
  const revoke = (grantId, actorId = fixtures.editor) =>
    run(({ baseContentPreviews }) =>
      baseContentPreviews.revoke({
        schemaVersion: 1,
        grantId,
        actorId,
        reasonCode: "BASE_PREVIEW_REVOKE",
        requestId: randomUUID(),
      }),
    );
  const counts = async () =>
    (
      await client.query(`SELECT jsonb_build_object(
    'receipts',(SELECT count(*) FROM base_content_review_receipts),
    'previews',(SELECT count(*) FROM base_content_preview_grants),
    'audit',(SELECT count(*) FROM audit_logs),
    'reviews',(SELECT count(*) FROM policy_translation_reviews)) AS value`)
    ).rows[0].value;
  try {
    equal(
      (
        await client.query(
          "SELECT to_regclass('public.base_content_review_receipts') IS NOT NULL AS reviews,to_regclass('public.base_content_preview_grants') IS NOT NULL AS previews",
        )
      ).rows[0],
      { reviews: true, previews: true },
      "0016 supplies typed review receipts and scoped preview grants",
    );
    await migrate({ direction: "down", confirmVersion: "0016" });
    await migrate({ direction: "up", targetVersion: "0016" });
    stage = "normal-trigger fixtures";
    fixtures = await seedContentAuthoringFixtures(client, {
      sessions: sessionFixtures,
    });
    const publishedBefore = (
      await client.query(
        "SELECT jsonb_agg(to_jsonb(p.*) ORDER BY id) AS rows FROM content_publications p",
      )
    ).rows[0].rows;
    const authored = {},
      targets = {};
    for (const key of Object.keys(fixtures.targets)) {
      stage = `${key} base review`;
      const legacyTarget = {
        owner: fixtures.targets[key],
        revisionId: fixtures.approvedSourceRevisionIds[key],
        locale: "en",
      };
      const legacy = success(
        await read(legacyTarget),
        `${key} legacy remains readable`,
      );
      equal(
        (await append(command(legacy.context, "APPROVE", fixtures.reviewer)))
          .code,
        "INVALID_REVIEW_STATE",
        `${key} legacy must first copy to an authored revision`,
      );
      authored[key] = await create(key);
      targets[key] = {
        owner: fixtures.targets[key],
        revisionId: authored[key],
        locale: "en",
      };
      for (const locale of SUPPORTED_LOCALES) {
        const target = { ...targets[key], locale };
        const initial = success(
          await read(target),
          `${key}/${locale} draft read`,
        );
        equal(
          initial.context.audit.review.status,
          "DRAFT",
          `${key}/${locale} starts draft`,
        );
        equal(
          initial.context.stale,
          false,
          `${key}/${locale} binds actual English`,
        );
        equal(
          initial.content.fields,
          fixtures.content[key].translations.find(
            (row) => row.locale === locale,
          ).fields,
          `${key}/${locale} exact selected text`,
        );
        equal(
          (await append(command(initial.context, "SUBMIT", fixtures.reviewer)))
            .code,
          "FORBIDDEN",
          `${key}/${locale} only editor submits`,
        );
        equal(
          (
            await append(
              command(initial.context, "SUBMIT", fixtures.editor, {
                expectedVersion: 2,
              }),
            )
          ).code,
          "STALE_VERSION",
          `${key}/${locale} sequence guard`,
        );
        equal(
          (
            await append(
              command(initial.context, "SUBMIT", fixtures.editor, {
                expectedContentHash: "0".repeat(64),
              }),
            )
          ).code,
          "STALE_CONTENT",
          `${key}/${locale} content hash guard`,
        );
        success(
          await append(command(initial.context, "SUBMIT", fixtures.editor)),
          `${key}/${locale} submitted`,
        );
        const submitted = success(
          await read(target),
          `${key}/${locale} submitted read`,
        );
        equal(
          submitted.context.audit.reviewSequence,
          2,
          `${key}/${locale} exact second event`,
        );
        equal(
          (await append(command(submitted.context, "APPROVE", fixtures.editor)))
            .code,
          "SELF_REVIEW",
          `${key}/${locale} self review blocked`,
        );
        success(
          await append(
            command(submitted.context, "APPROVE", fixtures.reviewer),
          ),
          `${key}/${locale} independent approval`,
        );
        const approved = success(
          await read(target),
          `${key}/${locale} approved read`,
        );
        equal(
          approved.context.audit.reviewSequence,
          3,
          `${key}/${locale} exact terminal event`,
        );
        equal(
          approved.context.audit.review.reviewedSourceHash,
          approved.context.currentEnglishSourceHash,
          `${key}/${locale} canonical approval source`,
        );
        const token = digest(),
          grant = success(
            await issue(target, token),
            `${key}/${locale} preview grant`,
          );
        ok(
          Date.parse(grant.expiresAt) - Date.parse(grant.createdAt) <= 60_000,
          `${key}/${locale} bounded preview TTL`,
        );
        const view = success(
          await preview(target, token),
          `${key}/${locale} scoped preview`,
        );
        equal(
          view.content.fields,
          initial.content.fields,
          `${key}/${locale} preview exact locale`,
        );
        ok(
          !JSON.stringify(view).includes(fixtures.editor) &&
            !("translations" in view.content),
          `${key}/${locale} preview omits editor and other translations`,
        );
        equal(
          (
            await preview(
              { ...target, locale: locale === "en" ? "ja" : "en" },
              token,
            )
          ).code,
          "PREVIEW_UNAVAILABLE",
          `${key}/${locale} wrong scope fails opaque`,
        );
        success(
          await revoke(grant.grantId),
          `${key}/${locale} revoke own grant`,
        );
        equal(
          (await preview(target, token)).code,
          "PREVIEW_UNAVAILABLE",
          `${key}/${locale} revoked token denied`,
        );
      }
      const source = success(
        await author(({ contentAuthoring }) =>
          contentAuthoring.read({
            schemaVersion: 1,
            action: "READ",
            target: fixtures.targets[key],
            revisionId: authored[key],
          }),
        ),
        `${key} approved copy source`,
      ).snapshot;
      const copied = success(
        await write(
          {
            schemaVersion: 1,
            action: "COPY",
            target: source.target,
            expectedVersion: source.headVersion,
            sourceRevisionId: source.revisionId,
            expectedSourceHash: source.contentHash,
            changes: { kind: source.target.kind },
            reasonCode: "COPY_APPROVED_FIXTURE",
            idempotencyKey: randomUUID(),
          },
          fixtures.reviewer,
        ),
        `${key} original reviewer can author exact inherited copy`,
      );
      const inherited = success(
        await read({ ...targets[key], revisionId: copied.resultId }),
        `${key} inherited read`,
      );
      equal(
        inherited.context.structureEditorId,
        fixtures.reviewer,
        `${key} changed structure author`,
      );
      equal(
        inherited.context.audit.review.reviewerId,
        fixtures.reviewer,
        `${key} exact original reviewer retained`,
      );
      equal(
        inherited.context.audit.inheritedFrom.reviewId,
        source.translationAudits.find((row) => row.locale === "en").reviewId,
        `${key} inherited source approval exact FK`,
      );
    }
    stage = "published heads unchanged";
    equal(
      (
        await client.query(
          "SELECT jsonb_agg(to_jsonb(p.*) ORDER BY id) AS rows FROM content_publications p",
        )
      ).rows[0].rows,
      publishedBefore,
      "base review and preview never publish",
    );
    stage = "preview authority";
    const token = digest(),
      grant = success(await issue(targets.policy, token), "authority grant");
    equal(
      (await revoke(grant.grantId, fixtures.reviewer)).code,
      "NOT_FOUND",
      "another actor cannot revoke issuer grant",
    );
    equal(
      (
        await preview(
          { ...targets.policy, owner: fixtures.targets.idol },
          token,
        )
      ).code,
      "PREVIEW_UNAVAILABLE",
      "wrong content kind cannot reuse a token",
    );
    equal(
      (
        await preview(
          {
            ...targets.policy,
            owner: { kind: "POLICY", policyKey: "not-the-owner" },
          },
          token,
        )
      ).code,
      "PREVIEW_UNAVAILABLE",
      "wrong stable owner cannot reuse a token",
    );
    await client.query(
      "UPDATE admin_sessions SET authenticated_with_mfa=false WHERE id=$1",
      [fixtures.sessions.editor],
    );
    equal(
      (await preview(targets.policy, token)).code,
      "PREVIEW_UNAVAILABLE",
      "MFA removal invalidates issued preview",
    );
    await client.query(
      "UPDATE admin_sessions SET authenticated_with_mfa=true WHERE id=$1",
      [fixtures.sessions.editor],
    );
    await revokeAdminContentLocaleGrant(client, {
      adminIdentityId: fixtures.editor,
      locale: "en",
      actorId: fixtures.reviewer,
    });
    equal(
      (await preview(targets.policy, token)).code,
      "PREVIEW_UNAVAILABLE",
      "locale revocation invalidates issued preview",
    );
    await grantAdminContentLocale(client, {
      adminIdentityId: fixtures.editor,
      locale: "en",
      actorId: fixtures.reviewer,
    });
    success(
      await preview(targets.policy, token),
      "audited locale regrant restores issuer capability",
    );
    await rejectsSql(client, "unaudited preview revoke rejected", () =>
      client.query(
        "UPDATE base_content_preview_grants SET revoked_at=clock_timestamp() WHERE id=$1",
        [grant.grantId],
      ),
    );
    await rejectsSql(client, "preview scope cannot change", () =>
      client.query(
        "UPDATE base_content_preview_grants SET locale='ja' WHERE id=$1",
        [grant.grantId],
      ),
    );
    await rejectsSql(client, "preview cannot be deleted", () =>
      client.query("DELETE FROM base_content_preview_grants WHERE id=$1", [
        grant.grantId,
      ]),
    );
    stage = "concurrent base approval";
    const raceTarget = {
      ...targets.policy,
      revisionId: await create("policy"),
    };
    const raceDraft = success(await read(raceTarget), "race draft");
    success(
      await append(command(raceDraft.context, "SUBMIT", fixtures.editor)),
      "race submit",
    );
    const raceSubmitted = success(await read(raceTarget), "race submitted");
    const results = await Promise.allSettled([
      append(command(raceSubmitted.context, "APPROVE", fixtures.reviewer)),
      append(command(raceSubmitted.context, "APPROVE", fixtures.reviewer)),
    ]);
    equal(
      results.filter(
        (result) =>
          result.status === "fulfilled" && result.value.outcome === "SUCCESS",
      ).length,
      1,
      "concurrent approvals commit exactly once",
    );
    equal(
      (await read(raceTarget)).context.audit.reviewSequence,
      3,
      "concurrent approval preserves one exact event",
    );
    stage = "review audit atomicity";
    const atomicTarget = {
      ...targets.policy,
      revisionId: await create("policy"),
    };
    const atomicDraft = success(await read(atomicTarget), "atomic draft");
    const before = await counts();
    await client.query(
      "CREATE FUNCTION public.base_review_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason_code='BASE_CONTENT_ATOMICITY' THEN RAISE EXCEPTION 'synthetic audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$",
    );
    await client.query(
      "CREATE TRIGGER base_review_test_fault BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.base_review_test_fault()",
    );
    let faulted = false;
    try {
      await append(
        command(atomicDraft.context, "SUBMIT", fixtures.editor, {
          reasonCode: "BASE_CONTENT_ATOMICITY",
        }),
      );
    } catch {
      faulted = true;
    }
    ok(faulted, "audit fault aborts mutation");
    equal(
      await counts(),
      before,
      "audit fault leaves no review, receipt, grant, or audit",
    );
    await client.query(
      "DROP TRIGGER base_review_test_fault ON public.audit_logs",
    );
    await client.query("DROP FUNCTION public.base_review_test_fault()");
    success(
      await append(
        command(atomicDraft.context, "SUBMIT", fixtures.editor, {
          reasonCode: "BASE_CONTENT_ATOMICITY",
        }),
      ),
      "same operation succeeds after fault removed",
    );
    await rejectsSql(client, "receipt is immutable", () =>
      client.query(
        "UPDATE base_content_review_receipts SET field_paths=ARRAY['unsafe']",
      ),
    );
    await rejectsSql(client, "receipt cannot be deleted", () =>
      client.query("DELETE FROM base_content_review_receipts"),
    );
    stage = "direct review receipt constraints";
    const directTarget = {
      ...targets.policy,
      revisionId: await create("policy"),
    };
    const directDraft = success(await read(directTarget), "direct SQL draft");
    async function directSubmit(context, mode) {
      const reviewId = randomUUID(),
        auditId = randomUUID(),
        requestId = randomUUID();
      const at = (
        await client.query(
          `SELECT to_char(GREATEST(clock_timestamp(),$1::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
          [context.audit.editedAt],
        )
      ).rows[0].now;
      if (mode === "forged copy") {
        await client.query(
          `INSERT INTO policy_translation_copy_evidence(target_translation_id,source_translation_id,source_approval_review_id,audit_log_id,copied_at)
          SELECT $1,t.id,v.id,a.audit_log_id,a.created_at FROM policy_revision_translations t
          JOIN policy_translation_reviews v ON v.policy_translation_id=t.id AND v.status='APPROVED'
          CROSS JOIN content_authoring_receipts a WHERE t.policy_revision_id=$2 AND t.locale='en' AND a.policy_revision_id=$3`,
          [
            context.audit.id,
            fixtures.approvedSourceRevisionIds.policy,
            context.target.revisionId,
          ],
        );
      }
      await client.query(
        `INSERT INTO policy_translation_reviews(id,policy_translation_id,sequence,status,submitted_at,created_at)
        VALUES($1,$2,2,'IN_REVIEW',$3,$3)`,
        [reviewId, context.audit.id, at],
      );
      if (mode === "no receipt" || mode === "forged copy") return;
      await client.query(
        `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
        VALUES($1,'ADMIN',$2,'BASE_CONTENT_REVIEW_SUBMIT','BASE_CONTENT_TRANSLATION_REVIEW',$3,'SQL_REVIEW_FIXTURE',$4,$4,'SUCCEEDED','CONTENT_TRANSLATION',$5)`,
        [
          auditId,
          mode === "wrong actor" ? fixtures.reviewer : fixtures.editor,
          mode === "wrong subject" ? randomUUID() : reviewId,
          requestId,
          at,
        ],
      );
      await client.query(
        `INSERT INTO base_content_review_receipts(policy_review_id,audit_log_id,created_at,field_paths) VALUES($1,$2,$3,$4)`,
        [
          reviewId,
          auditId,
          at,
          [
            mode === "wrong path"
              ? "translations.en.body"
              : `translations.${context.target.locale}.review`,
          ],
        ],
      );
    }
    const directBefore = await counts();
    for (const mode of [
      "no receipt",
      "wrong actor",
      "wrong subject",
      "wrong path",
      "forged copy",
    ]) {
      await rejectsSql(client, `${mode} cannot forge a base review`, () =>
        directSubmit(directDraft.context, mode),
      );
      equal(
        await counts(),
        directBefore,
        `${mode} rolls back all audit and review records`,
      );
    }
    stage = "future microsecond review causality";
    const futureSource = await transaction(client, () =>
      seedContentAuthoringPolicySource(client, {
        editor: fixtures.editor,
        reviewer: fixtures.reviewer,
        timeline: {
          created: "2036-01-02T00:00:00.000000Z",
          edited: "2036-01-02T00:01:00.123456Z",
          submitted: "2036-01-02T00:02:00.123456Z",
          reviewed: "2036-01-02T00:03:00.123456Z",
        },
      }),
    );
    const futureSnapshot = success(
      await author(({ contentAuthoring }) =>
        contentAuthoring.read({
          schemaVersion: 1,
          action: "READ",
          target: futureSource.target,
          revisionId: futureSource.revisionId,
        }),
      ),
      "future approved source read",
    ).snapshot;
    const futureCopy = success(
      await write({
        schemaVersion: 1,
        action: "COPY",
        target: futureSource.target,
        sourceRevisionId: futureSource.revisionId,
        expectedVersion: futureSnapshot.headVersion,
        expectedSourceHash: futureSnapshot.contentHash,
        changes: {
          kind: "POLICY",
          translations: [
            {
              locale: "en",
              origin: "HUMAN",
              fields: {
                ...futureSnapshot.content.translations.find(
                  (row) => row.locale === "en",
                ).fields,
                title: "Future causal source",
              },
            },
          ],
        },
        reasonCode: "FUTURE_REVIEW_FIXTURE",
        idempotencyKey: randomUUID(),
      }),
      "future history creates new authored draft",
    );
    const futureTarget = {
      owner: futureSource.target,
      revisionId: futureCopy.resultId,
      locale: "en",
    };
    const futureDraft = success(await read(futureTarget), "future draft read");
    success(
      await append(command(futureDraft.context, "SUBMIT", fixtures.editor)),
      "submit survives future microsecond history",
    );
    const futureSubmitted = success(
      await read(futureTarget),
      "future submitted read",
    );
    success(
      await append(
        command(futureSubmitted.context, "APPROVE", fixtures.reviewer),
      ),
      "approval preserves microsecond causal lower bound",
    );
    equal(
      (
        await client.query(
          `SELECT array_agg(to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') ORDER BY sequence) AS times
      FROM policy_translation_reviews WHERE policy_translation_id=$1`,
          [futureDraft.context.audit.id],
        )
      ).rows[0].times,
      Array(3).fill("2036-01-02T00:03:00.123456Z"),
      "all three causal events preserve the exact stored microsecond",
    );
    const staleTarget = { ...futureTarget, locale: "ja" };
    const staleDraft = success(
      await read(staleTarget),
      "stale source remains readable",
    );
    equal(
      staleDraft.context.stale,
      true,
      "unchanged foreign text retains its old source lineage",
    );
    equal(
      (await append(command(staleDraft.context, "SUBMIT", fixtures.editor)))
        .code,
      "STALE_CONTENT",
      "stale translation cannot enter review",
    );
    await rejectsSql(
      client,
      "direct audited stale submit also rejects actual English mismatch",
      () => directSubmit(staleDraft.context, "valid receipt"),
    );
    stage = "session revocation";
    await client.query(
      "UPDATE admin_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [fixtures.sessions.editor],
    );
    equal(
      (await preview(targets.policy, token)).code,
      "PREVIEW_UNAVAILABLE",
      "session expiry invalidates an otherwise active grant",
    );
    await client.query(
      "UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '1 hour',revoked_at=clock_timestamp() WHERE id=$1",
      [fixtures.sessions.editor],
    );
    equal(
      (await preview(targets.policy, token)).code,
      "PREVIEW_UNAVAILABLE",
      "session revocation invalidates an otherwise active grant",
    );
    stage = "history safe downgrade";
    let downRefused = false;
    try {
      await migrate({ direction: "down", confirmVersion: "0016" });
    } catch {
      downRefused = true;
    }
    ok(downRefused, "audit history prevents downgrade");
    equal(
      (
        await client.query(
          "SELECT max(version) AS version FROM schema_migrations",
        )
      ).rows[0].version,
      "0016",
      "refused down retains applied head",
    );
    process.stdout.write(
      `${JSON.stringify({ result: "PASS", assertions, kinds: 5, locales: 7, seeding: "normal triggers; no replica bypass" })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ stage, check, assertions, code: error.code ?? null, constraint: error.constraint ?? null, failure: error.name })}\n`,
    );
    throw error;
  } finally {
    await persistence.close();
    await client.end();
  }
});
