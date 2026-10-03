#!/usr/bin/env node
// L3-10 ③: built-in admin accounts through the production API composition over HTTP, with a real
// PostgreSQL, real scrypt/TOTP and the envelope KMS adapter the remote TEST instance uses.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { decodeBase32, totpCode } from "@fan-support/application";
import { createStructuredLogger } from "@fan-support/observability";
import { createApiApplication } from "../dist/bootstrap.js";
import { createProductionAdminComposition } from "../dist/production-admin-composition.js";
import { resolveAdminApiRuntimeConfig } from "../dist/admin-runtime-config.js";
import { createLocalExperienceKms } from "./local-experience-kms.mjs";
import {
  localAccountComposition,
  provisionFirstAdministrator,
} from "./admin-local-fixtures.mjs";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.join(
  workspaceRoot,
  "output/checks/l3-10",
  `http-${new Date().toISOString().replaceAll(":", "-")}`,
);
await mkdir(output, { recursive: true });
const adminOrigin = "https://admin.example.test";
const checks = [];
let stage = "initialization";
function check(value, label) {
  checks.push({ stage, label, passed: Boolean(value) });
  assert.ok(value, `${stage}: ${label}`);
}
function same(actual, expected, label) {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ stage, label, passed });
  assert.deepEqual(actual, expected, `${stage}: ${label}`);
}
// Everything secret is registered, then searched for in logs, the report and stored rows.
const secrets = new Set();
const secret = (value) => {
  secrets.add(value);
  return value;
};
const logs = [];
let innerError;
const TOTP_PERIOD_MS = 30_000;
const currentStep = () => Math.floor(Date.now() / TOTP_PERIOD_MS);
/** A code newer than the last accepted step and inside the ±1 window, waiting if the clock is behind. */
async function freshCode(key, lastStep) {
  for (;;) {
    const now = currentStep();
    const target = Math.max(lastStep + 1, now - 1);
    if (target <= now + 1) return { code: totpCode(key, target), step: target };
    await delay(
      Math.min(TOTP_PERIOD_MS, (target - 1) * TOTP_PERIOD_MS - Date.now() + 50),
    );
  }
}

