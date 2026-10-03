#!/usr/bin/env node
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  createDefaultHomeLayout,
  createDefaultStorefrontTheme,
  createDefaultStorefrontNavigation,
  storefrontNavigationSchema,
} from "@fan-support/contracts";
import {
  createHomeLayoutUseCases,
  createPublicHomeLayoutUseCases,
  createStorefrontThemeUseCases,
  createPublicStorefrontThemeUseCases,
  createStorefrontNavigationUseCases,
  createPublicStorefrontNavigationUseCases,
  digestAdminContentToken,
} from "@fan-support/application";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";
import { seedCommerceBaseline } from "./storefront-theme-presentation-cases.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let checks = 0;
let stage = "start";
const check = (condition, label) => {
  stage = label;
  assert.ok(condition, label);
  checks++;
};
const equal = (actual, expected, label) => {
  stage = label;
  assert.deepEqual(actual, expected, label);
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
  "homepage_publication_heads",
  "content_publications",
  "media_assets",
];
async function snapshot(client, tables) {
  const values = [];
  for (const table of tables)
    values.push({
      table,
      rows: (
        await client.query(
          `SELECT to_jsonb(t) value FROM public.${table} t ORDER BY to_jsonb(t)::text`,
        )
      ).rows,
    });
  return values;
}
const priorSettingsTables = [
  "homepage_layout_heads",
  "homepage_layout_revisions",
  "homepage_layout_publications",
  "homepage_layout_receipts",
  "storefront_theme_heads",
  "storefront_theme_revisions",
  "storefront_theme_publications",
  "storefront_theme_receipts",
];
const mutation = (action, expectedVersion, fields = {}) => ({
  schemaVersion: 1,
  expectedVersion,
  idempotencyKey: randomUUID(),
  action,
  ...fields,
});

