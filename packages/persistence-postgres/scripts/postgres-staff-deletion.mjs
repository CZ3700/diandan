// ADR-022 / L3-14 on real PostgreSQL: deleting a staff account through the actual staff repository, the 0063
// guards, and a deleted broker's artists going back to the studio. Artists and their first assignments are
// replica-seeded; sign-ins are exact hand-made rows that satisfy the 0052 checks.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import {
  ADMIN_STAFF_ROLE_KEYS,
  adminPermissionKeySchema,
  adminStandardRolePermissions,
} from "@fan-support/contracts";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

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
  check(isDeepStrictEqual(actual, expected), label, {
    actual,
    expected,
  });
const FUNCTIONS =
  "SELECT pg_get_functiondef('public.assert_local_admin_session_revocation_audit()'::regprocedure) revocation, pg_get_functiondef('public.guard_idol_assignment()'::regprocedure) assignment";

async function roundTrip() {
  await withEphemeralPostgres(async (configuration) => {
    const migrate = (command) =>
      runMigrations({ clientConfig: configuration, workspaceRoot, command });
    await migrate({ direction: "up", targetVersion: "0062" });
    const client = new Client(configuration);
    await client.connect();
    try {
      const bodies = async () => (await client.query(FUNCTIONS)).rows[0];
      const before = await bodies();
      await migrate({ direction: "up", targetVersion: "0063" });
      const after = await bodies();
      check(
        after.revocation.includes("ACCOUNT_DELETED") &&
          !before.revocation.includes("ACCOUNT_DELETED"),
        "0063 lets a deletion revoke sessions with its own reason",
      );
      check(
        after.assignment.includes("ARCHIVED") &&
          !before.assignment.includes("ARCHIVED"),
        "0063 lets a deleted broker's archived artists go back to the studio",
      );
      await migrate({ direction: "down", confirmVersion: "0063" });
      equal(
        await bodies(),
        before,
        "down restores the exact 0052 and 0057 functions",
      );
      equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM pg_trigger WHERE tgname IN('admin_identity_archived_final','admin_identity_role_not_archived')",
          )
        ).rows[0].n,
        0,
        "down drops the two deletion guards",
      );
      await migrate({ direction: "up", targetVersion: "0063" });
      equal(await bodies(), after, "0063 re-applies after a clean down");
    } finally {
      await client.end();
    }
  });
}

