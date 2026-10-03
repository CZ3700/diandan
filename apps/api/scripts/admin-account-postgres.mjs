#!/usr/bin/env node
// L3-10 ⑦: the built-in account server command on a real PostgreSQL, checked through the same
// sign-in use cases the API runs.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createAdminLocalAccessUseCases } from "@fan-support/application";
import { adminStandardRolePermissions } from "@fan-support/contracts";
import {
  ensureStandardRoles,
  runAdminAccountCommand,
} from "./admin-account.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
let checks = 0,
  stage = "setup",
  inner;
const ok = (value, label) => {
  assert.ok(value, `${stage}: ${label}`);
  checks++;
};
const same = (actual, expected, label) => {
  assert.deepEqual(actual, expected, `${stage}: ${label}`);
  checks++;
};
try {
  await withEphemeralPostgres(async (database) => {
    await runMigrations({
      clientConfig: database,
      workspaceRoot,
      command: { direction: "up" },
    });
    const client = new Client(database);
    await client.connect();
    const persistence = createPostgresPersistence(database);
    try {
      const subjectPepper = randomBytes(32).toString("hex");
      const tokenPepper = randomBytes(32).toString("hex");
      const run = (command, options, password) =>
        runAdminAccountCommand({
          client,
          subjectPepper,
          command,
          options,
          readPassword: async () => {
            if (password === undefined) throw new Error("no password expected");
            return password;
          },
        });
      const useCases = createAdminLocalAccessUseCases({
        transactions: persistence.adminLocalAccessTransactionManager,
        keys: {
          encryptEnvelope: async () => ({}),
          decryptEnvelope: async () => ({}),
        },
        tokenPepper,
        subjectPepper,
        totpIssuer: "Studio Admin",
      });
      const login = (loginName, password) =>
        useCases.login({
          schemaVersion: 1,
          requestId: randomUUID(),
          locale: "en",
          loginName,
          password,
        });
      const count = async (sql, values = []) =>
        Number((await client.query(sql, values)).rows[0].n);

      stage = "first administrator";
      const ownerPassword = `owner ${randomBytes(9).toString("base64url")}`;
      await assert.rejects(
        run("create", { login: "studio.owner", name: "Owner" }, "short"),
        /Password rejected: TOO_SHORT/u,
      );
      checks++;
      await assert.rejects(
        run("create", { login: "x", name: "Owner" }, ownerPassword),
        /--login must be/u,
      );
      checks++;
      same(
        await run(
          "create",
          { login: "Studio.Owner", name: "Studio Owner" },
          ownerPassword,
        ),
        { created: "studio.owner", role: "studio:owner" },
        "owner created",
      );
      await assert.rejects(
        run("create", { login: "studio.owner", name: "Again" }, ownerPassword),
        /already in use/u,
      );
      checks++;
      const owner = await login("studio.owner", ownerPassword);
      same(
        owner.kind,
        "SESSION_CREATED",
        "the owner signs in through the API use cases",
      );
      same(
        await count(
          `SELECT count(*) AS n FROM admin_content_locale_grants g JOIN admin_local_accounts a ON a.admin_identity_id=g.admin_identity_id
          WHERE a.login_name='studio.owner' AND g.revoked_at IS NULL`,
        ),
        7,
        "seven content languages",
      );
      same(
        await count(
          `SELECT count(*) AS n FROM admin_order_message_locale_grants g JOIN admin_local_accounts a ON a.admin_identity_id=g.admin_identity_id
          WHERE a.login_name='studio.owner' AND g.revoked_at IS NULL`,
        ),
        7,
        "seven message languages",
      );
      const staffContext = await useCases.staff({
        schemaVersion: 1,
        requestId: randomUUID(),
        sessionToken: owner.sessionToken,
        csrfToken: owner.csrfToken,
        command: { action: "CONTEXT" },
      });
      same(staffContext.kind, "STAFF_CONTEXT", "the owner manages staff");

      stage = "standard roles";
      const permissionsOf = async (role) =>
        (
          await client.query(
            `SELECT p.permission_key FROM roles r JOIN role_permissions rp ON rp.role_id=r.id
            JOIN permissions p ON p.id=rp.permission_id WHERE r.role_key=$1 ORDER BY 1`,
            [role],
          )
        ).rows.map((row) => row.permission_key);
      const ownerPermissions = await permissionsOf("studio:owner");
      const operatorPermissions = await permissionsOf("studio:operator");
      ok(ownerPermissions.includes("staff.manage"), "owners manage staff");
      ok(ownerPermissions.includes("finance.manage"), "owners handle finance");
      for (const key of [
        "staff.manage",
        "finance.manage",
        "payments.configure",
        "exceptions.replay",
        "orders.manage",
      ])
        ok(
          !operatorPermissions.includes(key),
          `daily operations exclude ${key}`,
        );
      for (const key of [
        "content.publish",
        "gift.manage",
        "orders.fulfillment",
        "payments.read",
      ])
        ok(
          operatorPermissions.includes(key),
          `daily operations include ${key}`,
        );
      const before = await count("SELECT count(*) AS n FROM role_permissions");
      await client.query("BEGIN");
      await ensureStandardRoles(client);
      await client.query("COMMIT");
      same(
        await count("SELECT count(*) AS n FROM role_permissions"),
        before,
        "idempotent",
      );

      stage = "ADR-022 roles";
      const brokerPermissions = await permissionsOf("studio:broker");
      same(
        brokerPermissions,
        [...adminStandardRolePermissions("studio:broker")].sort(),
        "the broker role holds its own scope and the media pipeline only",
      );
      ok(
        brokerPermissions.includes("management.assigned") &&
          !brokerPermissions.includes("management.direct"),
        "a broker manages assigned artists, never all of them",
      );
      ok(
        ownerPermissions.includes("idols.assign") &&
          ownerPermissions.includes("idols.private") &&
          !ownerPermissions.includes("management.assigned"),
        "owners assign artists and are not themselves brokers",
      );
      ok(
        !operatorPermissions.includes("idols.assign") &&
          !operatorPermissions.includes("idols.private") &&
          !operatorPermissions.includes("management.assigned") &&
          operatorPermissions.includes("management.direct"),
        "daily operations manage every artist but neither assign nor read private notes",
      );
      // A database provisioned before ADR-022 has two roles and none of the new grants.
      await client.query(
        "DELETE FROM role_permissions rp USING roles r WHERE rp.role_id=r.id AND r.role_key='studio:broker'",
      );
      await client.query("DELETE FROM roles WHERE role_key='studio:broker'");
      await client.query(
        "DELETE FROM role_permissions rp USING permissions p WHERE rp.permission_id=p.id AND p.permission_key IN('idols.assign','idols.private','ledger.read')",
      );
      same(
        await run("sync-roles", {}),
        { synced: ["studio:owner", "studio:operator", "studio:broker"] },
        "sync-roles reports the standard roles",
      );
      same(
        [
          await permissionsOf("studio:owner"),
          await permissionsOf("studio:operator"),
          await permissionsOf("studio:broker"),
        ],
        [ownerPermissions, operatorPermissions, brokerPermissions],
        "sync-roles completes an older database without creating an account",
      );
      same(await run("sync-roles", {}), await run("sync-roles", {}), "again");
      same(
        await count("SELECT count(*) AS n FROM role_permissions"),
        before,
        "repeating sync-roles grants nothing twice",
      );
      same(
        await count(
          "SELECT count(*) AS n FROM audit_logs WHERE task_name='admin-account-cli' AND action='ADMIN_STANDARD_ROLES_SYNCED'",
        ),
        3,
        "each sync is audited as the server command",
      );
      await assert.rejects(
        run("create", {
          login: "some.body",
          name: "Some Body",
          role: "local:manager:fixture",
        }),
        /--role must be/u,
      );
      checks++;

      stage = "operator";
      const operatorPassword = `night ${randomBytes(9).toString("base64url")}`;
      same(
        await run(
          "create",
          {
            login: "night.shift",
            name: "Night shift",
            role: "studio:operator",
          },
          operatorPassword,
        ),
        { created: "night.shift", role: "studio:operator" },
        "operator created",
      );
      const operator = await login("night.shift", operatorPassword);
      same(
        (
          await useCases.staff({
            schemaVersion: 1,
            requestId: randomUUID(),
            sessionToken: operator.sessionToken,
            csrfToken: operator.csrfToken,
            command: { action: "CONTEXT" },
          })
        ).code,
        "FORBIDDEN",
        "operators do not manage staff",
      );

      stage = "emergency access";
      const account = (token) =>
        useCases.account({
          schemaVersion: 1,
          requestId: randomUUID(),
          sessionToken: token.sessionToken,
          csrfToken: token.csrfToken,
          command: { action: "READ" },
        });
      const replaced = `owner ${randomBytes(9).toString("base64url")}`;
      same(
        await run("reset-password", { login: "studio.owner" }, replaced),
        { "reset-password": "studio.owner", sessionsSignedOut: 1 },
        "reset signs the owner out",
      );
      same(
        (await account(owner)).code,
        "UNAUTHENTICATED",
        "the old session ended",
      );
      same(
        (await login("studio.owner", ownerPassword)).code,
        "INVALID_CREDENTIALS",
        "old password refused",
      );
      const owner2 = await login("studio.owner", replaced);
      same(
        owner2.kind,
        "SESSION_CREATED",
        "the new password works without another change",
      );
      const enc = () => `enc:v1:${randomBytes(48).toString("base64url")}`;
      await client.query(
        `UPDATE admin_local_accounts SET totp_ciphertext=$2,totp_encrypted_data_key=$3,totp_key_version='test-envelope',
          totp_enabled_at=clock_timestamp(),totp_last_step=1,version=version+1 WHERE login_name=$1`,
        ["studio.owner", enc(), enc()],
      );
      same(
        await run("clear-2fa", { login: "studio.owner" }),
        { "clear-2fa": "studio.owner", sessionsSignedOut: 1 },
        "clearing the second factor signs out",
      );
      same(
        await count(
          "SELECT count(*) AS n FROM admin_local_accounts WHERE login_name='studio.owner' AND totp_ciphertext IS NULL",
        ),
        1,
        "second factor cleared",
      );
      const operator2 = await login("night.shift", operatorPassword);
      same(
        await run("suspend", { login: "night.shift" }),
        { suspend: "night.shift", sessionsSignedOut: 2 },
        "suspension ends every session",
      );
      same(
        (await account(operator2)).code,
        "UNAUTHENTICATED",
        "their session ended",
      );
      same(
        (await login("night.shift", operatorPassword)).code,
        "INVALID_CREDENTIALS",
        "suspended cannot sign in",
      );
      same(
        await run("reactivate", { login: "night.shift" }),
        { reactivate: "night.shift", sessionsSignedOut: 0 },
        "reactivated",
      );
      same(
        (await login("night.shift", operatorPassword)).kind,
        "SESSION_CREATED",
        "signs in again",
      );
      await assert.rejects(
        run("suspend", { login: "nobody.here" }),
        /No built-in account/u,
      );
      checks++;

      stage = "as a process with the password on standard input";
      const url = new URL("postgresql://localhost");
      url.hostname = database.host;
      url.port = String(database.port);
      url.username = database.user;
      url.password = database.password;
      url.pathname = `/${database.database}`;
      const cli = (args, input) =>
        new Promise((resolve) => {
          const child = spawn(
            process.execPath,
            [
              fileURLToPath(new URL("./admin-account.mjs", import.meta.url)),
              ...args,
            ],
            {
              env: {
                ...process.env,
                FAN_SUPPORT_DATABASE_URL: url.toString(),
                FAN_SUPPORT_ADMIN_SUBJECT_PEPPER: subjectPepper,
              },
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          let out = "";
          child.stdout.on("data", (chunk) => (out += chunk));
          child.stderr.on("data", (chunk) => (out += chunk));
          child.on("close", (code) => resolve({ code, out }));
          child.stdin.end(input ?? "");
        });
      const cliPassword = `cli ${randomBytes(9).toString("base64url")}`;
      const created = await cli(
        [
          "create",
          "--login",
          "cli.user",
          "--name",
          "CLI user",
          "--role",
          "studio:operator",
          "--password-stdin",
        ],
        `${cliPassword}
`,
      );
      same(created.code, 0, "the command succeeds");
      ok(
        created.out.includes('"created": "cli.user"'),
        "it reports what it created",
      );
      ok(!created.out.includes(cliPassword), "the password is never echoed");
      same(
        (await login("cli.user", cliPassword)).kind,
        "SESSION_CREATED",
        "the piped password works",
      );
      const refused = await cli([
        "create",
        "--login",
        "cli.user2",
        "--name",
        "Two",
      ]);
      ok(
        refused.code !== 0 && /--password-stdin/u.test(refused.out),
        "no terminal and no --password-stdin is refused",
      );
      ok(
        (
          await cli([
            "reset-password",
            "--login",
            "cli.user",
            "--password",
            "x",
          ])
        ).code === 2,
        "a password flag does not exist",
      );

      stage = "broker";
      const brokerPassword = `mina ${randomBytes(9).toString("base64url")}`;
      same(
        await run(
          "create",
          { login: "mina.park", name: "Mina Park", role: "studio:broker" },
          brokerPassword,
        ),
        { created: "mina.park", role: "studio:broker" },
        "broker created by the server command",
      );
      const broker = await login("mina.park", brokerPassword);
      same(
        (
          await useCases.staff({
            schemaVersion: 1,
            requestId: randomUUID(),
            sessionToken: broker.sessionToken,
            csrfToken: broker.csrfToken,
            command: { action: "CONTEXT" },
          })
        ).code,
        "FORBIDDEN",
        "a broker signs in and does not manage staff",
      );

      stage = "a deleted account (L3-14)";
      // What the staff page leaves behind: the identity marked deleted and holding no role.
      await client.query(
        "DELETE FROM admin_identity_roles WHERE admin_identity_id=(SELECT admin_identity_id FROM admin_local_accounts WHERE login_name='mina.park')",
      );
      await client.query(
        "UPDATE admin_identities SET status='ARCHIVED' WHERE id=(SELECT admin_identity_id FROM admin_local_accounts WHERE login_name='mina.park')",
      );
      for (const command of ["reactivate", "suspend", "clear-2fa"]) {
        await assert.rejects(
          run(command, { login: "mina.park" }),
          /was deleted/u,
        );
        checks++;
      }
      await assert.rejects(
        run(
          "create",
          { login: "mina.park", name: "Mina Again" },
          brokerPassword,
        ),
        /already in use/u,
      );
      checks++;
      same(
        (await login("mina.park", brokerPassword)).code,
        "INVALID_CREDENTIALS",
        "a deleted account cannot sign in",
      );

      stage = "list and evidence";
      const list = await run("list", {});
      same(
        list.map((row) => [row.loginName, row.status, row.roles]),
        [
          ["studio.owner", "ACTIVE", ["studio:owner"]],
          ["night.shift", "ACTIVE", ["studio:operator"]],
          ["cli.user", "ACTIVE", ["studio:operator"]],
          ["mina.park", "DELETED", []],
        ],
        "accounts listed, the deleted one marked so",
      );
      ok(
        !JSON.stringify(list).includes("scrypt$"),
        "no password hash is listed",
      );
      same(
        await count(
          "SELECT count(*) AS n FROM audit_logs WHERE task_name='admin-account-cli' AND action LIKE 'ADMIN_LOCAL_%'",
        ),
        8,
        "each command audited as the server command",
      );
      same(
        await count(
          `SELECT count(*) AS n FROM admin_sessions s WHERE s.revoked_at IS NOT NULL AND NOT EXISTS(
            SELECT 1 FROM audit_logs a WHERE a.subject_id=s.id AND a.created_at=s.revoked_at)`,
        ),
        0,
        "every revocation has its audit",
      );
    } catch (error) {
      inner = error;
      throw error;
    } finally {
      await client.end();
      await persistence.close();
    }
  });
  console.log(JSON.stringify({ result: "PASS", checks }));
} catch (error) {
  console.error(
    JSON.stringify({
      result: "FAIL",
      stage,
      checks,
      message: String((inner ?? error)?.message),
    }),
  );
  process.exitCode = 1;
}
