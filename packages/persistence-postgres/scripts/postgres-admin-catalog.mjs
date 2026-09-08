#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createIdolDiscoveryPlan } from "@fan-support/catalog";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
} from "@fan-support/content";
import {
  runMigrations,
  withEphemeralPostgres,
  createPostgresPersistence,
  loadMigrationManifest,
} from "../dist/index.js";
import { runMigrationCommandOnSession } from "../dist/migrations/runner.js";
import { createAdminCatalogUseCases } from "../../application/dist/admin-catalog.js";
import { createTranslationTransferUseCases } from "../../application/dist/translation-transfer.js";
import { digestAdminContentToken } from "../../application/dist/admin-content-tokens.js";
import { seedPublicationRuntimeFixtures } from "./postgres-publication-runtime-fixtures.mjs";
import { approvePreflightBase } from "./postgres-publication-preflight-fixtures.mjs";
import { revokeAdminContentLocaleGrant } from "./postgres-admin-content-fixtures.mjs";
import { verifyAdminTranslationCases } from "./postgres-admin-translation-cases.mjs";
import {
  verifyAdminCatalogTransitionProof,
  verifyUnsealedExportProof,
  verifyPublicationHistoryOrder,
} from "./postgres-admin-catalog-proof-cases.mjs";
import { seedContentAuthoringPolicySource } from "./postgres-content-authoring-fixtures.mjs";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let assertions = 0,
  stage = "migration",
  label = "none";