try {
  await withEphemeralPostgres(async (database) => {
    stage = "migrations";
    await runMigrations({
      clientConfig: database,
      workspaceRoot,
      command: { direction: "up" },
    });
    const client = new Client(database);
    await client.connect();
    const close = [];
    const own = (stop) => close.unshift(stop);
    own(() => client.end());
    try {
      const tokenPepper = secret(randomBytes(32).toString("hex")),
        subjectPepper = secret(randomBytes(32).toString("hex")),
        accessKey = secret(randomBytes(32).toString("hex"));
      const ownerPassword = secret(
        `owner ${randomBytes(12).toString("base64url")}`,
      );
      stage = "first administrator";
      const { accountId: ownerAccount } = await provisionFirstAdministrator(
        client,
        { subjectPepper, password: ownerPassword },
      );

      stage = "production composition";
      const kms = createLocalExperienceKms({
        environment: "TEST",
        masterKey: randomBytes(32).toString("base64url"),
        macKey: randomBytes(32).toString("base64url"),
      });
      own(() => kms.close());
      const { config, composition } = localAccountComposition({
        createProductionAdminComposition,
        resolveAdminApiRuntimeConfig,
        createPostgresPersistence,
        database,
        keyManagement: kms.adapter,
        adminOrigin,
        accessKey,
        tokenPepper,
        subjectPepper,
        own,
      });
      check(
        config.settings === undefined && config.localAccounts,
        "built-in accounts without OIDC",
      );
      check(
        composition.adminAccessRoute === undefined,
        "no OIDC route without OIDC settings",
      );
      const app = await createApiApplication(preflightEnvironment(database), {
        ...composition,
        logger: createStructuredLogger({
          service: "api",
          write: (line) => logs.push(line),
        }),
      });
      own(() => app.close());
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      async function post(route, body, headers = {}) {
        const response = await globalThis.fetch(
          `${base}/api/v1/admin/${route}`,
          {
            method: "POST",
            headers: {
              origin: adminOrigin,
              "content-type": "application/json",
              ...headers,
            },
            body: JSON.stringify(body),
          },
        );
        check(
          response.headers.get("cache-control") === "private, no-store",
          `${route} is private no-store`,
        );
        return { status: response.status, data: await response.json() };
      }
      const access = (action, body) =>
        post(
          `local-access/${action}`,
          { schemaVersion: 1, requestId: randomUUID(), ...body },
          {
            "x-admin-access-key": accessKey,
          },
        );
      const signedIn = (session) => ({
        cookie: `__Host-fan-admin-session=${session.sessionToken}`,
        "x-csrf-token": session.csrfToken,
      });
      const account = (session, action, body = {}) =>
        post(`account/${action}`, body, signedIn(session));
      const staff = (session, action, body = {}) =>
        post(`staff/${action}`, body, signedIn(session));
      const login = (loginName, password, locale = "zh-CN") =>
        access("login", { locale, loginName, password });
      const remember = (response) => {
        for (const key of ["sessionToken", "csrfToken", "challengeToken"])
          if (typeof response.data[key] === "string")
            secret(response.data[key]);
        return response.data;
      };

      stage = "password sign-in";
      same(
        (await login("nobody.here", "whatever it is")).data.code,
        "INVALID_CREDENTIALS",
        "unknown name",
      );
      const wrong = await login("studio.owner", "not the password");
      same(
        [wrong.status, wrong.data.code],
        [403, "INVALID_CREDENTIALS"],
        "wrong password",
      );
      const denied = await post(
        "local-access/login",
        {
          schemaVersion: 1,
          requestId: randomUUID(),
          locale: "en",
          loginName: "studio.owner",
          password: ownerPassword,
        },
        { "x-admin-access-key": "0".repeat(64) },
      );
      same(denied.status, 403, "the BFF access key is required");
      const first = remember(await login("  Studio.Owner ", ownerPassword));
      same(
        [first.kind, first.locale],
        ["SESSION_CREATED", "zh-CN"],
        "session created",
      );
      const context = await account(first, "context");
      same(
        [
          context.status,
          context.data.kind,
          context.data.account.twoFactorEnabled,
        ],
        [200, "ACCOUNT", false],
        "own account",
      );
      same(
        (await staff(first, "context")).data.kind,
        "STAFF_CONTEXT",
        "owner manages staff",
      );

      stage = "second factor enrollment";
      same(
        (
          await account(first, "totp-begin", {
            currentPassword: "not the password",
          })
        ).data.code,
        "INVALID_PASSWORD",
        "enrollment needs the password",
      );
      const enrollment = await account(first, "totp-begin", {
        currentPassword: ownerPassword,
      });
      same(enrollment.data.kind, "TOTP_ENROLLMENT", "enrollment started");
      const totpSecret = secret(enrollment.data.secret);
      check(
        enrollment.data.otpauthUri ===
          `otpauth://totp/Studio%20Admin:studio.owner?secret=${totpSecret}&issuer=Studio%20Admin&algorithm=SHA1&digits=6&period=30`,
        "otpauth URI for authenticator apps",
      );
      const key = decodeBase32(totpSecret);
      const [stored] = (
        await client.query(
          "SELECT totp_pending_ciphertext,totp_pending_key_version FROM admin_local_accounts WHERE id=$1",
          [ownerAccount],
        )
      ).rows;
      check(
        stored.totp_pending_ciphertext.startsWith("enc:v1:") &&
          stored.totp_pending_key_version === "test-envelope",
        "secret stored only as an envelope",
      );
      const first6 = await freshCode(key, -1);
      const enabled = await account(first, "totp-confirm", {
        code: first6.code,
      });
      same(
        [enabled.data.kind, enabled.data.recoveryCodes.length],
        ["TOTP_ENABLED", 10],
        "second factor enabled",
      );
      const recoveryCodes = enabled.data.recoveryCodes.map(secret);
      let lastStep = first6.step;

      stage = "sign-in with the second factor";
      same(
        (
          await access("logout", {
            sessionToken: first.sessionToken,
            csrfToken: first.csrfToken,
            revokeAll: false,
          })
        ).data.kind,
        "LOGGED_OUT",
        "logout",
      );
      same(
        (await account(first, "context")).status,
        401,
        "a logged-out session is refused",
      );
      const stepped = remember(await login("studio.owner", ownerPassword));
      same(
        [stepped.kind, stepped.step],
        ["STEP_REQUIRED", "SECOND_FACTOR"],
        "code required",
      );
      const replay = await access("step", {
        challengeToken: stepped.challengeToken,
        step: { kind: "TOTP", code: first6.code },
      });
      same(
        replay.data.code,
        "INVALID_CODE",
        "the enrollment code cannot be replayed",
      );
      const next = await freshCode(key, lastStep);
      const second = remember(
        await access("step", {
          challengeToken: stepped.challengeToken,
          step: { kind: "TOTP", code: next.code },
        }),
      );
      same(second.kind, "SESSION_CREATED", "signed in with TOTP");
      lastStep = next.step;
      same(
        (
          await access("step", {
            challengeToken: stepped.challengeToken,
            step: { kind: "TOTP", code: next.code },
          })
        ).data.code,
        "LOGIN_RESTART_REQUIRED",
        "a completed challenge is single use",
      );
      const byRecovery = remember(await login("studio.owner", ownerPassword));
      const third = remember(
        await access("step", {
          challengeToken: byRecovery.challengeToken,
          step: { kind: "RECOVERY_CODE", code: recoveryCodes[0].toLowerCase() },
        }),
      );
      same(third.kind, "SESSION_CREATED", "signed in with a recovery code");
      same(
        (await account(third, "context")).data.account.recoveryCodesRemaining,
        9,
        "one code spent",
      );

      stage = "staff accounts";
      const created = await staff(second, "create", {
        loginName: "night.shift",
        displayName: "Night shift",
        roleKeys: ["studio:operator"],
      });
      same(
        [created.data.kind, created.data.member.mustChangePassword],
        ["STAFF_CREATED", true],
        "staff created",
      );
      const temporary = secret(created.data.temporaryPassword);
      same(
        (
          await staff(second, "create", {
            loginName: "night.shift",
            displayName: "Again",
            roleKeys: ["studio:operator"],
          })
        ).data.code,
        "LOGIN_NAME_TAKEN",
        "names are unique",
      );
      const firstStaff = remember(await login("night.shift", temporary, "th"));
      same(
        [firstStaff.kind, firstStaff.step],
        ["STEP_REQUIRED", "NEW_PASSWORD"],
        "a temporary password needs replacing",
      );
      same(
        (
          await access("step", {
            challengeToken: firstStaff.challengeToken,
            step: { kind: "NEW_PASSWORD", newPassword: temporary },
          })
        ).data.passwordProblem,
        "SAME_AS_CURRENT",
        "the temporary password cannot stay",
      );
      same(
        (
          await access("step", {
            challengeToken: firstStaff.challengeToken,
            step: { kind: "NEW_PASSWORD", newPassword: "short" },
          })
        ).data.passwordProblem,
        "TOO_SHORT",
        "policy enforced",
      );
      const staffPassword = secret(
        `night ${randomBytes(12).toString("base64url")}`,
      );
      const staffSession = remember(
        await access("step", {
          challengeToken: firstStaff.challengeToken,
          step: { kind: "NEW_PASSWORD", newPassword: staffPassword },
        }),
      );
      same(
        [staffSession.kind, staffSession.locale],
        ["SESSION_CREATED", "th"],
        "signed in after replacing it",
      );
      same(
        (await staff(staffSession, "list")).status,
        403,
        "operators cannot manage staff",
      );
      same(
        (await account(staffSession, "context")).data.account.loginName,
        "night.shift",
        "staff reads their own account",
      );
      const list = await staff(second, "list");
      same(
        list.data.members.map((m) => [
          m.loginName,
          m.self,
          m.mustChangePassword,
        ]),
        [
          ["studio.owner", true, false],
          ["night.shift", false, false],
        ],
        "staff list",
      );
      const night = list.data.members[1];
      same(
        (
          await staff(second, "set-status", {
            accountId: list.data.members[0].accountId,
            expectedVersion: list.data.members[0].version,
            status: "SUSPENDED",
          })
        ).data.code,
        "SELF_LOCKOUT",
        "cannot suspend yourself",
      );
      const suspended = await staff(second, "set-status", {
        accountId: night.accountId,
        expectedVersion: night.version,
        status: "SUSPENDED",
      });
      same(suspended.data.member.status, "SUSPENDED", "suspended");
      same(
        (await account(staffSession, "context")).status,
        401,
        "suspension ends their sessions",
      );
      same(
        (await login("night.shift", staffPassword)).data.code,
        "INVALID_CREDENTIALS",
        "a suspended account cannot sign in",
      );
      const reactivated = await staff(second, "set-status", {
        accountId: night.accountId,
        expectedVersion: suspended.data.member.version,
        status: "ACTIVE",
      });
      const reset = await staff(second, "reset-password", {
        accountId: night.accountId,
        expectedVersion: reactivated.data.member.version,
      });
      same(
        [reset.data.kind, reset.data.member.mustChangePassword],
        ["PASSWORD_RESET", true],
        "password reset",
      );
      const resetPassword = secret(reset.data.temporaryPassword);
      same(
        (await login("night.shift", staffPassword)).data.code,
        "INVALID_CREDENTIALS",
        "the old password stops working",
      );

      stage = "lockout";
      // The old password tried just above was the first consecutive failure.
      for (let attempt = 2; attempt <= 4; attempt++)
        same(
          (await login("night.shift", `wrong ${attempt}`)).data.code,
          "INVALID_CREDENTIALS",
          `failure ${attempt}`,
        );
      same(
        (await login("night.shift", "wrong 5")).data.code,
        "ACCOUNT_LOCKED",
        "the fifth consecutive failure locks",
      );
      same(
        (await login("night.shift", resetPassword)).data.code,
        "ACCOUNT_LOCKED",
        "even the right password waits",
      );

      stage = "password change ends other sessions";
      const newOwnerPassword = secret(
        `owner ${randomBytes(12).toString("base64url")}`,
      );
      same(
        (
          await account(second, "change-password", {
            currentPassword: ownerPassword,
            newPassword: ownerPassword,
          })
        ).data.passwordProblem,
        "SAME_AS_CURRENT",
        "a new password must differ",
      );
      const changed = await account(second, "change-password", {
        currentPassword: ownerPassword,
        newPassword: newOwnerPassword,
      });
      same(changed.data.kind, "PASSWORD_CHANGED", "password changed");
      same(
        (await account(third, "context")).status,
        401,
        "other sessions revoked",
      );
      same(
        (await account(second, "context")).status,
        200,
        "the current session stays",
      );
      const regenerated = await account(second, "recovery-codes", {
        currentPassword: newOwnerPassword,
        code: (await freshCode(key, lastStep)).code,
      });
      same(
        [regenerated.data.kind, regenerated.data.recoveryCodes.length],
        ["RECOVERY_CODES", 10],
        "recovery codes regenerated",
      );
      regenerated.data.recoveryCodes.forEach(secret);

      stage = "evidence";
      const [audit] = (
        await client.query(`SELECT
        (SELECT count(*)::int FROM admin_local_logins l LEFT JOIN audit_logs a ON a.id=l.audit_log_id WHERE l.state='CONSUMED' AND a.id IS NULL) AS unaudited,
        (SELECT count(*)::int FROM admin_sessions s JOIN admin_local_logins l ON l.session_id=s.id WHERE s.revoked_at IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.subject_id=s.id AND a.created_at=s.revoked_at)) AS unaudited_revocations,
        (SELECT count(*)::int FROM audit_logs WHERE action LIKE 'ADMIN_LOCAL_%' OR action LIKE 'ADMIN_STAFF_%') AS local_audits`)
      ).rows;
      same(
        [audit.unaudited, audit.unaudited_revocations],
        [0, 0],
        "every consumed login and revocation audited",
      );
      check(audit.local_audits > 10, "account activity audited");
      const dump = JSON.stringify(
        (
          await client.query(
            "SELECT to_jsonb(a) AS row FROM admin_local_accounts a UNION ALL SELECT to_jsonb(l) FROM admin_local_logins l UNION ALL SELECT to_jsonb(g) FROM audit_logs g",
          )
        ).rows,
      );
      const logText = logs.join("\n");
      for (const value of secrets) {
        check(!dump.includes(value), "no secret stored in plaintext");
        check(!logText.includes(value), "no secret in API logs");
      }
    } catch (error) {
      // The ephemeral database harness replaces errors with a generic one; keep the real cause.
      innerError = error;
      throw error;
    } finally {
      for (const stop of close)
        await Promise.resolve()
          .then(stop)
          .catch(() => undefined);
    }
  });
  stage = "report";
  const report = JSON.stringify(
    { result: "PASS", checks: checks.length, detail: checks },
    null,
    2,
  );
  for (const value of secrets)
    assert.ok(!report.includes(value), "no secret in the report");
  await writeFile(path.join(output, "report.json"), report);
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: checks.length,
      output: path.relative(workspaceRoot, output),
    }),
  );
} catch (error) {
  const failure = {
    result: "FAIL",
    stage,
    checks: checks.length,
    message: String((innerError ?? error)?.message),
  };
  for (const value of secrets)
    failure.message = failure.message.replaceAll(value, "<secret>");
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify({ ...failure, detail: checks }, null, 2),
  );
  console.error(JSON.stringify(failure));
  process.exitCode = 1;
}