await withEphemeralPostgres(async (config) => {
  const client = new Client(config);
  await client.connect();
  let persistence;
  try {
    const migrate = (command) =>
      runMigrations({ clientConfig: config, workspaceRoot, command });
    await migrate({ direction: "up", targetVersion: "0047" });
    const actorId = randomUUID(),
      roleId = randomUUID(),
      sessionId = randomUUID();
    const token = randomBytes(32).toString("base64url"),
      csrf = randomBytes(32).toString("base64url"),
      tokenPepper = randomBytes(32).toString("hex");
    await client.query(
      "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'navigation-integration',$2,'ACTIVE')",
      [actorId, createHash("sha256").update(actorId).digest()],
    );
    await client.query(
      "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Navigation integration')",
      [roleId, `navigation:${roleId}`],
    );
    await client.query(
      "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$1)",
      [actorId, roleId],
    );
    const permissions = {};
    for (const permission of [
      "content.read",
      "content.edit",
      "content.publish",
    ]) {
      const id = randomUUID();
      permissions[permission] = id;
      await client.query(
        "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Navigation integration')",
        [id, permission],
      );
      await client.query(
        "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
        [roleId, id, actorId],
      );
    }
    await client.query(
      "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour')",
      [
        sessionId,
        actorId,
        Buffer.from(
          digestAdminContentToken({
            tokenPepper,
            purpose: "admin-session",
            token,
          }),
          "hex",
        ),
        Buffer.from(
          digestAdminContentToken({
            tokenPepper,
            purpose: "admin-csrf",
            token: csrf,
          }),
          "hex",
        ),
      ],
    );
    persistence = createPostgresPersistence(config);
    const request = (app, command, override = {}) =>
      app.execute({
        schemaVersion: 1,
        requestId: randomUUID(),
        sessionToken: token,
        csrfToken: csrf,
        command,
        ...override,
      });
    const layoutApp = createHomeLayoutUseCases({
      transactions: persistence.homeLayoutTransactionManager,
      tokenPepper,
    });
    const themeApp = createStorefrontThemeUseCases({
      transactions: persistence.storefrontThemeTransactionManager,
      tokenPepper,
    });
    const publicLayout = createPublicHomeLayoutUseCases({
      transactions: persistence.homeLayoutTransactionManager,
    });
    const publicTheme = createPublicStorefrontThemeUseCases({
      transactions: persistence.storefrontThemeTransactionManager,
    });
    // Commit both legacy receipt shapes before 0048 exists, then replay those exact bytes after upgrading.
    const oldLayoutSave = mutation("SAVE_DRAFT", 0, {
      layout: createDefaultHomeLayout(),
    });
    const oldLayoutSaved = await request(layoutApp, oldLayoutSave);
    check(
      oldLayoutSaved.outcome === "SUCCESS",
      "old layout draft accepted before upgrade",
    );
    const oldLayoutPublish = mutation("PUBLISH", 1, {
      draftRevisionId: oldLayoutSaved.state.draft.revisionId,
    });
    const oldLayoutPublished = await request(layoutApp, oldLayoutPublish);
    const oldThemeSave = mutation("SAVE_DRAFT", 0, {
      theme: createDefaultStorefrontTheme(),
    });
    const oldThemeSaved = await request(themeApp, oldThemeSave);
    check(
      oldThemeSaved.outcome === "SUCCESS",
      "old five-field theme draft accepted before upgrade",
    );
    const oldThemePublish = mutation("PUBLISH", 1, {
      draftRevisionId: oldThemeSaved.state.draft.revisionId,
    });
    const oldThemePublished = await request(themeApp, oldThemePublish);
    const beforeSettings = await snapshot(client, priorSettingsTables);
    await seedCommerceBaseline(client, actorId);
    const businessBefore = await snapshot(client, protectedTables);
    check(
      businessBefore
        .filter(({ table }) =>
          ["gifts", "gift_variants", "prices", "inventory_balances"].includes(
            table,
          ),
        )
        .every(({ rows }) => rows.length > 0),
      "protected fixture has real audited gift, price and tracked stock",
    );
    check(
      (
        await client.query(
          "SELECT to_regclass('public.storefront_navigation_heads') missing",
        )
      ).rows[0].missing === null,
      "navigation absent on prior schema",
    );
    await migrate({ direction: "up", targetVersion: "0048" });
    equal(
      await snapshot(client, priorSettingsTables),
      beforeSettings,
      "upgrade preserves old layout/theme bytes and receipts",
    );
    equal(
      await snapshot(client, protectedTables),
      businessBefore,
      "upgrade preserves nonempty commerce and content",
    );
    await migrate({ direction: "down", confirmVersion: "0048" });
    check(
      (await client.query("SELECT max(version) v FROM schema_migrations"))
        .rows[0].v === "0047",
      "empty navigation downgrade succeeds with older histories present",
    );
    await migrate({ direction: "up", targetVersion: "0048" });
    for (const [app, oldCommand, oldResult] of [
      [layoutApp, oldLayoutSave, oldLayoutSaved],
      [layoutApp, oldLayoutPublish, oldLayoutPublished],
      [themeApp, oldThemeSave, oldThemeSaved],
      [themeApp, oldThemePublish, oldThemePublished],
    ]) {
      equal(
        await request(app, oldCommand),
        { ...oldResult, replayed: true },
        "legacy receipt replays unchanged across navigation migration",
      );
    }
    equal(
      await snapshot(client, priorSettingsTables),
      beforeSettings,
      "legacy replay creates no new settings state",
    );
    const priorLayout = await publicLayout.execute(),
      priorTheme = await publicTheme.execute();
    const navigation = createDefaultStorefrontNavigation();
    const configured = {
      ...navigation,
      header: [...navigation.header].reverse(),
      footer: [...navigation.footer]
        .reverse()
        .map((entry) => ({ ...entry, visible: entry.id !== "DESCRIPTION" })),
    };
    const permutations = (values) =>
      values.length === 0
        ? [[]]
        : values.flatMap((value, index) =>
            permutations(values.filter((_, i) => index !== i)).map((rest) => [
              value,
              ...rest,
            ]),
          );
    const validCases = [];
    for (const header of permutations(navigation.header))
      for (let mask = 0; mask < 16; mask++)
        validCases.push({
          ...navigation,
          header,
          footer: navigation.footer.map((row, index) => ({
            ...row,
            visible: row.id === "POLICIES" || Boolean(mask & (1 << index)),
          })),
        });
    const invalidCases = [
      null,
      {},
      [],
      { ...navigation, schemaVersion: 2 },
      { ...navigation, header: [] },
      { ...navigation, header: ["HOME", "HOME", "GIFTS"] },
      { ...navigation, header: ["HOME", "ARTISTS", "ORDER_LOOKUP"] },
      { ...navigation, header: ["HOME", "ARTISTS", null] },
      {
        ...navigation,
        header: ["HOME", "ARTISTS", { id: "GIFTS", visible: false }],
      },
      { ...navigation, footer: [] },
      {
        ...navigation,
        footer: navigation.footer.map((row, index) =>
          index === 0 ? navigation.footer[1] : row,
        ),
      },
      {
        ...navigation,
        footer: navigation.footer.map((row) =>
          row.id === "POLICIES" ? { ...row, visible: false } : row,
        ),
      },
      {
        ...navigation,
        footer: navigation.footer.map((row) => ({
          ...row,
          url: "https://example.invalid",
        })),
      },
      {
        ...navigation,
        footer: navigation.footer.map((row) => ({ ...row, visible: "true" })),
      },
      {
        ...navigation,
        footer: navigation.footer.map((row) =>
          row.id === "GIFTS" ? { ...row, id: "SCRIPT" } : row,
        ),
      },
      {
        ...navigation,
        footer: navigation.footer.map((row) =>
          row.id === "GIFTS" ? { ...row, visible: null } : row,
        ),
      },
      { ...navigation, script: "alert(1)" },
    ];
    for (const value of [...validCases, configured, ...invalidCases]) {
      const expected = storefrontNavigationSchema.safeParse(value).success;
      const actual = (
        await client.query(
          "SELECT valid_storefront_navigation($1::jsonb) valid",
          [JSON.stringify(value)],
        )
      ).rows[0].valid;
      equal(
        actual,
        expected,
        "SQL validator matches strict Zod on order, visibility and invalid fields",
      );
    }
    let app = createStorefrontNavigationUseCases({
      transactions: persistence.storefrontNavigationTransactionManager,
      tokenPepper,
    });
    let publicApp = createPublicStorefrontNavigationUseCases({
      transactions: persistence.storefrontNavigationTransactionManager,
    });
    const execute = (command, override) => request(app, command, override);
    equal(
      await publicApp.execute(),
      {
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_NAVIGATION",
        source: "DEFAULT",
        navigation,
        version: 0,
        publicationId: null,
      },
      "unconfigured default preserves current storefront",
    );
    check(
      (await execute({ schemaVersion: 1, action: "READ" })).state.version === 0,
      "editor begins with independent version zero",
    );
    check(
      (
        await execute(
          { schemaVersion: 1, action: "READ" },
          { csrfToken: randomBytes(32).toString("base64url") },
        )
      ).code === "CSRF_INVALID",
      "invalid csrf denied",
    );
    const saveCommand = mutation("SAVE_DRAFT", 0, { navigation: configured });
    const saved = await execute(saveCommand);
    check(
      saved.outcome === "SUCCESS" && saved.state.version === 1,
      "operator saves without translation grants",
    );
    check(
      (await publicApp.execute()).source === "DEFAULT",
      "draft is not public",
    );
    equal(
      await execute(saveCommand),
      { ...saved, replayed: true },
      "save replay is exact",
    );
    check(
      (await execute({ ...saveCommand, navigation })).code ===
        "IDEMPOTENCY_CONFLICT",
      "same key cannot describe a different navigation",
    );
    check(
      (await execute({ ...saveCommand, idempotencyKey: randomUUID() })).code ===
        "STALE_VERSION",
      "stale save rejected",
    );
    const publishCommand = mutation("PUBLISH", 1, {
      draftRevisionId: saved.state.draft.revisionId,
    });
    await client.query(
      "DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2",
      [roleId, permissions["content.publish"]],
    );
    check(
      (await execute(publishCommand)).code === "FORBIDDEN",
      "current permission required to publish",
    );
    await client.query(
      "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
      [roleId, permissions["content.publish"], actorId],
    );
    const published = await execute(publishCommand);
    check(
      published.outcome === "SUCCESS" &&
        published.state.version === 2 &&
        published.state.draft === null,
      "publish clears draft and advances version",
    );
    equal(
      (await publicApp.execute()).navigation,
      configured,
      "public reads exact committed navigation",
    );
    equal(
      await execute(publishCommand),
      { ...published, replayed: true },
      "publish replay does not append duplicate history",
    );
    const concurrent = await Promise.all(
      [1, 2].map(() => execute(mutation("SAVE_DRAFT", 2, { navigation }))),
    );
    check(
      concurrent.filter((row) => row.outcome === "SUCCESS").length === 1 &&
        concurrent.filter((row) => row.code === "STALE_VERSION").length === 1,
      "concurrent saves permit one winner",
    );
    const state = (await execute({ schemaVersion: 1, action: "READ" })).state;
    check(
      (
        await execute({
          ...publishCommand,
          expectedVersion: 3,
          idempotencyKey: randomUUID(),
        })
      ).code === "REVISION_NOT_DRAFT",
      "old revision cannot publish over current draft",
    );
    const retryPublish = mutation("PUBLISH", 3, {
      draftRevisionId: state.draft.revisionId,
    });
    await client.query(
      "CREATE FUNCTION fail_navigation_publication_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected navigation failure'; END $$; CREATE TRIGGER fail_navigation_publication_test BEFORE INSERT ON storefront_navigation_publications FOR EACH ROW EXECUTE FUNCTION fail_navigation_publication_test()",
    );
    check(
      (await execute(retryPublish)).outcome === "FAILURE",
      "injected failure is reported",
    );
    check(
      (await execute({ schemaVersion: 1, action: "READ" })).state.version ===
        3 && (await publicApp.execute()).version === 2,
      "failed publish preserves current draft and publication",
    );
    await client.query(
      "DROP TRIGGER fail_navigation_publication_test ON storefront_navigation_publications; DROP FUNCTION fail_navigation_publication_test()",
    );
    check(
      (await execute(retryPublish)).state.version === 4,
      "retry after rollback publishes once",
    );
    const restoreCommand = mutation("RESTORE", 4, {
      publicationId: published.state.published.publicationId,
    });
    const restored = await execute(restoreCommand);
    check(
      restored.state.version === 5 &&
        restored.state.published.revisionId !==
          published.state.published.revisionId &&
        restored.state.published.restoredFromPublicationId ===
          published.state.published.publicationId,
      "restore appends new revision and publication",
    );
    equal(
      restored.state.published.navigation,
      configured,
      "restore recovers exact configuration",
    );
    equal(
      await execute(restoreCommand),
      { ...restored, replayed: true },
      "restore receipt replay is exact",
    );
    equal(
      await publicLayout.execute(),
      priorLayout,
      "navigation restore preserves layout publication",
    );
    equal(
      await publicTheme.execute(),
      priorTheme,
      "navigation restore preserves theme publication",
    );
    equal(
      await snapshot(client, priorSettingsTables),
      beforeSettings,
      "navigation mutations never write prior settings histories",
    );
    equal(
      await snapshot(client, protectedTables),
      businessBefore,
      "navigation mutations preserve nonempty commerce/content/media",
    );
    const navBeforeOldRestores = await publicApp.execute();
    const layoutRestored = await request(
      layoutApp,
      mutation("RESTORE", 2, {
        publicationId: oldLayoutPublished.state.published.publicationId,
      }),
    );
    const themeRestored = await request(
      themeApp,
      mutation("RESTORE", 2, {
        publicationId: oldThemePublished.state.published.publicationId,
      }),
    );
    check(
      layoutRestored.outcome === "SUCCESS" &&
        themeRestored.outcome === "SUCCESS",
      "older independent settings remain restorable",
    );
    equal(
      await publicApp.execute(),
      navBeforeOldRestores,
      "layout and theme restore cannot overwrite navigation",
    );
    equal(
      await snapshot(client, protectedTables),
      businessBefore,
      "older setting restore cannot touch business data",
    );
    const history = await execute({
      schemaVersion: 1,
      action: "HISTORY",
      page: 1,
      pageSize: 2,
    });
    check(
      history.entries.length === 2 &&
        history.hasMore &&
        history.entries[0].version === 5,
      "history is newest first and paginated",
    );
    check(
      (
        await execute({
          schemaVersion: 1,
          action: "HISTORY",
          page: 2,
          pageSize: 2,
        })
      ).entries.length === 1,
      "history contains original publications without replay duplicates",
    );
    for (const table of ["revisions", "publications", "receipts"]) {
      let denied = false;
      try {
        await client.query(`UPDATE storefront_navigation_${table} SET id=id`);
      } catch (error) {
        denied = error.code === "55000";
      }
      check(denied, `${table} remains immutable`);
    }
    check(
      (
        await client.query(
          "SELECT count(*)::int n FROM storefront_navigation_receipts",
        )
      ).rows[0].n === 5,
      "one receipt per committed mutation",
    );
    check(
      (
        await client.query(
          "SELECT count(*)::int n FROM audit_logs WHERE subject_type='STOREFRONT_NAVIGATION'",
        )
      ).rows[0].n === 5,
      "one audit per committed mutation",
    );
    let refused = false;
    try {
      await migrate({ direction: "down", confirmVersion: "0048" });
    } catch {
      refused = true;
    }
    check(refused, "downgrade cannot discard populated navigation history");
    await persistence.close();
    persistence = createPostgresPersistence(config);
    app = createStorefrontNavigationUseCases({
      transactions: persistence.storefrontNavigationTransactionManager,
      tokenPepper,
    });
    publicApp = createPublicStorefrontNavigationUseCases({
      transactions: persistence.storefrontNavigationTransactionManager,
    });
    equal(
      await publicApp.execute(),
      navBeforeOldRestores,
      "new application connection retains exact published navigation",
    );
    equal(
      await execute(saveCommand),
      { ...saved, replayed: true },
      "old save receipt remains reproducible after later publications and restart",
    );
    await client.query(
      "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
      [sessionId],
    );
    check(
      (
        await execute({
          schemaVersion: 1,
          action: "HISTORY",
          page: 1,
          pageSize: 2,
        })
      ).code === "UNAUTHENTICATED",
      "revoked session cannot read history",
    );
    check(
      (await execute(restoreCommand)).code === "UNAUTHENTICATED",
      "replayed mutation cannot bypass revoked session",
    );
    console.log(
      JSON.stringify({
        suite: "storefront-navigation-postgres",
        checks,
        result: "PASS",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        suite: "storefront-navigation-postgres",
        stage,
        error: error?.code ?? error?.name ?? "UNKNOWN",
      }),
    );
    throw error;
  } finally {
    await persistence?.close();
    await client.end();
  }
});
