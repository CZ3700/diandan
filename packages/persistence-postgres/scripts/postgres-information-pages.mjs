#!/usr/bin/env node
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  SUPPORTED_LOCALES,
  informationPagePreviewDocumentSchema,
  informationPageStructureSchema,
  informationPageFieldsSchema,
  createDefaultStorefrontTheme,
  createDefaultStorefrontNavigation,
  createDefaultHomeLayout,
} from "@fan-support/contracts";
import {
  createInformationPageUseCases,
  createPublicInformationPageUseCases,
  createStorefrontThemeUseCases,
  createStorefrontNavigationUseCases,
  createHomeLayoutUseCases,
  digestAdminContentToken,
  createListReadyOutboxJobs,
} from "@fan-support/application";
import {
  createPostgresPersistence,
  createInformationPageRepository,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";
import { seedCommerceBaseline } from "./storefront-theme-presentation-cases.mjs";
import { informationPageHash } from "../dist/information-pages-data.js";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let checks = 0,
  stage = "start";
const equal = (a, b, label) => {
  stage = label;
  assert.deepEqual(a, b, label);
  checks++;
};
const ok = (condition, label) => {
  stage = label;
  assert.ok(condition, label);
  checks++;
};
const protectedTables = [
  "gifts",
  "gift_variants",
  "prices",
  "price_books",
  "price_book_publications",
  "price_book_publication_heads",
  "inventory_items",
  "inventory_balances",
  "inventory_ledger",
  "orders",
  "order_items",
  "homepage_layout_heads",
  "homepage_layout_revisions",
  "homepage_layout_publications",
  "homepage_layout_receipts",
  "storefront_theme_heads",
  "storefront_theme_revisions",
  "storefront_theme_publications",
  "storefront_theme_receipts",
  "storefront_navigation_heads",
  "storefront_navigation_revisions",
  "storefront_navigation_publications",
  "storefront_navigation_receipts",
  "policies",
  "policy_revisions",
  "policy_revision_translations",
];
async function snapshot(client) {
  const result = [];
  for (const table of protectedTables)
    result.push({
      table,
      rows: (
        await client.query(
          `SELECT to_jsonb(t) value FROM public.${table} t ORDER BY to_jsonb(t)::text`,
        )
      ).rows,
    });
  return result;
}
async function rejectSql(client, label, work) {
  stage = label;
  await client.query("BEGIN");
  let error;
  try {
    await work();
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } catch (e) {
    error = e;
  } finally {
    await client.query("ROLLBACK");
  }
  ok(!!error && ["23514", "23505", "55000"].includes(error.code), label);
}
const mutation = (action, pageKey, locale, state, extra = {}) => ({
  schemaVersion: 1,
  action,
  pageKey,
  locale,
  expectedVersion: state.version,
  idempotencyKey: randomUUID(),
  ...extra,
});
const field = (title, id) => ({
  title,
  summary: "Synthetic test text",
  sections: [
    {
      id,
      heading: "A question?",
      body: "Synthetic integration content, not operational information.",
    },
  ],
});
try {
  await withEphemeralPostgres(async (config) => {
    const client = new Client(config);
    await client.connect();
    let persistence;
    try {
      const migrate = (command) =>
        runMigrations({ clientConfig: config, workspaceRoot, command });
      stage = "upgrade 0048";
      await migrate({ direction: "up", targetVersion: "0048" });
      stage = "seed identities";
      const tokenPepper = randomBytes(32).toString("hex");
      const permissions = {};
      for (const name of [
        "content.read",
        "content.edit",
        "content.translation.review",
        "content.publish",
        "content.preview",
      ]) {
        permissions[name] = randomUUID();
        await client.query(
          "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Information fixture')",
          [permissions[name], name],
        );
      }
      const actors = [];
      for (let index = 0; index < 3; index++) {
        await client.query("BEGIN");
        const actor = {
          id: randomUUID(),
          role: randomUUID(),
          session: randomUUID(),
          token: randomBytes(32).toString("base64url"),
          csrf: randomBytes(32).toString("base64url"),
        };
        actors.push(actor);
        await client.query(
          "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'information-fixture',$2,'ACTIVE')",
          [actor.id, createHash("sha256").update(actor.id).digest()],
        );
        await client.query(
          "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Information fixture')",
          [actor.role, `information:${actor.role}`],
        );
        await client.query(
          "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$1)",
          [actor.id, actor.role],
        );
        for (const id of Object.values(permissions))
          await client.query(
            "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
            [actor.role, id, actor.id],
          );
        for (const locale of SUPPORTED_LOCALES) {
          const audit = randomUUID(),
            request = randomUUID();
          await client.query(
            "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$2,'FIXTURE_GRANT',$3,$3,'SUCCEEDED','CONTENT_TRANSLATION')",
            [audit, actor.id, request],
          );
          await client.query(
            "INSERT INTO admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id) VALUES($1,$2,$1,$3)",
            [actor.id, locale, audit],
          );
        }
        await client.query(
          "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour')",
          [
            actor.session,
            actor.id,
            Buffer.from(
              digestAdminContentToken({
                tokenPepper,
                purpose: "admin-session",
                token: actor.token,
              }),
              "hex",
            ),
            Buffer.from(
              digestAdminContentToken({
                tokenPepper,
                purpose: "admin-csrf",
                token: actor.csrf,
              }),
              "hex",
            ),
          ],
        );
        await client.query("COMMIT");
      }
      const [author, translator, reviewer] = actors;
      persistence = createPostgresPersistence(config);
      const request = (app, actor, command) =>
        app.execute({
          schemaVersion: 1,
          requestId: randomUUID(),
          sessionToken: actor.token,
          csrfToken: actor.csrf,
          command,
        });
      const legacy = [];
      for (const [factory, manager, key, value] of [
        [
          createHomeLayoutUseCases,
          persistence.homeLayoutTransactionManager,
          "layout",
          createDefaultHomeLayout(),
        ],
        [
          createStorefrontThemeUseCases,
          persistence.storefrontThemeTransactionManager,
          "theme",
          createDefaultStorefrontTheme(),
        ],
        [
          createStorefrontNavigationUseCases,
          persistence.storefrontNavigationTransactionManager,
          "navigation",
          createDefaultStorefrontNavigation(),
        ],
      ]) {
        const app = factory({ transactions: manager, tokenPepper });
        const command = {
          schemaVersion: 1,
          action: "SAVE_DRAFT",
          expectedVersion: 0,
          idempotencyKey: randomUUID(),
          [key]: value,
        };
        const result = await request(app, author, command);
        ok(
          result.outcome === "SUCCESS",
          "legacy settings draft succeeds before upgrade",
        );
        legacy.push({ app, command, result });
      }
      await seedCommerceBaseline(client, author.id);
      const before = await snapshot(client);
      ok(
        before
          .filter((x) =>
            ["gifts", "prices", "inventory_balances"].includes(x.table),
          )
          .every((x) => x.rows.length > 0),
        "protected gift price tracked stock are nonempty",
      );
      await migrate({ direction: "up", targetVersion: "0049" });
      equal(
        await snapshot(client),
        before,
        "migration preserves settings receipts and nonempty commerce",
      );
      await migrate({ direction: "down", confirmVersion: "0049" });
      await migrate({ direction: "up", targetVersion: "0049" });
      for (const old of legacy)
        equal(
          await request(old.app, author, old.command),
          { ...old.result, replayed: true },
          "old receipt exactly replays after upgrade",
        );
      const app = createInformationPageUseCases({
        transactions: persistence.informationPageTransactionManager,
        tokenPepper,
      });
      const publicApp = createPublicInformationPageUseCases({
        transactions: persistence.informationPageTransactionManager,
      });
      const read = async (pageKey, locale = "en", actor = author) => {
        const response = await request(app, actor, {
          schemaVersion: 1,
          action: "READ",
          pageKey,
          locale,
        });
        ok(response.outcome === "SUCCESS", "authorized information read");
        return response.workspace;
      };
      const execute = (actor, command) => request(app, actor, command);
      const successful = async (actor, command, label) => {
        const response = await execute(actor, command);
        stage = label;
        equal(response.outcome, "SUCCESS", label);
        return response.workspace;
      };
      const save = async (
        pageKey,
        locale,
        fields,
        structure = null,
        actor = locale === "en" ? author : translator,
      ) => {
        const current = await read(pageKey, locale, actor);
        const command = mutation("SAVE_DRAFT", pageKey, locale, current, {
          revisionId: current.draft?.revisionId ?? null,
          expectedSourceHash: current.draft?.sourceHash ?? null,
          structure,
          fields,
        });
        return successful(actor, command, `save ${pageKey} ${locale}`);
      };
      const reviewCommand = (action, pageKey, locale, state) =>
        mutation(action, pageKey, locale, state, {
          revisionId: state.draft.revisionId,
          expectedContentHash: state.selected.contentHash,
          expectedSourceHash: state.draft.sourceHash,
          expectedReviewSequence: state.selected.review.sequence,
        });
      const approve = async (pageKey, locale) => {
        const editor = locale === "en" ? author : translator;
        let state = await read(pageKey, locale, editor);
        state = await successful(
          editor,
          reviewCommand("SUBMIT_REVIEW", pageKey, locale, state),
          "editor submits current bound fields",
        );
        if (locale !== "en") {
          const denied = await read(pageKey, locale, author);
          equal(
            denied.capabilities.canApprove,
            false,
            "source author approval capability denied",
          );
          equal(
            (
              await execute(
                author,
                reviewCommand("APPROVE_REVIEW", pageKey, locale, denied),
              )
            ).code,
            "SELF_REVIEW",
            "source author may not approve translated content",
          );
        }
        equal(
          (
            await execute(
              editor,
              reviewCommand("APPROVE_REVIEW", pageKey, locale, state),
            )
          ).code,
          "SELF_REVIEW",
          "editor self approval rejected",
        );
        return successful(
          reviewer,
          reviewCommand("APPROVE_REVIEW", pageKey, locale, state),
          "independent reviewer approves exact fields",
        );
      };
      for (const pageKey of ["ABOUT", "FAQ", "SUPPORT"])
        equal(
          (await publicApp.execute({ schemaVersion: 1, pageKey, locale: "en" }))
            .code,
          "NOT_FOUND",
          "empty information page is not fabricated",
        );
      equal(
        (await publicApp.index({ schemaVersion: 1, locale: "en" })).entries,
        [],
        "empty public index has no synthetic entries",
      );
      const section = randomUUID();
      const structure = { sectionIds: [section], contactEmail: null };
      // Bounded SQL/Zod semantics are checked against literal Unicode text and strict fields.
      for (const title of [
        "hello",
        "&nbsp;",
        "<>",
        "🙂".repeat(60),
        "🙂".repeat(120),
        "🙂".repeat(121),
        "",
        "\u200b",
        "\t\n",
        "\u2060",
        "a\u0001b",
        "<p>hi</p>",
      ]) {
        const fields = field(title, section);
        equal(
          (
            await client.query(
              "SELECT valid_information_page_fields($1::jsonb,$2) valid",
              [JSON.stringify(fields), "ABOUT"],
            )
          ).rows[0].valid,
          informationPageFieldsSchema.safeParse(fields).success,
          `SQL and Zod agree on bounded literal text ${JSON.stringify(title)}`,
        );
      }
      for (const email of [
        null,
        "support@example.invalid",
        "o'name@example.invalid",
        ".bad@example.invalid",
        "two..dots@example.invalid",
        "a@bad-.invalid",
        "a+b@example.invalid",
        "bad\n@example.invalid",
      ]) {
        const s = { ...structure, contactEmail: email };
        for (const pageKey of ["ABOUT", "SUPPORT"])
          equal(
            (
              await client.query(
                "SELECT valid_information_page_structure($1::jsonb,$2) valid",
                [JSON.stringify(s), pageKey],
              )
            ).rows[0].valid,
            informationPageStructureSchema.safeParse(s).success &&
              (pageKey === "SUPPORT" || email === null),
            "SQL and Zod agree on support-only email",
          );
      }
      let state = await save(
        "ABOUT",
        "en",
        field("Original source", section),
        structure,
      );
      const originalDraft = state.draft;
      const firstSave = mutation("SAVE_DRAFT", "ABOUT", "en", state, {
        revisionId: state.draft.revisionId,
        expectedSourceHash: state.draft.sourceHash,
        structure,
        fields: field("Original source", section),
      });
      const saved = await execute(author, firstSave);
      equal(saved.outcome, "SUCCESS", "second source save");
      equal(
        await execute(author, firstSave),
        { ...saved, replayed: true },
        "permanent immutable save receipt replays",
      );
      equal(
        (
          await execute(author, {
            ...firstSave,
            fields: field("Different", section),
          })
        ).code,
        "IDEMPOTENCY_CONFLICT",
        "same key different document rejected",
      );
      equal(
        (await execute(author, { ...firstSave, idempotencyKey: randomUUID() }))
          .code,
        "STALE_VERSION",
        "old version rejected",
      );
      await rejectSql(
        client,
        "sealed historical revision rejects newly appended locale",
        () =>
          client.query(
            "INSERT INTO information_page_revision_translations(id,revision_id,locale,title,summary,sections,content_hash,translated_from_source_hash,editor_id,edited_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,clock_timestamp())",
            [
              randomUUID(),
              originalDraft.revisionId,
              "ja",
              "Late locale",
              "Synthetic test text",
              JSON.stringify(field("Late locale", section).sections),
              informationPageHash(field("Late locale", section)),
              originalDraft.sourceHash,
              translator.id,
            ],
          ),
      );
      await rejectSql(
        client,
        "head cannot advance without an atomic audited receipt",
        () =>
          client.query(
            "UPDATE information_page_heads SET version=version+1 WHERE page_key='ABOUT'",
          ),
      );
      state = await read("ABOUT");
      equal(
        (
          await execute(
            author,
            mutation("PUBLISH", "ABOUT", "en", state, {
              revisionId: state.draft.revisionId,
            }),
          )
        ).code,
        "INVALID_CONTENT",
        "partial locale publication rejected",
      );
      for (const locale of SUPPORTED_LOCALES) {
        if (locale !== "en")
          await save("ABOUT", locale, field(`${locale} original`, section));
        await approve("ABOUT", locale);
      }
      state = await read("ABOUT");
      ok(
        state.capabilities.canPublish,
        "seven independent current reviews enable publication",
      );
      const publish = mutation("PUBLISH", "ABOUT", "en", state, {
        revisionId: state.draft.revisionId,
      });
      const published = await execute(author, publish);
      equal(
        published.outcome,
        "SUCCESS",
        `whole page publication ${published.code ?? ""}`,
      );
      equal(
        await execute(author, publish),
        { ...published, replayed: true },
        "publication replay creates no extra proof",
      );
      const firstPublication = published.workspace.published.publicationId;
      const sourceState = published.workspace;
      for (const locale of SUPPORTED_LOCALES) {
        const result = await publicApp.execute({
          schemaVersion: 1,
          pageKey: "ABOUT",
          locale,
        });
        equal(result.outcome, "SUCCESS", "public approved locale readable");
        equal(
          result.availableLocales,
          [...SUPPORTED_LOCALES],
          "available locales derive from same proof",
        );
        equal(result.document.locale, locale, "no mixed locale document");
        ok(
          !JSON.stringify(result).includes("editorId") &&
            !JSON.stringify(result).includes("reviewerId"),
          "public DTO excludes internal approval evidence",
        );
      }
      equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM outbox_events WHERE event_type='INFORMATION_PAGE_PUBLICATION_CHANGED'",
          )
        ).rows[0].n,
        7,
        "one typed event per locale",
      );
      state = await save(
        "ABOUT",
        "en",
        field("Changed source", section),
        structure,
      );
      equal(
        state.cells.filter((c) => c.status === "STALE").length,
        6,
        "source change marks all other locales stale",
      );
      equal(
        (
          await publicApp.execute({
            schemaVersion: 1,
            pageKey: "ABOUT",
            locale: "en",
          })
        ).document.fields.title,
        "Original source",
        "draft keeps prior public snapshot",
      );
      await save("ABOUT", "ja", field("ja refreshed", section));
      const stale = await read("ABOUT", "vi");
      equal(
        stale.previousSource.title,
        "Original source",
        "later translated save retains actual old English source",
      );
      ok(
        stale.changedPaths.includes("title"),
        "old source differences remain visible",
      );
      equal(stale.preview, null, "stale document preview is denied");
      equal(
        stale.selected.fields.title,
        "vi original",
        "stale translator text is retained",
      );
      // Copy evidence must remain useful after a long history, without a depth cutoff.
      for (let i = 0; i < 130; i++)
        await save("ABOUT", "ja", field(`ja revision ${i}`, section));
      const long = await read("ABOUT", "vi");
      equal(
        long.selected.review.status,
        "APPROVED",
        "130 copies preserve real inherited review",
      );
      equal(
        long.selected.review.reviewerId,
        reviewer.id,
        "long history retains original independent reviewer",
      );
      state = await read("ABOUT");
      state = await successful(
        author,
        mutation("RESTORE", "ABOUT", "en", state, {
          publicationId: firstPublication,
        }),
        "restore historical whole page",
      );
      equal(
        state.draft.revisionId,
        sourceState.draft.revisionId,
        "restore selects complete original revision",
      );
      const unpublish = mutation("UNPUBLISH", "ABOUT", "en", state);
      const removed = await execute(author, unpublish);
      equal(removed.outcome, "SUCCESS", "unpublish is atomic audited action");
      equal(removed.workspace.published, null, "unpublish clears pointer only");
      equal(
        (
          await publicApp.execute({
            schemaVersion: 1,
            pageKey: "ABOUT",
            locale: "en",
          })
        ).code,
        "NOT_FOUND",
        "unpublished page is 404",
      );
      equal(
        (await publicApp.index({ schemaVersion: 1, locale: "en" })).entries,
        [],
        "unpublish removes public index entry",
      );
      equal(
        await execute(author, unpublish),
        { ...removed, replayed: true },
        "unpublish receipt replays",
      );
      state = await successful(
        author,
        mutation("RESTORE", "ABOUT", "en", removed.workspace, {
          publicationId: firstPublication,
        }),
        "restore after unpublish",
      );
      equal(
        (await publicApp.index({ schemaVersion: 1, locale: "en" })).entries[0]
          .publishedAt,
        state.published.publishedAt,
        "index carries current publication timestamp",
      );
      const history = await execute(author, {
        schemaVersion: 1,
        action: "HISTORY",
        pageKey: "ABOUT",
        locale: "en",
        page: 1,
        pageSize: 20,
      });
      equal(
        history.entries.length,
        4,
        "history includes publish restore unpublish restore",
      );
      await rejectSql(client, "immutable translated text", () =>
        client.query(
          "UPDATE information_page_revision_translations SET title='tampered' WHERE locale='en'",
        ),
      );
      await rejectSql(client, "cannot erase history", () =>
        client.query("DELETE FROM information_page_publications"),
      );
      await assert.rejects(
        migrate({ direction: "down", confirmVersion: "0049" }),
      );
      checks++;
      // A publication cannot commit with a missing locale event, even if every text review is valid.
      const beforeFault = await read("ABOUT");
      const retryRestore = mutation("RESTORE", "ABOUT", "en", beforeFault, {
        publicationId: firstPublication,
      });
      await client.query(
        "CREATE FUNCTION information_event_omit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='INFORMATION_PAGE_PUBLICATION_CHANGED' AND NEW.locale='pt' THEN RETURN NULL; END IF; RETURN NEW; END $$; CREATE TRIGGER information_event_omit_test BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION information_event_omit_test()",
      );
      equal(
        (await execute(author, retryRestore)).outcome,
        "FAILURE",
        "omitted locale event rolls publication back",
      );
      equal(
        await read("ABOUT"),
        beforeFault,
        "failed publication leaves head draft and public pointer unchanged",
      );
      await client.query(
        "DROP TRIGGER information_event_omit_test ON outbox_events; DROP FUNCTION information_event_omit_test()",
      );
      state = await successful(
        author,
        retryRestore,
        "same key can retry after atomic failure",
      );
      const blankFaq = await read("FAQ");
      equal(
        (
          await execute(
            author,
            mutation("RESTORE", "FAQ", "en", blankFaq, {
              publicationId: firstPublication,
            }),
          )
        ).code,
        "NOT_FOUND",
        "cross-page restore denied",
      );
      await client.query(
        "DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2",
        [author.role, permissions["content.preview"]],
      );
      const narrowed = await execute(author, firstSave);
      equal(
        narrowed.replayed,
        true,
        "currently authorized write receipt remains replayable",
      );
      equal(
        narrowed.workspace.preview,
        null,
        "revoked preview capability does not leak old preview",
      );
      await client.query(
        "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
        [author.role, permissions["content.preview"], author.id],
      );
      await client.query(
        "DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2",
        [author.role, permissions["content.publish"]],
      );
      equal(
        (await execute(author, publish)).code,
        "FORBIDDEN",
        "revoked publisher cannot replay publication",
      );
      await client.query(
        "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
        [author.role, permissions["content.publish"], author.id],
      );
      // Both remaining page types share the bounded authoring/review lifecycle, not policy enums.
      for (const pageKey of ["FAQ", "SUPPORT"]) {
        const sectionId = randomUUID();
        const pageStructure = {
          sectionIds: [sectionId],
          contactEmail:
            pageKey === "SUPPORT" ? "support@example.invalid" : null,
        };
        for (const locale of SUPPORTED_LOCALES) {
          await save(
            pageKey,
            locale,
            field(`${pageKey} ${locale}`, sectionId),
            locale === "en" ? pageStructure : null,
          );
          await approve(pageKey, locale);
        }
        const current = await read(pageKey);
        await successful(
          author,
          mutation("PUBLISH", pageKey, "en", current, {
            revisionId: current.draft.revisionId,
          }),
          `publish ${pageKey}`,
        );
        equal(
          (await publicApp.execute({ schemaVersion: 1, pageKey, locale: "th" }))
            .document.structure,
          pageStructure,
          "page-specific structure is preserved publicly",
        );
        if (pageKey === "SUPPORT") {
          await save(pageKey, "en", field(`${pageKey} en`, sectionId), {
            ...pageStructure,
            contactEmail: "changed@example.invalid",
          });
          const contactStale = await read(pageKey, "vi");
          ok(
            contactStale.changedPaths.includes("structure.contactEmail"),
            "contact-only source changes show structural difference",
          );
        }
      }
      equal(
        (await publicApp.index({ schemaVersion: 1, locale: "vi" })).entries
          .length,
        3,
        "all fixed page types appear only after publication",
      );
      const newEvent = (
        await client.query(
          "SELECT id,primary_subject_id FROM outbox_events WHERE event_type='INFORMATION_PAGE_PUBLICATION_CHANGED' LIMIT 1",
        )
      ).rows[0];
      await rejectSql(
        client,
        "wrong consumer cannot claim information effect",
        () =>
          client.query(
            "INSERT INTO outbox_effect_receipts(id,outbox_event_id,consumer_key,effect_key,subject_id) VALUES($1,$2,'content-publication','INFORMATION_PAGE_PUBLICATION_OBSERVED',$3)",
            [randomUUID(), newEvent.id, newEvent.primary_subject_id],
          ),
      );
      await rejectSql(
        client,
        "wrong publication subject cannot be acknowledged",
        () =>
          client.query(
            "INSERT INTO outbox_effect_receipts(id,outbox_event_id,consumer_key,effect_key,subject_id) VALUES($1,$2,'information-page-publication','INFORMATION_PAGE_PUBLICATION_OBSERVED',$3)",
            [randomUUID(), newEvent.id, randomUUID()],
          ),
      );
      await client.query(
        "INSERT INTO outbox_effect_receipts(id,outbox_event_id,consumer_key,effect_key,subject_id) VALUES($1,$2,'information-page-publication','INFORMATION_PAGE_PUBLICATION_OBSERVED',$3)",
        [randomUUID(), newEvent.id, newEvent.primary_subject_id],
      );
      await client.query(
        "INSERT INTO outbox_dispatch_attempts(id,outbox_event_id,consumer_key,attempt_number,outcome,started_at,finished_at) VALUES($1,$2,'information-page-publication',1,'SUCCEEDED',clock_timestamp(),clock_timestamp())",
        [randomUUID(), newEvent.id],
      );
      checks += 2;
      const listReady = createListReadyOutboxJobs({
        transactionManager: persistence.reliableEventTransactionManager,
      });
      const propagation = {
        schemaVersion: 1,
        requestId: randomUUID(),
        traceparent: `00-${"c".repeat(32)}-${"d".repeat(16)}-01`,
      };
      const jobs = await listReady({
        schemaVersion: 1,
        operation: "LIST_READY_OUTBOX_EVENTS",
        consumerKey: "information-page-publication",
        availableAtOrBefore: new Date().toISOString(),
        limit: 100,
        propagation,
      });
      equal(
        jobs.length,
        48,
        "new relay selects only information family events",
      );
      const oldJobs = await listReady({
        schemaVersion: 1,
        operation: "LIST_READY_OUTBOX_EVENTS",
        consumerKey: "content-publication",
        availableAtOrBefore: new Date().toISOString(),
        limit: 100,
        propagation,
      });
      ok(
        oldJobs.every(
          (j) => !jobs.some((n) => n.outboxEventId === j.outboxEventId),
        ),
        "legacy consumer excludes new information events",
      );
      const context =
        await persistence.reliableEventTransactionManager.runInReliableEventTransaction(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          (r) =>
            r.outboxDispatch.loadContext({
              schemaVersion: 1,
              operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
              outboxEventId: jobs[0].outboxEventId,
              consumerKey: "information-page-publication",
            }),
        );
      equal(
        context.value.event.eventType,
        "INFORMATION_PAGE_PUBLICATION_CHANGED",
        "new consumer decodes typed publication event",
      );
      equal(
        context.value.primarySubjectId,
        context.value.event.payload.informationPagePublicationId,
        "dispatch subject is exactly the proved publication",
      );
      await assert.rejects(
        persistence.reliableEventTransactionManager.runInReliableEventTransaction(
          { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
          (r) =>
            r.outboxDispatch.loadContext({
              schemaVersion: 1,
              operation: "LOAD_OUTBOX_DISPATCH_CONTEXT",
              outboxEventId: jobs[0].outboxEventId,
              consumerKey: "content-publication",
            }),
        ),
      );
      checks++;
      // Read-boundary fault injection simulates a damaged locale without bypassing immutable database guards.
      const faultReader = (damaged) =>
        createInformationPageRepository(
          {
            release() {},
            async query(sql, values) {
              const result = await client.query(sql, values);
              return sql.includes("information_page_effective_review")
                ? {
                    ...result,
                    rows: result.rows.map((row) =>
                      damaged.includes(row.locale)
                        ? { ...row, content_hash: "0".repeat(64) }
                        : row,
                    ),
                  }
                : result;
            },
          },
          { trackOperation: (work) => work(), markRollbackOnly() {} },
        );
      const fallback = await faultReader(["ja"]).readPublished({
        schemaVersion: 1,
        pageKey: "ABOUT",
        locale: "ja",
      });
      equal(
        fallback.resolvedLocale,
        "en",
        "damaged requested locale falls back as a whole English document",
      );
      equal(
        fallback.document.locale,
        "en",
        "fallback document never claims requested locale",
      );
      ok(
        !fallback.availableLocales.includes("ja"),
        "damaged locale is excluded from alternate provenance",
      );
      equal(
        (
          await faultReader(["ja"]).readIndex({
            schemaVersion: 1,
            locale: "ja",
          })
        ).entries.length,
        0,
        "index omits titles for damaged requested locale",
      );
      equal(
        (
          await faultReader(["ja", "en"]).readPublished({
            schemaVersion: 1,
            pageKey: "ABOUT",
            locale: "ja",
          })
        ).code,
        "CONTENT_UNAVAILABLE",
        "damaged requested and English locale fail closed",
      );
      equal(
        await snapshot(client),
        before,
        "all information lifecycle operations preserve settings and nonempty commerce byte-for-byte",
      );
      ok(
        informationPagePreviewDocumentSchema.safeParse(state.preview).success,
        "saved approved draft remains a strict preview DTO",
      );
      const source = await client.query(
        "SELECT source_hash,structure,page_key FROM information_page_revisions WHERE id=$1",
        [state.draft.revisionId],
      );
      equal(
        source.rows[0].source_hash,
        informationPageHash({
          pageKey: "ABOUT",
          structure,
          englishFields: field("Original source", section),
        }),
        "JavaScript and SQL canonical source identity match",
      );
      console.log(
        `Information pages PostgreSQL integration passed (${checks} assertions; three identities; normal triggers; nonempty price and tracked-stock protection).`,
      );
    } catch (error) {
      console.error(
        `Synthetic fixture failure ${stage}: ${error?.code ?? error?.name} ${error?.message}`,
      );
      throw error;
    } finally {
      if (persistence) await persistence.close();
      await client.end();
    }
  });
} catch (error) {
  console.error(
    `Information integration failed at ${stage}: ${error?.name ?? "Error"} (${error?.code ?? error?.message ?? "unknown"})`,
  );
  process.exitCode = 1;
}