async function behavior() {
  await withEphemeralPostgres(async (configuration) => {
    const migrate = (command) =>
      runMigrations({ clientConfig: configuration, workspaceRoot, command });
    const migrated = await migrate({ direction: "up" });
    const client = new Client(configuration);
    await client.connect();
    const persistence = createPostgresPersistence(configuration);
    const q = async (text, values = []) =>
      (await client.query(text, values)).rows;
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
      /** A built-in account with a consumed password sign-in, so its session's revocation is audit-checked. */
      async function person(key, role, displayName) {
        const identity = randomUUID(),
          account = randomUUID(),
          session = randomUUID(),
          sessionToken = randomBytes(32),
          csrfToken = randomBytes(32),
          login = randomUUID(),
          audit = randomUUID();
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
            key,
            displayName,
            `scrypt$1$32768$8$1$${randomBytes(16).toString("base64url")}$${randomBytes(32).toString("base64url")}`,
          ],
        );
        if (role)
          await client.query(
            `INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by,granted_at) SELECT $1,id,$1,${past} FROM roles WHERE role_key=$2`,
            [identity, role],
          );
        await client.query("COMMIT");
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO admin_local_logins(id,account_id,challenge_digest,locale,needs_second_factor,needs_new_password,created_at,expires_at) VALUES($1,$2,NULL,'en',false,false,clock_timestamp(),clock_timestamp()+interval '60 seconds')",
          [login, account],
        );
        await client.query(
          "CREATE TEMP TABLE t_now ON COMMIT DROP AS SELECT clock_timestamp() AS t",
        );
        await client.query(
          `INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,last_seen_at,expires_at)
          SELECT $1,$2,$3,$4,true,t,t,t+interval '1 hour' FROM t_now`,
          [session, identity, sessionToken, csrfToken],
        );
        await client.query(
          `INSERT INTO audit_logs(id,actor_type,task_name,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)
          SELECT $1,'SYSTEM','admin-local-access','ADMIN_LOCAL_LOGIN_SUCCEEDED','ADMIN_LOCAL_LOGIN',$2,'AUTHENTICATED_PASSWORD',$3,$2,'SUCCEEDED',t FROM t_now`,
          [audit, login, randomUUID()],
        );
        await client.query(
          "UPDATE admin_local_logins SET state='CONSUMED',second_factor='NONE',completed_at=(SELECT t FROM t_now),session_id=$2,audit_log_id=$3 WHERE id=$1",
          [login, session, audit],
        );
        await client.query("COMMIT");
        people[key] = {
          actorId: identity,
          accountId: account,
          sessionId: session,
          loginName: key,
          credentials: () => ({
            sessionTokenDigest: sessionToken.toString("hex"),
            csrfTokenDigest: csrfToken.toString("hex"),
          }),
        };
      }
      await person("studio.owner", "studio:owner", "Studio Owner");
      await person("second.owner", "studio:owner", "Second Owner");
      await person("night.shift", "studio:operator", "Night Shift");
      await person("mina.park", "studio:broker", "Mina Park");
      await person("rui.tanaka", "studio:broker", "Rui Tanaka");
      await person("idle.broker", "studio:broker", "Idle Broker");
      const owner = people["studio.owner"],
        second = people["second.owner"],
        night = people["night.shift"],
        mina = people["mina.park"],
        rui = people["rui.tanaka"],
        idle = people["idle.broker"];

      const staff = (who, change) =>
        persistence.adminLocalAccessTransactionManager.runInAdminLocalAccessTransaction(
          ({ localStaff }) =>
            localStaff.execute({
              schemaVersion: 1,
              requestId: randomUUID(),
              ...who.credentials(),
              change,
            }),
        );
      const version = async (who) =>
        (
          await q("SELECT version FROM admin_local_accounts WHERE id=$1", [
            who.accountId,
          ])
        )[0].version;
      const remove = async (who, target, overrides = {}) =>
        staff(who, {
          action: "DELETE",
          accountId: target.accountId,
          expectedVersion: Number(await version(target)),
          loginName: target.loginName,
          ...overrides,
        });
      const failure = (code) => ({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });

      // ---------- Artists: three current and one archived for Mina, one for Rui, one unassigned ----------
      const artists = Object.fromEntries(
        ["a1", "a2", "a3", "gone", "r1", "free"].map((key) => [
          key,
          randomUUID(),
        ]),
      );
      const seeded = await sql([
        ["SET LOCAL session_replication_role=replica"],
        ...Object.entries(artists).map(([key, id]) => [
          "INSERT INTO idols(id,handle,status,accepting_gifts,version) VALUES($1,$2,$3,$4,2)",
          [
            id,
            `delete-${key}`,
            key === "gone" ? "archived" : "active",
            key !== "gone",
          ],
        ]),
        ...[
          ["a1", mina],
          ["a2", mina],
          ["a3", mina],
          ["gone", mina],
          ["r1", rui],
        ].flatMap(([key, broker]) => {
          const audit = randomUUID(),
            request = randomUUID();
          return [
            [
              "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at) VALUES($1,'ADMIN',$2,'IDOL_ASSIGNMENT','IDOL',$3,'ASSIGNED',$4,$5,'SUCCEEDED','IDOL_ASSIGNMENT',transaction_timestamp()-interval '5 minutes')",
              [audit, owner.actorId, artists[key], request, owner.sessionId],
            ],
            [
              "INSERT INTO idol_assignments(id,idol_id,sequence,broker_identity_id,previous_broker_identity_id,reason,operation_id,actor_id,session_id,audit_log_id,request_id,created_at) VALUES($1,$2,1,$3,NULL,'ASSIGNED',NULL,$4,$5,$6,$7,transaction_timestamp()-interval '5 minutes')",
              [
                randomUUID(),
                artists[key],
                broker.actorId,
                owner.actorId,
                owner.sessionId,
                audit,
                request,
              ],
            ],
          ];
        }),
      ]);
      equal(seeded, "COMMIT", "artists and their brokers are seeded");
      const current = async (key) =>
        (
          await q("SELECT public.idol_current_broker($1) broker", [
            artists[key],
          ])
        )[0].broker;

      // ---------- The listing tells the administrator what a deletion would hand back ----------
      const listing = await staff(owner, { action: "LIST" });
      const counts = Object.fromEntries(
        (listing.members ?? []).map((m) => [m.loginName, m.assignedArtists]),
      );
      equal(
        counts,
        {
          "studio.owner": 0,
          "second.owner": 0,
          "night.shift": 0,
          "mina.park": 3,
          "rui.tanaka": 1,
          "idle.broker": 0,
        },
        "each member shows its current (not archived) artists",
      );

      // ---------- Refusals ----------
      equal(
        await remove(owner, owner),
        failure("SELF_LOCKOUT"),
        "nobody deletes their own account",
      );
      equal(
        await remove(night, mina),
        failure("FORBIDDEN"),
        "daily operations cannot delete accounts",
      );
      equal(
        await remove(mina, rui),
        failure("FORBIDDEN"),
        "brokers cannot delete accounts",
      );
      equal(
        await remove(owner, mina, { loginName: "rui.tanaka" }),
        failure("INVALID_COMMAND"),
        "the typed login name must be the account's own",
      );
      equal(
        await remove(owner, mina, { expectedVersion: 99 }),
        failure("STALE_VERSION"),
        "a deletion from a stale page is refused",
      );
      equal(
        await remove(owner, mina, { accountId: randomUUID() }),
        failure("NOT_FOUND"),
        "an unknown account is not found",
      );
      equal(
        (
          await q(
            "SELECT count(*)::int n FROM audit_logs WHERE action='ADMIN_STAFF_DELETED'",
          )
        )[0].n,
        0,
        "refusals leave no deletion audit",
      );

      // ---------- Deleting a broker ----------
      const deleted = await remove(owner, mina);
      equal(
        deleted,
        {
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "STAFF_DELETED",
          accountId: mina.accountId,
          transferredArtists: 3,
        },
        "deleting the broker reports the three current artists the list showed",
      );
      const brokers = [];
      for (const key of ["a1", "a2", "a3", "gone", "r1"])
        brokers.push(await current(key));
      equal(
        brokers,
        [null, null, null, null, rui.actorId],
        "her artists are now the studio's; Rui's stays with Rui",
      );
      const history = await q(
        `SELECT a.sequence,a.broker_identity_id,a.previous_broker_identity_id,a.reason,a.actor_id,l.reason_code
        FROM idol_assignments a JOIN audit_logs l ON l.id=a.audit_log_id WHERE a.idol_id=$1 ORDER BY a.sequence`,
        [artists.a1],
      );
      equal(
        history.map((row) => [
          Number(row.sequence),
          row.broker_identity_id,
          row.previous_broker_identity_id,
          row.reason,
          row.actor_id,
          row.reason_code,
        ]),
        [
          [1, mina.actorId, null, "ASSIGNED", owner.actorId, "ASSIGNED"],
          [2, null, mina.actorId, "ASSIGNED", owner.actorId, "BROKER_DELETED"],
        ],
        "each artist keeps its history, with a record of why it moved",
      );
      const [gone] = await q(
        "SELECT i.status,a.totp_ciphertext IS NULL no_totp,(SELECT count(*)::int FROM admin_identity_roles WHERE admin_identity_id=i.id) roles,(SELECT count(*)::int FROM admin_sessions WHERE admin_identity_id=i.id AND revoked_at IS NULL) live,a.login_name,a.display_name FROM admin_identities i JOIN admin_local_accounts a ON a.admin_identity_id=i.id WHERE i.id=$1",
        [mina.actorId],
      );
      equal(
        gone,
        {
          status: "ARCHIVED",
          no_totp: true,
          roles: 0,
          live: 0,
          login_name: "mina.park",
          display_name: "Mina Park",
        },
        "the account is marked deleted, holds no role and no live session, and keeps its name for history",
      );
      equal(
        (
          await q(
            "SELECT action,reason_code FROM audit_logs WHERE subject_id=$1 AND action IN('ADMIN_SESSIONS_REVOKED','ADMIN_STAFF_DELETED') ORDER BY action",
            [mina.sessionId],
          )
        ).map((row) => [row.action, row.reason_code]),
        [["ADMIN_SESSIONS_REVOKED", "ACCOUNT_DELETED"]],
        "her session was revoked with the deletion's own reason",
      );
      equal(
        (
          await q(
            "SELECT actor_id,reason_code FROM audit_logs WHERE action='ADMIN_STAFF_DELETED' AND subject_id=$1",
            [mina.accountId],
          )
        ).map((row) => [row.actor_id, row.reason_code]),
        [[owner.actorId, "STAFF_MANAGEMENT"]],
        "the deletion is audited once, by the administrator",
      );
      const after = await staff(owner, { action: "LIST" });
      check(
        !(after.members ?? []).some((m) => m.loginName === "mina.park"),
        "the deleted account leaves the staff list",
      );
      equal(
        await staff(mina, { action: "LIST" }),
        failure("UNAUTHENTICATED"),
        "the deleted account's session no longer works",
      );
      equal(
        await remove(owner, mina, {
          expectedVersion: Number(await version(mina)),
        }),
        failure("NOT_FOUND"),
        "a deleted account cannot be deleted again",
      );
      equal(
        await staff(owner, {
          action: "SET_STATUS",
          accountId: mina.accountId,
          expectedVersion: Number(await version(mina)),
          status: "ACTIVE",
        }),
        failure("NOT_FOUND"),
        "nor reactivated from the staff page",
      );

      // ---------- Other deletions ----------
      equal(
        (await remove(owner, idle)).transferredArtists,
        0,
        "a broker without artists is simply deleted",
      );
      equal(
        (await remove(owner, night)).kind,
        "STAFF_DELETED",
        "a daily operations account can be deleted",
      );
      equal(
        (await remove(owner, second)).kind,
        "STAFF_DELETED",
        "so can another administrator",
      );

      // ---------- The database keeps deleted accounts deleted ----------
      check(
        (
          await sql([
            [
              "UPDATE admin_identities SET status='ACTIVE' WHERE id=$1",
              [mina.actorId],
            ],
          ])
        ).startsWith("55000: a deleted admin identity stays deleted"),
        "a deleted identity cannot be brought back directly",
      );
      check(
        (
          await sql([
            [
              "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) SELECT $1,id,$2 FROM roles WHERE role_key='studio:owner'",
              [mina.actorId, owner.actorId],
            ],
          ])
        ).startsWith("55000: a deleted admin identity holds no role"),
        "nor given a role",
      );
      const audit = randomUUID(),
        request = randomUUID();
      check(
        (
          await sql([
            [
              "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'IDOL_ASSIGNMENT','IDOL',$3,'ASSIGNED',$4,$5,'SUCCEEDED','IDOL_ASSIGNMENT')",
              [audit, owner.actorId, artists.free, request, owner.sessionId],
            ],
            [
              "INSERT INTO idol_assignments(id,idol_id,sequence,broker_identity_id,previous_broker_identity_id,reason,actor_id,session_id,audit_log_id,request_id,created_at) VALUES($1,$2,1,$3,NULL,'ASSIGNED',$4,$5,$6,$7,transaction_timestamp())",
              [
                randomUUID(),
                artists.free,
                mina.actorId,
                owner.actorId,
                owner.sessionId,
                audit,
                request,
              ],
            ],
          ])
        ).includes("only be assigned to an active broker"),
        "no artist can be assigned to a deleted broker",
      );
      // An archived artist still cannot be unassigned from a broker who was not deleted.
      const archivedRui = randomUUID();
      await sql([
        ["SET LOCAL session_replication_role=replica"],
        [
          "UPDATE idols SET status='archived',accepting_gifts=false WHERE id=$1",
          [artists.r1],
        ],
      ]);
      const a2 = randomUUID(),
        r2 = randomUUID();
      check(
        (
          await sql([
            [
              "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'IDOL_ASSIGNMENT','IDOL',$3,'UNASSIGNED',$4,$5,'SUCCEEDED','IDOL_ASSIGNMENT')",
              [a2, owner.actorId, artists.r1, r2, owner.sessionId],
            ],
            [
              "INSERT INTO idol_assignments(id,idol_id,sequence,broker_identity_id,previous_broker_identity_id,reason,actor_id,session_id,audit_log_id,request_id,created_at) VALUES($1,$2,2,NULL,$3,'ASSIGNED',$4,$5,$6,$7,transaction_timestamp())",
              [
                archivedRui,
                artists.r1,
                rui.actorId,
                owner.actorId,
                owner.sessionId,
                a2,
                r2,
              ],
            ],
          ])
        ).includes("only a current artist can be assigned"),
        "the archived-artist exception is only for deleted brokers",
      );

      // ---------- 0063 refuses to forget deleted accounts ----------
      const down = readFileSync(
        new URL(
          "../../../database/migrations/0063_staff-account-deletion.down.sql",
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
        "55000: deleted staff accounts cannot be downgraded",
        "0063's down refuses while deleted accounts exist",
      );
      // The runner only rolls back the applied head, so once later migrations exist the
      // direct probe above is what proves 0063's own guard.
      equal(
        (await q("SELECT max(version) v FROM schema_migrations"))[0].v,
        migrated.currentVersion,
        "the historical rollback probe leaves the registered head in place",
      );
      await client.end();
      await persistence.close();
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
      await persistence.close().catch(() => undefined);
      throw error;
    }
  });
}

await roundTrip();
await behavior();
console.log(
  JSON.stringify({
    status: failures.length === 0 ? "PASS" : "FAIL",
    suite: "staff-deletion",
    assertions,
    failures,
    evidence:
      "real migrated PostgreSQL through the actual staff repository and direct SQL; artists and first assignments are replica-seeded, sign-ins are exact hand-made rows",
  }),
);
process.exitCode = failures.length === 0 ? 0 : 1;
