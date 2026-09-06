#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  prepareIdolAliasDraft,
  prepareGiftDetailDraft,
} from "@fan-support/content";
import {
  persistIdolAliasDraft,
  persistGiftDetailDraft,
} from "../dist/content-draft-writes.js";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";
import {
  seedAdminContentFixtures,
  adminAliasDraftFixture,
  adminGiftDetailDraftFixture,
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
async function rejectSql(
  client,
  label,
  work,
  codes = ["23514", "23503", "23505", "55000"],
) {
  stage = label;
  let failure;
  try {
    await transaction(client, work);
  } catch (error) {
    failure = error;
  }
  ok(
    failure && codes.includes(failure.code),
    `${label}: expected constraint rejection`,
  );
}
const token = () => randomBytes(32).toString("hex");
await withEphemeralPostgres(async (clientConfig) => {
  const migrate = (command) =>
    runMigrations({ clientConfig, workspaceRoot, command });
  await migrate({ direction: "up", targetVersion: "0013" });
  const client = new Client(clientConfig);
  await client.connect();
  const persistence = createPostgresPersistence(clientConfig);
  const run = (work) =>
    persistence.adminContentTransactionManager.runInAdminContentTransaction(
      work,
    );
  try {
    const catalog = await seedCatalogDirectoryFixtures(client, 2);
    const historical = async () =>
      (
        await client.query(`SELECT jsonb_build_object(
      'idols',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM idol_revision_translations t),
      'gifts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM gift_revision_translations t),
      'publications',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM content_publications t)) AS snapshot`)
      ).rows[0].snapshot;
    const oldSnapshot = await historical();
    await migrate({ direction: "up", targetVersion: "0014" });
    const result = await client.query(
      "SELECT to_regclass('public.admin_content_locale_grants') IS NOT NULL AS grants, to_regclass('public.content_preview_grants') IS NOT NULL AS previews",
    );
    process.stdout.write(
      `${JSON.stringify({ stage: "required grant tables", ...result.rows[0] })}\n`,
    );
    equal(
      result.rows[0],
      { grants: true, previews: true },
      "canonical language and preview grants must exist",
    );
    equal(
      await historical(),
      oldSnapshot,
      "0014 does not rewrite historical content",
    );
    await migrate({ direction: "down", confirmVersion: "0014" });
    await migrate({ direction: "up", targetVersion: "0014" });
    equal(await historical(), oldSnapshot, "old data survives 0014 down/up");
    const sessionSpecs = [
      { name: "editor", actor: "editor" },
      { name: "reviewer", actor: "reviewer" },
      { name: "denied", actor: "denied" },
      { name: "mfaOff", actor: "editor", authenticatedWithMfa: false },
      { name: "expired", actor: "editor", expiresInSeconds: -60 },
      { name: "revoked", actor: "editor", revoked: true },
    ].map((session) => ({
      ...session,
      sessionTokenDigest: token(),
      csrfTokenDigest: token(),
    }));
    const fixtures = await seedAdminContentFixtures(client, {
      catalog,
      sessions: sessionSpecs,
    });
    const spec = (name) =>
      sessionSpecs.find((session) => session.name === name);
    const authorization = (
      name,
      permission = "content.read",
      locales = [],
      overrides = {},
    ) => ({
      schemaVersion: 1,
      sessionTokenDigest: spec(name).sessionTokenDigest,
      csrfTokenDigest: spec(name).csrfTokenDigest,
      permission,
      locales,
      ...overrides,
    });
    const authorize = (name, permission, locales, overrides) =>
      run(({ authorization: repository }) =>
        repository.authorize(
          authorization(name, permission, locales, overrides),
        ),
      );
    stage = "canonical authorization";
    for (const name of ["editor", "reviewer"])
      equal(
        (await authorize(name)).outcome,
        "SUCCESS",
        `${name} session is authorized`,
      );
    for (const name of ["mfaOff", "expired", "revoked"])
      equal(
        (await authorize(name)).code,
        "UNAUTHENTICATED",
        `${name} session denied`,
      );
    equal(
      (await authorize("denied")).code,
      "FORBIDDEN",
      "identity alone is not a permission",
    );
    equal(
      (
        await authorize("editor", "content.read", [], {
          sessionTokenDigest: token(),
        })
      ).code,
      "UNAUTHENTICATED",
      "unknown session denied",
    );
    equal(
      (
        await authorize("editor", "content.read", [], {
          csrfTokenDigest: token(),
        })
      ).code,
      "CSRF_INVALID",
      "CSRF must bind the session",
    );
    equal(
      (await authorize("reviewer", "content.edit")).code,
      "FORBIDDEN",
      "reviewer cannot edit",
    );
    await client.query(
      "UPDATE admin_identities SET status='SUSPENDED' WHERE id=$1",
      [fixtures.editor],
    );
    equal(
      (await authorize("editor")).code,
      "UNAUTHENTICATED",
      "suspended identity invalidates session",
    );
    await client.query(
      "UPDATE admin_identities SET status='ACTIVE' WHERE id=$1",
      [fixtures.editor],
    );
    stage = "wall clock session expiry";
    await client.query(
      "UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",
      [fixtures.sessions.expired],
    );
    equal(
      (
        await run(async ({ authorization: auth }) => {
          ok(
            (
              await client.query(
                "SELECT clock_timestamp()<expires_at AS before_expiry FROM admin_sessions WHERE id=$1",
                [fixtures.sessions.expired],
              )
            ).rows[0].before_expiry,
            "authorization transaction begins before the session expires",
          );
          const waitStartedAt = performance.now();
          let expired = false;
          while (performance.now() - waitStartedAt < 5_000) {
            expired = (
              await client.query(
                "SELECT clock_timestamp()>=expires_at+interval '500 milliseconds' AS expired FROM admin_sessions WHERE id=$1",
                [fixtures.sessions.expired],
              )
            ).rows[0].expired;
            if (expired) break;
            await delay(25);
          }
          assert.ok(
            expired,
            "database clock reaches expiry within the bounded wait",
          );
          return auth.authorize(authorization("expired"));
        })
      ).code,
      "UNAUTHENTICATED",
      "a transaction begun before expiry cannot extend the session",
    );
    stage = "revoke suspended recipient";
    const suspendedScope = {
      adminIdentityId: fixtures.reviewer,
      locale: "es",
      actorId: fixtures.editor,
    };
    await client.query(
      "UPDATE admin_identities SET status='SUSPENDED' WHERE id=$1",
      [fixtures.reviewer],
    );
    ok(
      await revokeAdminContentLocaleGrant(client, suspendedScope),
      "suspended recipient can lose a permission",
    );
    let rejectedSuspendedGrant = false;
    try {
      await grantAdminContentLocale(client, suspendedScope);
    } catch {
      rejectedSuspendedGrant = true;
    }
    ok(rejectedSuspendedGrant, "suspended recipient cannot gain a permission");
    await client.query(
      "UPDATE admin_identities SET status='ACTIVE' WHERE id=$1",
      [fixtures.reviewer],
    );
    await grantAdminContentLocale(client, suspendedScope);
    stage = "revoke after original grantor suspension";
    const independentlyRevokedScope = {
      adminIdentityId: fixtures.reviewer,
      locale: "th",
      actorId: fixtures.reviewer,
    };
    const originalGrant = (
      await client.query(
        "SELECT id,granted_by,audit_log_id FROM admin_content_locale_grants WHERE admin_identity_id=$1 AND locale='th' AND revoked_at IS NULL",
        [fixtures.reviewer],
      )
    ).rows[0];
    await client.query(
      "UPDATE admin_identities SET status='SUSPENDED' WHERE id=$1",
      [fixtures.editor],
    );
    const independentlyRevokedId = await revokeAdminContentLocaleGrant(
      client,
      independentlyRevokedScope,
    );
    equal(
      independentlyRevokedId,
      originalGrant.id,
      "active administrator can revoke after original grantor is suspended",
    );
    const retainedGrant = (
      await client.query(
        "SELECT g.granted_by,g.audit_log_id,a.actor_id AS revoked_by FROM admin_content_locale_grants g JOIN audit_logs a ON a.id=g.revoked_audit_log_id WHERE g.id=$1",
        [originalGrant.id],
      )
    ).rows[0];
    equal(
      retainedGrant,
      {
        granted_by: fixtures.editor,
        audit_log_id: originalGrant.audit_log_id,
        revoked_by: fixtures.reviewer,
      },
      "original grant and independent revocation remain attributed to their actual actors",
    );
    await client.query(
      "UPDATE admin_identities SET status='ACTIVE' WHERE id=$1",
      [fixtures.editor],
    );
    await grantAdminContentLocale(client, {
      ...independentlyRevokedScope,
      actorId: fixtures.editor,
    });
    stage = "reject suspended actual revoker";
    const inactiveRevokerScope = {
      adminIdentityId: fixtures.editor,
      locale: "vi",
      actorId: fixtures.reviewer,
    };
    const beforeInvalidRevocation = (
      await client.query("SELECT count(*)::int AS count FROM audit_logs")
    ).rows[0].count;
    await client.query(
      "UPDATE admin_identities SET status='SUSPENDED' WHERE id=$1",
      [fixtures.reviewer],
    );
    let rejectedInactiveRevoker = false;
    try {
      await revokeAdminContentLocaleGrant(client, inactiveRevokerScope);
    } catch (error) {
      rejectedInactiveRevoker = error.code === "23514";
    }
    ok(rejectedInactiveRevoker, "suspended actual revoker is rejected");
    equal(
      (await client.query("SELECT count(*)::int AS count FROM audit_logs"))
        .rows[0].count,
      beforeInvalidRevocation,
      "invalid revoker audit rolls back",
    );
    equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM admin_content_locale_grants WHERE admin_identity_id=$1 AND locale='vi' AND revoked_at IS NULL",
          [fixtures.editor],
        )
      ).rows[0].count,
      1,
      "invalid actual revoker leaves active grant untouched",
    );
    await client.query(
      "UPDATE admin_identities SET status='ACTIVE' WHERE id=$1",
      [fixtures.reviewer],
    );
    const reviewerGrant = {
      adminIdentityId: fixtures.reviewer,
      locale: "ja",
      actorId: fixtures.editor,
    };
    const savedGrant = await revokeAdminContentLocaleGrant(
      client,
      reviewerGrant,
    );
    equal(
      (await authorize("reviewer", "content.translation.review", ["ja"])).code,
      "FORBIDDEN",
      "missing assigned language denied",
    );
    equal(
      (await authorize("reviewer", "content.preview", ["ja"])).code,
      "FORBIDDEN",
      "preview is also locale scoped",
    );
    equal(
      (await authorize("reviewer", "content.translation.review", ["en", "th"]))
        .outcome,
      "SUCCESS",
      "independent languages remain allowed",
    );
    const replacementGrant = await grantAdminContentLocale(
      client,
      reviewerGrant,
    );
    ok(
      replacementGrant !== savedGrant,
      "regrant creates a new historical record",
    );
    stage = "atomic authorized creation";
    const aliasCommand = adminAliasDraftFixture(fixtures);
    const detailCommand = adminGiftDetailDraftFixture(fixtures);
    const createdAlias = await run(
      async ({ authorization: auth, contentDrafts }) => {
        const principal = await auth.authorize(
          authorization("editor", "content.edit", [...SUPPORTED_LOCALES]),
        );
        equal(
          principal.outcome,
          "SUCCESS",
          "create is authorized in same transaction",
        );
        return contentDrafts.createIdolAliases({
          ...aliasCommand,
          actorId: principal.principal.actorId,
        });
      },
    );
    equal(createdAlias.outcome, "SUCCESS", "alias created");
    equal(
      (
        await run(({ contentDrafts }) =>
          contentDrafts.createGiftDetails(detailCommand),
        )
      ).outcome,
      "SUCCESS",
      "details created",
    );
    const aliasTarget = {
      kind: "IDOL_ALIASES",
      revisionId: fixtures.idolRevisionId,
    };
    const detailTarget = {
      kind: "GIFT_DETAILS",
      revisionId: fixtures.giftRevisionId,
      locale: "ja",
    };
    const load = (target) =>
      run(({ contentReviews }) =>
        contentReviews.loadTarget({ schemaVersion: 1, target }),
      );
    const aliasContext = (await load(aliasTarget)).context;
    const detailContext = (await load(detailTarget)).context;
    equal(
      aliasContext.locales,
      [...SUPPORTED_LOCALES],
      "general aliases require all languages",
    );
    equal(
      detailContext.locales,
      ["ja"],
      "detail review covers only requested language",
    );
    equal(
      detailContext.structureEditorId,
      fixtures.editor,
      "structure author loaded canonically",
    );
    const reviewCommand = (
      context,
      action,
      actorId = fixtures.editor,
      overrides = {},
    ) => ({
      schemaVersion: 1,
      action,
      target: context.target,
      expectedVersion: context.sequence,
      expectedContentHash: context.contentHash,
      expectedSourceHash: context.sourceHash,
      actorId,
      reasonCode: "CONTENT_REVIEW",
      requestId: randomUUID(),
      ...overrides,
    });
    const append = (command) =>
      run(({ contentReviews }) => contentReviews.append(command));
    equal(
      (await append(reviewCommand(aliasContext, "SUBMIT", fixtures.reviewer)))
        .code,
      "FORBIDDEN",
      "only author can submit",
    );
    equal(
      (await append(reviewCommand(aliasContext, "APPROVE", fixtures.reviewer)))
        .code,
      "INVALID_REVIEW_STATE",
      "cannot skip submission",
    );
    equal(
      (
        await append(
          reviewCommand(aliasContext, "SUBMIT", fixtures.editor, {
            expectedVersion: 2,
          }),
        )
      ).code,
      "STALE_VERSION",
      "version mismatch rejects",
    );
    equal(
      (
        await append(
          reviewCommand(aliasContext, "SUBMIT", fixtures.editor, {
            expectedContentHash: token(),
          }),
        )
      ).code,
      "STALE_CONTENT",
      "content hash mismatch rejects",
    );
    equal(
      (
        await append(
          reviewCommand(detailContext, "SUBMIT", fixtures.editor, {
            expectedSourceHash: token(),
          }),
        )
      ).code,
      "STALE_CONTENT",
      "source mismatch rejects",
    );
    const counts = async () =>
      (
        await client.query(
          "SELECT (SELECT count(*)::int FROM audit_logs) AS audits,(SELECT count(*)::int FROM idol_revision_alias_reviews) AS reviews",
        )
      ).rows[0];
    const beforeRollback = await counts();
    let aborted = false;
    try {
      await run(async ({ contentReviews }) => {
        const submitted = await contentReviews.append(
          reviewCommand(aliasContext, "SUBMIT"),
        );
        equal(
          submitted.outcome,
          "SUCCESS",
          "mutation reached within rollback probe",
        );
        throw new Error("rollback probe");
      });
    } catch {
      aborted = true;
    }
    ok(aborted, "enclosing failure rejects transaction");
    equal(
      await counts(),
      beforeRollback,
      "audit and review roll back together",
    );
    const submitAlias = await append(reviewCommand(aliasContext, "SUBMIT"));
    equal(submitAlias.outcome, "SUCCESS", "author submitted alias");
    equal(
      (await append(reviewCommand(aliasContext, "SUBMIT"))).code,
      "STALE_VERSION",
      "stale duplicate cannot append",
    );
    const submittedAlias = (await load(aliasTarget)).context;
    equal(submittedAlias.status, "IN_REVIEW", "submission persisted");
    equal(
      (await append(reviewCommand(submittedAlias, "APPROVE"))).code,
      "SELF_REVIEW",
      "self review blocked",
    );
    const approvedAlias = await run(
      async ({ authorization: auth, contentReviews }) => {
        const canonical = await contentReviews.loadTarget({
          schemaVersion: 1,
          target: aliasTarget,
        });
        const principal = await auth.authorize(
          authorization(
            "reviewer",
            "content.translation.review",
            canonical.context.locales,
          ),
        );
        equal(
          principal.outcome,
          "SUCCESS",
          "review authorization uses canonical scope",
        );
        return contentReviews.append(
          reviewCommand(
            canonical.context,
            "APPROVE",
            principal.principal.actorId,
          ),
        );
      },
    );
    equal(approvedAlias.outcome, "SUCCESS", "independent reviewer approved");
    equal(
      (await load(aliasTarget)).context.status,
      "APPROVED",
      "approval persisted",
    );
    const terminal = (await load(aliasTarget)).context;
    equal(
      (await append(reviewCommand(terminal, "APPROVE", fixtures.reviewer)))
        .code,
      "INVALID_REVIEW_STATE",
      "approval is terminal",
    );
    equal(
      (await append(reviewCommand(detailContext, "SUBMIT"))).outcome,
      "SUCCESS",
      "detail submitted",
    );
    const submittedDetail = (await load(detailTarget)).context;
    equal(
      (await append(reviewCommand(submittedDetail, "APPROVE"))).code,
      "SELF_REVIEW",
      "detail author cannot approve",
    );
    equal(
      (
        await append(
          reviewCommand(submittedDetail, "APPROVE", fixtures.reviewer),
        )
      ).outcome,
      "SUCCESS",
      "independent detail review approved",
    );
    equal(
      (await load(detailTarget)).context.status,
      "APPROVED",
      "detail approval persisted",
    );
    stage = "causal review timestamps survive a backward wall clock";
    for (const [index, micros] of [0, 456].entries()) {
      const revisionId = randomUUID();
      await client.query(
        "INSERT INTO idol_revisions(id,idol_id,revision,lifecycle,theme_accent,hero_text_tone,display_order,created_by) VALUES($1,$2,$3,'DRAFT','#D4AF37','light',0,$4)",
        [revisionId, catalog.idols[0].id, index + 3, fixtures.editor],
      );
      const future = (
        await client.query(
          `SELECT to_char((date_trunc('second',clock_timestamp())+interval '60 seconds 123 milliseconds'+$1*interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`,
          [micros],
        )
      ).rows[0].value;
      const command = adminAliasDraftFixture(fixtures, {
        idolRevisionId: revisionId,
      });
      const prepared = prepareIdolAliasDraft(command, future);
      equal(
        prepared.outcome,
        "SUCCESS",
        "future fixture stays within immutable draft contract",
      );
      await transaction(client, () =>
        persistIdolAliasDraft(client, command, prepared),
      );
      const target = { kind: "IDOL_ALIASES", revisionId };
      equal(
        (await append(reviewCommand((await load(target)).context, "SUBMIT")))
          .outcome,
        "SUCCESS",
        "submission retains DB editing-time lower bound after a backward clock",
      );
      equal(
        (
          await append(
            reviewCommand(
              (await load(target)).context,
              "APPROVE",
              fixtures.reviewer,
            ),
          )
        ).outcome,
        "SUCCESS",
        "same-millisecond independent approval remains valid after a backward clock",
      );
      const evidence = (
        await client.query(
          `SELECT s.edited_at<=(SELECT submitted_at FROM idol_revision_alias_reviews WHERE alias_set_id=s.id AND sequence=2) AS causal_submit,
        (SELECT reviewed_at FROM idol_revision_alias_reviews WHERE alias_set_id=s.id AND sequence=3)>=(SELECT submitted_at FROM idol_revision_alias_reviews WHERE alias_set_id=s.id AND sequence=2) AS causal_approve,
        (SELECT submitted_at FROM idol_revision_alias_reviews WHERE alias_set_id=s.id AND sequence=2)=date_trunc('milliseconds',s.edited_at)+$2*interval '1 millisecond' AS rounded,
        (SELECT count(*)::int FROM idol_revision_alias_reviews r JOIN audit_logs a ON a.id=r.audit_log_id WHERE r.alias_set_id=s.id AND r.sequence>1 AND a.created_at=COALESCE(r.submitted_at,r.reviewed_at)) AS audited
        FROM idol_revision_alias_sets s WHERE s.id=$1`,
          [command.id, micros === 0 ? 0 : 1],
        )
      ).rows[0];
      equal(
        evidence,
        {
          causal_submit: true,
          causal_approve: true,
          rounded: true,
          audited: 2,
        },
        "DB microseconds round upward and audit timestamp matches exact review event",
      );
    }
    const futureGiftRevision = randomUUID();
    await client.query(
      "INSERT INTO gift_revisions(id,gift_id,revision,lifecycle,category,delivery_minimum,delivery_maximum,delivery_unit,requires_safety_notice,shipping_mode,created_by) VALUES($1,$2,3,'DRAFT','OTHER',1,2,'DAY',false,'internal_to_idol',$3)",
      [futureGiftRevision, catalog.gifts[0].id, fixtures.editor],
    );
    const timeFixture = (
      await client.query(`SELECT to_char((date_trunc('second',clock_timestamp())+interval '60 seconds 123 milliseconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edited,
      to_char((date_trunc('second',clock_timestamp())+interval '61 seconds 123456 microseconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS submitted`)
    ).rows[0];
    const futureGift = adminGiftDetailDraftFixture(fixtures);
    futureGift.document.giftRevisionId = futureGiftRevision;
    const futureGiftSnapshot = prepareGiftDetailDraft(
      futureGift,
      timeFixture.edited,
    );
    equal(
      futureGiftSnapshot.outcome,
      "SUCCESS",
      "future detail fixture is valid",
    );
    await transaction(client, () =>
      persistGiftDetailDraft(
        client,
        futureGift,
        futureGiftSnapshot,
        timeFixture.edited,
      ),
    );
    const futureGiftTarget = {
      kind: "GIFT_DETAILS",
      revisionId: futureGiftRevision,
      locale: "en",
    };
    const futureGiftContext = (await load(futureGiftTarget)).context;
    await transaction(client, async () => {
      const id = randomUUID(),
        audit = randomUUID(),
        request = randomUUID();
      await client.query(
        "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at) VALUES($1,'ADMIN',$2,'GIFT_DETAIL_SUBMIT','GIFT_DETAIL_TRANSLATION_REVIEW',$3,'CAUSAL_TIME_FIXTURE',$4,$4,'SUCCEEDED',$5)",
        [audit, fixtures.editor, id, request, timeFixture.submitted],
      );
      await client.query(
        "INSERT INTO gift_detail_translation_reviews(id,gift_detail_translation_id,sequence,status,submitted_at,audit_log_id,created_at) VALUES($1,$2,2,'IN_REVIEW',$3,$4,$3)",
        [id, futureGiftContext.subjectId, timeFixture.submitted, audit],
      );
    });
    equal(
      (
        await append(
          reviewCommand(
            (await load(futureGiftTarget)).context,
            "APPROVE",
            fixtures.reviewer,
          ),
        )
      ).outcome,
      "SUCCESS",
      "approval uses previous DB review time even when it exceeds the editing time",
    );
    equal(
      (
        await client.query(
          `SELECT r.reviewed_at>=s.submitted_at AS causal,r.reviewed_at=date_trunc('milliseconds',s.submitted_at)+interval '1 millisecond' AS rounded,a.created_at=r.reviewed_at AS audited
      FROM gift_detail_translation_reviews r JOIN gift_detail_translation_reviews s ON s.gift_detail_translation_id=r.gift_detail_translation_id AND s.sequence=2
      JOIN audit_logs a ON a.id=r.audit_log_id WHERE r.gift_detail_translation_id=$1 AND r.sequence=3`,
          [futureGiftContext.subjectId],
        )
      ).rows[0],
      { causal: true, rounded: true, audited: true },
      "previous microsecond submission is preserved without altering audit history",
    );
    stage = "direct structural author guard";
    // Isolate the new trigger function from the older translator-self-review
    // trigger, without disabling or changing any production-table guard.
    await client.query(
      "CREATE TEMP TABLE structure_review_probe (LIKE public.gift_detail_translation_reviews INCLUDING DEFAULTS)",
    );
    await client.query(
      "CREATE TRIGGER structure_guard BEFORE INSERT ON structure_review_probe FOR EACH ROW EXECUTE FUNCTION public.guard_gift_detail_structure_review()",
    );
    const probe = (reviewer) =>
      client.query(
        `INSERT INTO structure_review_probe(id,gift_detail_translation_id,sequence,status,reviewer_id,reviewed_at,reviewed_content_hash,reviewed_source_hash,audit_log_id)
      VALUES($1,$2,3,'APPROVED',$3,clock_timestamp(),$4,$5,$6)`,
        [
          randomUUID(),
          detailContext.subjectId,
          reviewer,
          detailContext.contentHash,
          detailContext.sourceHash,
          randomUUID(),
        ],
      );
    await rejectSql(
      client,
      "structure author independently rejected by additive guard",
      () => probe(fixtures.editor),
    );
    await probe(fixtures.reviewer);
    equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM structure_review_probe",
        )
      ).rows[0].count,
      1,
      "independent actor passes structural guard while production retains all review guards",
    );
    equal(
      (await load({ ...detailTarget, revisionId: randomUUID() })).code,
      "NOT_FOUND",
      "unknown revision unavailable",
    );
    stage = "review optimistic concurrency";
    const competingTarget = { ...detailTarget, locale: "en" };
    const competing = (await load(competingTarget)).context;
    const race = await Promise.allSettled([
      append(reviewCommand(competing, "SUBMIT")),
      append(reviewCommand(competing, "SUBMIT")),
    ]);
    equal(
      race.filter(
        (result) =>
          result.status === "fulfilled" && result.value.outcome === "SUCCESS",
      ).length,
      1,
      "one concurrent expectedVersion wins",
    );
    equal(
      (await load(competingTarget)).context.sequence,
      2,
      "concurrency appends one review",
    );
    equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM audit_logs WHERE subject_type='GIFT_DETAIL_TRANSLATION_REVIEW' AND subject_id IN (SELECT id FROM gift_detail_translation_reviews WHERE gift_detail_translation_id=$1)",
          [competing.subjectId],
        )
      ).rows[0].count,
      1,
      "concurrency produces one audit",
    );
    stage = "preview grant repository";
    const previewTarget = {
      kind: "GIFT_DETAILS",
      revisionId: fixtures.giftRevisionId,
      locale: "ja",
    };
    const previewDigest = token();
    const issue = await run(
      async ({ authorization: auth, contentPreviews }) => {
        const principal = await auth.authorize(
          authorization("editor", "content.preview", ["ja"]),
        );
        return contentPreviews.issue({
          schemaVersion: 1,
          target: previewTarget,
          tokenDigest: previewDigest,
          actorId: principal.principal.actorId,
          sessionId: principal.principal.sessionId,
          ttlSeconds: 60,
          reasonCode: "PREVIEW_CREATED",
          requestId: randomUUID(),
        });
      },
    );
    equal(issue.outcome, "SUCCESS", "short lived preview issued");
    const readPreview = (overrides = {}) =>
      run(({ contentPreviews }) =>
        contentPreviews.read({
          schemaVersion: 1,
          target: previewTarget,
          tokenDigest: previewDigest,
          ...overrides,
        }),
      );
    stage = "preview read";
    const preview = await readPreview();
    equal(
      preview.outcome,
      "SUCCESS",
      "preview reads scoped unpublished content",
    );
    ok(
      !JSON.stringify(preview).includes(fixtures.editor),
      "preview excludes editor identity",
    );
    for (const target of [
      { ...previewTarget, locale: "en" },
      { ...previewTarget, revisionId: randomUUID() },
      { ...previewTarget, kind: "IDOL_ALIASES" },
    ])
      equal(
        (await readPreview({ target })).code,
        "PREVIEW_UNAVAILABLE",
        "wrong preview scope rejected",
      );
    equal(
      (await readPreview({ tokenDigest: token() })).code,
      "PREVIEW_UNAVAILABLE",
      "unknown preview token rejected",
    );
    await client.query(
      "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
      [fixtures.sessions.editor],
    );
    equal(
      (await readPreview()).code,
      "PREVIEW_UNAVAILABLE",
      "issuer session revocation invalidates preview",
    );
    await client.query(
      "UPDATE admin_sessions SET revoked_at=NULL WHERE id=$1",
      [fixtures.sessions.editor],
    );
    equal(
      (await readPreview()).outcome,
      "SUCCESS",
      "fixture session restore permits preview",
    );
    const editorGrant = {
      adminIdentityId: fixtures.editor,
      locale: "ja",
      actorId: fixtures.editor,
    };
    await revokeAdminContentLocaleGrant(client, editorGrant);
    equal(
      (await readPreview()).code,
      "PREVIEW_UNAVAILABLE",
      "issuer locale revocation invalidates preview",
    );
    await grantAdminContentLocale(client, editorGrant);
    equal(
      (
        await run(({ contentPreviews }) =>
          contentPreviews.revoke({
            schemaVersion: 1,
            grantId: issue.grantId,
            actorId: fixtures.reviewer,
            reasonCode: "PREVIEW_REVOKED",
            requestId: randomUUID(),
          }),
        )
      ).code,
      "NOT_FOUND",
      "another actor cannot revoke scoped grant",
    );
    equal(
      (
        await run(({ contentPreviews }) =>
          contentPreviews.revoke({
            schemaVersion: 1,
            grantId: issue.grantId,
            actorId: fixtures.editor,
            reasonCode: "PREVIEW_REVOKED",
            requestId: randomUUID(),
          }),
        )
      ).outcome,
      "SUCCESS",
      "issuer can revoke",
    );
    equal(
      (await readPreview()).code,
      "PREVIEW_UNAVAILABLE",
      "revoked token cannot read",
    );
    const stored = (
      await client.query("SELECT * FROM content_preview_grants WHERE id=$1", [
        issue.grantId,
      ])
    ).rows[0];
    equal(stored.token_digest.length, 32, "only digest is persisted");
    ok(stored.revoked_audit_log_id, "revocation bound to explicit audit");
    await rejectSql(client, "preview scope immutable", () =>
      client.query(
        "UPDATE content_preview_grants SET locale='en' WHERE id=$1",
        [issue.grantId],
      ),
    );
    await rejectSql(client, "preview cannot be unrevoked", () =>
      client.query(
        "UPDATE content_preview_grants SET revoked_at=NULL,revoked_audit_log_id=NULL WHERE id=$1",
        [issue.grantId],
      ),
    );
    await rejectSql(client, "preview cannot be deleted", () =>
      client.query("DELETE FROM content_preview_grants WHERE id=$1", [
        issue.grantId,
      ]),
    );
    await rejectSql(client, "preview cannot be truncated", () =>
      client.query("TRUNCATE content_preview_grants"),
    );
    await rejectSql(client, "locale scope cannot be retargeted", () =>
      client.query(
        "UPDATE admin_content_locale_grants SET locale='und' WHERE admin_identity_id=$1 AND locale='en'",
        [fixtures.editor],
      ),
    );
    await rejectSql(client, "locale grants cannot be truncated", () =>
      client.query("TRUNCATE admin_content_locale_grants"),
    );
    await rejectSql(client, "locale grant history cannot be deleted", () =>
      client.query("DELETE FROM admin_content_locale_grants WHERE id=$1", [
        savedGrant,
      ]),
    );
    await rejectSql(client, "locale revocation cannot be reversed", () =>
      client.query(
        "UPDATE admin_content_locale_grants SET revoked_at=NULL,revoked_audit_log_id=NULL WHERE id=$1",
        [savedGrant],
      ),
    );
    await rejectSql(client, "locale revocation requires its audit", () =>
      client.query(
        "UPDATE admin_content_locale_grants SET revoked_at=clock_timestamp() WHERE id=$1",
        [replacementGrant],
      ),
    );
    const insertPreview = async (overrides = {}) => {
      const { ttlMilliseconds = 60_000, ...fields } = overrides;
      const at = (
        await client.query(
          "SELECT date_trunc('milliseconds',transaction_timestamp()) AS now",
        )
      ).rows[0].now;
      const row = {
        id: randomUUID(),
        token_digest: Buffer.from(token(), "hex"),
        alias_set_id: null,
        gift_detail_document_id: detailCommand.document.id,
        locale: "ja",
        actor_id: fixtures.editor,
        session_id: fixtures.sessions.editor,
        audit_log_id: randomUUID(),
        created_at: at,
        expires_at: new Date(at.getTime() + ttlMilliseconds),
        ...fields,
      };
      const requestId = randomUUID();
      await client.query(
        `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)
        VALUES($1,'ADMIN',$2,'CONTENT_PREVIEW_ISSUE','CONTENT_PREVIEW_GRANT',$3,'FIXTURE_PREVIEW',$4,$4,'SUCCEEDED',$5)`,
        [row.audit_log_id, row.actor_id, row.id, requestId, row.created_at],
      );
      const columns = Object.keys(row);
      try {
        await client.query(
          `INSERT INTO content_preview_grants(${columns.join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")})`,
          Object.values(row),
        );
      } catch (error) {
        if (stage === "wall clock preview expiry")
          process.stderr.write(
            `${JSON.stringify({
              stage,
              sqlCode: error.code,
              constraint: error.constraint ?? null,
              createdAt: row.created_at.toISOString(),
              expiresAt: row.expires_at.toISOString(),
              issuanceClockGuard:
                error.message ===
                "preview grant requires its active MFA session and actor",
            })}\n`,
          );
        throw error;
      }
      return row;
    };
    for (const [label, overrides] of [
      [
        "preview digest must be exactly 256 bits",
        { token_digest: randomBytes(31) },
      ],
      [
        "preview TTL has a hard 900-second ceiling",
        { ttlMilliseconds: 901_000 },
      ],
      ["preview binds its issuer session", { actor_id: fixtures.reviewer }],
      [
        "preview cannot use non-MFA session",
        { session_id: fixtures.sessions.mfaOff },
      ],
      [
        "preview cannot use expired session",
        { session_id: fixtures.sessions.expired },
      ],
      ["preview cannot span two targets", { alias_set_id: aliasCommand.id }],
      ["preview must name a target", { gift_detail_document_id: null }],
      ["preview target must exist", { gift_detail_document_id: randomUUID() }],
      ["preview locale must be supported", { locale: "und" }],
    ])
      await rejectSql(client, label, () => insertPreview(overrides));
    stage = "wall clock preview expiry";
    const expiring = await transaction(client, () =>
      insertPreview({ ttlMilliseconds: 1_000 }),
    );
    equal(
      (
        await run(async ({ contentPreviews }) => {
          ok(
            (
              await client.query(
                "SELECT clock_timestamp()<expires_at AS before_expiry FROM content_preview_grants WHERE id=$1",
                [expiring.id],
              )
            ).rows[0].before_expiry,
            "preview transaction begins before the grant expires",
          );
          const waitStartedAt = performance.now();
          let expired = false;
          while (performance.now() - waitStartedAt < 5_000) {
            expired = (
              await client.query(
                "SELECT clock_timestamp()>=expires_at+interval '500 milliseconds' AS expired FROM content_preview_grants WHERE id=$1",
                [expiring.id],
              )
            ).rows[0].expired;
            if (expired) break;
            await delay(25);
          }
          assert.ok(
            expired,
            "database clock reaches preview expiry within the bounded wait",
          );
          return contentPreviews.read({
            schemaVersion: 1,
            target: previewTarget,
            tokenDigest: expiring.token_digest.toString("hex"),
          });
        })
      ).code,
      "PREVIEW_UNAVAILABLE",
      "transaction start does not extend a preview past expiry",
    );
    await rejectSql(client, "extension publication stays blocked", () =>
      client.query(
        "UPDATE gift_revisions SET lifecycle='VALIDATED' WHERE id=$1",
        [fixtures.giftRevisionId],
      ),
    );
    stage = "authorization grant concurrency";
    let release, authorized;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const began = new Promise((resolve) => {
      authorized = resolve;
    });
    const authorizedWork = run(async ({ authorization: auth }) => {
      const result = await auth.authorize(
        authorization("reviewer", "content.translation.review", ["ja"]),
      );
      equal(result.outcome, "SUCCESS", "permission locks acquired");
      authorized();
      await held;
      return result;
    });
    await began;
    const revoker = new Client(clientConfig);
    await revoker.connect();
    try {
      const backend = (await revoker.query("SELECT pg_backend_pid() AS id"))
        .rows[0].id;
      const revoke = revokeAdminContentLocaleGrant(revoker, reviewerGrant);
      let blocked = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        blocked = (
          await client.query(
            "SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",
            [backend],
          )
        ).rows[0]?.blocked;
        if (blocked) break;
        await delay(10);
      }
      ok(blocked, "revocation waits for authorized transaction");
      release();
      await authorizedWork;
      await revoke;
      equal(
        (await authorize("reviewer", "content.translation.review", ["ja"]))
          .code,
        "FORBIDDEN",
        "next transaction observes revoke",
      );
    } finally {
      release();
      await authorizedWork;
      await revoker.end();
    }
    stage = "authorization history rollback protection";
    let rejected = false;
    try {
      await migrate({ direction: "down", confirmVersion: "0014" });
    } catch {
      rejected = true;
    }
    ok(rejected, "authorization history prevents downgrade");
    equal(
      await historical(),
      oldSnapshot,
      "all historical content stayed unchanged",
    );
    process.stdout.write(`${JSON.stringify({ result: "PASS", assertions })}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ stage, check, assertions, failure: error?.name === "AssertionError" ? "ASSERTION" : error?.name === "PersistenceTransactionFailureError" ? "PERSISTENCE" : "OTHER", sqlCode: typeof error?.code === "string" && /^[0-9A-Z]{5}$/u.test(error.code) ? error.code : null })}\n`,
    );
    throw error;
  } finally {
    await persistence.close();
    await client.end();
  }
});
