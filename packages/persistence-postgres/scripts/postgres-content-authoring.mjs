#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";
import { createContentAuthoringRepository } from "../dist/content-authoring-repository.js";
import {
  seedContentAuthoringFixtures,
  seedContentAuthoringPolicySource,
} from "./postgres-content-authoring-fixtures.mjs";
import { adminAliasDraftFixture } from "./postgres-admin-content-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let assertions = 0,
  stage = "migration",
  check = "none";
const equal = (actual, expected, label) => {
  check = label;
  assert.deepEqual(actual, expected, label);
  assertions++;
};
const ok = (actual, label) => {
  check = label;
  assert.ok(actual, label);
  assertions++;
};
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
  let failure;
  try {
    await transaction(client, work);
  } catch (error) {
    failure = error;
  }
  ok(
    failure && ["23514", "23503", "23505", "55000"].includes(failure.code),
    label,
  );
}

await withEphemeralPostgres(
  async (clientConfig) => {
    const migrate = (command) =>
      runMigrations({ clientConfig, workspaceRoot, command });
    await migrate({
      direction: "up",
      targetVersion:
        process.env["AUTHORING_RED_BASELINE"] === "1" ? "0014" : "0015",
    });
    const client = new Client(clientConfig);
    await client.connect();
    const persistence = createPostgresPersistence(clientConfig);
    const run = (work) =>
      persistence.contentAuthoringTransactionManager.runInContentAuthoringTransaction(
        work,
      );
    const read = (target, revisionId) =>
      run(({ contentAuthoring }) =>
        contentAuthoring.read({
          schemaVersion: 1,
          action: "READ",
          target,
          revisionId,
        }),
      );
    const command = (target, expectedVersion, content) => ({
      schemaVersion: 1,
      action: "CREATE",
      target,
      expectedVersion,
      content,
      reasonCode: "AUTHORING_FIXTURE",
      idempotencyKey: randomUUID(),
    });
    let fixtures;
    const write = (value, actorId = fixtures.editor) =>
      run(({ contentAuthoring }) =>
        contentAuthoring.write({
          schemaVersion: 1,
          command: value,
          actorId,
          requestId: randomUUID(),
        }),
      );
    try {
      const tables = await client.query(
        "SELECT to_regclass('public.content_authoring_receipts') IS NOT NULL AS receipts,to_regclass('public.policy_translation_copy_evidence') IS NOT NULL AS policy",
      );
      equal(
        tables.rows[0],
        { receipts: true, policy: true },
        "0015 supplies receipt and exact copy provenance tables",
      );
      await migrate({ direction: "down", confirmVersion: "0015" });
      await migrate({ direction: "up", targetVersion: "0015" });
      stage = "normal-trigger fixtures";
      fixtures = await seedContentAuthoringFixtures(client);
      const originalHeads = (
        await client.query(
          "SELECT jsonb_agg(to_jsonb(h.*) ORDER BY id) AS heads FROM idol_publication_heads h",
        )
      ).rows[0].heads;
      const snapshots = {};
      for (const key of Object.keys(fixtures.targets)) {
        const loaded = await read(
          fixtures.targets[key],
          fixtures.approvedSourceRevisionIds[key],
        );
        equal(
          loaded.outcome,
          "SUCCESS",
          `${key} existing canonical source read`,
        );
        snapshots[key] = loaded.snapshot;
        equal(
          loaded.snapshot.translationAudits.map((row) => row.review.status),
          Array(7).fill("APPROVED"),
          `${key} real seven-language source approval`,
        );
      }
      // A legacy approved DRAFT's child write starts first but waits on the source
      // parent held by COPY. It must observe the committed seal after the wait.
      stage = "READ COMMITTED source child race";
      const concurrent = new Client(clientConfig);
      await concurrent.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT id FROM homepage_revisions WHERE id=$1 FOR UPDATE",
          [snapshots.homepage.revisionId],
        );
        await concurrent.query("BEGIN");
        const pid = (await concurrent.query("SELECT pg_backend_pid() AS pid"))
          .rows[0].pid;
        const attempt = concurrent
          .query(
            "UPDATE homepage_slot_translations SET label='Unauthorized concurrent label' WHERE homepage_translation_id=(SELECT id FROM homepage_revision_translations WHERE homepage_revision_id=$1 AND locale='en')",
            [snapshots.homepage.revisionId],
          )
          .then(
            () => ({ ok: true }),
            (error) => ({ ok: false, code: error.code }),
          );
        let waiting = false;
        for (let index = 0; index < 60 && !waiting; index++) {
          waiting =
            (
              await client.query(
                "SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",
                [pid],
              )
            ).rows[0]?.waiting ?? false;
          if (!waiting) await delay(10);
        }
        ok(
          waiting,
          "child edit blocks behind source parent before receipt exists",
        );
        const repository = createContentAuthoringRepository(client, {
          trackOperation: (work) => work(),
        });
        const value = {
          schemaVersion: 1,
          action: "COPY",
          target: fixtures.targets.homepage,
          expectedVersion: fixtures.headVersions.homepage,
          sourceRevisionId: snapshots.homepage.revisionId,
          expectedSourceHash: snapshots.homepage.contentHash,
          changes: { kind: "HOMEPAGE" },
          reasonCode: "AUTHORING_RACE",
          idempotencyKey: randomUUID(),
        };
        const result = await repository.write({
          schemaVersion: 1,
          command: value,
          actorId: fixtures.editor,
          requestId: randomUUID(),
        });
        equal(
          result.outcome,
          "SUCCESS",
          "copy writes complete source while child edit is blocked",
        );
        await client.query("COMMIT");
        equal(
          await attempt,
          { ok: false, code: "55000" },
          "waiting child edit sees the newly committed seal",
        );
        await concurrent.query("ROLLBACK");
        fixtures.headVersions.homepage++;
      } finally {
        await client.query("ROLLBACK");
        await concurrent.query("ROLLBACK");
        await concurrent.end();
      }
      stage = "copy unchanged approvals";
      const copied = {},
        created = {};
      for (const [key, target] of Object.entries(fixtures.targets)) {
        const source = snapshots[key];
        const result = await write({
          schemaVersion: 1,
          action: "COPY",
          target,
          expectedVersion: fixtures.headVersions[key],
          sourceRevisionId: source.revisionId,
          expectedSourceHash: source.contentHash,
          changes: { kind: target.kind },
          reasonCode: "AUTHORING_COPY",
          idempotencyKey: randomUUID(),
        });
        equal(result.outcome, "SUCCESS", `${key} immutable copy creation`);
        const loaded = await read(target, result.resultId);
        equal(loaded.outcome, "SUCCESS", `${key} copied revision readback`);
        copied[key] = loaded.snapshot;
        fixtures.headVersions[key]++;
        equal(
          loaded.snapshot.revisionNumber,
          fixtures.headVersions[key],
          `${key} exact next revision sequence`,
        );
        equal(
          loaded.snapshot.lifecycle,
          { status: "DRAFT" },
          `${key} copy does not publish`,
        );
        for (const audit of loaded.snapshot.translationAudits) {
          const old = source.translationAudits.find(
            (row) => row.locale === audit.locale,
          );
          equal(
            {
              editorId: audit.editorId,
              editedAt: audit.editedAt,
              review: audit.review,
            },
            {
              editorId: old.editorId,
              editedAt: old.editedAt,
              review: old.review,
            },
            `${key}/${audit.locale} retains exact historical approval`,
          );
          equal(
            audit.inheritedFrom,
            {
              revisionId: source.revisionId,
              translationId: old.id,
              reviewId: old.reviewId,
            },
            `${key}/${audit.locale} immediate source proof`,
          );
          ok(
            audit.id !== old.id,
            `${key}/${audit.locale} new translation identity`,
          );
        }
        const fresh = await write(
          command(target, fixtures.headVersions[key], fixtures.content[key]),
        );
        equal(fresh.outcome, "SUCCESS", `${key} full authoring create`);
        const freshRead = await read(target, fresh.resultId);
        created[key] = freshRead.snapshot;
        fixtures.headVersions[key]++;
        equal(
          created[key].translationAudits.map((row) => row.review.status),
          Array(7).fill("DRAFT"),
          `${key} new copy is initially unapproved`,
        );
        equal(
          created[key].translationAudits.map((row) => row.editorId),
          Array(7).fill(fixtures.editor),
          `${key} editor comes from canonical command actor`,
        );
      }
      equal(
        (
          await client.query(
            "SELECT jsonb_agg(to_jsonb(h.*) ORDER BY id) AS heads FROM idol_publication_heads h",
          )
        ).rows[0].heads,
        originalHeads,
        "authoring leaves published heads unchanged",
      );
      const uppercase = await read(
        { kind: "IDOL", idolId: fixtures.targets.idol.idolId.toUpperCase() },
        snapshots.idol.revisionId.toUpperCase(),
      );
      equal(
        uppercase.snapshot.contentHash,
        snapshots.idol.contentHash,
        "UUID casing cannot change the same source snapshot hash",
      );
      equal(
        created.idol.extensions.aliases.review.status,
        "DRAFT",
        "new alias set has independent draft review",
      );
      equal(
        created.gift.extensions.details.translations.map(
          (row) => row.review.status,
        ),
        Array(7).fill("DRAFT"),
        "new details have seven independent draft reviews",
      );
      await transaction(client, async () => {
        await client.query("SET LOCAL TIME ZONE 'Asia/Bangkok'");
        const repository = createContentAuthoringRepository(client, {
          trackOperation: (work) => work(),
        });
        const loaded = await repository.read({
          schemaVersion: 1,
          action: "READ",
          target: fixtures.targets.idol,
          revisionId: snapshots.idol.revisionId,
        });
        equal(
          loaded.snapshot.contentHash,
          snapshots.idol.contentHash,
          "session time zone does not change canonical snapshot hash",
        );
      });
      const createdPaths = (
        await client.query(
          "SELECT changed_paths FROM content_authoring_receipts WHERE gift_revision_id=$1",
          [created.gift.revisionId],
        )
      ).rows[0].changed_paths;
      ok(
        createdPaths.includes("structure.category") &&
          createdPaths.includes("translations.en.title") &&
          createdPaths.includes("details"),
        "creation audit retains safe field paths for base text and extensions",
      );
      equal(
        (
          await client.query(
            "SELECT changed_paths FROM content_authoring_receipts WHERE policy_revision_id=$1",
            [copied.policy.revisionId],
          )
        ).rows[0].changed_paths,
        [],
        "unchanged approved copy records no invented content change",
      );
      stage = "fixed future historical clock regression";
      const future = {
        created: "2036-01-01T00:00:00.123456Z",
        edited: "2036-01-01T00:01:00.123456Z",
        submitted: "2036-01-01T00:02:00.123456Z",
        reviewed: "2036-01-01T00:03:00.123456Z",
      };
      const futurePolicy = await transaction(client, () =>
        seedContentAuthoringPolicySource(client, {
          editor: fixtures.editor,
          reviewer: fixtures.reviewer,
          timeline: future,
        }),
      );
      const futureSource = (
        await read(futurePolicy.target, futurePolicy.revisionId)
      ).snapshot;
      const futureCopy = await write({
        schemaVersion: 1,
        action: "COPY",
        target: futurePolicy.target,
        expectedVersion: 1,
        sourceRevisionId: futurePolicy.revisionId,
        expectedSourceHash: futureSource.contentHash,
        changes: { kind: "POLICY" },
        reasonCode: "CLOCK_REGRESSION",
        idempotencyKey: randomUUID(),
      });
      equal(
        futureCopy.outcome,
        "SUCCESS",
        "copy respects fixed future historical approval despite earlier wall clock",
      );
      equal(
        (
          await client.query(
            "SELECT created_at >= $2::timestamptz AS causal,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS exact FROM policy_revisions WHERE id=$1",
            [futureCopy.resultId, future.reviewed],
          )
        ).rows[0],
        { causal: true, exact: future.reviewed },
        "causal event time keeps exact microsecond historical lower bound",
      );
      const futureRead = (await read(futurePolicy.target, futureCopy.resultId))
        .snapshot;
      equal(
        futureRead.translationAudits[0].review.reviewedAt,
        futureSource.translationAudits[0].review.reviewedAt,
        "future approval is inherited without invented later review time",
      );
      stage = "editing and stale English lineage";
      const source = copied.policy,
        english = source.content.translations.find(
          (row) => row.locale === "en",
        );
      const changed = await write({
        schemaVersion: 1,
        action: "COPY",
        target: fixtures.targets.policy,
        expectedVersion: fixtures.headVersions.policy,
        sourceRevisionId: source.revisionId,
        expectedSourceHash: source.contentHash,
        changes: {
          kind: "POLICY",
          translations: [
            {
              ...english,
              fields: {
                ...english.fields,
                title: "A changed English policy title",
              },
            },
          ],
        },
        reasonCode: "AUTHORING_EDIT",
        idempotencyKey: randomUUID(),
      });
      equal(
        changed.outcome,
        "SUCCESS",
        "English edits create another immutable revision",
      );
      fixtures.headVersions.policy++;
      const edited = (await read(fixtures.targets.policy, changed.resultId))
        .snapshot;
      const editedPaths = (
        await client.query(
          "SELECT changed_paths FROM content_authoring_receipts WHERE policy_revision_id=$1",
          [changed.resultId],
        )
      ).rows[0].changed_paths;
      ok(
        editedPaths.includes("translations.en.title") &&
          !editedPaths.includes("translations.en.body") &&
          !JSON.stringify(editedPaths).includes(
            "A changed English policy title",
          ),
        "copy audit stores only actual changed field paths and no content text",
      );
      equal(
        edited.translationAudits.map((row) => row.review.status),
        Array(7).fill("DRAFT"),
        "English edit resets all affected approvals",
      );
      const editedEnglish = edited.translationAudits.find(
        (row) => row.locale === "en",
      );
      for (const audit of edited.translationAudits.filter(
        (row) => row.locale !== "en",
      )) {
        ok(
          audit.translatedFromSourceHash !== editedEnglish.sourceHash,
          `${audit.locale} untouched translation remains stale`,
        );
        equal(
          audit.inheritedFrom,
          undefined,
          `${audit.locale} stale copy carries no approval proof`,
        );
      }
      stage = "extension copy authors and identifiers";
      for (const key of ["idol", "gift"]) {
        const source = created[key],
          target = fixtures.targets[key];
        const result = await write(
          {
            schemaVersion: 1,
            action: "COPY",
            target,
            expectedVersion: fixtures.headVersions[key],
            sourceRevisionId: source.revisionId,
            expectedSourceHash: source.contentHash,
            changes: { kind: target.kind },
            reasonCode: "AUTHORING_EXTENSION_COPY",
            idempotencyKey: randomUUID(),
          },
          fixtures.reviewer,
        );
        equal(
          result.outcome,
          "SUCCESS",
          `${key} copies all extensions atomically`,
        );
        fixtures.headVersions[key]++;
        const snapshot = (await read(target, result.resultId)).snapshot;
        if (key === "idol") {
          ok(
            snapshot.extensions.aliases.id !== source.extensions.aliases.id,
            "alias copy has new set identity",
          );
          equal(
            snapshot.extensions.aliases.editorId,
            fixtures.reviewer,
            "alias copy binds new author",
          );
          equal(
            snapshot.extensions.aliases.review.status,
            "DRAFT",
            "alias copy never inherits approval",
          );
          equal(
            snapshot.extensions.aliases.aliases,
            source.extensions.aliases.aliases,
            "alias copy preserves full names",
          );
        } else {
          ok(
            snapshot.extensions.details.document.id !==
              source.extensions.details.document.id,
            "details copy has new document identity",
          );
          equal(
            snapshot.extensions.details.translations.map((row) => row.editorId),
            Array(7).fill(fixtures.reviewer),
            "details copy binds every translation to new author",
          );
          equal(
            snapshot.extensions.details.translations.map(
              (row) => row.review.status,
            ),
            Array(7).fill("DRAFT"),
            "details copy resets every independent review",
          );
          equal(
            snapshot.extensions.details.translations.map(
              (row) => row.translatedFromSourceHash,
            ),
            source.extensions.details.translations.map(
              (row) => row.translatedFromSourceHash,
            ),
            "details copy preserves each legal source lineage exactly",
          );
        }
      }
      stage = "stale input and concurrency";
      const before = (
        await client.query(
          "SELECT count(*)::int AS count FROM content_authoring_receipts",
        )
      ).rows[0].count;
      equal(
        (await write(command(fixtures.targets.idol, 0, fixtures.content.idol)))
          .code,
        "STALE_VERSION",
        "stale owner revision rejected",
      );
      equal(
        (
          await write({
            schemaVersion: 1,
            action: "COPY",
            target: fixtures.targets.idol,
            expectedVersion: fixtures.headVersions.idol,
            sourceRevisionId: snapshots.idol.revisionId,
            expectedSourceHash: "f".repeat(64),
            changes: { kind: "IDOL" },
            reasonCode: "STALE_FIXTURE",
            idempotencyKey: randomUUID(),
          })
        ).code,
        "STALE_CONTENT",
        "stale full source snapshot rejected",
      );
      equal(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM content_authoring_receipts",
          )
        ).rows[0].count,
        before,
        "rejected commands do not leave receipts",
      );
      const concurrentCommand = command(
        fixtures.targets.media,
        fixtures.headVersions.media,
        fixtures.content.media,
      );
      const raced = await Promise.allSettled([
        write(concurrentCommand),
        write({ ...concurrentCommand, idempotencyKey: randomUUID() }),
      ]);
      equal(
        raced.filter(
          (row) =>
            row.status === "fulfilled" && row.value.outcome === "SUCCESS",
        ).length,
        1,
        "exactly one concurrent owner version succeeds",
      );
      equal(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM content_authoring_receipts",
          )
        ).rows[0].count,
        before + 1,
        "concurrent loser leaves no partial receipt",
      );
      stage = "fault injection atomic rollback";
      const counts = async () => {
        const tables = [
          "audit_logs",
          "content_authoring_receipts",
          "idol_revisions",
          "idol_revision_translations",
          "idol_translation_reviews",
          "idol_revision_alias_sets",
          "idol_revision_aliases",
          "idol_revision_alias_reviews",
          "gift_revisions",
          "gift_revision_translations",
          "gift_translation_reviews",
          "gift_variant_labels",
          "gift_detail_documents",
          "gift_detail_translations",
          "gift_detail_translation_reviews",
          "gift_translation_copy_evidence",
          "policy_revisions",
          "policy_revision_translations",
          "policy_translation_reviews",
          "policy_translation_copy_evidence",
        ];
        return (
          await client.query(
            `SELECT jsonb_object_agg(name,count) AS counts FROM (${tables.map((table) => `SELECT '${table}' AS name,count(*)::int AS count FROM ${table}`).join(" UNION ALL ")}) counted`,
          )
        ).rows[0].counts;
      };
      const atomicCommand = {
        ...command(
          fixtures.targets.gift,
          fixtures.headVersions.gift,
          fixtures.content.gift,
        ),
        reasonCode: "AUTHORING_ATOMICITY",
      };
      const originalCounts = await counts();
      await client.query(
        "CREATE FUNCTION authoring_fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason_code='AUTHORING_ATOMICITY' THEN RAISE EXCEPTION 'fixture authoring audit unavailable' USING ERRCODE='23514'; END IF; RETURN NEW; END $$",
      );
      await client.query(
        "CREATE TRIGGER authoring_fixture_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION authoring_fixture_audit_failure()",
      );
      let failedAudit;
      try {
        await write(atomicCommand);
      } catch (error) {
        failedAudit = error;
      }
      ok(failedAudit, "audit failure rejects the authoring transaction");
      equal(
        await counts(),
        originalCounts,
        "audit failure rolls back all base, translation, review, extension, and receipt rows",
      );
      await client.query(
        "DROP TRIGGER authoring_fixture_audit_failure ON audit_logs",
      );
      await client.query("DROP FUNCTION authoring_fixture_audit_failure()");
      equal(
        (await write(atomicCommand)).outcome,
        "SUCCESS",
        "same command succeeds after failed transaction without partial state",
      );
      fixtures.headVersions.gift++;
      const proofCommand = {
        schemaVersion: 1,
        action: "COPY",
        target: fixtures.targets.policy,
        expectedVersion: fixtures.headVersions.policy,
        sourceRevisionId: snapshots.policy.revisionId,
        expectedSourceHash: snapshots.policy.contentHash,
        changes: { kind: "POLICY" },
        reasonCode: "AUTHORING_PROOF_TEST",
        idempotencyKey: randomUUID(),
      };
      const proofCounts = await counts();
      await client.query(
        "CREATE FUNCTION authoring_fixture_wrong_proof() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.source_approval_review_id := (SELECT r.id FROM policy_translation_reviews r JOIN policy_revision_translations t ON t.id=r.policy_translation_id WHERE t.policy_revision_id=(SELECT policy_revision_id FROM policy_revision_translations WHERE id=NEW.source_translation_id) AND t.id<>NEW.source_translation_id AND r.status='APPROVED' LIMIT 1); RETURN NEW; END $$",
      );
      await client.query(
        "CREATE TRIGGER authoring_fixture_wrong_proof BEFORE INSERT ON policy_translation_copy_evidence FOR EACH ROW EXECUTE FUNCTION authoring_fixture_wrong_proof()",
      );
      let failedProof;
      try {
        await write(proofCommand);
      } catch (error) {
        failedProof = error;
      }
      ok(
        failedProof,
        "approval from another translation cannot authorize copied text",
      );
      equal(
        await counts(),
        proofCounts,
        "invalid exact source proof rolls back revision and audit at commit",
      );
      await client.query(
        "DROP TRIGGER authoring_fixture_wrong_proof ON policy_translation_copy_evidence",
      );
      await client.query("DROP FUNCTION authoring_fixture_wrong_proof()");
      const labelCounts = await counts();
      await client.query(
        "CREATE FUNCTION authoring_fixture_wrong_label() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.label := 'Injected altered label'; RETURN NEW; END $$",
      );
      await client.query(
        "CREATE TRIGGER authoring_fixture_wrong_label BEFORE INSERT ON gift_variant_labels FOR EACH ROW EXECUTE FUNCTION authoring_fixture_wrong_label()",
      );
      let failedLabel;
      try {
        await write({
          ...proofCommand,
          target: fixtures.targets.gift,
          expectedVersion: fixtures.headVersions.gift,
          sourceRevisionId: snapshots.gift.revisionId,
          expectedSourceHash: snapshots.gift.contentHash,
          changes: { kind: "GIFT" },
        });
      } catch (error) {
        failedLabel = error;
      }
      ok(
        failedLabel,
        "unchanged row hash cannot conceal changed copied child labels",
      );
      equal(
        await counts(),
        labelCounts,
        "tampered copied labels and all generated evidence roll back together",
      );
      await client.query(
        "DROP TRIGGER authoring_fixture_wrong_label ON gift_variant_labels",
      );
      await client.query("DROP FUNCTION authoring_fixture_wrong_label()");
      stage = "database payload seals";
      await rejectsSql(client, "cannot edit labels in a copied source", () =>
        client.query(
          "UPDATE homepage_slot_translations SET label='Changed source' WHERE homepage_translation_id=$1",
          [snapshots.homepage.translationAudits[0].id],
        ),
      );
      await rejectsSql(client, "cannot edit labels in an authored target", () =>
        client.query(
          "UPDATE gift_variant_labels SET label='Changed target' WHERE gift_translation_id=$1",
          [created.gift.translationAudits[0].id],
        ),
      );
      await rejectsSql(
        client,
        "cannot append media after authored receipt",
        () =>
          client.query(
            "INSERT INTO idol_revision_media SELECT $1,role,media_asset_id,media_metadata_revision_id,sort_order+20 FROM idol_revision_media WHERE idol_revision_id=$2 LIMIT 1",
            [copied.idol.revisionId, snapshots.idol.revisionId],
          ),
      );
      await rejectsSql(client, "cannot delete an authored draft revision", () =>
        client.query("DELETE FROM policy_revisions WHERE id=$1", [
          created.policy.revisionId,
        ]),
      );
      await rejectsSql(client, "copy proof is append only", () =>
        client.query(
          "DELETE FROM policy_translation_copy_evidence WHERE target_translation_id=$1",
          [copied.policy.translationAudits[0].id],
        ),
      );
      await rejectsSql(client, "receipt is append only", () =>
        client.query(
          "UPDATE content_authoring_receipts SET expected_version=0 WHERE policy_revision_id=$1",
          [copied.policy.revisionId],
        ),
      );
      const originalAlias =
        await persistence.adminContentTransactionManager.runInAdminContentTransaction(
          ({ contentDrafts }) =>
            contentDrafts.createIdolAliases(adminAliasDraftFixture(fixtures)),
        );
      equal(
        originalAlias.outcome,
        "SUCCESS",
        "3A legacy unreceipted draft still accepts first alias set",
      );
      let rejectedExtension;
      try {
        await persistence.adminContentTransactionManager.runInAdminContentTransaction(
          ({ contentDrafts }) =>
            contentDrafts.createIdolAliases(
              adminAliasDraftFixture(fixtures, {
                idolRevisionId: copied.idol.revisionId,
              }),
            ),
        );
      } catch (error) {
        rejectedExtension = error;
      }
      ok(
        rejectedExtension,
        "sealed copied parent rejects later first alias header",
      );
      stage = "rollback preserves authored history";
      let refused;
      try {
        await migrate({ direction: "down", confirmVersion: "0015" });
      } catch (error) {
        refused = error;
      }
      ok(refused, "0015 refuses downgrade after authoring history");
      equal(
        (
          await client.query(
            "SELECT to_regclass('content_authoring_receipts') IS NOT NULL AS exists",
          )
        ).rows[0].exists,
        true,
        "failed down retains evidence schema",
      );
      process.stdout.write(
        `${JSON.stringify({ result: "PASS", assertions, normalTriggers: true, kinds: 5, locales: 7, stage: "complete" })}\n`,
      );
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({ result: "FAIL", stage, check, sqlstate: typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : undefined })}\n`,
      );
      throw error;
    } finally {
      await persistence.close();
      await client.end();
    }
  },
  { databasePrefix: "fan_authoring" },
);
