#!/usr/bin/env node
// L3-10 ③: built-in admin accounts on a real PostgreSQL — repositories, concurrency and every 0052 trigger.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  adminPermissionKeySchema,
  adminStandardRolePermissions,
} from "@fan-support/contracts";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const LOCAL = "urn:fan-support:local";
const digest = () => randomBytes(32).toString("hex");
const hash = () =>
  `scrypt$1$32768$8$1$${randomBytes(16).toString("base64url")}$${randomBytes(32).toString("base64url")}`;
const enc = () => `enc:v1:${randomBytes(48).toString("base64url")}`;
const secret = () => ({
  ciphertext: enc(),
  encryptedDataKey: enc(),
  keyVersion: "test-envelope",
});
let checks = 0;
let stage = "setup";
let passed = "none";
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, `${stage}: ${label}`);
  passed = label;
  checks++;
}
function ok(value, label) {
  assert.ok(value, `${stage}: ${label}`);
  passed = label;
  checks++;
}

await withEphemeralPostgres(async (config) => {
  await runMigrations({
    clientConfig: config,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(config);
  await client.connect();
  const persistence = createPostgresPersistence(config);
  const run = (work) =>
    persistence.adminLocalAccessTransactionManager.runInAdminLocalAccessTransaction(
      work,
    );
  const q = async (sql, values = []) => (await client.query(sql, values)).rows;
  // Without values node-pg uses the simple protocol, which multi-statement SQL (a whole migration) needs.
  const runSql = (sql, values) =>
    values === undefined ? client.query(sql) : client.query(sql, values);
  /** Every statement runs in one transaction; deferred triggers fire at COMMIT. */
  async function rejects(label, statements, codes = ["23514"]) {
    await client.query("BEGIN");
    try {
      for (const [sql, values] of statements) await runSql(sql, values);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      ok(
        codes.includes(error.code),
        `${label} (got ${error.code}: ${error.message})`,
      );
      return;
    }
    assert.fail(`${stage}: ${label} was accepted`);
  }
  async function accepts(label, statements) {
    await client.query("BEGIN");
    try {
      for (const [sql, values] of statements) await runSql(sql, values);
      await client.query("COMMIT");
      ok(true, label);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      assert.fail(`${stage}: ${label}: ${error.code} ${error.message}`);
    }
  }
  const material = (ttl = 3600) => ({
    sessionId: randomUUID(),
    sessionTokenDigest: digest(),
    csrfTokenDigest: digest(),
    sessionTtlSeconds: ttl,
  });
  const credentials = (m) => ({
    sessionTokenDigest: m.sessionTokenDigest,
    csrfTokenDigest: m.csrfTokenDigest,
  });
  const envelope = () => ({ schemaVersion: 1, requestId: randomUUID() });
  const account = async (id) =>
    (await q("SELECT * FROM admin_local_accounts WHERE id=$1", [id]))[0];
  const audits = (subjectId) =>
    q(
      "SELECT actor_type,actor_id,task_name,action,reason_code,outcome FROM audit_logs WHERE subject_id=$1 ORDER BY created_at,action",
      [subjectId],
    );
  async function start(accountId, passwordHash, overrides = {}) {
    const m = material();
    const challengeDigest = digest();
    const loginId = randomUUID();
    const result = await run(({ localLogin }) =>
      localLogin.start({
        ...envelope(),
        loginId,
        accountId,
        verifiedPasswordHash: passwordHash,
        locale: "zh-CN",
        challengeDigest,
        ...m,
        ...overrides,
      }),
    );
    return { result, m, challengeDigest, loginId };
  }
  const complete = (flow, outcome, m = material()) =>
    run(({ localLogin }) =>
      localLogin.completeStep({
        ...envelope(),
        challengeDigest: flow.challengeDigest,
        loginId: flow.loginId,
        outcome,
        ...m,
      }),
    ).then((result) => ({ result, m }));
  const readStep = (flow) =>
    run(({ localLogin }) =>
      localLogin.readStep({
        schemaVersion: 1,
        challengeDigest: flow.challengeDigest,
      }),
    );
  const settings = (m, change, accountId) =>
    run(({ localAccount }) =>
      localAccount.update({
        ...envelope(),
        ...credentials(m),
        accountId,
        change,
      }),
    );
  const staff = (m, change) =>
    run(({ localStaff }) =>
      localStaff.execute({ ...envelope(), ...credentials(m), change }),
    );

  // ---------- Fixture: what the L3-10 server command provisions for the first administrator ----------
  const ownerIdentity = randomUUID(),
    ownerAccount = randomUUID();
  let ownerHash = hash();
  await client.query("BEGIN");
  for (const key of adminPermissionKeySchema.options)
    await client.query(
      "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Platform permission') ON CONFLICT (permission_key) DO NOTHING",
      [randomUUID(), key],
    );
  await client.query(
    "INSERT INTO roles(id,role_key,description) VALUES($1,'studio:owner','Studio administrator'),($2,'studio:operator','Daily operations'),($3,'studio:broker','Broker')",
    [randomUUID(), randomUUID(), randomUUID()],
  );
  await client.query(
    "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.role_key='studio:owner'",
  );
  await client.query(
    "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN ('content.read','orders.read') WHERE r.role_key='studio:operator'",
  );
  await client.query(
    "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key=ANY($1::text[]) WHERE r.role_key='studio:broker'",
    [adminStandardRolePermissions("studio:broker")],
  );
  // The local experience seeds roles like this for its TEST sign-in identities (L3-10a).
  await client.query(
    "INSERT INTO roles(id,role_key,description) VALUES($1,'local:manager:fixture','Local TEST role')",
    [randomUUID()],
  );
  await client.query(
    "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.role_key='local:manager:fixture'",
  );
  await client.query(
    "INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required) VALUES($1,$2,$3,'ACTIVE',false)",
    [ownerIdentity, LOCAL, randomBytes(32)],
  );
  await client.query(
    "INSERT INTO admin_local_accounts(id,admin_identity_id,login_name,display_name,password_hash,password_changed_at,must_change_password) VALUES($1,$2,'studio.owner','Studio Owner',$3,clock_timestamp(),false)",
    [ownerAccount, ownerIdentity, ownerHash],
  );
  await client.query(
    "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) SELECT $1,id,$1 FROM roles WHERE role_key='studio:owner'",
    [ownerIdentity],
  );
  await client.query("COMMIT");

  try {
    stage = "read";
    equal(
      (
        await run(({ localLogin }) =>
          localLogin.read({ schemaVersion: 1, loginName: "nobody.here" }),
        )
      ).kind,
      "NO_ACCOUNT",
      "unknown login name",
    );
    const read = await run(({ localLogin }) =>
      localLogin.read({ schemaVersion: 1, loginName: "studio.owner" }),
    );
    equal(
      [read.kind, read.accountId, read.passwordHash, read.active, read.locked],
      ["LOGIN_ACCOUNT", ownerAccount, ownerHash, true, false],
      "known account read without locks",
    );

    stage = "password-only sign-in";
    const stale = await start(ownerAccount, hash());
    equal(stale.result.code, "INVALID_CREDENTIALS", "stale verified hash");
    equal(
      (await q("SELECT count(*)::int AS n FROM admin_local_logins"))[0].n,
      0,
      "a stale hash creates no login",
    );
    const first = await start(ownerAccount, ownerHash);
    equal(first.result.kind, "SESSION_SAVED", "session issued immediately");
    equal(first.result.locale, "zh-CN", "sign-in locale returned");
    const [login] = await q(
      "SELECT state,second_factor,challenge_digest,session_id FROM admin_local_logins WHERE id=$1",
      [first.loginId],
    );
    equal(
      [
        login.state,
        login.second_factor,
        login.challenge_digest,
        login.session_id,
      ],
      ["CONSUMED", "NONE", null, first.m.sessionId],
      "one-step login consumed without a challenge",
    );
    equal(
      (await audits(first.loginId)).map((a) => [
        a.action,
        a.reason_code,
        a.task_name,
      ]),
      [
        [
          "ADMIN_LOCAL_LOGIN_SUCCEEDED",
          "AUTHENTICATED_PASSWORD",
          "admin-local-access",
        ],
      ],
      "exact success audit",
    );
    const [session] = await q(
      "SELECT authenticated_with_mfa,admin_identity_id,expires_at-created_at AS ttl FROM admin_sessions WHERE id=$1",
      [first.m.sessionId],
    );
    equal(
      [session.authenticated_with_mfa, session.admin_identity_id],
      [true, ownerIdentity],
      "session met the platform policy",
    );
    ok((await account(ownerAccount)).last_login_at !== null, "last login kept");

    stage = "failed passwords and lockout";
    const fail = () =>
      run(({ localLogin }) =>
        localLogin.recordFailure({ ...envelope(), accountId: ownerAccount }),
      );
    for (let i = 1; i <= 4; i++)
      equal((await fail()).locked, false, `failure ${i}`);
    equal((await account(ownerAccount)).failed_attempts, 4, "four counted");
    equal((await fail()).locked, true, "the fifth failure locks");
    const locked = await account(ownerAccount);
    equal(locked.failed_attempts, 0, "the count restarts when locked");
    ok(locked.locked_until !== null, "lock deadline set");
    equal(
      (await start(ownerAccount, ownerHash)).result.code,
      "ACCOUNT_LOCKED",
      "a locked account cannot start even with the right password",
    );
    equal((await fail()).locked, true, "failures while locked do not extend");
    equal(
      (await audits(ownerAccount)).map((a) => a.reason_code),
      [
        "INVALID_PASSWORD",
        "INVALID_PASSWORD",
        "INVALID_PASSWORD",
        "INVALID_PASSWORD",
        "ACCOUNT_LOCKED",
        "ACCOUNT_LOCKED",
      ],
      "each failure audited under the account",
    );
    await client.query(
      "UPDATE admin_local_accounts SET locked_until=clock_timestamp()-interval '1 second',version=version+1 WHERE id=$1",
      [ownerAccount],
    );
    equal((await fail()).locked, false, "a lapsed lock starts a new count");
    equal(
      (await account(ownerAccount)).failed_attempts,
      1,
      "count restarted at one",
    );
    const cleared = await start(ownerAccount, ownerHash);
    equal(
      cleared.result.kind,
      "SESSION_SAVED",
      "success after the lock lapsed",
    );
    const afterSuccess = await account(ownerAccount);
    equal(
      [afterSuccess.failed_attempts, afterSuccess.locked_until],
      [0, null],
      "success clears failures",
    );
    const racing = await Promise.all(Array.from({ length: 5 }, () => fail()));
    equal(
      racing.filter((r) => r.locked).length,
      1,
      "five concurrent failures are all counted and lock once",
    );
    await client.query(
      "UPDATE admin_local_accounts SET locked_until=NULL,failed_attempts=0,version=version+1 WHERE id=$1",
      [ownerAccount],
    );

    stage = "logout of a built-in session";
    const loggedOut = await run(({ adminAccess }) =>
      adminAccess.revoke({
        ...envelope(),
        ...credentials(cleared.m),
        revokeAll: false,
      }),
    );
    equal(
      loggedOut.kind,
      "LOGGED_OUT",
      "existing revoke works for built-in sessions",
    );
    equal(
      (await audits(cleared.m.sessionId)).map((a) => [a.action, a.reason_code]),
      [["ADMIN_SESSION_REVOKED", "USER_LOGOUT"]],
      "logout audit satisfies the 0052 revocation trigger",
    );

    stage = "staff authorization";
    const ownerSession = first.m;
    equal(
      (await staff(ownerSession, { action: "CONTEXT" })).kind,
      "STAFF_CONTEXT",
      "owner holds staff.manage",
    );
    equal(
      (
        await staff(
          { ...ownerSession, csrfTokenDigest: digest() },
          { action: "CONTEXT" },
        )
      ).code,
      "CSRF_INVALID",
      "wrong CSRF",
    );
    equal(
      (await staff(material(), { action: "CONTEXT" })).code,
      "UNAUTHENTICATED",
      "unknown session",
    );
    const nightAccount = randomUUID(),
      nightIdentity = randomUUID();
    let nightHash = hash();
    const create = (overrides = {}) =>
      staff(ownerSession, {
        action: "CREATE",
        loginName: "night.shift",
        displayName: "Night shift",
        roleKeys: ["studio:operator"],
        accountId: nightAccount,
        identityId: nightIdentity,
        subjectDigest: digest(),
        passwordHash: nightHash,
        ...overrides,
      });
    equal(
      (await create({ roleKeys: ["studio:nobody"] })).code,
      "UNKNOWN_ROLE",
      "unknown role rejected",
    );
    equal(
      (await create({ roleKeys: ["studio:operator", "local:manager:fixture"] }))
        .code,
      "UNKNOWN_ROLE",
      "roles other than the standard ones cannot be granted",
    );
    const created = await create();
    equal(created.kind, "STAFF_SAVED", "staff account created");
    equal(
      [
        created.member.loginName,
        created.member.status,
        created.member.mustChangePassword,
        created.member.twoFactorEnabled,
        created.member.roleKeys,
        created.member.self,
        created.member.version,
      ],
      ["night.shift", "ACTIVE", true, false, ["studio:operator"], false, 1],
      "new member view",
    );
    equal(
      (
        await create({
          accountId: randomUUID(),
          identityId: randomUUID(),
          loginName: "night.shift",
        })
      ).code,
      "LOGIN_NAME_TAKEN",
      "duplicate login name",
    );
    const [grants] = await q(
      `SELECT (SELECT count(*)::int FROM admin_content_locale_grants WHERE admin_identity_id=$1 AND revoked_at IS NULL) AS content,
        (SELECT count(*)::int FROM admin_order_message_locale_grants WHERE admin_identity_id=$1 AND revoked_at IS NULL) AS message`,
      [nightIdentity],
    );
    equal(
      [grants.content, grants.message],
      [7, 7],
      "seven content and message locales granted",
    );
    const [identity] = await q(
      "SELECT issuer,mfa_required,status FROM admin_identities WHERE id=$1",
      [nightIdentity],
    );
    equal(
      [identity.issuer, identity.mfa_required, identity.status],
      [LOCAL, false, "ACTIVE"],
      "built-in identity",
    );

    stage = "temporary password sign-in";
    const temp = await start(nightAccount, nightHash);
    equal(
      [temp.result.kind, temp.result.step],
      ["STEP_SAVED", "NEW_PASSWORD"],
      "a temporary password requires a new one",
    );
    const tempStep = await readStep(temp);
    equal(
      [
        tempStep.kind,
        tempStep.step,
        tempStep.loginName,
        tempStep.expired,
        tempStep.totp,
      ],
      ["LOGIN_STEP", "NEW_PASSWORD", "night.shift", false, null],
      "step read by challenge",
    );
    equal(
      (
        await complete(temp, {
          kind: "TOTP",
          ciphertext: enc(),
          step: 1,
        })
      ).result.code,
      "INVALID_COMMAND",
      "a step the login does not need",
    );
    equal(
      (
        await complete(temp, {
          kind: "NEW_PASSWORD",
          previousPasswordHash: hash(),
          newPasswordHash: hash(),
        })
      ).result.code,
      "LOGIN_RESTART_REQUIRED",
      "a stale temporary password ends the login",
    );
    equal(
      (await audits(temp.loginId)).map((a) => a.reason_code),
      ["ACCESS_DENIED"],
      "rejection audited",
    );
    equal(
      (await readStep(temp)).code,
      "LOGIN_RESTART_REQUIRED",
      "consumed login",
    );
    const temp2 = await start(nightAccount, nightHash);
    const newHash = hash();
    const replaced = await complete(temp2, {
      kind: "NEW_PASSWORD",
      previousPasswordHash: nightHash,
      newPasswordHash: newHash,
    });
    equal(
      replaced.result.kind,
      "SESSION_SAVED",
      "new password completes sign-in",
    );
    nightHash = newHash;
    const nightRow = await account(nightAccount);
    equal(
      [nightRow.password_hash, nightRow.must_change_password],
      [newHash, false],
      "password replaced",
    );
    equal(
      (await audits(nightAccount)).map((a) => [a.action, a.reason_code]).at(-1),
      ["ADMIN_LOCAL_PASSWORD_CHANGED", "TEMPORARY_PASSWORD_REPLACED"],
      "replacement audited",
    );
    const nightSession = replaced.m;
    equal(
      (await staff(nightSession, { action: "LIST" })).code,
      "FORBIDDEN",
      "operators cannot manage staff",
    );

    stage = "own account and TOTP enrollment";
    const state = await run(({ localAccount }) =>
      localAccount.read({ schemaVersion: 1, ...credentials(ownerSession) }),
    );
    equal(
      [
        state.kind,
        state.accountId,
        state.account.twoFactorEnabled,
        state.totp,
        state.pending,
      ],
      ["ACCOUNT_STATE", ownerAccount, false, null, null],
      "owner account state",
    );
    equal(
      (
        await settings(
          ownerSession,
          {
            kind: "BEGIN_TOTP",
            previousPasswordHash: hash(),
            pending: secret(),
          },
          ownerAccount,
        )
      ).code,
      "INVALID_PASSWORD",
      "stale password cannot enroll",
    );
    equal(
      (
        await settings(
          nightSession,
          {
            kind: "BEGIN_TOTP",
            previousPasswordHash: ownerHash,
            pending: secret(),
          },
          ownerAccount,
        )
      ).code,
      "UNAUTHENTICATED",
      "a session cannot change another account",
    );
    const pending = secret();
    const begun = await settings(
      ownerSession,
      { kind: "BEGIN_TOTP", previousPasswordHash: ownerHash, pending },
      ownerAccount,
    );
    equal(begun.kind, "ENROLLMENT_SAVED", "enrollment pending");
    const window = (
      await q(
        "SELECT extract(epoch FROM totp_pending_expires_at-updated_at)::int AS s FROM admin_local_accounts WHERE id=$1",
        [ownerAccount],
      )
    )[0].s;
    equal(window, 600, "ten-minute enrollment window");
    const codes = Array.from({ length: 10 }, digest);
    const confirm = (overrides = {}) =>
      settings(
        ownerSession,
        {
          kind: "CONFIRM_TOTP",
          pendingCiphertext: pending.ciphertext,
          step: 1000,
          batchId: randomUUID(),
          recoveryCodeDigests: codes,
          ...overrides,
        },
        ownerAccount,
      );
    equal(
      (await confirm({ pendingCiphertext: enc() })).code,
      "ENROLLMENT_EXPIRED",
      "another pending secret",
    );
    const enabled = await confirm();
    equal(
      [
        enabled.kind,
        enabled.account.twoFactorEnabled,
        enabled.account.recoveryCodesRemaining,
      ],
      ["ACCOUNT_UPDATED", true, 10],
      "TOTP enabled with ten codes",
    );
    equal(
      (await confirm()).code,
      "TOTP_ALREADY_ENABLED",
      "cannot enable twice",
    );
    const ownerRow = await account(ownerAccount);
    equal(
      [
        ownerRow.totp_ciphertext,
        ownerRow.totp_last_step,
        ownerRow.totp_pending_ciphertext,
      ],
      [pending.ciphertext, "1000", null],
      "pending promoted",
    );

    stage = "second factor sign-in";
    const totpFlow = await start(ownerAccount, ownerHash);
    equal(
      [totpFlow.result.kind, totpFlow.result.step],
      ["STEP_SAVED", "SECOND_FACTOR"],
      "TOTP required after enrollment",
    );
    const totpStep = await readStep(totpFlow);
    equal(
      [totpStep.step, totpStep.totp.ciphertext, totpStep.totp.lastStep],
      ["SECOND_FACTOR", pending.ciphertext, 1000],
      "encrypted secret handed to the verifier",
    );
    const replay = await complete(totpFlow, {
      kind: "TOTP",
      ciphertext: pending.ciphertext,
      step: 1000,
    });
    equal(
      replay.result.code,
      "INVALID_CODE",
      "a replayed time step is rejected",
    );
    equal(
      (
        await q("SELECT step_attempts FROM admin_local_logins WHERE id=$1", [
          totpFlow.loginId,
        ])
      )[0].step_attempts,
      1,
      "attempt counted on the login",
    );
    equal(
      (await account(ownerAccount)).failed_attempts,
      1,
      "and on the account",
    );
    const accept = { kind: "TOTP", ciphertext: pending.ciphertext, step: 1001 };
    const [a1, a2] = await Promise.all([
      complete(totpFlow, accept),
      complete(totpFlow, accept),
    ]);
    equal(
      [
        a1.result.kind ?? a1.result.code,
        a2.result.kind ?? a2.result.code,
      ].sort(),
      ["LOGIN_RESTART_REQUIRED", "SESSION_SAVED"],
      "a double submit issues exactly one session",
    );
    equal(
      (await audits(totpFlow.loginId)).map((a) => a.reason_code),
      ["AUTHENTICATED_TOTP"],
      "TOTP success audited",
    );
    const totpRow = await account(ownerAccount);
    equal(
      [totpRow.totp_last_step, totpRow.failed_attempts],
      ["1001", 0],
      "step advanced, failures cleared",
    );
    const recoveryFlow = await start(ownerAccount, ownerHash);
    const recovered = await complete(recoveryFlow, {
      kind: "RECOVERY_CODE",
      codeDigest: codes[0],
    });
    equal(recovered.result.kind, "SESSION_SAVED", "recovery code signs in");
    equal(
      (await audits(recoveryFlow.loginId)).map((a) => a.reason_code),
      ["AUTHENTICATED_RECOVERY_CODE"],
      "recovery sign-in audited",
    );
    const reuse = await start(ownerAccount, ownerHash);
    equal(
      (await complete(reuse, { kind: "RECOVERY_CODE", codeDigest: codes[0] }))
        .result.code,
      "INVALID_CODE",
      "a recovery code is single use",
    );
    const expiredFlow = await start(ownerAccount, ownerHash);
    equal(
      (await complete(expiredFlow, { kind: "EXPIRED" })).result.code,
      "LOGIN_RESTART_REQUIRED",
      "an expired step ends the login",
    );
    equal(
      (await audits(expiredFlow.loginId)).map((a) => a.reason_code),
      ["LOGIN_EXPIRED"],
      "expiry audited",
    );
    // A real database-time expiry: a login may not outlive its expires_at.
    const shortLogin = randomUUID(),
      shortChallenge = digest();
    await client.query(
      "INSERT INTO admin_local_logins(id,account_id,challenge_digest,locale,needs_second_factor,needs_new_password,created_at,expires_at) VALUES($1,$2,$3,'en',true,false,clock_timestamp(),clock_timestamp()+interval '1 second')",
      [shortLogin, ownerAccount, Buffer.from(shortChallenge, "hex")],
    );
    await delay(1300);
    equal(
      (await readStep({ challengeDigest: shortChallenge })).expired,
      true,
      "expiry read from the database clock",
    );
    equal(
      (
        await complete(
          { challengeDigest: shortChallenge, loginId: shortLogin },
          { kind: "TOTP", ciphertext: pending.ciphertext, step: 5000 },
        )
      ).result.code,
      "LOGIN_RESTART_REQUIRED",
      "a valid code after expiry does not sign in",
    );
    equal(
      (await audits(shortLogin)).map((a) => a.reason_code),
      ["LOGIN_EXPIRED"],
      "database expiry audited",
    );
    const doomed = randomUUID();
    await rejects("a pending login cannot move after it expired", [
      [
        "INSERT INTO admin_local_logins(id,account_id,challenge_digest,locale,needs_second_factor,needs_new_password,created_at,expires_at) VALUES($1,$2,$3,'en',true,false,clock_timestamp(),clock_timestamp()+interval '1 millisecond')",
        [doomed, ownerAccount, randomBytes(32)],
      ],
      ["SELECT pg_sleep(0.01)"],
      ["UPDATE admin_local_logins SET step_attempts=1 WHERE id=$1", [doomed]],
    ]);
    const lockFlow = await start(ownerAccount, ownerHash);
    let last;
    for (let i = 0; i < 5; i++)
      last = await complete(lockFlow, { kind: "CODE_REJECTED" });
    equal(
      last.result.code,
      "ACCOUNT_LOCKED",
      "five wrong codes lock the account",
    );
    equal(
      (
        await q(
          "SELECT step_attempts,state FROM admin_local_logins WHERE id=$1",
          [lockFlow.loginId],
        )
      )[0],
      { step_attempts: 5, state: "CONSUMED" },
      "login consumed at its fifth attempt",
    );
    equal(
      (await audits(lockFlow.loginId)).map((a) => a.reason_code),
      ["ACCOUNT_LOCKED"],
      "lockout audited on the login",
    );
    equal(
      (await start(ownerAccount, ownerHash)).result.code,
      "ACCOUNT_LOCKED",
      "and on the next sign-in",
    );
    await client.query(
      "UPDATE admin_local_accounts SET locked_until=NULL,failed_attempts=0,version=version+1 WHERE id=$1",
      [ownerAccount],
    );

    stage = "password change and second-factor removal";
    const extra = await start(ownerAccount, ownerHash);
    const extraSession = (
      await complete(extra, { kind: "RECOVERY_CODE", codeDigest: codes[1] })
    ).m;
    const liveBefore = (
      await q(
        "SELECT count(*)::int AS n FROM admin_sessions WHERE admin_identity_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
        [ownerIdentity],
      )
    )[0].n;
    ok(liveBefore >= 3, "several live owner sessions");
    const changedHash = hash();
    const changed = await settings(
      ownerSession,
      {
        kind: "CHANGE_PASSWORD",
        previousPasswordHash: ownerHash,
        newPasswordHash: changedHash,
      },
      ownerAccount,
    );
    equal(changed.kind, "ACCOUNT_UPDATED", "password changed");
    ownerHash = changedHash;
    const live = await q(
      "SELECT id FROM admin_sessions WHERE admin_identity_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
      [ownerIdentity],
    );
    equal(
      live.map((s) => s.id),
      [ownerSession.sessionId],
      "only the current session survives",
    );
    equal(
      (await audits(extraSession.sessionId)).map((a) => [
        a.action,
        a.reason_code,
        a.actor_type,
      ]),
      [["ADMIN_SESSIONS_REVOKED", "PASSWORD_CHANGED", "ADMIN"]],
      "other sessions revoked with exact audits",
    );
    const other = await start(ownerAccount, ownerHash);
    const otherSession = (
      await complete(other, {
        kind: "TOTP",
        ciphertext: pending.ciphertext,
        step: 1002,
      })
    ).m;
    const disable = (overrides = {}) =>
      settings(
        ownerSession,
        {
          kind: "DISABLE_TOTP",
          previousPasswordHash: ownerHash,
          ciphertext: pending.ciphertext,
          step: 1003,
          ...overrides,
        },
        ownerAccount,
      );
    equal(
      (await disable({ ciphertext: enc() })).code,
      "INVALID_CODE",
      "other secret",
    );
    equal(
      (await disable({ step: 1002 })).code,
      "INVALID_CODE",
      "replayed step",
    );
    const disabled = await disable();
    equal(
      [
        disabled.kind,
        disabled.account.twoFactorEnabled,
        disabled.account.recoveryCodesRemaining,
      ],
      ["ACCOUNT_UPDATED", false, 0],
      "second factor removed and codes revoked",
    );
    equal(
      (await audits(otherSession.sessionId)).map((a) => a.reason_code),
      ["SECOND_FACTOR_CHANGED"],
      "other sessions revoked on removal",
    );
    equal((await disable()).code, "TOTP_NOT_ENABLED", "nothing left to remove");
    const pending2 = secret();
    await settings(
      ownerSession,
      {
        kind: "BEGIN_TOTP",
        previousPasswordHash: ownerHash,
        pending: pending2,
      },
      ownerAccount,
    );
    const codes2 = Array.from({ length: 10 }, digest);
    await settings(
      ownerSession,
      {
        kind: "CONFIRM_TOTP",
        pendingCiphertext: pending2.ciphertext,
        step: 2000,
        batchId: randomUUID(),
        recoveryCodeDigests: codes2,
      },
      ownerAccount,
    );
    const codes3 = Array.from({ length: 10 }, digest);
    const regenerated = await settings(
      ownerSession,
      {
        kind: "REGENERATE_RECOVERY_CODES",
        previousPasswordHash: ownerHash,
        ciphertext: pending2.ciphertext,
        step: 2001,
        batchId: randomUUID(),
        recoveryCodeDigests: codes3,
      },
      ownerAccount,
    );
    equal(regenerated.account.recoveryCodesRemaining, 10, "a fresh batch");
    equal(
      (
        await q(
          "SELECT count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked,count(*) FILTER (WHERE revoked_at IS NULL AND used_at IS NULL)::int AS live FROM admin_local_recovery_codes WHERE account_id=$1 AND code_digest=ANY($2::bytea[])",
          [ownerAccount, codes2.map((c) => Buffer.from(c, "hex"))],
        )
      )[0],
      { revoked: 10, live: 0 },
      "the previous batch is revoked",
    );
    const accountFail = () =>
      run(({ localAccount }) =>
        localAccount.recordFailure({
          ...envelope(),
          ...credentials(ownerSession),
          accountId: ownerAccount,
        }),
      );
    for (let i = 0; i < 4; i++) await accountFail();
    equal(
      (await accountFail()).locked,
      true,
      "settings failures share the lockout",
    );
    equal(
      (
        await settings(
          ownerSession,
          {
            kind: "CHANGE_PASSWORD",
            previousPasswordHash: ownerHash,
            newPasswordHash: hash(),
          },
          ownerAccount,
        )
      ).code,
      "ACCOUNT_LOCKED",
      "a locked account cannot change its password",
    );
    await client.query(
      "UPDATE admin_local_accounts SET locked_until=NULL,failed_attempts=0,version=version+1 WHERE id=$1",
      [ownerAccount],
    );

    stage = "staff changes";
    let version = (await account(nightAccount)).version;
    equal(
      (
        await staff(ownerSession, {
          action: "UPDATE_ROLES",
          accountId: nightAccount,
          expectedVersion: Number(version) + 5,
          roleKeys: ["studio:owner"],
        })
      ).code,
      "STALE_VERSION",
      "stale version",
    );
    const promoted = await staff(ownerSession, {
      action: "UPDATE_ROLES",
      accountId: nightAccount,
      expectedVersion: Number(version),
      roleKeys: ["studio:owner", "studio:operator"],
    });
    equal(
      promoted.member.roleKeys,
      ["studio:operator", "studio:owner"],
      "roles replaced",
    );
    const ownerVersion = Number((await account(ownerAccount)).version);
    equal(
      (
        await staff(ownerSession, {
          action: "UPDATE_ROLES",
          accountId: ownerAccount,
          expectedVersion: ownerVersion,
          roleKeys: ["studio:operator"],
        })
      ).code,
      "SELF_LOCKOUT",
      "cannot drop your own staff.manage",
    );
    equal(
      (
        await staff(ownerSession, {
          action: "UPDATE_ROLES",
          accountId: ownerAccount,
          expectedVersion: ownerVersion,
          roleKeys: ["studio:owner", "local:manager:fixture"],
        })
      ).code,
      "UNKNOWN_ROLE",
      "role changes accept only the two standard roles",
    );
    for (const change of [
      { action: "RESET_PASSWORD", passwordHash: hash() },
      { action: "CLEAR_TOTP" },
      { action: "SET_STATUS", status: "SUSPENDED" },
    ])
      equal(
        (
          await staff(ownerSession, {
            ...change,
            accountId: ownerAccount,
            expectedVersion: ownerVersion,
          })
        ).code,
        "SELF_LOCKOUT",
        `${change.action} on yourself`,
      );
    const demoted = await staff(ownerSession, {
      action: "UPDATE_ROLES",
      accountId: nightAccount,
      expectedVersion: promoted.member.version,
      roleKeys: ["studio:operator"],
    });
    version = demoted.member.version;
    const resetHash = hash();
    const reset = await staff(ownerSession, {
      action: "RESET_PASSWORD",
      accountId: nightAccount,
      expectedVersion: version,
      passwordHash: resetHash,
    });
    equal(
      reset.member.mustChangePassword,
      true,
      "reset requires a new password",
    );
    equal(
      (await audits(nightSession.sessionId)).map((a) => [
        a.reason_code,
        a.actor_id,
      ]),
      [["PASSWORD_RESET", ownerIdentity]],
      "reset revokes the member's sessions",
    );
    nightHash = resetHash;
    const n1 = await start(nightAccount, nightHash);
    const nightSession2 = (
      await complete(n1, {
        kind: "NEW_PASSWORD",
        previousPasswordHash: nightHash,
        newPasswordHash: hash(),
      })
    ).m;
    version = Number((await account(nightAccount)).version);
    const suspended = await staff(ownerSession, {
      action: "SET_STATUS",
      accountId: nightAccount,
      expectedVersion: version,
      status: "SUSPENDED",
    });
    equal(suspended.member.status, "SUSPENDED", "suspended");
    equal(
      (await audits(nightSession2.sessionId)).map((a) => a.reason_code),
      ["ACCOUNT_SUSPENDED"],
      "suspension revokes sessions",
    );
    const suspendedRead = await run(({ localLogin }) =>
      localLogin.read({ schemaVersion: 1, loginName: "night.shift" }),
    );
    equal(suspendedRead.active, false, "suspended identity reads inactive");
    equal(
      (await start(nightAccount, (await account(nightAccount)).password_hash))
        .result.code,
      "INVALID_CREDENTIALS",
      "a suspended account cannot sign in",
    );
    const reactivated = await staff(ownerSession, {
      action: "SET_STATUS",
      accountId: nightAccount,
      expectedVersion: suspended.member.version,
      status: "ACTIVE",
    });
    equal(reactivated.member.status, "ACTIVE", "reactivated");
    const cleared2 = await staff(ownerSession, {
      action: "CLEAR_TOTP",
      accountId: nightAccount,
      expectedVersion: reactivated.member.version,
    });
    equal(cleared2.member.twoFactorEnabled, false, "second factor cleared");
    const list = await staff(ownerSession, { action: "LIST" });
    equal(
      list.members.map((m) => [m.loginName, m.self]),
      [
        ["studio.owner", true],
        ["night.shift", false],
      ],
      "members listed oldest first with self flag",
    );
    equal(
      list.roles.map((r) => r.roleKey),
      ["studio:broker", "studio:operator", "studio:owner"],
      "only the three standard roles are listed (ADR-022)",
    );
    equal(
      list.roles.find((r) => r.roleKey === "studio:broker").permissions,
      [...adminStandardRolePermissions("studio:broker")].sort(),
      "the broker role lists only its own scope and the media pipeline",
    );
    ok(
      list.roles
        .find((r) => r.roleKey === "studio:owner")
        .permissions.includes("staff.manage"),
      "role permissions listed",
    );
    equal(
      (await audits(nightAccount))
        .filter((a) => a.action.startsWith("ADMIN_STAFF_"))
        .map((a) => a.action),
      [
        "ADMIN_STAFF_CREATED",
        "ADMIN_STAFF_ROLES_UPDATED",
        "ADMIN_STAFF_ROLES_UPDATED",
        "ADMIN_STAFF_PASSWORD_RESET",
        "ADMIN_STAFF_SUSPENDED",
        "ADMIN_STAFF_REACTIVATED",
        "ADMIN_STAFF_TOTP_CLEARED",
      ],
      "every staff change audited",
    );

    stage = "broker staff";
    const brokerAccount = randomUUID(),
      brokerIdentity = randomUUID();
    const broker = await create({
      loginName: "mina.park",
      displayName: "Mina Park",
      roleKeys: ["studio:broker"],
      accountId: brokerAccount,
      identityId: brokerIdentity,
      subjectDigest: digest(),
      passwordHash: hash(),
    });
    equal(
      [broker.kind, broker.member.roleKeys, broker.member.mustChangePassword],
      ["STAFF_SAVED", ["studio:broker"], true],
      "the staff page creates a broker account",
    );
    equal(
      (
        await q(
          `SELECT p.permission_key FROM admin_identity_roles ar JOIN role_permissions rp ON rp.role_id=ar.role_id
          JOIN permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=$1 ORDER BY 1`,
          [brokerIdentity],
        )
      ).map((row) => row.permission_key),
      [...adminStandardRolePermissions("studio:broker")].sort(),
      "a broker holds management.assigned and nothing of the studio's own permissions",
    );
    const movedRole = await staff(ownerSession, {
      action: "UPDATE_ROLES",
      accountId: brokerAccount,
      expectedVersion: broker.member.version,
      roleKeys: ["studio:operator"],
    });
    equal(
      movedRole.member.roleKeys,
      ["studio:operator"],
      "a broker can be moved to another standard role",
    );
    equal(
      (
        await staff(ownerSession, {
          action: "UPDATE_ROLES",
          accountId: brokerAccount,
          expectedVersion: movedRole.member.version,
          roleKeys: ["studio:broker"],
        })
      ).member.roleKeys,
      ["studio:broker"],
      "and back to broker",
    );

    stage = "0052 triggers";
    const nonLocal = randomUUID();
    await rejects("a built-in account needs a built-in identity", [
      [
        "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'https://idp.example.test',$2,'ACTIVE')",
        [nonLocal, randomBytes(32)],
      ],
      [
        "INSERT INTO admin_local_accounts(id,admin_identity_id,login_name,display_name,password_hash,password_changed_at,must_change_password) VALUES($1,$2,'oidc.person','OIDC person',$3,clock_timestamp(),false)",
        [randomUUID(), nonLocal, hash()],
      ],
    ]);
    await rejects(
      "updates must bump the version",
      [
        [
          "UPDATE admin_local_accounts SET display_name='Owner' WHERE id=$1",
          [ownerAccount],
        ],
      ],
      ["40001"],
    );
    await rejects(
      "the login name is immutable",
      [
        [
          "UPDATE admin_local_accounts SET login_name='studio.boss',version=version+1 WHERE id=$1",
          [ownerAccount],
        ],
      ],
      ["55000"],
    );
    await rejects("a password change needs a new timestamp", [
      [
        "UPDATE admin_local_accounts SET password_hash=$2,version=version+1 WHERE id=$1",
        [ownerAccount, hash()],
      ],
    ]);
    await rejects("accepted TOTP steps never move backwards", [
      [
        "UPDATE admin_local_accounts SET totp_last_step=totp_last_step-1,version=version+1 WHERE id=$1",
        [ownerAccount],
      ],
    ]);
    for (const [label, value] of [
      ["too short", "enc:v1:" + "A".repeat(31)],
      ["outside the base64url alphabet", "enc:v1:" + "A+/=".repeat(10)],
      ["too long", "enc:v1:" + "A".repeat(4097)],
      ["unversioned", "enc:v2:" + "A".repeat(40)],
    ])
      await rejects(`0055 format check rejects a secret ${label}`, [
        [
          "UPDATE admin_local_accounts SET totp_ciphertext=$2,version=version+1 WHERE id=$1",
          [ownerAccount, value],
        ],
      ]);
    await accepts("0055 format check accepts the longest envelope", [
      [
        "UPDATE admin_local_accounts SET totp_encrypted_data_key=$2,version=version+1 WHERE id=$1",
        [ownerAccount, "enc:v1:" + "A".repeat(4096)],
      ],
    ]);
    await rejects("second-factor columns are all or nothing", [
      [
        "UPDATE admin_local_accounts SET totp_key_version=NULL,version=version+1 WHERE id=$1",
        [ownerAccount],
      ],
    ]);
    for (const table of [
      "admin_local_accounts",
      "admin_local_recovery_codes",
      "admin_local_logins",
    ]) {
      await rejects(
        `${table} rejects DELETE`,
        [[`DELETE FROM ${table}`]],
        ["55000"],
      );
      await rejects(
        `${table} rejects TRUNCATE`,
        [[`TRUNCATE ${table} CASCADE`]],
        ["55000"],
      );
    }
    const [usedCode] = await q(
      "SELECT id FROM admin_local_recovery_codes WHERE used_at IS NOT NULL LIMIT 1",
    );
    await rejects(
      "a used recovery code cannot be reused",
      [
        [
          "UPDATE admin_local_recovery_codes SET used_at=clock_timestamp() WHERE id=$1",
          [usedCode.id],
        ],
      ],
      ["55000"],
    );
    await rejects(
      "a used recovery code cannot be revived",
      [
        [
          "UPDATE admin_local_recovery_codes SET used_at=NULL WHERE id=$1",
          [usedCode.id],
        ],
      ],
      ["55000"],
    );
    await rejects("recovery codes start unused", [
      [
        "INSERT INTO admin_local_recovery_codes(id,account_id,batch_id,code_digest,used_at) VALUES($1,$2,$3,$4,clock_timestamp())",
        [randomUUID(), ownerAccount, randomUUID(), randomBytes(32)],
      ],
    ]);
    const pendingLogin = await start(ownerAccount, ownerHash);
    await rejects("login steps move one at a time", [
      [
        "UPDATE admin_local_logins SET step_attempts=2 WHERE id=$1",
        [pendingLogin.loginId],
      ],
    ]);
    await rejects(
      "login binding is immutable",
      [
        [
          "UPDATE admin_local_logins SET locale='ja' WHERE id=$1",
          [pendingLogin.loginId],
        ],
      ],
      ["55000"],
    );
    const twoStep = randomUUID();
    await rejects("the chosen second factor cannot change", [
      [
        "INSERT INTO admin_local_logins(id,account_id,challenge_digest,locale,needs_second_factor,needs_new_password,created_at,expires_at) VALUES($1,$2,$3,'en',true,true,clock_timestamp(),clock_timestamp()+interval '60 seconds')",
        [twoStep, ownerAccount, randomBytes(32)],
      ],
      [
        "UPDATE admin_local_logins SET second_factor='TOTP' WHERE id=$1",
        [twoStep],
      ],
      [
        "UPDATE admin_local_logins SET second_factor='RECOVERY_CODE' WHERE id=$1",
        [twoStep],
      ],
    ]);
    await rejects("a login starts pending", [
      [
        "INSERT INTO admin_local_logins(id,account_id,locale,needs_second_factor,needs_new_password,state,created_at,expires_at,completed_at) VALUES($1,$2,'en',false,false,'CONSUMED',clock_timestamp(),clock_timestamp()+interval '60 seconds',clock_timestamp())",
        [randomUUID(), ownerAccount],
      ],
    ]);
    await rejects("a login lives at most 300 seconds", [
      [
        "INSERT INTO admin_local_logins(id,account_id,locale,needs_second_factor,needs_new_password,created_at,expires_at) VALUES($1,$2,'en',false,false,clock_timestamp(),clock_timestamp()+interval '301 seconds')",
        [randomUUID(), ownerAccount],
      ],
    ]);
    // Consumption: one fixture builder, then each variant breaks exactly one rule.
    async function consumption(label, variant, expectAccepted = false) {
      const loginId = randomUUID(),
        sessionId = randomUUID(),
        auditId = randomUUID();
      const v = {
        needsSecond: false,
        factor: "NONE",
        mfa: true,
        reason: "AUTHENTICATED_PASSWORD",
        action: "ADMIN_LOCAL_LOGIN_SUCCEEDED",
        outcome: "SUCCEEDED",
        task: "admin-local-access",
        ttl: 3600,
        session: true,
        ...variant,
      };
      const statements = [
        [
          "INSERT INTO admin_local_logins(id,account_id,challenge_digest,locale,needs_second_factor,needs_new_password,created_at,expires_at) VALUES($1,$2,$3,'en',$4,false,clock_timestamp(),clock_timestamp()+interval '60 seconds')",
          [
            loginId,
            ownerAccount,
            v.needsSecond ? randomBytes(32) : null,
            v.needsSecond,
          ],
        ],
        // One completion instant shared by the session, the audit and the login.
        [
          "CREATE TEMP TABLE t_now ON COMMIT DROP AS SELECT clock_timestamp() AS t",
        ],
      ];
      if (v.session)
        statements.push([
          `INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,last_seen_at,expires_at)
          SELECT $1,$2,$3,$4,$5,t,t,t+$6::integer*interval '1 second' FROM t_now`,
          [
            sessionId,
            ownerIdentity,
            randomBytes(32),
            randomBytes(32),
            v.mfa,
            v.ttl,
          ],
        ]);
      statements.push([
        `INSERT INTO audit_logs(id,actor_type,task_name,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)
        SELECT $1,'SYSTEM',$2,$3,'ADMIN_LOCAL_LOGIN',$4,$5,$6,$4,$7,t FROM t_now`,
        [auditId, v.task, v.action, loginId, v.reason, randomUUID(), v.outcome],
      ]);
      statements.push([
        "UPDATE admin_local_logins SET state='CONSUMED',second_factor=$2,completed_at=(SELECT t FROM t_now),session_id=$3,audit_log_id=$4 WHERE id=$1",
        [loginId, v.factor, v.session ? sessionId : null, auditId],
      ]);
      if (expectAccepted) await accepts(label, statements);
      else await rejects(label, statements);
    }
    await consumption("an exact password-only success commits", {}, true);
    await consumption(
      "an exact rejection commits",
      {
        session: false,
        action: "ADMIN_LOCAL_LOGIN_REJECTED",
        outcome: "REJECTED",
        reason: "ACCESS_DENIED",
      },
      true,
    );
    await consumption("the audit must come from the built-in login task", {
      task: "admin-access",
    });
    await consumption("the reason must match the factor used", {
      reason: "AUTHENTICATED_TOTP",
    });
    await consumption("a needed second factor must be used", {
      needsSecond: true,
      reason: "AUTHENTICATED_PASSWORD",
    });
    await consumption("the session must meet the platform policy", {
      mfa: false,
    });
    await consumption("sessions last at most eight hours", { ttl: 28_801 });
    await consumption("a rejection names an allowed reason", {
      session: false,
      action: "ADMIN_LOCAL_LOGIN_REJECTED",
      outcome: "REJECTED",
      reason: "IDENTITY_REJECTED",
    });
    await consumption("a success cannot be recorded as a rejection", {
      action: "ADMIN_LOCAL_LOGIN_REJECTED",
      outcome: "REJECTED",
      reason: "ACCESS_DENIED",
    });
    // Issued built-in sessions: immutable, never deleted, revoked only with an exact audit.
    const guarded = await start(
      nightAccount,
      (await account(nightAccount)).password_hash,
    );
    const guardedSession =
      guarded.result.kind === "SESSION_SAVED"
        ? guarded.m
        : (
            await complete(guarded, {
              kind: "NEW_PASSWORD",
              previousPasswordHash: (await account(nightAccount)).password_hash,
              newPasswordHash: hash(),
            })
          ).m;
    await rejects(
      "an issued session cannot be deleted",
      [["DELETE FROM admin_sessions WHERE id=$1", [guardedSession.sessionId]]],
      ["55000"],
    );
    await rejects(
      "an issued session binding is immutable",
      [
        [
          "UPDATE admin_sessions SET csrf_token_digest=$2 WHERE id=$1",
          [guardedSession.sessionId, randomBytes(32)],
        ],
      ],
      ["55000"],
    );
    await rejects("revocation needs an audit", [
      [
        "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
        [guardedSession.sessionId],
      ],
    ]);
    const revokeWith = (reason, actor) => [
      [
        "CREATE TEMP TABLE r_now ON COMMIT DROP AS SELECT clock_timestamp() AS t",
      ],
      [
        `INSERT INTO audit_logs(id,actor_type,actor_id,task_name,action,subject_type,subject_id,reason_code,request_id,outcome,created_at)
        SELECT $1,$2,$3,$4,'ADMIN_SESSIONS_REVOKED','ADMIN_SESSION',$5,$6,$7,'SUCCEEDED',t FROM r_now`,
        [
          randomUUID(),
          actor.type,
          actor.type === "ADMIN" ? ownerIdentity : null,
          actor.type === "SYSTEM" ? actor.task : null,
          guardedSession.sessionId,
          reason,
          randomUUID(),
        ],
      ],
      [
        "UPDATE admin_sessions SET revoked_at=(SELECT t FROM r_now) WHERE id=$1",
        [guardedSession.sessionId],
      ],
    ];
    await rejects(
      "revocation reason must be allowed",
      revokeWith("USER_BORED", { type: "ADMIN" }),
    );
    await rejects(
      "only the server command may revoke as SYSTEM",
      revokeWith("ACCOUNT_SUSPENDED", {
        type: "SYSTEM",
        task: "admin-local-access",
      }),
    );
    await accepts(
      "the server command revokes with an exact audit",
      revokeWith("ACCOUNT_SUSPENDED", {
        type: "SYSTEM",
        task: "admin-account-cli",
      }),
    );
    await rejects(
      "revocation is final",
      [
        [
          "UPDATE admin_sessions SET revoked_at=NULL WHERE id=$1",
          [guardedSession.sessionId],
        ],
      ],
      ["55000"],
    );
    const down = await readFile(
      path.join(
        workspaceRoot,
        "database/migrations/0052_admin-local-accounts.down.sql",
      ),
      "utf8",
    );
    await rejects(
      "0052 refuses to downgrade built-in account history",
      [[down]],
      ["55000"],
    );
    const down55 = await readFile(
      path.join(
        workspaceRoot,
        "database/migrations/0055_admin-local-secret-format.down.sql",
      ),
      "utf8",
    );
    await rejects(
      "0055 refuses to restore the 0052 checks over stored secrets",
      [[down55]],
      ["55000"],
    );
    const invariant = await q(
      "SELECT count(*)::int AS n FROM admin_local_logins l LEFT JOIN audit_logs a ON a.id=l.audit_log_id WHERE l.state='CONSUMED' AND a.id IS NULL",
    );
    equal(invariant[0].n, 0, "every consumed login has its audit");
    console.log(
      JSON.stringify({
        result: "PASS",
        checks,
        logins: (
          await q("SELECT count(*)::int AS n FROM admin_local_logins")
        )[0].n,
        audits: (await q("SELECT count(*)::int AS n FROM audit_logs"))[0].n,
        sha: createHash("sha256").update(down).digest("hex").slice(0, 12),
      }),
    );
  } catch (error) {
    // Synthetic fixtures only; the message carries no secret.
    console.error(
      JSON.stringify({
        result: "FAIL",
        stage,
        checks,
        passed,
        code: error?.code,
        message: String(error?.message).slice(0, 2000),
      }),
    );
    throw error;
  } finally {
    await client.end();
    await persistence.close();
  }
});
