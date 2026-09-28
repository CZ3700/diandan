#!/usr/bin/env node
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  createDefaultStorefrontTheme,
  createDefaultHomeLayout,
} from "@fan-support/contracts";
import {
  createStorefrontThemeUseCases,
  createHomeLayoutUseCases,
  createPublicHomeLayoutUseCases,
  createPublicStorefrontThemeUseCases,
  digestAdminContentToken,
} from "@fan-support/application";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
  withNativeTestPostgres,
} from "../dist/index.js";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let checks = 0,
  stage = "start";
const check = (value, label) => {
  stage = label;
  assert.ok(value, label);
  checks++;
};
const runtime = process.env.STOREFRONT_THEME_TEST_PG_BIN
  ? (work) =>
      withNativeTestPostgres(work, {
        binDirectory: process.env.STOREFRONT_THEME_TEST_PG_BIN,
      })
  : withEphemeralPostgres;
await runtime(async (config) => {
  const client = new Client(config);
  await client.connect();
  let persistence;
  try {
    const migrate = (command) =>
      runMigrations({ clientConfig: config, workspaceRoot, command });
    stage = "migrate prior schema";
    await migrate({ direction: "up", targetVersion: "0044" });
    check(
      (
        await client.query(
          "SELECT to_regclass('public.storefront_theme_heads') missing",
        )
      ).rows[0].missing === null,
      "pre-migration theme absent",
    );
    const actorId = randomUUID(),
      roleId = randomUUID(),
      sessionId = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      csrf = randomBytes(32).toString("base64url"),
      tokenPepper = randomBytes(32).toString("hex");
    await client.query(
      "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'theme-integration',$2,'ACTIVE')",
      [actorId, createHash("sha256").update(actorId).digest()],
    );
    await client.query(
      "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Theme integration')",
      [roleId, `theme:${roleId}`],
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
        "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Theme integration')",
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
    stage = "upgrade 44 to 45 with existing identity";
    await migrate({ direction: "up", targetVersion: "0045" });
    check(
      (
        await client.query(
          "SELECT count(*)::int n FROM admin_identities WHERE id=$1",
          [actorId],
        )
      ).rows[0].n === 1,
      "upgrade preserves prior identity",
    );
    await migrate({ direction: "down", confirmVersion: "0045" });
    check(
      (await client.query("SELECT max(version) v FROM schema_migrations"))
        .rows[0].v === "0044",
      "unused theme migration rolls back",
    );
    await migrate({ direction: "up", targetVersion: "0045" });
    const theme = createDefaultStorefrontTheme();
    const invalid = [
      null,
      {},
      { ...theme, palette: "RED" },
      { ...theme, typography: null },
      { ...theme, density: 1 },
      { ...theme, corners: "TINY" },
      { ...theme, schemaVersion: 2 },
      { ...theme, script: "alert(1)" },
    ];
    for (const bad of invalid)
      check(
        (
          await client.query("SELECT valid_storefront_theme($1::jsonb) valid", [
            JSON.stringify(bad),
          ])
        ).rows[0].valid === false,
        "SQL rejects invalid theme",
      );
    persistence = createPostgresPersistence(config);
    let app = createStorefrontThemeUseCases({
      transactions: persistence.storefrontThemeTransactionManager,
      tokenPepper,
    });
    let publicApp = createPublicStorefrontThemeUseCases({
      transactions: persistence.storefrontThemeTransactionManager,
    });
    const execute = (command, override = {}) =>
      app.execute({
        schemaVersion: 1,
        requestId: randomUUID(),
        sessionToken: token,
        csrfToken: csrf,
        command,
        ...override,
      });
    const command = (action, data = {}) => ({
      schemaVersion: 1,
      action,
      ...data,
    });
    const layoutApp = createHomeLayoutUseCases({
      transactions: persistence.homeLayoutTransactionManager,
      tokenPepper,
    });
    const publicLayout = createPublicHomeLayoutUseCases({
      transactions: persistence.homeLayoutTransactionManager,
    });
    const layoutRequest = (command) =>
      layoutApp.execute({
        schemaVersion: 1,
        requestId: randomUUID(),
        sessionToken: token,
        csrfToken: csrf,
        command,
      });
    const layoutSaved = await layoutRequest({
      schemaVersion: 1,
      action: "SAVE_DRAFT",
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      layout: createDefaultHomeLayout(),
    });
    const layoutPublished = await layoutRequest({
      schemaVersion: 1,
      action: "PUBLISH",
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      draftRevisionId: layoutSaved.state.draft.revisionId,
    });
    check(
      layoutPublished.outcome === "SUCCESS",
      "existing layout publishes independently",
    );
    const priorLayout = await publicLayout.execute();
    const saveCommand = command("SAVE_DRAFT", {
      expectedVersion: 0,
      theme: {
        ...theme,
        palette: "GRAPHITE_PEARL",
        typography: "LARGE",
        density: "AIRY",
        corners: "ROUND",
      },
      idempotencyKey: randomUUID(),
    });
    check(
      (await publicApp.execute()).source === "DEFAULT",
      "unconfigured public default",
    );
    check(
      (await execute(command("READ"))).state.version === 0,
      "initial editor state",
    );
    check(
      (
        await execute(command("READ"), {
          csrfToken: randomBytes(32).toString("base64url"),
        })
      ).code === "CSRF_INVALID",
      "invalid csrf denied",
    );
    const saved = await execute(saveCommand);
    check(
      saved.outcome === "SUCCESS" && saved.state.version === 1,
      "save without locale grants",
    );
    check(
      (await publicApp.execute()).source === "DEFAULT",
      "draft does not publish",
    );
    check(
      (await execute(saveCommand)).replayed === true,
      "idempotent save replay",
    );
    check(
      (await execute({ ...saveCommand, theme })).code ===
        "IDEMPOTENCY_CONFLICT",
      "different intent cannot reuse key",
    );
    check(
      (await execute({ ...saveCommand, idempotencyKey: randomUUID() })).code ===
        "STALE_VERSION",
      "stale save rejected",
    );
    const publishCommand = command("PUBLISH", {
      expectedVersion: 1,
      draftRevisionId: saved.state.draft.revisionId,
      idempotencyKey: randomUUID(),
    });
    await client.query(
      "DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2",
      [roleId, permissions["content.publish"]],
    );
    check(
      (await execute(publishCommand)).code === "FORBIDDEN",
      "editor cannot publish without grant",
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
      "publishes saved revision",
    );
    check(
      (await publicApp.execute()).publicationId ===
        published.state.published.publicationId,
      "public sees committed publication",
    );
    check(
      (await execute(publishCommand)).replayed,
      "publish replay adds no history",
    );
    const concurrent = await Promise.all(
      [1, 2].map(() =>
        execute(
          command("SAVE_DRAFT", {
            expectedVersion: 2,
            theme,
            idempotencyKey: randomUUID(),
          }),
        ),
      ),
    );
    check(
      concurrent.filter((row) => row.outcome === "SUCCESS").length === 1 &&
        concurrent.filter((row) => row.code === "STALE_VERSION").length === 1,
      "concurrent saves fence one winner",
    );
    const nextState = (await execute(command("READ"))).state;
    check(
      (
        await execute({
          ...publishCommand,
          expectedVersion: 3,
          idempotencyKey: randomUUID(),
        })
      ).code === "REVISION_NOT_DRAFT",
      "old draft cannot publish over new draft",
    );
    const failedPublishCommand = command("PUBLISH", {
      expectedVersion: 3,
      draftRevisionId: nextState.draft.revisionId,
      idempotencyKey: randomUUID(),
    });
    await client.query(
      "CREATE FUNCTION fail_theme_publication_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected theme failure'; END $$; CREATE TRIGGER fail_theme_publication_test BEFORE INSERT ON storefront_theme_publications FOR EACH ROW EXECUTE FUNCTION fail_theme_publication_test()",
    );
    check(
      (await execute(failedPublishCommand)).outcome === "FAILURE",
      "publication transaction failure reported",
    );
    check(
      (await execute(command("READ"))).state.version === 3 &&
        (await publicApp.execute()).version === 2,
      "failed publication preserves draft and published head",
    );
    await client.query(
      "DROP TRIGGER fail_theme_publication_test ON storefront_theme_publications; DROP FUNCTION fail_theme_publication_test()",
    );
    check(
      (await execute(failedPublishCommand)).state.version === 4,
      "retry after rollback publishes once",
    );
    const restored = await execute(
      command("RESTORE", {
        expectedVersion: 4,
        publicationId: published.state.published.publicationId,
        idempotencyKey: randomUUID(),
      }),
    );
    check(
      restored.state.version === 5 &&
        restored.state.published.revisionId !==
          published.state.published.revisionId &&
        restored.state.published.restoredFromPublicationId ===
          published.state.published.publicationId,
      "restore appends new revision and publication",
    );
    check(
      JSON.stringify(restored.state.published.theme) ===
        JSON.stringify(published.state.published.theme),
      "restore recovers exact theme",
    );
    check(
      JSON.stringify(await publicLayout.execute()) ===
        JSON.stringify(priorLayout),
      "theme restore preserves the independently published layout",
    );
    check(
      (await layoutRequest({ schemaVersion: 1, action: "READ" })).state
        .version === 2,
      "theme changes do not increment layout version",
    );
    const history = await execute(command("HISTORY", { page: 1, pageSize: 2 }));
    check(
      history.entries.length === 2 &&
        history.hasMore &&
        history.entries[0].version === 5,
      "history is paginated newest first",
    );
    check(
      (await execute(command("HISTORY", { page: 2, pageSize: 2 }))).entries
        .length === 1,
      "history includes originals without duplicate replay",
    );
    check(
      (
        await client.query(
          "SELECT count(*)::int n FROM audit_logs WHERE action LIKE 'STOREFRONT_THEME_%'",
        )
      ).rows[0].n === 5,
      "successful mutations audit atomically once",
    );
    check(
      (
        await client.query(
          "SELECT count(*)::int n FROM storefront_theme_receipts",
        )
      ).rows[0].n === 5,
      "receipt count matches committed mutations",
    );
    let immutable = false;
    try {
      await client.query("UPDATE storefront_theme_revisions SET theme=theme");
    } catch (error) {
      immutable = error.code === "55000";
    }
    check(immutable, "revision history immutable");
    let refused = false;
    try {
      await migrate({ direction: "down", confirmVersion: "0045" });
    } catch {
      refused = true;
    }
    check(refused, "downgrade refuses existing theme history");
    await persistence.close();
    persistence = createPostgresPersistence(config);
    app = createStorefrontThemeUseCases({
      transactions: persistence.storefrontThemeTransactionManager,
      tokenPepper,
    });
    publicApp = createPublicStorefrontThemeUseCases({
      transactions: persistence.storefrontThemeTransactionManager,
    });
    check(
      (await publicApp.execute()).version === 5,
      "new application process connection retains publication",
    );
    await client.query(
      "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
      [sessionId],
    );
    check(
      (await execute(command("HISTORY", { page: 1, pageSize: 2 }))).code ===
        "UNAUTHENTICATED",
      "history requires current nonrevoked session",
    );
    console.log(
      JSON.stringify({
        suite: "storefront-theme-postgres",
        checks,
        result: "PASS",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        suite: "storefront-theme-postgres",
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
