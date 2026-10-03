#!/usr/bin/env node
// ADR-022 / L3-11 on a real migrated PostgreSQL: brokers, artist assignment and the 0057 guards,
// through the actual daily-center repository and by direct SQL that bypasses it.
// Artists and one upload reservation are seeded in replica mode (no S3 here); the publication
// that creates an artist with its image is verified on the deployed TEST instance, not by this script.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import {
  ADMIN_STAFF_ROLE_KEYS,
  adminPermissionKeySchema,
  adminStandardRolePermissions,
} from "@fan-support/contracts";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { createManagementCenterOperationRepository } from "../dist/management-center-operation-repository.js";
import { assignCreatedArtistToBroker } from "../dist/management-center-assignment.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
let assertions = 0,
  stage = "migrate",
  failure;
const equal = (actual, expected, label) => {
  stage = label;
  assert.deepEqual(actual, expected, label);
  assertions++;
};
const ok = (value, label) => equal(Boolean(value), true, label);
const sha = (value) => createHash("sha256").update(value).digest("hex");

async function roundTrip() {
  await withEphemeralPostgres(async (configuration) => {
    const migrate = (command) =>
      runMigrations({ clientConfig: configuration, workspaceRoot, command });
    await migrate({ direction: "up", targetVersion: "0056" });
    const client = new Client(configuration);
    await client.connect();
    try {
      const definitions = async () =>
        (
          await client.query(
            "SELECT proname,pg_get_functiondef(oid) AS body FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('assert_management_authority','guard_management_operation') ORDER BY proname",
          )
        ).rows;
      const before = await definitions();
      equal(before.length, 2, "0056 has the two daily-management guards");
      await migrate({ direction: "up", targetVersion: "0057" });
      const after = await definitions();
      ok(
        after.every((row) => row.body.includes("assert_management_scope")) &&
          after.every((row) => !row.body.includes("management.direct")),
        "0057 routes both guards through the assignment scope",
      );
      equal(
        (
          await client.query(
            "SELECT permission_key FROM permissions WHERE permission_key IN('idols.assign','management.assigned') ORDER BY 1",
          )
        ).rows.map((row) => row.permission_key),
        ["idols.assign", "management.assigned"],
        "0057 registers exactly its two permission keys",
      );
      equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM permissions WHERE permission_key IN('idols.private','ledger.read','ledger.assigned','ledger.messages')",
          )
        ).rows[0].n,
        0,
        "keys of later items are not registered by 0057",
      );
      await migrate({ direction: "down", confirmVersion: "0057" });
      equal(
        await definitions(),
        before,
        "down restores the exact 0022 function bodies",
      );
      equal(
        (
          await client.query(
            "SELECT (to_regclass('public.idol_assignments') IS NULL) AND (to_regprocedure('public.idol_current_broker(uuid)') IS NULL) AND (to_regprocedure('public.assert_management_scope(uuid,uuid,jsonb,uuid)') IS NULL) AND (to_regprocedure('public.guard_idol_assignment()') IS NULL) AND NOT EXISTS(SELECT 1 FROM permissions WHERE permission_key IN('idols.assign','management.assigned')) AS clean",
          )
        ).rows[0].clean,
        true,
        "down removes the table, the functions and the two keys",
      );
      await migrate({ direction: "up", targetVersion: "0057" });
      ok(
        (await definitions()).every((row) =>
          row.body.includes("assert_management_scope"),
        ),
        "0057 applies again after a down",
      );
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
    const q = async (sql, values = []) =>
      (await client.query(sql, values)).rows;
    const repo = () =>
      createManagementCenterOperationRepository(
        client,
        { trackOperation: (work) => work(), markRollbackOnly: () => undefined },
        "https://media.example.invalid",
      );
    /** One serializable transaction per call, as the real transaction manager runs them. */
    async function tx(work) {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        const result = await work(repo());
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    /** Direct SQL in its own transaction; resolves to the SQLSTATE, or COMMIT. */
    /** Which 0057 guard refused, so a refusal for the wrong reason does not pass. */
    const guards = [
      ["assigned management covers only", "NOT_ITS_ARTIST"],
      ["requires its current permission", "NO_PERMISSION"],
      ["only be assigned to an active broker", "NOT_A_BROKER"],
      ["must extend its exact current history", "HISTORY"],
      ["requires its exact audit record", "AUDIT"],
      ["owns only the artist its own running operation", "NOT_ITS_OPERATION"],
    ];
    async function sql(statements) {
      await client.query("BEGIN");
      try {
        for (const [text, values] of statements)
          await client.query(text, values ?? []);
        await client.query("COMMIT");
        return "COMMIT";
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        return error.code === "23514"
          ? (guards.find(([text]) => error.message.includes(text))?.[1] ??
              `23514: ${error.message}`)
          : error.code;
      }
    }
    async function seed(work) {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL session_replication_role=replica");
        await work();
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    const past = "transaction_timestamp()-interval '10 minutes'";
    const people = {};
    async function person(key, role, displayName) {
      const identity = randomUUID(),
        session = randomUUID(),
        sessionToken = randomBytes(32),
        csrfToken = randomBytes(32),
        audit = randomUUID();
      await client.query(
        `INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required,created_at) VALUES($1,'urn:fan-support:local',$2,'ACTIVE',false,${past})`,
        [identity, randomBytes(32)],
      );
      if (displayName)
        await client.query(
          `INSERT INTO admin_local_accounts(id,admin_identity_id,login_name,display_name,password_hash,password_changed_at,must_change_password,created_at,updated_at) VALUES($1,$2,$3,$4,$5,${past},false,${past},${past})`,
          [
            randomUUID(),
            identity,
            key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "."),
            displayName,
            `scrypt$1$32768$8$1$${randomBytes(16).toString("base64url")}$${randomBytes(32).toString("base64url")}`,
          ],
        );
      if (role)
        await client.query(
          `INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by,granted_at) SELECT $1,id,$1,${past} FROM roles WHERE role_key=$2`,
          [identity, role],
        );
      await client.query(
        `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at) VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$2,'ASSIGNMENT_FIXTURE',$1,$1,'SUCCEEDED','CONTENT_TRANSLATION',${past})`,
        [audit, identity],
      );
      await client.query(
        `INSERT INTO admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id,granted_at) VALUES($1,'en',$1,$2,${past})`,
        [identity, audit],
      );
      await client.query(
        `INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,$3,$4,true,${past},transaction_timestamp()+interval '2 hours')`,
        [session, identity, sessionToken, csrfToken],
      );
      people[key] = {
        actorId: identity,
        sessionId: session,
        digests: {
          sessionTokenDigest: sessionToken.toString("hex"),
          csrfTokenDigest: csrfToken.toString("hex"),
        },
      };
    }
    try {
      stage = "fixture: what the server command provisions";
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
      await person("owner", "studio:owner", "Studio Owner");
      await person("operator", "studio:operator", "Night Shift");
      await person("brokerA", "studio:broker", "Mina Park");
      await person("brokerB", "studio:broker", "Rui Tanaka");
      await person("nobody", null, "No Role");
      await client.query("COMMIT");
      const { owner, operator, brokerA, brokerB, nobody } = people;
      // a4 is the spare that only direct SQL ever assigns.
      const artists = {
        a1: randomUUID(),
        a2: randomUUID(),
        a3: randomUUID(),
        a4: randomUUID(),
      };
      const upload = randomUUID(),
        uploadAudit = randomUUID();
      await seed(async () => {
        for (const [handle, id] of Object.entries(artists))
          await client.query(
            "INSERT INTO idols(id,handle,status,accepting_gifts,version) VALUES($1,$2,'active',true,2)",
            [id, `assignment-${handle}`],
          );
        await client.query(
          "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'MEDIA_UPLOAD_BEGIN','MEDIA_UPLOAD_RESERVATION',$3,'ASSIGNMENT_FIXTURE',$1,$1,'SUCCEEDED','RESOURCE_MANAGEMENT')",
          [uploadAudit, brokerA.actorId, upload],
        );
        await client.query(
          "INSERT INTO media_upload_reservations(id,actor_id,session_id,object_key,checksum_sha256,mime_type,byte_size,rights_reference,created_at,expires_at,audit_log_id) VALUES($1,$2,$3,$4,$5,'image/png',100,'management-attestation:fixture',clock_timestamp(),clock_timestamp()+interval '800 seconds',$6)",
          [
            upload,
            brokerA.actorId,
            brokerA.sessionId,
            `uploads/v1/${upload}`,
            sha(upload),
            uploadAudit,
          ],
        );
      });
      const principal = async (who, sourceLocale) => {
        const result = await tx((r) =>
          r.authorize({
            ...who.digests,
            ...(sourceLocale ? { sourceLocale } : {}),
          }),
        );
        return result.outcome === "SUCCESS" ? result.principal : result;
      };
      const list = (section, assignment) => ({
        schemaVersion: 1,
        action: "LIST",
        section,
        page: 1,
        pageSize: 50,
        ...(assignment ? { assignment } : {}),
      });
      const visible = async (who, section = "ARTISTS", assignment) => {
        const p = await principal(who);
        const result = await tx((r) =>
          r.list({ principal: p, command: list(section, assignment) }),
        );
        return result.outcome === "SUCCESS"
          ? result.items.map((item) => item.id).sort()
          : result.code;
      };
      const assign = async (who, artistId, brokerId, expectedBrokerId) => {
        const p = await principal(who);
        return tx((r) =>
          r.assignArtist({
            principal: p,
            requestId: randomUUID(),
            artistId,
            brokerId,
            expectedBrokerId,
          }),
        );
      };
      const intent = (overrides = {}) => ({
        kind: "SAVE_ARTIST",
        sourceLocale: "en",
        id: null,
        expectedVersion: 0,
        name: "Assignment fixture",
        description: "Assignment fixture",
        image: { uploadId: upload },
        ...overrides,
      });
      const edit = (artistId) =>
        intent({ id: artistId, expectedVersion: 2, image: null });
      const submit = async (who, value) => {
        const p = await principal(who, value.sourceLocale);
        if (p.outcome === "FAILURE") return p;
        const canonical = (
          await q(
            "SELECT encode(sha256(convert_to(public.canonical_publication_json($1::jsonb),'UTF8')),'hex') AS hash",
            [JSON.stringify(value)],
          )
        )[0].hash;
        return tx((r) =>
          r.submit({
            principal: p,
            requestId: randomUUID(),
            intent: value,
            intentHash: canonical,
            idempotencyKey: `assignment-${randomUUID()}`,
          }),
        );
      };
      const checkpoint = {
        sourceAssetId: null,
        jobs: [],
        preparedMedia: null,
        retryRequested: false,
      };
      /** A queued operation written by SQL alone, as if the application checks did not exist. */
      const rawOperation = (who, value, targetId, id = randomUUID()) => [
        `INSERT INTO management_operations(id,actor_id,session_id,request_id,capability,intent,intent_hash,idempotency_key,status,phase,version,target_id,checkpoint,authorized_until,attempt_count,next_attempt_at,created_at,updated_at)
        VALUES($1::uuid,$2,$3,$1::uuid,'DIRECT_OPERATOR_V1',$4::jsonb,sha256(convert_to(public.canonical_publication_json($4::jsonb),'UTF8')),$1::uuid::text,'QUEUED','PREPARE_MEDIA',1,$5,$6,clock_timestamp()+interval '1 hour',0,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
        [
          id,
          who.actorId,
          who.sessionId,
          JSON.stringify(value),
          targetId,
          JSON.stringify(checkpoint),
        ],
      ];

      // ---------- Who may enter, and what each account is told ----------
      equal(
        (await principal(nobody)).code,
        "FORBIDDEN",
        "an account with neither management permission cannot enter the daily center",
      );
      for (const who of [owner, operator, brokerA])
        equal(
          (await principal(who)).actorId,
          who.actorId,
          "studio roles and brokers enter the daily center",
        );
      const context = async (who) => {
        const p = await principal(who);
        return tx((r) => r.context(p));
      };
      const ownerContext = await context(owner);
      equal(
        [ownerContext.artists.scope, ownerContext.artists.canAssign],
        ["ALL", true],
        "the administrator manages every artist and may assign",
      );
      equal(
        ownerContext.artists.brokers.map((row) => [
          row.displayName,
          row.active,
        ]),
        [
          ["Mina Park", true],
          ["Rui Tanaka", true],
        ],
        "the broker directory lists both brokers by name and nobody else",
      );
      const operatorContext = await context(operator);
      equal(
        [operatorContext.artists.scope, operatorContext.artists.canAssign],
        ["ALL", false],
        "daily operations manage every artist but cannot assign",
      );
      const brokerContext = await context(brokerA);
      equal(
        [brokerContext.artists, brokerContext.markets, brokerContext.defaults],
        [{ scope: "ASSIGNED", canAssign: false, brokers: [] }, [], null],
        "a broker is told it manages only its own artists and gets no directory, markets or defaults",
      );

      // ---------- Assigning ----------
      equal(
        (await assign(operator, artists.a1, brokerA.actorId, null)).code,
        "FORBIDDEN",
        "daily operations cannot assign",
      );
      equal(
        (await assign(brokerA, artists.a1, brokerA.actorId, null)).code,
        "FORBIDDEN",
        "a broker cannot assign an artist to itself",
      );
      equal(
        (await assign(owner, artists.a1, operator.actorId, null)).code,
        "NOT_FOUND",
        "an artist cannot be assigned to an account that is not a broker",
      );
      equal(
        (await assign(owner, randomUUID(), brokerA.actorId, null)).code,
        "NOT_FOUND",
        "an unknown artist is not found",
      );
      const first = await assign(owner, artists.a1, brokerA.actorId, null);
      equal(
        [first.kind, first.assignment],
        [
          "ARTIST_ASSIGNED",
          { brokerId: brokerA.actorId, displayName: "Mina Park", active: true },
        ],
        "the administrator assigns an artist to a broker",
      );
      equal(
        (await assign(owner, artists.a2, brokerB.actorId, null)).kind,
        "ARTIST_ASSIGNED",
        "a second artist goes to the other broker",
      );
      equal(
        (await assign(owner, artists.a1, brokerB.actorId, null)).code,
        "TARGET_CONFLICT",
        "an editor that still shows the artist as unassigned cannot reassign it",
      );
      equal(
        (await assign(owner, artists.a1, brokerA.actorId, null)).kind,
        "ARTIST_ASSIGNED",
        "repeating the current assignment succeeds",
      );
      const history = () =>
        q(
          "SELECT idol_id,sequence::int AS sequence,broker_identity_id,previous_broker_identity_id,reason,actor_id FROM idol_assignments ORDER BY idol_id,sequence",
        );
      equal(
        (await history()).map((row) => [
          row.sequence,
          row.broker_identity_id,
          row.reason,
          row.actor_id,
        ]),
        [artists.a1, artists.a2]
          .sort()
          .map((id) => [
            1,
            id === artists.a1 ? brokerA.actorId : brokerB.actorId,
            "ASSIGNED",
            owner.actorId,
          ]),
        "refusals and the repeat wrote no history",
      );
      equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM audit_logs l JOIN idol_assignments a ON a.audit_log_id=l.id WHERE l.action='IDOL_ASSIGNMENT' AND l.actor_id=$1 AND l.subject_id=a.idol_id AND l.created_at=a.created_at",
            [owner.actorId],
          )
        )[0].n,
        2,
        "every assignment has its own audit record by the administrator",
      );

      // ---------- What each account sees ----------
      const all = Object.values(artists).sort();
      equal(await visible(owner), all, "the administrator lists every artist");
      equal(await visible(operator), all, "daily operations list every artist");
      equal(
        await visible(brokerA),
        [artists.a1],
        "a broker lists only its own artist",
      );
      equal(
        await visible(brokerB),
        [artists.a2],
        "the other broker lists only its own",
      );
      equal(
        await visible(owner, "ARTISTS", { kind: "UNASSIGNED" }),
        [artists.a3, artists.a4].sort(),
        "the unassigned filter lists the artists nobody owns",
      );
      equal(
        await visible(operator, "ARTISTS", {
          kind: "BROKER",
          brokerId: brokerA.actorId,
        }),
        [artists.a1],
        "the broker filter lists that broker's artist",
      );
      const ownerPrincipal = await principal(owner);
      const ownerView = await tx((r) =>
        r.list({ principal: ownerPrincipal, command: list("ARTISTS") }),
      );
      equal(
        Object.fromEntries(
          ownerView.items.map((item) => [
            item.id,
            item.assignment?.displayName ?? null,
          ]),
        ),
        {
          [artists.a1]: "Mina Park",
          [artists.a2]: "Rui Tanaka",
          [artists.a3]: null,
          [artists.a4]: null,
        },
        "each artist is listed with its broker, or as unassigned",
      );
      // Search is evaluated by PostgreSQL before pagination, inside the same authority scope.
      // These synthetic artists have no revision, so their displayed name is the handle.
      const searched = async (who, filters) => {
        const p = await principal(who);
        return tx((r) =>
          r.list({ principal: p, command: { ...list("ARTISTS"), ...filters } }),
        );
      };
      const searchedIds = [];
      for (let page = 1; page <= 5; page++) {
        const result = await searched(owner, {
          search: "ASSIGNMENT-A",
          page,
          pageSize: 1,
        });
        equal(
          [result.kind, result.totalItems, result.items.length],
          ["LIST", 4, page <= 4 ? 1 : 0],
          `case-insensitive name search keeps its full count on page ${page}`,
        );
        searchedIds.push(...result.items.map((item) => item.id));
      }
      equal(
        searchedIds,
        ownerView.items.map((item) => item.id),
        "search pages retain the stable newest order without repeating or losing artists",
      );
      for (const search of ["%", "_", "' OR true --", "No such artist"]) {
        const result = await searched(owner, { search });
        equal(
          [result.totalItems, result.items],
          [0, []],
          "search metacharacters remain literal and an unmatched name stays empty",
        );
      }
      for (const [who, filters, expected] of [
        [
          owner,
          { search: "a3", assignment: { kind: "UNASSIGNED" } },
          [artists.a3],
        ],
        [owner, { search: "a1", assignment: { kind: "UNASSIGNED" } }, []],
        [
          owner,
          {
            search: "a2",
            assignment: { kind: "BROKER", brokerId: brokerA.actorId },
          },
          [],
        ],
        [brokerA, { search: "a1" }, [artists.a1]],
        [brokerA, { search: "a2" }, []],
      ]) {
        const result = await searched(who, filters);
        equal(
          [result.totalItems, result.items.map((item) => item.id)],
          [expected.length, expected],
          "name search intersects assignment and never widens a broker's authority",
        );
      }
      for (const section of ["GIFTS", "POSTERS"])
        equal(
          await visible(brokerA, section),
          "FORBIDDEN",
          `a broker cannot list ${section.toLowerCase()}`,
        );
      equal(
        await visible(brokerA, "ARTISTS", { kind: "UNASSIGNED" }),
        "FORBIDDEN",
        "a broker cannot ask for unassigned artists",
      );
      equal(
        await visible(brokerA, "ARTISTS", {
          kind: "BROKER",
          brokerId: brokerB.actorId,
        }),
        "FORBIDDEN",
        "a broker cannot ask for another broker's artists",
      );
      const image = async (who, kind, id) => {
        const p = await principal(who);
        return (
          await tx((r) =>
            r.readImageSource({
              principal: p,
              target: { kind, id, expectedVersion: 2 },
            }),
          )
        ).code;
      };
      equal(
        [
          await image(brokerA, "ARTIST", artists.a2),
          await image(brokerA, "ARTIST", artists.a3),
          await image(brokerA, "GIFT", artists.a1),
          await image(brokerA, "POSTER", artists.a1),
        ],
        ["FORBIDDEN", "FORBIDDEN", "FORBIDDEN", "FORBIDDEN"],
        "a broker cannot fetch the original image of another, an unassigned artist, a gift or the poster",
      );
      equal(
        [
          await image(brokerA, "ARTIST", artists.a1),
          await image(operator, "ARTIST", artists.a2),
        ],
        ["REUPLOAD_REQUIRED", "REUPLOAD_REQUIRED"],
        "its own artist, and any artist for daily operations, pass to the image lookup",
      );

      // ---------- Saving ----------
      equal(
        [
          (await submit(brokerA, edit(artists.a2))).code,
          (await submit(brokerA, edit(artists.a3))).code,
          (
            await submit(brokerA, {
              ...intent(),
              kind: "SAVE_GIFT",
              giftKind: "VIRTUAL",
              category: "OTHER",
              price: { market: "TEST", currency: "USD", amountMinor: 1000 },
              inventory: { policy: "PROCURE_ON_DEMAND" },
              eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
            })
          ).code,
          (
            await submit(brokerA, {
              kind: "RESTORE_POSTER",
              sourceLocale: "en",
              expectedVersion: 1,
              sourceRevisionId: randomUUID(),
            })
          ).code,
        ],
        ["FORBIDDEN", "FORBIDDEN", "FORBIDDEN", "FORBIDDEN"],
        "a broker cannot save another broker's artist, an unassigned artist, a gift or a poster",
      );
      const brokerPrincipal = await principal(brokerA);
      equal(
        (
          await tx((r) =>
            r.archivePoster({
              principal: brokerPrincipal,
              requestId: randomUUID(),
              revisionId: randomUUID(),
              expectedVersion: 1,
            }),
          )
        ).code,
        "FORBIDDEN",
        "a broker cannot delete a poster",
      );
      equal(
        (await q("SELECT count(*)::int AS n FROM management_operations"))[0].n,
        0,
        "no refused save queued any work",
      );
      const ownEdit = await submit(brokerA, edit(artists.a1));
      equal(
        [ownEdit.kind, ownEdit.operation?.targetId],
        ["OPERATION", artists.a1],
        "a broker queues an edit of its own artist past the database guard",
      );
      const created = await submit(brokerA, intent());
      equal(
        created.kind,
        "OPERATION",
        "a broker queues a new artist past the database guard",
      );
      const newArtist = created.operation.targetId;
      equal(
        (await submit(operator, edit(artists.a2))).kind,
        "OPERATION",
        "daily operations still save any artist",
      );

      // ---------- The database alone refuses what the application refuses ----------
      equal(
        [
          await sql([
            rawOperation(
              brokerA,
              {
                ...intent(),
                kind: "SAVE_GIFT",
              },
              randomUUID(),
            ),
          ]),
          await sql([rawOperation(brokerA, edit(artists.a2), artists.a2)]),
          await sql([rawOperation(brokerA, edit(artists.a3), artists.a3)]),
          await sql([rawOperation(brokerA, intent(), artists.a3)]),
          await sql([rawOperation(brokerA, intent(), artists.a2)]),
          await sql([
            rawOperation(
              brokerA,
              {
                kind: "RESTORE_POSTER",
                sourceLocale: "en",
                expectedVersion: 1,
                sourceRevisionId: randomUUID(),
              },
              randomUUID(),
            ),
          ]),
          await sql([rawOperation(nobody, intent(), randomUUID())]),
        ],
        [...Array(6).fill("NOT_ITS_ARTIST"), "NO_PERMISSION"],
        "by SQL alone a broker cannot queue a gift, another or an unassigned artist, a 'new' artist that already exists, or a poster; an account without a role queues nothing",
      );
      equal(
        [
          await sql([rawOperation(brokerB, edit(artists.a2), artists.a2)]),
          await sql([rawOperation(brokerB, intent(), randomUUID())]),
          await sql([rawOperation(operator, edit(artists.a3), artists.a3)]),
        ],
        ["COMMIT", "COMMIT", "COMMIT"],
        "by SQL a broker queues its own and a new artist, and daily operations any artist",
      );
      const rawAssignment = (values) => {
        const id = randomUUID(),
          audit = randomUUID(),
          at = "clock_timestamp()";
        const row = {
          sequence: 1,
          broker: brokerA.actorId,
          previous: null,
          reason: "ASSIGNED",
          operation: null,
          actor: owner,
          audited: true,
          ...values,
        };
        return [
          [`SELECT set_config('fixture.at',${at}::text,true)`],
          ...(row.audited
            ? [
                [
                  "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at) VALUES($1,'ADMIN',$2,'IDOL_ASSIGNMENT','IDOL',$3,'ASSIGNED',$1,$1,'SUCCEEDED','IDOL_ASSIGNMENT',current_setting('fixture.at')::timestamptz)",
                  [audit, row.actor.actorId, row.artist],
                ],
              ]
            : []),
          [
            "INSERT INTO idol_assignments(id,idol_id,sequence,broker_identity_id,previous_broker_identity_id,reason,operation_id,actor_id,session_id,audit_log_id,request_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,current_setting('fixture.at')::timestamptz)",
            [
              id,
              row.artist,
              row.sequence,
              row.broker,
              row.previous,
              row.reason,
              row.operation,
              row.actor.actorId,
              row.actor.sessionId,
              audit,
            ],
          ],
        ];
      };
      equal(
        [
          await sql(rawAssignment({ artist: artists.a3, actor: operator })),
          await sql(rawAssignment({ artist: artists.a3, actor: brokerA })),
          await sql(
            rawAssignment({ artist: artists.a3, broker: operator.actorId }),
          ),
          await sql(rawAssignment({ artist: artists.a3, sequence: 2 })),
          await sql(
            rawAssignment({
              artist: artists.a1,
              sequence: 2,
              broker: brokerB.actorId,
              previous: null,
            }),
          ),
          await sql(rawAssignment({ artist: artists.a3, audited: false })),
        ],
        [
          "NO_PERMISSION",
          "NO_PERMISSION",
          "NOT_A_BROKER",
          "HISTORY",
          "HISTORY",
          "AUDIT",
        ],
        "by SQL alone: only idols.assign assigns, only to a broker, in exact sequence from the actual previous broker, with its audit record",
      );
      equal(
        [
          await sql(rawAssignment({ artist: artists.a4 })),
          await sql(
            rawAssignment({
              artist: artists.a4,
              sequence: 2,
              broker: null,
              previous: brokerA.actorId,
            }),
          ),
        ],
        ["COMMIT", "COMMIT"],
        "the same SQL by the administrator, in sequence and audited, assigns and unassigns",
      );
      equal(
        [
          await sql([
            [
              "UPDATE idol_assignments SET broker_identity_id=$1",
              [brokerB.actorId],
            ],
          ]),
          await sql([["DELETE FROM idol_assignments"]]),
        ].every((code) => code !== "COMMIT"),
        true,
        "assignment history can be neither rewritten nor deleted",
      );

      // ---------- A broker's new artist belongs to that broker ----------
      const lease = sha("assignment-lease"),
        digest = Buffer.from(lease, "hex");
      const running = async (operationId) => {
        equal(
          await sql([
            [
              "UPDATE management_operations SET status='RUNNING',version=version+1,attempt_count=attempt_count+1,lease_token_digest=$2,lease_expires_at=clock_timestamp()+interval '300 seconds',next_attempt_at=NULL,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1",
              [operationId, digest],
            ],
          ]),
          "COMMIT",
          "the worker leases the broker's own operation",
        );
        return tx((r) => r.loadClaim({ operationId, leaseTokenDigest: lease }));
      };
      const claim = await running(created.operation.operationId);
      equal(
        [claim.actorId, claim.operation.targetId],
        [brokerA.actorId, newArtist],
        "the claim still belongs to the broker and its new artist",
      );
      const createArtist = async (theClaim, artistId) => {
        await client.query("BEGIN");
        try {
          await client.query("SET LOCAL session_replication_role=replica");
          await client.query(
            "INSERT INTO idols(id,handle,status,accepting_gifts,version) VALUES($1,$2,'draft',false,1)",
            [artistId, `idol-${artistId.replaceAll("-", "")}`],
          );
          // Every guard is live again for the assignment itself.
          await client.query("SET LOCAL session_replication_role=origin");
          await assignCreatedArtistToBroker(client, theClaim, artistId);
          await client.query("COMMIT");
          return "COMMIT";
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          return error.code ?? error.message;
        }
      };
      equal(
        await createArtist(claim, newArtist),
        "COMMIT",
        "the publication writes the artist and its assignment in one transaction",
      );
      equal(
        await q(
          "SELECT sequence::int AS sequence,broker_identity_id,previous_broker_identity_id,reason,operation_id,actor_id FROM idol_assignments WHERE idol_id=$1",
          [newArtist],
        ),
        [
          {
            sequence: 1,
            broker_identity_id: brokerA.actorId,
            previous_broker_identity_id: null,
            reason: "BROKER_CREATED",
            operation_id: created.operation.operationId,
            actor_id: brokerA.actorId,
          },
        ],
        "a broker's new artist is assigned to that broker, bound to its operation",
      );
      equal(
        await visible(brokerA),
        [artists.a1, newArtist].sort(),
        "the broker now lists its new artist",
      );
      equal(
        (await visible(brokerB)).includes(newArtist),
        false,
        "the other broker does not",
      );
      ok(
        (
          await tx((r) =>
            r.loadClaim({
              operationId: created.operation.operationId,
              leaseTokenDigest: lease,
            }),
          )
        ).operation,
        "the rest of the publication keeps its authority over the artist it created",
      );
      const studioNew = await submit(operator, {
        ...intent(),
        image: { uploadId: upload },
      });
      equal(
        studioNew.code,
        "UPLOAD_NOT_READY",
        "an upload belongs to the session that made it",
      );
      const operatorTarget = randomUUID(),
        operatorOperation = randomUUID();
      equal(
        await sql([
          rawOperation(operator, intent(), operatorTarget, operatorOperation),
        ]),
        "COMMIT",
        "daily operations queue a new artist",
      );
      const operatorClaim = await running(operatorOperation);
      equal(
        await createArtist(operatorClaim, operatorTarget),
        "COMMIT",
        "daily operations create the artist",
      );
      equal(
        await q("SELECT 1 FROM idol_assignments WHERE idol_id=$1", [
          operatorTarget,
        ]),
        [],
        "an artist created by daily operations stays unassigned",
      );
      equal(
        (await visible(owner, "ARTISTS", { kind: "UNASSIGNED" })).includes(
          operatorTarget,
        ),
        true,
        "and is listed as unassigned",
      );
      equal(
        [
          await sql(
            rawAssignment({
              artist: operatorTarget,
              broker: brokerB.actorId,
              reason: "BROKER_CREATED",
              operation: operatorOperation,
              actor: brokerB,
            }),
          ),
          await sql(
            rawAssignment({
              artist: artists.a3,
              broker: brokerA.actorId,
              reason: "BROKER_CREATED",
              operation: created.operation.operationId,
              actor: brokerA,
            }),
          ),
        ],
        ["NOT_ITS_OPERATION", "NOT_ITS_OPERATION"],
        "by SQL alone a broker cannot claim an artist through someone else's operation or one its operation did not create",
      );

      // ---------- Reassigning takes effect at once ----------
      const queued = await submit(brokerA, {
        ...edit(artists.a1),
        name: "Queued before reassignment",
      });
      equal(
        queued.kind,
        "OPERATION",
        "a second edit of its own artist is queued",
      );
      const moved = await assign(
        owner,
        artists.a1,
        brokerB.actorId,
        brokerA.actorId,
      );
      equal(
        moved.assignment?.brokerId,
        brokerB.actorId,
        "the administrator reassigns the artist to the other broker",
      );
      equal(
        [await visible(brokerA), await visible(brokerB)],
        [[newArtist], [artists.a1, artists.a2].sort()],
        "the former broker no longer lists the artist and the new broker does, in the very next request",
      );
      equal(
        [
          (await submit(brokerA, edit(artists.a1))).code,
          await image(brokerA, "ARTIST", artists.a1),
        ],
        ["FORBIDDEN", "FORBIDDEN"],
        "the former broker can neither save nor fetch the image of the reassigned artist",
      );
      equal(
        (await submit(brokerB, edit(artists.a1))).kind,
        "OPERATION",
        "the new broker can save it",
      );
      equal(
        await sql([
          [
            "UPDATE management_operations SET status='RUNNING',version=version+1,attempt_count=attempt_count+1,lease_token_digest=$2,lease_expires_at=clock_timestamp()+interval '300 seconds',next_attempt_at=NULL,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1",
            [queued.operation.operationId, digest],
          ],
        ]),
        "NOT_ITS_ARTIST",
        "by SQL alone the former broker's queued edit can no longer start",
      );
      const drained = [];
      for (let index = 0; index < 12; index++) {
        const next = await tx((r) =>
          r.claim({
            leaseTokenDigest: sha(`drain-${index}`),
            leaseSeconds: 60,
          }),
        );
        if (next === null) break;
        drained.push("code" in next ? next.code : next.operation.operationId);
      }
      equal(
        (
          await q(
            "SELECT status,failure_code,failure_retryable FROM management_operations WHERE id IN($1,$2) ORDER BY created_at",
            [ownEdit.operation.operationId, queued.operation.operationId],
          )
        ).map((row) => [row.status, row.failure_code, row.failure_retryable]),
        [
          ["FAILED", "NEEDS_AUTHORIZATION", true],
          ["FAILED", "NEEDS_AUTHORIZATION", true],
        ],
        "the worker fails the former broker's queued edits honestly instead of publishing them",
      );
      ok(
        drained.includes("NEEDS_AUTHORIZATION"),
        "the claim reports the lost authority",
      );
      const unassigned = await assign(owner, artists.a1, null, brokerB.actorId);
      equal(
        [unassigned.kind, unassigned.assignment],
        ["ARTIST_ASSIGNED", null],
        "the administrator takes the artist back as unassigned",
      );
      equal(
        [
          (await visible(brokerB)).includes(artists.a1),
          (await visible(owner, "ARTISTS", { kind: "UNASSIGNED" })).includes(
            artists.a1,
          ),
        ],
        [false, true],
        "an unassigned artist leaves every broker and returns to the studio",
      );
      equal(
        (
          await q(
            "SELECT sequence::int AS sequence,broker_identity_id,previous_broker_identity_id FROM idol_assignments WHERE idol_id=$1 ORDER BY sequence",
            [artists.a1],
          )
        ).map((row) => [
          row.sequence,
          row.broker_identity_id,
          row.previous_broker_identity_id,
        ]),
        [
          [1, brokerA.actorId, null],
          [2, brokerB.actorId, brokerA.actorId],
          [3, null, brokerB.actorId],
        ],
        "history keeps who owned the artist, in order",
      );

      // ---------- A suspended broker ----------
      await client.query(
        "UPDATE admin_identities SET status='SUSPENDED',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [brokerB.actorId],
      );
      const suspendedView = await context(owner);
      equal(
        suspendedView.artists.brokers.find(
          (row) => row.brokerId === brokerB.actorId,
        ),
        { brokerId: brokerB.actorId, displayName: "Rui Tanaka", active: false },
        "a suspended broker stays in the directory, marked inactive",
      );
      const ownerAgain = await principal(owner);
      const afterSuspension = await tx((r) =>
        r.list({ principal: ownerAgain, command: list("ARTISTS") }),
      );
      equal(
        afterSuspension.items.find((item) => item.id === artists.a2)
          ?.assignment,
        { brokerId: brokerB.actorId, displayName: "Rui Tanaka", active: false },
        "its artists keep their assignment, shown as inactive",
      );
      equal(
        [
          (await assign(owner, artists.a3, brokerB.actorId, null)).code,
          await sql(
            rawAssignment({ artist: artists.a3, broker: brokerB.actorId }),
          ),
        ],
        ["NOT_FOUND", "NOT_A_BROKER"],
        "nothing new can be assigned to a suspended broker, by the application or by SQL",
      );
      equal(
        (await assign(owner, artists.a2, brokerA.actorId, brokerB.actorId))
          .assignment?.brokerId,
        brokerA.actorId,
        "its artist can be reassigned to an active broker",
      );
      equal(
        (await context(owner)).artists.brokers.map((row) => row.displayName),
        ["Mina Park"],
        "a suspended broker with no artists left drops out of the directory",
      );

      // ---------- History blocks the downgrade ----------
      const kept = (await history()).length;
      // Later migrations come off first, so what refuses below is 0057's own down and not a version mismatch.
      const later = await client.query(
        "SELECT version FROM schema_migrations WHERE version>'0057' ORDER BY version DESC",
      );
      for (const { version } of later.rows)
        await migrate({ direction: "down", confirmVersion: version });
      // The runner reports only which down failed; the down script itself says why.
      await client.query("BEGIN");
      const reason = await client
        .query(
          readFileSync(
            new URL(
              "../../../database/migrations/0057_idol-assignments.down.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        )
        .then(
          () => "APPLIED",
          (error) => `${error.code}: ${error.message}`,
        );
      await client.query("ROLLBACK");
      equal(
        reason,
        "55000: artist assignment history cannot be downgraded",
        "0057's down refuses while assignment history exists",
      );
      await client.end();
      const refused = await migrate({
        direction: "down",
        confirmVersion: "0057",
      }).then(
        () => "MIGRATED",
        (error) => String(error?.message ?? error),
      );
      equal(
        refused,
        "migration 0057 down failed",
        "and the runner leaves 0057 in place",
      );
      const check = new Client(configuration);
      await check.connect();
      try {
        equal(
          (
            await check.query(
              "SELECT (SELECT count(*) FROM idol_assignments)::int AS n,pg_get_functiondef('public.guard_management_operation()'::regprocedure) LIKE '%assert_management_scope%' AS scoped",
            )
          ).rows[0],
          { n: kept, scoped: true },
          "the refused downgrade left history and guards in place",
        );
      } finally {
        await check.end();
      }
    } catch (error) {
      // The cluster wrapper reports only that the scenario failed; keep the actual cause.
      failure = {
        code: error.code ?? error.name,
        message: error.message,
        where: typeof error.where === "string" ? error.where : undefined,
      };
      await client.end().catch(() => undefined);
      throw error;
    }
  });
}

try {
  await roundTrip();
  await behavior();
  console.log(
    JSON.stringify({
      status: "PASS",
      suite: "idol-assignments",
      assertions,
      evidence:
        "real migrated PostgreSQL through the actual daily-center repository and direct SQL; artists and one upload reservation are replica-seeded, so this is not image or publication evidence",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "FAIL",
      suite: "idol-assignments",
      stage,
      code: error.code ?? error.name,
      message: error.message,
      ...failure,
    }),
  );
  process.exitCode = 1;
}