function equal(actual, expected, message) {
  label = message;
  assert.deepEqual(actual, expected, message);
  assertions++;
}
function success(value, message) {
  equal(value.outcome, "SUCCESS", message);
  return value;
}
const pepper = randomBytes(32).toString("hex");
const actors = Object.fromEntries(
  ["editor", "reviewer", "denied"].map((name) => [
    name,
    {
      sessionToken: randomBytes(32).toString("base64url"),
      csrfToken: randomBytes(32).toString("base64url"),
    },
  ]),
);
const digests = (name) => ({
  sessionTokenDigest: digestAdminContentToken({
    tokenPepper: pepper,
    purpose: "admin-session",
    token: actors[name].sessionToken,
  }),
  csrfTokenDigest: digestAdminContentToken({
    tokenPepper: pepper,
    purpose: "admin-csrf",
    token: actors[name].csrfToken,
  }),
});
await withEphemeralPostgres(async (clientConfig) => {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0017" },
  });
  const client = new Client(clientConfig);
  await client.connect();
  const persistence = createPostgresPersistence(clientConfig, {
    catalogPublicMediaBaseUrl: "https://media.example.test",
  });
  try {
    const fixtures = await seedPublicationRuntimeFixtures(client, persistence, {
      sessions: Object.keys(actors).map((name) => ({
        name,
        actor: name,
        ...digests(name),
      })),
    });
    await client.query("BEGIN");
    const legacyExportSource = await seedContentAuthoringPolicySource(
      client,
      fixtures,
    );
    await client.query("COMMIT");
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up" },
    });
    const app = createAdminCatalogUseCases({
      transactions: persistence.adminCatalogTransactionManager,
      tokenPepper: pepper,
    });
    const execute = (command, actor = "editor") =>
      app.execute({
        schemaVersion: 1,
        requestId: randomUUID(),
        ...actors[actor],
        command: { schemaVersion: 1, ...command },
      });
    const mutation = (command) => ({
      ...command,
      idempotencyKey: `admin-catalog:${randomUUID()}`,
      reasonCode: "PG_ADMIN_CATALOG",
    });
    const deadline = performance.now() + 5000;
    while (true) {
      const check = await client.query(
        "SELECT bool_and(granted_at<=clock_timestamp()) AS effective FROM admin_content_locale_grants WHERE revoked_at IS NULL",
      );
      if (check.rows[0].effective) break;
      if (performance.now() > deadline)
        throw new Error("fixture grant time did not become effective");
      await delay(20);
    }
    stage = "direct SQL constraints";
    await assert.rejects(
      client.query(
        "INSERT INTO public.idols(id,handle,status) VALUES(gen_random_uuid(),'unaudited-artist','draft')",
      ),
      { code: "23514" },
    );
    assertions++;
    await assert.rejects(
      client.query(
        "UPDATE public.idols SET handle='unaudited-rename',version=version+1 WHERE id=$1",
        [fixtures.targets.idol.idolId],
      ),
      { code: "23514" },
    );
    assertions++;
    await assert.rejects(
      client.query(
        "UPDATE public.idols SET status='paused',accepting_gifts=false,version=version+1 WHERE id=$1",
        [fixtures.targets.idol.idolId],
      ),
      { code: "23514" },
    );
    assertions++;
    await assert.rejects(
      client.query("DELETE FROM public.idols WHERE id=$1", [
        fixtures.targets.idol.idolId,
      ]),
      { code: "55000" },
    );
    assertions++;
    stage = "identity transition proof";
    await verifyAdminCatalogTransitionProof({ client, fixtures, check: equal });
    stage = "unsealed legacy export";
    await verifyUnsealedExportProof({
      client,
      fixtures,
      source: legacyExportSource,
      check: equal,
    });
    const transfer = createTranslationTransferUseCases({
      transactions: persistence.translationTransferTransactionManager,
      tokenPepper: pepper,
    });
    equal(
      (
        await transfer.execute({
          schemaVersion: 1,
          requestId: randomUUID(),
          ...actors.editor,
          command: {
            schemaVersion: 1,
            action: "EXPORT",
            target: {
              owner: legacyExportSource.target,
              revisionId: legacyExportSource.revisionId,
            },
            locales: ["ja"],
            reasonCode: "UNSEALED_EXPORT_FIXTURE",
            idempotencyKey: randomUUID(),
          },
        })
      ).code,
      "CONFLICT",
      "mutable legacy DRAFT must be copied before an immutable export package is issued",
    );
    stage = "authorized discovery";
    await verifyPublicationHistoryOrder({ client, fixtures, check: equal });
    for (const kind of [
      "IDOL",
      "GIFT",
      "HOMEPAGE",
      "MEDIA_METADATA",
      "POLICY",
    ]) {
      const page = success(
        await execute({
          action: "LIST_OWNERS",
          kind,
          locale: "ja",
          page: 1,
          pageSize: 1,
        }),
        `${kind} management discovery`,
      );
      equal(page.items.length, 1, `${kind} bounded management page`);
      equal(page.items[0].locale, "ja", `${kind} requested locale only`);
      equal(
        /objectKey|rightsReference|external_subject_hash|sessionToken/.test(
          JSON.stringify(page),
        ),
        false,
        `${kind} safe owner summary`,
      );
      const last = success(
        await execute({
          action: "LIST_OWNERS",
          kind,
          locale: "ja",
          page: 1000,
          pageSize: 50,
        }),
        `${kind} bounded empty page`,
      );
      equal(
        last.items.length,
        0,
        `${kind} never silently replaces out-of-range page`,
      );
    }
    equal(
      (
        await execute(
          {
            action: "LIST_OWNERS",
            kind: "IDOL",
            locale: "ja",
            page: 1,
            pageSize: 10,
          },
          "denied",
        )
      ).code,
      "FORBIDDEN",
      "denied identity cannot discover drafts",
    );
    const existing = success(
      await execute({
        action: "READ_OWNER",
        target: fixtures.targets.idol,
        locale: "en",
      }),
      "known idol owner",
    ).owner;
    equal(
      existing.authoringVersion > existing.publicationHeadVersion,
      true,
      "authoring and publication head are separate counters",
    );
    for (const history of ["REVISIONS", "PUBLICATIONS", "IDENTITY"]) {
      const result = success(
        await execute({
          action: "READ_HISTORY",
          target: fixtures.targets.idol,
          history,
          page: 1,
          pageSize: 1,
        }),
        `${history} history`,
      );
      equal(result.items.length <= 1, true, `${history} strict page limit`);
    }
    stage = "identity create and immutable replay";
    const create = mutation({
      action: "CREATE_IDOL",
      handle: `fresh-${randomUUID()}`,
      expectedBaseVersion: 0,
    });
    const created = success(await execute(create), "new stable idol identity");
    equal(
      [
        created.baseVersion,
        created.authoringVersion,
        created.publicationHeadVersion,
      ],
      [1, 0, 0],
      "new identity uses independent zero heads",
    );
    equal(
      [
        created.status,
        created.acceptingGifts,
        created.draftRevisionId,
        created.publishedRevisionId,
      ],
      ["draft", false, null, null],
      "new identity cannot become public",
    );
    const replay = success(
      await execute(create),
      "same key replays immutable creation",
    );
    equal(
      replay,
      { ...created, replayed: true },
      "complete receipt replay is stable",
    );
    equal(
      (await execute({ ...create, handle: "changed-request" })).code,
      "IDEMPOTENCY_CONFLICT",
      "same key with another identity conflicts",
    );
    equal(
      (await execute({ ...create, idempotencyKey: `another:${randomUUID()}` }))
        .code,
      "ALREADY_EXISTS",
      "current handle remains reserved",
    );
    equal(
      (
        await execute(
          mutation({
            action: "SET_IDOL_STATUS",
            idolId: created.idolId,
            expectedBaseVersion: 1,
            status: "active",
            acceptingGifts: true,
          }),
        )
      ).code,
      "INVALID_CONTENT",
      "unpublished identity cannot activate",
    );
    equal(
      (
        await execute(
          mutation({
            action: "RENAME_IDOL",
            idolId: created.idolId,
            expectedBaseVersion: 999,
            newHandle: "wrong-version",
          }),
        )
      ).code,
      "STALE_VERSION",
      "base expected version is checked",
    );
    equal(
      (
        await execute(
          mutation({
            action: "RENAME_IDOL",
            idolId: created.idolId,
            expectedBaseVersion: 1,
            newHandle: "reviewer-forbidden",
          }),
          "reviewer",
        )
      ).code,
      "FORBIDDEN",
      "reviewer cannot manage identities",
    );
    const rename1 = success(
      await execute(
        mutation({
          action: "RENAME_IDOL",
          idolId: created.idolId,
          expectedBaseVersion: 1,
          newHandle: `renamed-${randomUUID()}`,
        }),
      ),
      "first rename",
    );
    const rename2 = success(
      await execute(
        mutation({
          action: "RENAME_IDOL",
          idolId: created.idolId,
          expectedBaseVersion: 2,
          newHandle: `renamed-again-${randomUUID()}`,
        }),
      ),
      "second rename",
    );
    equal(
      (
        await execute(
          mutation({
            action: "RENAME_IDOL",
            idolId: created.idolId,
            expectedBaseVersion: 3,
            newHandle: create.handle,
          }),
        )
      ).code,
      "ALREADY_EXISTS",
      "own historical handle cannot form a cycle",
    );
    equal(
      (
        await execute(
          mutation({
            action: "CREATE_IDOL",
            handle: rename1.handle,
            expectedBaseVersion: 0,
          }),
        )
      ).code,
      "ALREADY_EXISTS",
      "another owner cannot claim historical handle",
    );
    equal(
      (await app.resolveHandle({ schemaVersion: 1, handle: create.handle }))
        .code,
      "NOT_FOUND",
      "unpublished renamed identity remains private",
    );
    const history = success(
      await execute({
        action: "READ_HISTORY",
        target: { kind: "IDOL", idolId: created.idolId },
        history: "IDENTITY",
        page: 2,
        pageSize: 1,
      }),
      "identity history second page",
    );
    equal(history.totalItems, 3, "history retains creation and both renames");
    equal(
      history.items[0].newHandle,
      rename1.handle,
      "history uses stable base version order",
    );
    equal(
      success(await execute(create), "replay after rename"),
      { ...created, replayed: true },
      "replay does not substitute current base",
    );
    stage = "concurrency and audit rollback";
    const conflictHandle = `race-${randomUUID()}`;
    const raced = await Promise.all([
      execute(
        mutation({
          action: "CREATE_IDOL",
          handle: conflictHandle,
          expectedBaseVersion: 0,
        }),
      ),
      execute(
        mutation({
          action: "CREATE_IDOL",
          handle: conflictHandle,
          expectedBaseVersion: 0,
        }),
      ),
    ]);
    equal(
      raced.filter((row) => row.outcome === "SUCCESS").length,
      1,
      "concurrent handle creation has one winner",
    );
    equal(
      raced.some(
        (row) => row.code === "CONFLICT" || row.code === "ALREADY_EXISTS",
      ),
      true,
      "concurrent loser gets conflict rather than 503",
    );
    const fault = mutation({
      action: "RENAME_IDOL",
      idolId: created.idolId,
      expectedBaseVersion: 3,
      newHandle: `atomic-${randomUUID()}`,
    });
    const counts = async () =>
      (
        await client.query(
          "SELECT (SELECT count(*) FROM admin_idol_identity_receipts)::int receipts,(SELECT count(*) FROM slug_redirects)::int redirects,(SELECT count(*) FROM audit_logs)::int audits,(SELECT count(*) FROM idempotency_records)::int idempotency",
        )
      ).rows[0];
    const before = await counts();
    await client.query(
      "CREATE FUNCTION public.test_admin_catalog_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='RENAME_IDOL' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_admin_catalog_audit_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.test_admin_catalog_audit_failure()",
    );
    equal(
      (await execute(fault)).code,
      "CONTENT_UNAVAILABLE",
      "audit failure aborts mutation",
    );
    equal(
      await counts(),
      before,
      "failure preserves audit redirect receipt and idempotency counts",
    );
    await client.query(
      "DROP TRIGGER test_admin_catalog_audit_failure ON public.audit_logs; DROP FUNCTION public.test_admin_catalog_audit_failure()",
    );
    const recovered = success(
      await execute(fault),
      "same key succeeds after rollback",
    );
    equal(
      recovered.baseVersion,
      4,
      "failed rename did not advance base version",
    );
    stage = "existing authoring and publication coexist";
    const content = { ...fixtures.content.idol };
    delete content.aliases;
    const authored = success(
      await persistence.contentAuthoringTransactionManager.runInContentAuthoringTransaction(
        ({ contentAuthoring }) =>
          contentAuthoring.write({
            schemaVersion: 1,
            actorId: fixtures.editor,
            requestId: randomUUID(),
            command: {
              schemaVersion: 1,
              action: "CREATE",
              target: { kind: "IDOL", idolId: created.idolId },
              expectedVersion: 0,
              content,
              idempotencyKey: `author:${randomUUID()}`,
              reasonCode: "PG_ADMIN_AUTHORING",
            },
          }),
      ),
      "existing authoring creates first immutable revision",
    );
    const afterAuthor = success(
      await execute({
        action: "READ_OWNER",
        target: { kind: "IDOL", idolId: created.idolId },
        locale: "en",
      }),
      "owner discovers authored draft",
    ).owner;
    equal(
      [
        afterAuthor.baseVersion,
        afterAuthor.authoringVersion,
        afterAuthor.publicationHeadVersion,
      ],
      [5, 1, 0],
      "authoring advances base and revision but not publication head",
    );
    equal(
      afterAuthor.draftRevisionId,
      authored.resultId,
      "owner returns actual draft pointer",
    );
    await approvePreflightBase(
      persistence,
      fixtures,
      { kind: "IDOL", idolId: created.idolId },
      authored.resultId,
    );
    const publishTarget = {
      owner: { kind: "IDOL", idolId: created.idolId },
      revisionId: authored.resultId,
    };
    for (const action of ["VALIDATE", "PUBLISH"]) {
      const result =
        await persistence.publicationRuntimeTransactionManager.runInPublicationRuntimeTransaction(
          async ({ authorization, publicationRuntime }) => {
            const principal = success(
              await authorization.authorize({
                schemaVersion: 1,
                ...digests("editor"),
                permission: "content.publish",
                locales: SUPPORTED_LOCALES,
              }),
              "publication current authority",
            ).principal;
            const context = success(
              await publicationRuntime.load({
                schemaVersion: 1,
                action: "PUBLISH",
                target: publishTarget,
              }),
              "publication canonical load",
            ).context.preflight;
            const manifest = buildPublicationManifest(context);
            return publicationRuntime.write({
              schemaVersion: 1,
              requestId: randomUUID(),
              principal,
              command: {
                schemaVersion: 1,
                action,
                target: publishTarget,
                expectedVersion: context.headVersion,
                expectedContentHash: context.snapshot.contentHash,
                idempotencyKey: `pub:${randomUUID()}`,
                reasonCode: "PG_ADMIN_PUBLICATION",
              },
              manifest,
              manifestHash: computePublicationManifestHash(manifest),
            });
          },
        );
      success(result, `new idol ${action}`);
    }
    let current = success(
      await execute({
        action: "READ_OWNER",
        target: { kind: "IDOL", idolId: created.idolId },
        locale: "en",
      }),
      "published owner",
    ).owner;
    equal(
      [
        current.baseVersion,
        current.authoringVersion,
        current.publicationHeadVersion,
      ],
      [6, 1, 1],
      "publication changes base and publication head independently",
    );
    for (const oldHandle of [create.handle, rename1.handle, rename2.handle]) {
      const resolved = success(
        await app.resolveHandle({ schemaVersion: 1, handle: oldHandle }),
        "historical handle resolution",
      );
      equal(
        [resolved.idolId, resolved.currentHandle, resolved.redirectStatus],
        [created.idolId, recovered.handle, 301],
        "all old handles resolve directly to stable current owner",
      );
    }
    success(
      await execute(
        mutation({
          action: "SET_IDOL_STATUS",
          idolId: created.idolId,
          expectedBaseVersion: 6,
          status: "active",
          acceptingGifts: true,
        }),
      ),
      "current published idol may begin receiving gifts",
    );
    const paused = success(
      await execute(
        mutation({
          action: "SET_IDOL_STATUS",
          idolId: created.idolId,
          expectedBaseVersion: 7,
          status: "paused",
          acceptingGifts: false,
        }),
      ),
      "pause current receiving idol",
    );
    equal(
      [
        paused.authoringVersion,
        paused.publicationHeadVersion,
        paused.publishedRevisionId,
      ],
      [1, 1, authored.resultId],
      "pause preserves immutable content and publication head",
    );
    const catalog =
      await persistence.contentReadTransactionManager.runInContentReadTransaction(
        ({ catalogDirectory }) =>
          catalogDirectory.readIdols({
            schemaVersion: 1,
            plan: createIdolDiscoveryPlan({
              schemaVersion: 1,
              locale: "en",
              limit: 10,
              q: recovered.handle,
            }),
          }),
      );
    equal(
      catalog.outcome,
      "SUCCESS",
      "public directory remains queryable after pause",
    );
    equal(
      catalog.items.map((item) => [
        item.source.base.id,
        item.source.base.status,
        item.source.base.acceptingGifts,
      ]),
      [[created.idolId, "paused", false]],
      "public directory exposes the paused identity without accepting gifts",
    );
    stage = "current source rights before reactivation";
    const sourceAssetId = (
      await client.query(
        "SELECT media_asset_id FROM idol_revision_media WHERE idol_revision_id=$1 ORDER BY role LIMIT 1",
        [authored.resultId],
      )
    ).rows[0].media_asset_id;
    const setSourceRights = (rightsStatus, expectedVersion) =>
      persistence.resourceManagementTransactionManager.runInResourceManagementTransaction(
        async ({ authorization, resources }) => {
          const authority = success(
            await authorization.authorize({
              schemaVersion: 1,
              ...digests("editor"),
              permission: "content.media.rights",
            }),
            "rights fixture uses current resource authority",
          );
          return resources.setRights({
            schemaVersion: 1,
            assetId: sourceAssetId,
            expectedVersion,
            rightsStatus,
            evidenceReference: "evidence:catalog-reactivation",
            actorId: authority.principal.actorId,
            sessionId: authority.principal.sessionId,
            eventId: randomUUID(),
            requestId: randomUUID(),
            reasonCode: "CATALOG_RIGHTS_FIXTURE",
          });
        },
      );
    success(
      await setSourceRights("REJECTED", 0),
      "current source rights are withdrawn with an immutable event",
    );
    equal(
      (
        await execute(
          mutation({
            action: "SET_IDOL_STATUS",
            idolId: created.idolId,
            expectedBaseVersion: 8,
            status: "active",
            acceptingGifts: true,
          }),
        )
      ).code,
      "INVALID_CONTENT",
      "reactivation cannot reuse an old approved manifest after source rights withdrawal",
    );
    equal(
      Number(
        (
          await client.query("SELECT version FROM idols WHERE id=$1", [
            created.idolId,
          ])
        ).rows[0].version,
      ),
      8,
      "failed reactivation preserves the canonical base version",
    );
    success(
      await setSourceRights("APPROVED", 1),
      "rights restoration is a new audited event",
    );
    const resumed = success(
      await execute(
        mutation({
          action: "SET_IDOL_STATUS",
          idolId: created.idolId,
          expectedBaseVersion: 8,
          status: "active",
          acceptingGifts: true,
        }),
      ),
      "reactivation rechecks current published proof",
    );
    equal(resumed.baseVersion, 9, "reactivation only increments base");
    success(
      await execute(
        mutation({
          action: "SET_IDOL_STATUS",
          idolId: created.idolId,
          expectedBaseVersion: 9,
          status: "archived",
          acceptingGifts: false,
        }),
      ),
      "archive preserves historical identity",
    );
    equal(
      (await app.resolveHandle({ schemaVersion: 1, handle: create.handle }))
        .code,
      "NOT_FOUND",
      "archived identity no longer resolves publicly",
    );
    equal(
      (
        await execute(
          mutation({
            action: "SET_IDOL_STATUS",
            idolId: created.idolId,
            expectedBaseVersion: 10,
            status: "active",
            acceptingGifts: true,
          }),
        )
      ).code,
      "FORBIDDEN",
      "archived identity is retained and cannot reactivate",
    );
    await assert.rejects(
      client.query(
        "UPDATE admin_idol_identity_receipts SET new_handle='forged' WHERE id=$1",
        [created.resultId],
      ),
      { code: "55000" },
    );
    assertions++;
    stage = "translation workspace and transfer";
    await verifyAdminTranslationCases({
      client,
      persistence,
      fixtures,
      credentials: actors,
      tokenPepper: pepper,
      check: equal,
    });
    stage = "current authorization before replay";
    await revokeAdminContentLocaleGrant(client, {
      adminIdentityId: fixtures.editor,
      locale: "ja",
      actorId: fixtures.editor,
    });
    equal(
      (await execute(create)).code,
      "FORBIDDEN",
      "revoked locale prevents even old identity replay",
    );
    equal(
      (
        await execute({
          action: "READ_OWNER",
          target: { kind: "IDOL", idolId: created.idolId },
          locale: "en",
        })
      ).outcome,
      "SUCCESS",
      "another permitted language remains readable",
    );
    equal(
      (
        await execute({
          action: "READ_OWNER",
          target: { kind: "IDOL", idolId: created.idolId },
          locale: "ja",
        })
      ).code,
      "FORBIDDEN",
      "management labels respect locale scope",
    );
    stage = "history downgrade guard";
    const retainedHistory = async () =>
      (
        await client.query(`SELECT
      (SELECT max(version) FROM public.schema_migrations) AS version,
      (SELECT count(*)::integer FROM public.gift_revision_profiles) AS profiles,
      (SELECT count(*)::integer FROM public.gift_revisions WHERE profile_version=2) AS classified_revisions,
      (SELECT count(*)::integer FROM public.admin_idol_identity_receipts) AS identities,
      (SELECT count(*)::integer FROM public.translation_export_receipts) AS exports,
      (SELECT count(*)::integer FROM public.translation_import_receipts) AS imports,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY idol_id) FROM public.idol_publication_heads h) AS idol_heads,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY gift_id) FROM public.gift_publication_heads h) AS gift_heads,
      (SELECT jsonb_agg(jsonb_build_object('id',id,'version',version,'status',status,'draft',draft_revision_id,'published',published_revision_id) ORDER BY id) FROM public.gifts) AS gift_versions
    `)
      ).rows[0];
    const beforeDailyDown = await retainedHistory();
    equal(
      beforeDailyDown.version,
      "0022",
      "admin and translation operations ran at the current migration head",
    );
    const dailyDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0022" },
    });
    equal(
      [dailyDown.revertedVersions, dailyDown.currentVersion],
      [["0022"], "0021"],
      "daily management rolls back before the SEO and classification history probes",
    );
    const beforeSeoDown = await retainedHistory();
    equal(
      beforeSeoDown,
      { ...beforeDailyDown, version: "0021" },
      "daily management rollback preserves all admin, translation and publication history",
    );
    const seoDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0021" },
    });
    equal(
      [seoDown.revertedVersions, seoDown.currentVersion],
      [["0021"], "0020"],
      "SEO purge guard rolls back before the gift classification history probe",
    );
    const beforeDown = await retainedHistory();
    equal(
      beforeDown,
      { ...beforeSeoDown, version: "0020" },
      "SEO guard rollback preserves all admin, translation and publication history",
    );
    equal(
      beforeDown.profiles > 0 &&
        beforeDown.profiles === beforeDown.classified_revisions,
      true,
      "normal gift translation copies created mandatory classification history",
    );
    equal(
      beforeDown.identities > 0 &&
        beforeDown.exports > 0 &&
        beforeDown.imports > 0,
      true,
      "the downgrade probe retains real identity and translation exchange receipts",
    );
    const migrationManifest = await loadMigrationManifest({ workspaceRoot });
    const downSql = migrationManifest.find((row) => row.version === "0020").down
      .sql;
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
                    "gift classification and identity history cannot be downgraded"
                      ? "GIFT_PROFILE_HISTORY"
                      : "OTHER",
                };
              throw error;
            }
          },
        },
        migrationManifest,
        { direction: "down", confirmVersion: "0020" },
      );
    } catch (error) {
      rejection = error;
    }
    equal(
      observed,
      { code: "55000", guard: "GIFT_PROFILE_HISTORY" },
      "current down SQL rejects actual gift classification history rather than a wrong version",
    );
    equal(
      rejection?.message,
      "migration 0020 down failed",
      "runner identifies the exact protected migration",
    );
    equal(
      await retainedHistory(),
      beforeDown,
      "rejected downgrade preserves migration head and identity, profile, import, export and publication history",
    );
    process.stdout.write(
      `admin catalog PostgreSQL checks: ${assertions} assertions PASS\n`,
    );
  } finally {
    await persistence.close();
    await client.end();
  }
}).catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ stage, label, assertions, code: error.code ?? error.failure?.error?.code ?? "ASSERTION" })}\n`,
  );
  process.exitCode = 1;
});
