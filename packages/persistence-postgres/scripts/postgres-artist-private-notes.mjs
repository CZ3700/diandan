// ADR-022 / L3-13 on real PostgreSQL: 0062 round trip, the second-factor gate, versioned saves, audited reads
// and the database guards against direct writes. Sign-ins are hand-made rows that satisfy the 0052 checks
// (password, TOTP or recovery code), so this proves the notes' gate, not the sign-in flow itself.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import {
  ADMIN_STAFF_ROLE_KEYS,
  adminPermissionKeySchema,
  adminStandardRolePermissions,
} from "@fan-support/contracts";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { createAdminArtistNoteRepository } from "../dist/admin-artist-notes-repository.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const failures = [];
let assertions = 0;
function check(condition, label, detail) {
  assertions += 1;
  if (!condition)
    failures.push(
      detail === undefined ? label : `${label} — ${JSON.stringify(detail)}`,
    );
}
const equal = (actual, expected, label) =>
  check(JSON.stringify(actual) === JSON.stringify(expected), label, {
    actual,
    expected,
  });
const sealed = () => `enc:v1:${randomBytes(48).toString("base64url")}`;
const envelope = () => ({
  ciphertext: sealed(),
  encryptedDataKey: sealed(),
  keyVersion: "local-test-1",
  algorithm: "AES_256_GCM",
});

async function roundTrip() {
  await withEphemeralPostgres(async (configuration) => {
    const migrate = (command) =>
      runMigrations({ clientConfig: configuration, workspaceRoot, command });
    await migrate({ direction: "up", targetVersion: "0061" });
    const client = new Client(configuration);
    await client.connect();
    try {
      const tables = async () =>
        (
          await client.query(
            "SELECT to_regclass('public.artist_private_notes') n,to_regclass('public.artist_private_note_accesses') a,to_regclass('public.artist_private_note_confirmations') c,to_regprocedure('public.artist_private_note_authorized(uuid,uuid,timestamptz)') f",
          )
        ).rows[0];
      equal(
        await tables(),
        { n: null, a: null, c: null, f: null },
        "before 0062 there are no note tables",
      );
      // Where sync-roles ran after L3-11 the key already exists; 0062 must accept that.
      await client.query(
        "INSERT INTO permissions(id,permission_key,description) VALUES(gen_random_uuid(),'idols.private','Platform permission')",
      );
      await migrate({ direction: "up", targetVersion: "0062" });
      const applied = await tables();
      check(
        applied.n && applied.a && applied.c && applied.f,
        "0062 adds the notes, accesses, confirmations and the gate",
        applied,
      );
      equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM permissions WHERE permission_key='idols.private'",
          )
        ).rows[0].n,
        1,
        "0062 keeps the one idols.private row sync-roles already made",
      );
      await migrate({ direction: "down", confirmVersion: "0062" });
      equal(
        {
          ...(await tables()),
          keys: (
            await client.query(
              "SELECT count(*)::int n FROM permissions WHERE permission_key='idols.private'",
            )
          ).rows[0].n,
        },
        { n: null, a: null, c: null, f: null, keys: 0 },
        "a clean down drops the tables, the gate and the key",
      );
      await migrate({ direction: "up", targetVersion: "0062" });
      check(Boolean((await tables()).n), "0062 re-applies after a clean down");
    } finally {
      await client.end();
    }
  });
}

async function behavior() {
  await withEphemeralPostgres(async (configuration) => {
    const migrate = (command) =>
      runMigrations({ clientConfig: configuration, workspaceRoot, command });
    await migrate({ direction: "up" });
    const client = new Client(configuration);
    await client.connect();
    const q = async (text, values = []) =>
      (await client.query(text, values)).rows;
    const scope = {
      trackOperation: (work) => work(),
      markRollbackOnly: () => undefined,
    };
    async function tx(work) {
      await client.query("BEGIN");
      try {
        const result = await work(
          createAdminArtistNoteRepository(client, scope),
        );
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        return { thrown: `${error.code ?? error.name}: ${error.message}` };
      }
    }
    /** Direct SQL in its own transaction; resolves to COMMIT or the refusing guard's message. */
    async function sql(statements) {
      await client.query("BEGIN");
      try {
        for (const [text, values] of statements)
          await client.query(text, values ?? []);
        await client.query("COMMIT");
        return "COMMIT";
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        return `${error.code}: ${error.message}`;
      }
    }
    try {
      // ---------- Staff: what the server command provisions ----------
      const past = "transaction_timestamp()-interval '10 minutes'";
      await client.query("BEGIN");
      for (const key of adminPermissionKeySchema.options)
        await client.query(
          `INSERT INTO permissions(id,permission_key,description,created_at) VALUES($1,$2,'Platform permission',${past}) ON CONFLICT (permission_key) DO NOTHING`,
          [randomUUID(), key],
        );
      for (const role of ADMIN_STAFF_ROLE_KEYS) {
        await client.query(
          `INSERT INTO roles(id,role_key,description,created_at) VALUES($1,$2,'Standard role',${past})`,
          [randomUUID(), role],
        );
        await client.query(
          `INSERT INTO role_permissions(role_id,permission_id,granted_at) SELECT r.id,p.id,${past} FROM roles r JOIN permissions p ON p.permission_key=ANY($2::text[]) WHERE r.role_key=$1`,
          [role, adminStandardRolePermissions(role)],
        );
      }
      await client.query("COMMIT");

      const people = {};
      async function enableTotp(accountId) {
        await client.query(
          "UPDATE admin_local_accounts SET totp_ciphertext=$2,totp_encrypted_data_key=$3,totp_key_version='local-test-1',totp_enabled_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [accountId, sealed(), sealed()],
        );
      }
      async function disableTotp(accountId) {
        await client.query(
          "UPDATE admin_local_accounts SET totp_ciphertext=NULL,totp_encrypted_data_key=NULL,totp_key_version=NULL,totp_enabled_at=NULL,totp_last_step=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [accountId],
        );
      }
      /**
       * signIn: TOTP | RECOVERY_CODE | PASSWORD make a consumed built-in sign-in with that factor;
       * DIRECT makes a session with no built-in sign-in, as an identity-provider session would be.
       * totp: BEFORE enables TOTP before signing in, AFTER enables it afterwards (the session keeps its factor).
       */
      async function person(key, role, displayName, { signIn, totp }) {
        const identity = randomUUID(),
          account = randomUUID(),
          session = randomUUID(),
          sessionToken = randomBytes(32),
          csrfToken = randomBytes(32);
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required,created_at) VALUES($1,'urn:fan-support:local',$2,'ACTIVE',false,${past})`,
          [identity, randomBytes(32)],
        );
        await client.query(
          `INSERT INTO admin_local_accounts(id,admin_identity_id,login_name,display_name,password_hash,password_changed_at,must_change_password,created_at,updated_at) VALUES($1,$2,$3,$4,$5,${past},false,${past},${past})`,
          [
            account,
            identity,
            key.toLowerCase(),
            displayName,
            `scrypt$1$32768$8$1$${randomBytes(16).toString("base64url")}$${randomBytes(32).toString("base64url")}`,
          ],
        );
        if (role)
          await client.query(
            `INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by,granted_at) SELECT $1,id,$1,${past} FROM roles WHERE role_key=$2`,
            [identity, role],
          );
        if (totp === "BEFORE") await enableTotp(account);
        await client.query("COMMIT");
        await client.query("BEGIN");
        const login = randomUUID(),
          coded = signIn === "TOTP" || signIn === "RECOVERY_CODE";
        // The sign-in starts first; its completion instant is shared by the session, the audit and the login.
        if (signIn !== "DIRECT")
          await client.query(
            "INSERT INTO admin_local_logins(id,account_id,challenge_digest,locale,needs_second_factor,needs_new_password,created_at,expires_at) VALUES($1,$2,$3,'en',$4,false,clock_timestamp(),clock_timestamp()+interval '60 seconds')",
            [login, account, coded ? randomBytes(32) : null, coded],
          );
        await client.query(
          "CREATE TEMP TABLE t_now ON COMMIT DROP AS SELECT clock_timestamp() AS t",
        );
        await client.query(
          `INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,last_seen_at,expires_at)
          SELECT $1,$2,$3,$4,true,t,t,t+interval '1 hour' FROM t_now`,
          [session, identity, sessionToken, csrfToken],
        );
        if (signIn !== "DIRECT") {
          const audit = randomUUID();
          await client.query(
            `INSERT INTO audit_logs(id,actor_type,task_name,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)
            SELECT $1,'SYSTEM','admin-local-access','ADMIN_LOCAL_LOGIN_SUCCEEDED','ADMIN_LOCAL_LOGIN',$2,$3,$4,$2,'SUCCEEDED',t FROM t_now`,
            [
              audit,
              login,
              {
                TOTP: "AUTHENTICATED_TOTP",
                RECOVERY_CODE: "AUTHENTICATED_RECOVERY_CODE",
                PASSWORD: "AUTHENTICATED_PASSWORD",
              }[signIn],
              randomUUID(),
            ],
          );
          await client.query(
            "UPDATE admin_local_logins SET state='CONSUMED',second_factor=$2,completed_at=(SELECT t FROM t_now),session_id=$3,audit_log_id=$4 WHERE id=$1",
            [login, coded ? signIn : "NONE", session, audit],
          );
        }
        await client.query("COMMIT");
        if (totp === "AFTER") {
          await client.query("BEGIN");
          await enableTotp(account);
          await client.query("COMMIT");
        }
        people[key] = {
          actorId: identity,
          accountId: account,
          sessionId: session,
          displayName,
          access: () => ({
            schemaVersion: 1,
            sessionTokenDigest: sessionToken.toString("hex"),
            csrfTokenDigest: csrfToken.toString("hex"),
            requestId: randomUUID(),
            correlationId: randomUUID(),
          }),
        };
      }
      await person("owner", "studio:owner", "Studio Owner", {
        signIn: "TOTP",
        totp: "BEFORE",
      });
      await person("recovered", "studio:owner", "Night Owner", {
        signIn: "RECOVERY_CODE",
        totp: "BEFORE",
      });
      await person("nototp", "studio:owner", "Plain Owner", {
        signIn: "PASSWORD",
      });
      await person("latetotp", "studio:owner", "Late Owner", {
        signIn: "PASSWORD",
        totp: "AFTER",
      });
      await person("direct", "studio:owner", "Provider Owner", {
        signIn: "DIRECT",
        totp: "BEFORE",
      });
      await person("operator", "studio:operator", "Night Shift", {
        signIn: "TOTP",
        totp: "BEFORE",
      });
      await person("broker", "studio:broker", "Mina Park", {
        signIn: "TOTP",
        totp: "BEFORE",
      });
      const { owner, recovered, nototp, latetotp, direct, operator, broker } =
        people;

      const artist = randomUUID(),
        other = randomUUID();
      // Artists are replica-seeded: the notes only need the rows to exist.
      equal(
        await sql([
          ["SET LOCAL session_replication_role=replica"],
          [
            "INSERT INTO idols(id,handle,status,accepting_gifts,version) VALUES($1,'notes-a1','active',true,2),($2,'notes-a2','active',true,2)",
            [artist, other],
          ],
        ]),
        "COMMIT",
        "two artists are seeded",
      );

      const command = (who, body) => ({
        schemaVersion: 1,
        access: who.access(),
        command: { schemaVersion: 1, ...body },
      });
      const execute = (who, body) =>
        tx((repo) => repo.execute(command(who, body)));
      const context = (who, artistId = artist) =>
        execute(who, { action: "CONTEXT", artistId });
      const save = (who, body) =>
        execute(who, {
          action: "SAVE",
          artistId: artist,
          noteId: randomUUID(),
          envelope: envelope(),
          ...body,
        });
      const prepare = (who, body) =>
        tx((repo) =>
          repo.prepareRead(
            command(who, { action: "READ", artistId: artist, ...body }),
          ),
        );
      const confirm = (who, accessId) =>
        tx((repo) =>
          repo.confirmRead({
            schemaVersion: 1,
            access: who.access(),
            accessId,
          }),
        );
      const audits = async (action) =>
        (
          await q(
            "SELECT count(*)::int n FROM audit_logs WHERE action=$1 AND subject_type='IDOL' AND field_category='ARTIST_PRIVATE'",
            [action],
          )
        )[0].n;
      const failure = (code) => ({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });

      // ---------- Who sees the section, and why it is locked ----------
      equal(
        await context(owner),
        {
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "CONTEXT",
          artistId: artist,
          gate: "READY",
          versions: [],
        },
        "an owner signed in with a TOTP code is ready, with no notes yet",
      );
      equal(
        (await context(recovered)).gate,
        "READY",
        "a recovery code counts as the second factor",
      );
      equal(
        (await context(nototp)).gate,
        "TOTP_NOT_ENABLED",
        "an owner without TOTP is told to turn it on",
      );
      equal(
        (await context(latetotp)).gate,
        "SIGN_IN_WITHOUT_CODE",
        "turning TOTP on after signing in does not upgrade the session",
      );
      equal(
        (await context(direct)).gate,
        "SIGN_IN_WITHOUT_CODE",
        "a session without a built-in sign-in never qualifies",
      );
      equal(
        await context(operator),
        failure("FORBIDDEN"),
        "daily operations never see private notes",
      );
      equal(
        await context(broker),
        failure("FORBIDDEN"),
        "brokers never see private notes",
      );
      equal(
        await context(owner, randomUUID()),
        failure("NOT_FOUND"),
        "an unknown artist is reported only to accounts holding idols.private",
      );
      equal(
        await context(operator, randomUUID()),
        failure("FORBIDDEN"),
        "and stays forbidden for everyone else",
      );

      // ---------- Saving ----------
      const firstId = randomUUID(),
        first = envelope();
      const saved = await save(owner, {
        noteId: firstId,
        expectedVersion: 0,
        envelope: first,
      });
      equal(
        {
          kind: saved.kind,
          version: saved.note?.version,
          by: saved.note?.savedBy,
        },
        { kind: "SAVED", version: 1, by: "Studio Owner" },
        "the first save is version 1, named after its author",
      );
      const replay = await save(owner, {
        noteId: firstId,
        expectedVersion: 0,
        envelope: envelope(),
      });
      equal(
        replay.note,
        saved.note,
        "resending the same save returns the version it made",
      );
      equal(
        (await q("SELECT count(*)::int n FROM artist_private_notes"))[0].n,
        1,
        "and writes nothing new",
      );
      equal(
        await save(owner, {
          noteId: firstId,
          artistId: other,
          expectedVersion: 0,
        }),
        failure("INVALID_COMMAND"),
        "a version id is never reused for another artist",
      );
      equal(
        await save(owner, { expectedVersion: 0 }),
        failure("STALE_VERSION"),
        "a save from a stale editor is refused",
      );
      const second = await save(recovered, { expectedVersion: 1 });
      equal(
        { version: second.note?.version, by: second.note?.savedBy },
        { version: 2, by: "Night Owner" },
        "another owner continues the history",
      );
      const beforeRefusals = await audits("ARTIST_PRIVATE_NOTE_SAVED");
      for (const [who, code, label] of [
        [nototp, "SECOND_FACTOR_REQUIRED", "without TOTP"],
        [latetotp, "SECOND_FACTOR_REQUIRED", "on a sign-in without a code"],
        [direct, "SECOND_FACTOR_REQUIRED", "without a built-in sign-in"],
        [operator, "FORBIDDEN", "as daily operations"],
        [broker, "FORBIDDEN", "as a broker"],
      ])
        equal(
          await save(who, { expectedVersion: 2 }),
          failure(code),
          `saving ${label} is refused`,
        );
      equal(
        {
          audits: await audits("ARTIST_PRIVATE_NOTE_SAVED"),
          rows: (await q("SELECT count(*)::int n FROM artist_private_notes"))[0]
            .n,
        },
        { audits: beforeRefusals, rows: 2 },
        "refused saves leave no audit and no version",
      );
      equal(beforeRefusals, 2, "each version has exactly one save audit");
      const listed = await context(owner);
      equal(
        listed.versions?.map((v) => [v.version, v.savedBy]),
        [
          [2, "Night Owner"],
          [1, "Studio Owner"],
        ],
        "the context lists versions newest first, without content",
      );
      check(
        !JSON.stringify(listed).includes("enc:v1:"),
        "the context carries no ciphertext",
      );
      equal(
        (await context(owner, other)).versions,
        [],
        "versions belong to their own artist",
      );

      // ---------- Reading ----------
      const readsBefore = await audits("ARTIST_PRIVATE_READ");
      const snapshot = await prepare(owner, { noteId: firstId });
      equal(
        {
          kind: snapshot.kind,
          version: snapshot.note?.version,
          envelope: snapshot.envelope,
        },
        { kind: "NOTE_SNAPSHOT", version: 1, envelope: first },
        "a prepared read hands back the stored envelope of that version",
      );
      const [receipt] = await q(
        "SELECT actor_id,session_id,note_id,extract(epoch from expires_at-created_at) ttl FROM artist_private_note_accesses WHERE id=$1",
        [snapshot.accessId],
      );
      equal(
        {
          actor: receipt?.actor_id,
          session: receipt?.session_id,
          note: receipt?.note_id,
          short: Number(receipt?.ttl) <= 300,
        },
        {
          actor: owner.actorId,
          session: owner.sessionId,
          note: firstId,
          short: true,
        },
        "the access receipt names the reader, the session and the version, for at most five minutes",
      );
      equal(
        await audits("ARTIST_PRIVATE_READ"),
        readsBefore + 1,
        "the read is audited before anything is decrypted",
      );
      equal(
        await confirm(owner, snapshot.accessId),
        {
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "PRIVATE_CONFIRMED",
          accessId: snapshot.accessId,
        },
        "the same session confirms its read",
      );
      equal(
        await confirm(recovered, snapshot.accessId),
        failure("PRIVATE_ACCESS_EXPIRED"),
        "another session cannot confirm someone else's read",
      );
      const readRefusals = await audits("ARTIST_PRIVATE_READ");
      for (const [who, code, label] of [
        [nototp, "SECOND_FACTOR_REQUIRED", "without TOTP"],
        [latetotp, "SECOND_FACTOR_REQUIRED", "on a sign-in without a code"],
        [direct, "SECOND_FACTOR_REQUIRED", "without a built-in sign-in"],
        [operator, "FORBIDDEN", "as daily operations"],
        [broker, "FORBIDDEN", "as a broker"],
      ])
        equal(
          await prepare(who, { noteId: firstId }),
          failure(code),
          `reading ${label} is refused`,
        );
      equal(
        await prepare(owner, { noteId: firstId, artistId: other }),
        failure("NOT_FOUND"),
        "a version is only readable through its own artist",
      );
      equal(
        await audits("ARTIST_PRIVATE_READ"),
        readRefusals,
        "refused reads leave no audit",
      );

      // Switching TOTP off keeps the current session alive; the notes must close anyway.
      const pending = await prepare(recovered, { noteId: firstId });
      await client.query("BEGIN");
      await disableTotp(recovered.accountId);
      await client.query("COMMIT");
      equal(
        (await context(recovered)).gate,
        "TOTP_NOT_ENABLED",
        "after TOTP is switched off the same session is locked out",
      );
      equal(
        await confirm(recovered, pending.accessId),
        failure("SECOND_FACTOR_REQUIRED"),
        "and a read prepared before cannot be confirmed",
      );
      equal(
        await save(recovered, { expectedVersion: 2 }),
        failure("SECOND_FACTOR_REQUIRED"),
        "nor can it save",
      );

      // An access past its time cannot be confirmed (made directly with a one-second life).
      const shortAccess = randomUUID(),
        shortAudit = randomUUID(),
        shortRequest = randomUUID();
      equal(
        await sql([
          [
            "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'ARTIST_PRIVATE_READ','IDOL',$3,$4,$4,'SUCCEEDED','ARTIST_PRIVATE')",
            [shortAudit, owner.actorId, artist, shortRequest],
          ],
          [
            "INSERT INTO artist_private_note_accesses(id,actor_id,session_id,idol_id,note_id,audit_log_id,request_id,correlation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7,transaction_timestamp()+interval '1 second')",
            [
              shortAccess,
              owner.actorId,
              owner.sessionId,
              artist,
              firstId,
              shortAudit,
              shortRequest,
            ],
          ],
        ]),
        "COMMIT",
        "an exact direct read receipt for a qualified session commits",
      );
      await delay(1300);
      equal(
        await confirm(owner, shortAccess),
        failure("PRIVATE_ACCESS_EXPIRED"),
        "an access past its time cannot be confirmed",
      );

      // ---------- Direct writes the database refuses ----------
      const noteRow = (who, version, audit, request) => [
        "INSERT INTO artist_private_notes(id,idol_id,version,actor_id,session_id,ciphertext,encrypted_data_key,key_version,audit_log_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,'local-test-1',$8,$9)",
        [
          randomUUID(),
          artist,
          version,
          who.actorId,
          who.sessionId,
          randomBytes(48),
          randomBytes(48),
          audit,
          request,
        ],
      ];
      const auditRow = (
        who,
        audit,
        request,
        action = "ARTIST_PRIVATE_NOTE_SAVED",
      ) => [
        "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,$3,'IDOL',$4,$5,$5,'SUCCEEDED','ARTIST_PRIVATE')",
        [audit, who.actorId, action, artist, request],
      ];
      const forged = async (who, version, withAudit = true) => {
        const audit = randomUUID(),
          request = randomUUID();
        return sql(
          withAudit
            ? [
                auditRow(who, audit, request),
                noteRow(who, version, audit, request),
              ]
            : [
                auditRow(who, audit, request, "ARTIST_PRIVATE_READ"),
                noteRow(who, version, audit, request),
              ],
        );
      };
      check(
        String(await forged(owner, 3, false)).includes(
          "private note requires its exact audit record",
        ),
        "a version without its save audit is refused",
      );
      for (const [who, label] of [
        [operator, "daily operations"],
        [broker, "a broker"],
        [latetotp, "a sign-in without a code"],
        [direct, "a session without a built-in sign-in"],
        [nototp, "an account without TOTP"],
      ])
        check(
          String(await forged(who, 3)).includes(
            "requires idols.private on a second-factor sign-in",
          ),
          `a version written directly by ${label} is refused`,
        );
      check(
        String(await forged(owner, 5)).includes("continue the artist history"),
        "a version that skips ahead is refused",
      );
      equal(
        await forged(owner, 3),
        "COMMIT",
        "an exact direct version by a qualified owner commits (positive control)",
      );
      for (const [statement, label] of [
        [
          "UPDATE artist_private_notes SET key_version='x'",
          "notes cannot be edited",
        ],
        ["DELETE FROM artist_private_notes", "notes cannot be deleted"],
        ["TRUNCATE artist_private_notes CASCADE", "notes cannot be truncated"],
        [
          "DELETE FROM artist_private_note_accesses",
          "read receipts cannot be deleted",
        ],
        [
          "UPDATE artist_private_note_confirmations SET confirmed_at=clock_timestamp()",
          "confirmations cannot be edited",
        ],
      ])
        check((await sql([[statement]])).startsWith("55000"), label);
      const lateAudit = randomUUID(),
        lateRequest = randomUUID();
      check(
        String(
          await sql([
            auditRow(latetotp, lateAudit, lateRequest, "ARTIST_PRIVATE_READ"),
            [
              "INSERT INTO artist_private_note_accesses(id,actor_id,session_id,idol_id,note_id,audit_log_id,request_id,correlation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7,transaction_timestamp()+interval '60 seconds')",
              [
                randomUUID(),
                latetotp.actorId,
                latetotp.sessionId,
                artist,
                firstId,
                lateAudit,
                lateRequest,
              ],
            ],
          ]),
        ).includes("requires idols.private on a second-factor sign-in"),
        "a read receipt for a sign-in without a code is refused",
      );
      const borrowedAudit = randomUUID(),
        borrowedRequest = randomUUID();
      check(
        String(
          await sql([
            auditRow(
              operator,
              borrowedAudit,
              borrowedRequest,
              "ARTIST_PRIVATE_READ",
            ),
            [
              "INSERT INTO artist_private_note_accesses(id,actor_id,session_id,idol_id,note_id,audit_log_id,request_id,correlation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7,transaction_timestamp()+interval '60 seconds')",
              [
                randomUUID(),
                operator.actorId,
                owner.sessionId,
                artist,
                firstId,
                borrowedAudit,
                borrowedRequest,
              ],
            ],
          ]),
        ).includes("exact session and audit"),
        "a read receipt on someone else's session is refused",
      );
      check(
        String(
          await sql([
            [
              "INSERT INTO artist_private_note_confirmations(access_id) VALUES($1)",
              [pending.accessId],
            ],
          ]),
        ).includes("live same-session authority"),
        "a confirmation after TOTP was switched off is refused directly too",
      );

      // ---------- 0062 refuses to drop history ----------
      const down = readFileSync(
        new URL(
          "../../../database/migrations/0062_artist-private-notes.down.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await client.query("BEGIN");
      const reason = await client.query(down).then(
        () => "APPLIED",
        (error) => `${error.code}: ${error.message}`,
      );
      await client.query("ROLLBACK");
      equal(
        reason,
        "55000: artist private note history cannot be downgraded",
        "0062's down refuses while notes or reads exist",
      );
      await client.end();
      const refused = await migrate({
        direction: "down",
        confirmVersion: "0062",
      }).then(
        () => "MIGRATED",
        (error) => String(error?.message ?? error),
      );
      equal(
        refused,
        "migration 0062 down failed",
        "and the runner leaves 0062 in place",
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          code: error.code ?? error.name,
          message: error.message,
          where: typeof error.where === "string" ? error.where : undefined,
          stack: String(error.stack).split("\n").slice(1, 6),
        }),
      );
      await client.end().catch(() => undefined);
      throw error;
    }
  });
}

await roundTrip();
await behavior();
console.log(
  JSON.stringify({
    status: failures.length === 0 ? "PASS" : "FAIL",
    suite: "artist-private-notes",
    assertions,
    failures,
    evidence:
      "real migrated PostgreSQL through the actual notes repository and direct SQL; sign-ins are exact hand-made rows, envelopes are opaque bytes (encryption is covered by the application and KMS tests)",
  }),
);
process.exitCode = failures.length === 0 ? 0 : 1;
