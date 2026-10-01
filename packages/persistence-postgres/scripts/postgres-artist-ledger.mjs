// ADR-022 / L3-12 on real PostgreSQL: 0059 round trip, ledger figures, reader scope, message reads and exports.
// Orders are replica-seeded (no checkout, payment or refund lifecycle ran), so this proves the ledger's reading
// and the 0059 guards, not the order lifecycle itself.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import {
  ADMIN_STAFF_ROLE_KEYS,
  adminPermissionKeySchema,
  adminStandardRolePermissions,
} from "@fan-support/contracts";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { createAdminLedgerRepository } from "../dist/admin-ledger-repository.js";
import { createLedgerSeeder } from "./artist-ledger-fixture.mjs";

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

const RECEIPT_FUNCTION =
  "SELECT pg_get_functiondef('public.assert_admin_order_receipt_authority()'::regprocedure) body";

async function roundTrip() {
  await withEphemeralPostgres(async (configuration) => {
    const migrate = (command) =>
      runMigrations({ clientConfig: configuration, workspaceRoot, command });
    await migrate({ direction: "up", targetVersion: "0058" });
    const client = new Client(configuration);
    await client.connect();
    try {
      const body = async () =>
        (await client.query(RECEIPT_FUNCTION)).rows[0].body;
      const before = await body();
      // Where sync-roles ran after L3-11 the ledger keys already exist; 0059 must accept that.
      await client.query(
        "INSERT INTO permissions(id,permission_key,description) VALUES(gen_random_uuid(),'ledger.read','Platform permission')",
      );
      await migrate({ direction: "up", targetVersion: "0059" });
      const after = await body();
      check(
        after.includes("ledger.messages") &&
          !before.includes("ledger.messages"),
        "0059 adds the broker branch",
      );
      equal(
        (
          await client.query(
            "SELECT permission_key FROM permissions WHERE permission_key LIKE 'ledger.%' ORDER BY 1",
          )
        ).rows.map((row) => row.permission_key),
        ["ledger.assigned", "ledger.messages", "ledger.read"],
        "0059 registers the three ledger keys beside one sync-roles already made",
      );
      equal(
        (
          await client.query(
            "SELECT indexname FROM pg_indexes WHERE indexname IN('payment_attempts_succeeded_idx','order_items_idol_order_idx','refund_items_order_item_idx') ORDER BY 1",
          )
        ).rows.map((row) => row.indexname),
        [
          "order_items_idol_order_idx",
          "payment_attempts_succeeded_idx",
          "refund_items_order_item_idx",
        ],
        "0059 adds the three read indexes",
      );
      await migrate({ direction: "down", confirmVersion: "0059" });
      equal(await body(), before, "down restores the exact 0031 receipt check");
      equal(
        (
          await client.query(
            "SELECT to_regclass('public.artist_ledger_exports') t, count(*)::int n FROM permissions WHERE permission_key LIKE 'ledger.%'",
          )
        ).rows[0],
        { t: null, n: 0 },
        "down drops the export receipts and the ledger keys",
      );
      await migrate({ direction: "up", targetVersion: "0059" });
      equal(await body(), after, "0059 re-applies after a clean down");
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
        const result = await work(createAdminLedgerRepository(client, scope));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
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
      const people = {};
      async function person(key, role, displayName, messageLocales = []) {
        const identity = randomUUID(),
          session = randomUUID(),
          sessionToken = randomBytes(32),
          csrfToken = randomBytes(32);
        await client.query(
          `INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required,created_at) VALUES($1,'urn:fan-support:local',$2,'ACTIVE',false,${past})`,
          [identity, randomBytes(32)],
        );
        await client.query(
          `INSERT INTO admin_local_accounts(id,admin_identity_id,login_name,display_name,password_hash,password_changed_at,must_change_password,created_at,updated_at) VALUES($1,$2,$3,$4,$5,${past},false,${past},${past})`,
          [
            randomUUID(),
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
        for (const locale of messageLocales) {
          const audit = randomUUID();
          await client.query(
            `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at) VALUES($1,'ADMIN',$2,'ORDER_MESSAGE_LOCALE_GRANT','ADMIN_ORDER_MESSAGE_LOCALE_GRANT',$2,'LEDGER_FIXTURE',$1,$1,'SUCCEEDED','SUPPORT_INTENT_PRIVATE',${past})`,
            [audit, identity],
          );
          await client.query(
            `INSERT INTO admin_order_message_locale_grants(admin_identity_id,locale,granted_by,audit_log_id,granted_at) VALUES($1,$2,$1,$3,${past})`,
            [identity, locale, audit],
          );
        }
        await client.query(
          `INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,$3,$4,true,${past},transaction_timestamp()+interval '2 hours')`,
          [session, identity, sessionToken, csrfToken],
        );
        people[key] = {
          actorId: identity,
          sessionId: session,
          access: () => ({
            schemaVersion: 1,
            sessionTokenDigest: sessionToken.toString("hex"),
            csrfTokenDigest: csrfToken.toString("hex"),
            requestId: randomUUID(),
            correlationId: randomUUID(),
          }),
        };
      }
      await person("owner", "studio:owner", "Studio Owner", ["en", "ja"]);
      await person("operator", "studio:operator", "Night Shift", ["en"]);
      await person("brokerA", "studio:broker", "Mina Park");
      await person("brokerB", "studio:broker", "Rui Tanaka");
      await person("nobody", null, "No Role");
      await client.query("COMMIT");
      const { owner, operator, brokerA, brokerB, nobody } = people;

      // ---------- Artists and who they belong to ----------
      const artists = {
        a1: randomUUID(),
        a2: randomUUID(),
        a3: randomUUID(),
        a4: randomUUID(),
      };
      const seeder = createLedgerSeeder(client, {
        actor: owner,
        reviewer: owner.actorId,
      });
      const { seed, items } = seeder;
      const assign = (artistId, brokerId) => seeder.assign(artistId, brokerId);
      await seed(async () => {
        for (const [handle, id] of Object.entries(artists))
          await client.query(
            "INSERT INTO idols(id,handle,status,accepting_gifts,version) VALUES($1,$2,'active',true,2)",
            [id, `ledger-${handle}`],
          );
        await assign(artists.a1, brokerA.actorId);
        await assign(artists.a2, brokerA.actorId);
        await assign(artists.a3, brokerB.actorId);
      });

      // ---------- Orders ----------
      const order = (spec) =>
        seeder.order({
          ...spec,
          paidAt: spec.paidAt ?? "2026-03-15T00:00:00Z",
          lines: spec.lines.map((line) => ({
            ...line,
            artistId: artists[line.artist],
          })),
        });
      const orders = {};
      await seed(async () => {
        // March 2026 in Beijing time runs from 2026-02-28T16:00Z up to 2026-03-31T16:00Z.
        orders.o1 = await order({
          paidAt: "2026-03-05T02:00:00Z",
          lines: [
            {
              key: "L1",
              artist: "a1",
              qty: 2,
              unit: 1250,
              status: "DELIVERED",
              message: { moderation: "APPROVED", locale: "ja" },
            },
            {
              key: "L2",
              artist: "a1",
              qty: 1,
              unit: 1000,
              status: "DELIVERED",
              kind: "VIRTUAL",
            },
            {
              key: "L3",
              artist: "a3",
              qty: 1,
              unit: 3000,
              status: "PREPARING",
              message: { moderation: "REJECTED", locale: "en" },
            },
          ],
          refunds: [{ status: "SUCCEEDED", items: [["L1", 500]] }],
        });
        orders.o2 = await order({
          paidAt: "2026-03-06T02:00:00Z",
          lines: [
            {
              key: "L4",
              artist: "a1",
              qty: 1,
              unit: 4000,
              status: "ON_HOLD",
              message: { moderation: "PENDING", locale: "en" },
            },
            { key: "L5", artist: "a2", qty: 1, unit: 1500, status: "PENDING" },
          ],
          refunds: [
            { status: "PROCESSING", items: [["L4", 1000]] },
            { status: "SUCCEEDED", items: [["L5", 1500]] },
            { status: "FAILED", items: [["L4", 300]] },
          ],
        });
        orders.o3 = await order({
          currency: "JPY",
          paidAt: "2026-03-07T02:00:00Z",
          lines: [
            {
              key: "L6",
              artist: "a1",
              qty: 1,
              unit: 3000,
              status: "DELIVERED",
              kind: "VIRTUAL",
            },
          ],
        });
        orders.o4 = await order({
          environment: "TEST",
          paidAt: "2026-03-08T02:00:00Z",
          lines: [
            { key: "L7", artist: "a1", qty: 1, unit: 700, status: "DELIVERED" },
          ],
        });
        orders.o5 = await order({
          paidAt: "2026-03-09T02:00:00Z",
          dispute: "LOST",
          lines: [
            {
              key: "L8",
              artist: "a2",
              qty: 1,
              unit: 2000,
              status: "DELIVERED",
            },
            {
              key: "L9",
              artist: "a4",
              qty: 1,
              unit: 500,
              status: "DELIVERED",
              kind: "VIRTUAL",
            },
          ],
          refunds: [{ status: "SUCCEEDED", items: [["L8", 200]] }],
        });
        orders.o6 = await order({
          state: "UNPAID",
          lines: [{ key: "L10", artist: "a1", qty: 1, unit: 1000 }],
        });
        orders.o7 = await order({
          state: "CANCELED",
          lines: [{ key: "L11", artist: "a1", qty: 1, unit: 1000 }],
        });
        orders.o8 = await order({
          paidAt: "2026-03-31T15:59:59Z",
          lines: [
            {
              key: "L12",
              artist: "a4",
              qty: 1,
              unit: 100,
              status: "DELIVERED",
            },
          ],
        });
        orders.o9 = await order({
          paidAt: "2026-03-31T16:00:00Z",
          lines: [
            {
              key: "L13",
              artist: "a4",
              qty: 1,
              unit: 100,
              status: "DELIVERED",
            },
          ],
        });
        orders.o10 = await order({
          paidAt: "2026-02-28T16:00:00Z",
          lines: [
            {
              key: "L14",
              artist: "a3",
              qty: 1,
              unit: 100,
              status: "DELIVERED",
            },
          ],
        });
        orders.o11 = await order({
          paidAt: "2026-03-10T02:00:00Z",
          lines: [
            { key: "L15", artist: "a3", qty: 1, unit: 200, status: "CANCELED" },
          ],
        });
      });

      const run = (who, command, timeZone = "Asia/Shanghai") =>
        tx((r) =>
          r.execute({
            schemaVersion: 1,
            access: who.access(),
            command: { schemaVersion: 1, ...command },
            timeZone,
          }),
        );
      const march = { kind: "CUSTOM", from: "2026-03-01", to: "2026-03-31" };
      const overview = (
        who,
        broker = { kind: "ALL" },
        period = march,
        timeZone,
      ) => run(who, { action: "OVERVIEW", period, broker }, timeZone);
      const figures = (entry) =>
        entry && {
          completed: [entry.completedOrders, entry.completedMinor],
          pending: [entry.pendingOrders, entry.pendingMinor],
          refunded: entry.refundedMinor,
          refundPending: entry.refundPendingMinor,
          net: entry.netMinor,
        };
      const total = (result, environment, currency) =>
        figures(
          result.totals?.find(
            (t) => t.environment === environment && t.currency === currency,
          ),
        );
      const row = (result, artist, environment = "LIVE", currency = "USD") =>
        figures(
          result.artists?.find(
            (a) =>
              a.artistId === artists[artist] &&
              a.environment === environment &&
              a.currency === currency,
          ),
        );
      const lineIds = (result) =>
        (result.lines ?? []).map((line) => line.itemId);
      const key = (id) =>
        Object.entries(items).find(([, v]) => v.item === id)?.[0];

      // ---------- Figures ----------
      const all = await overview(owner);
      equal(
        all.period,
        {
          kind: "CUSTOM",
          from: "2026-03-01",
          to: "2026-03-31",
          timeZone: "Asia/Shanghai",
          startsAt: "2026-02-28T16:00:00.000000Z",
          endsBefore: "2026-03-31T16:00:00.000000Z",
        },
        "a custom month resolves to Beijing midnight bounds",
      );
      equal(
        total(all, "LIVE", "USD"),
        {
          completed: [3, 3200],
          pending: [2, 7000],
          refunded: 4500,
          refundPending: 1000,
          net: 10400,
        },
        "LIVE USD totals: refunds deducted, pending refunds apart, a lost chargeback returns the whole order, orders counted once",
      );
      equal(
        total(all, "LIVE", "JPY"),
        {
          completed: [1, 3000],
          pending: [0, 0],
          refunded: 0,
          refundPending: 0,
          net: 3000,
        },
        "JPY is never added to USD",
      );
      equal(
        total(all, "TEST", "USD"),
        {
          completed: [1, 700],
          pending: [0, 0],
          refunded: 0,
          refundPending: 0,
          net: 700,
        },
        "TEST payments stay apart from LIVE",
      );
      equal(
        all.totals.map((t) => `${t.environment}:${t.currency}`),
        ["LIVE:JPY", "LIVE:USD", "TEST:USD"],
        "LIVE totals come before TEST",
      );
      equal(
        row(all, "a1"),
        {
          completed: [1, 3000],
          pending: [1, 4000],
          refunded: 500,
          refundPending: 1000,
          net: 7000,
        },
        "artist a1: two lines of one order count as one order",
      );
      equal(
        row(all, "a2"),
        {
          completed: [0, 0],
          pending: [0, 0],
          refunded: 3500,
          refundPending: 0,
          net: 0,
        },
        "artist a2: full refund and lost chargeback",
      );
      equal(
        row(all, "a3"),
        {
          completed: [1, 100],
          pending: [1, 3000],
          refunded: 0,
          refundPending: 0,
          net: 3300,
        },
        "artist a3: one order split across artists; a cancelled paid line stays in net",
      );
      equal(
        row(all, "a4"),
        {
          completed: [1, 100],
          pending: [0, 0],
          refunded: 500,
          refundPending: 0,
          net: 100,
        },
        "artist a4: the start and end of the month in Beijing time",
      );
      equal(
        row(all, "a1", "LIVE", "JPY"),
        {
          completed: [1, 3000],
          pending: [0, 0],
          refunded: 0,
          refundPending: 0,
          net: 3000,
        },
        "a1 has a separate JPY row",
      );
      equal(
        row(all, "a1", "TEST", "USD"),
        {
          completed: [1, 700],
          pending: [0, 0],
          refunded: 0,
          refundPending: 0,
          net: 700,
        },
        "a1 has a separate TEST row",
      );
      check(
        all.artists.every((a) => a.displayName.startsWith("ledger-")),
        "artists show their current name (the handle when unnamed)",
      );
      equal(
        all.artists
          .filter((a) => a.environment === "LIVE" && a.currency === "USD")
          .map((a) => [a.displayName, a.broker?.displayName ?? null]),
        [
          ["ledger-a1", "Mina Park"],
          ["ledger-a2", "Mina Park"],
          ["ledger-a3", "Rui Tanaka"],
          ["ledger-a4", null],
        ],
        "rows carry the current broker",
      );

      const april = await overview(
        owner,
        { kind: "ALL" },
        { kind: "CUSTOM", from: "2026-04-01", to: "2026-04-01" },
      );
      equal(
        total(april, "LIVE", "USD"),
        {
          completed: [1, 100],
          pending: [0, 0],
          refunded: 0,
          refundPending: 0,
          net: 100,
        },
        "00:00 Beijing on 1 April belongs to April",
      );
      const utcDay = await overview(
        owner,
        { kind: "ALL" },
        { kind: "CUSTOM", from: "2026-03-31", to: "2026-03-31" },
        "UTC",
      );
      equal(
        row(utcDay, "a4"),
        {
          completed: [2, 200],
          pending: [0, 0],
          refunded: 0,
          refundPending: 0,
          net: 200,
        },
        "the configured time zone decides the day",
      );
      equal(
        utcDay.period.startsAt,
        "2026-03-31T00:00:00.000000Z",
        "UTC bounds start at UTC midnight",
      );

      const ownerA1 = await run(owner, {
        action: "ARTIST",
        artistId: artists.a1,
        period: march,
      });
      equal(
        lineIds(ownerA1).map(key).sort(),
        ["L1", "L2", "L4", "L6", "L7"],
        "an artist's lines: paid only, never the unpaid or cancelled orders",
      );
      const l1 = ownerA1.lines.find((line) => line.itemId === items.L1.item),
        l4 = ownerA1.lines.find((line) => line.itemId === items.L4.item);
      equal(
        [
          l1.category,
          l1.amountMinor,
          l1.refundedMinor,
          l1.netMinor,
          l1.quantity,
          l1.unitAmountMinor,
          l1.waitingDays,
          l1.deliveredAt !== null,
        ],
        ["COMPLETED", 2500, 500, 2000, 2, 1250, null, true],
        "a delivered line with a partial refund",
      );
      equal(
        [
          l4.category,
          l4.fulfillmentStatus,
          l4.refundPendingMinor,
          l4.netMinor,
          l4.waitingDays > 100,
        ],
        ["PENDING", "ON_HOLD", 1000, 4000, true],
        "a held line waits with its refund in progress; failed refunds are ignored",
      );
      check(
        /^FS-[A-Z0-9]{6}$/u.test(l1.orderNumber),
        "lines show the public order number",
        l1.orderNumber,
      );
      const lost = (
        await run(owner, {
          action: "ARTIST",
          artistId: artists.a2,
          period: march,
        })
      ).lines.find((line) => line.itemId === items.L8.item);
      equal(
        [lost.category, lost.chargebackLost, lost.refundedMinor, lost.netMinor],
        ["REFUNDED", true, 2000, 0],
        "a lost chargeback refunds the line once, not on top of the earlier refund",
      );
      const closed = (
        await run(owner, {
          action: "ARTIST",
          artistId: artists.a3,
          period: march,
        })
      ).lines.find((line) => line.itemId === items.L15.item);
      equal(
        [closed.category, closed.netMinor],
        ["CLOSED", 200],
        "a paid line whose fulfilment was cancelled without refund is shown as closed",
      );

      // ---------- Presets ----------
      const zoneToday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
      }).format(new Date());
      const today = await overview(owner, { kind: "ALL" }, { kind: "TODAY" });
      equal(
        [today.period.from, today.period.to],
        [zoneToday, zoneToday],
        "TODAY is today in Beijing",
      );
      const week = await overview(
        owner,
        { kind: "ALL" },
        { kind: "THIS_WEEK" },
      );
      check(
        new Date(`${week.period.from}T00:00:00Z`).getUTCDay() === 1 &&
          week.period.to === zoneToday,
        "THIS_WEEK starts on Monday",
        week.period,
      );
      const lastMonth = await overview(
        owner,
        { kind: "ALL" },
        { kind: "LAST_MONTH" },
      );
      check(
        lastMonth.period.from.endsWith("-01") &&
          lastMonth.period.to < `${zoneToday.slice(0, 7)}-01`,
        "LAST_MONTH is the whole previous month",
        lastMonth.period,
      );
      const context = await run(owner, { action: "CONTEXT" });
      equal(
        [
          context.scope,
          context.canReadMessages,
          context.timeZone,
          context.today,
          context.brokers.map((b) => b.displayName),
        ],
        ["ALL", true, "Asia/Shanghai", zoneToday, ["Mina Park", "Rui Tanaka"]],
        "owner context: every artist, broker directory, ledger day",
      );
      equal(
        (
          await run(owner, {
            action: "OVERVIEW",
            period: { kind: "CUSTOM", from: "2026-01-01", to: "2027-01-02" },
            broker: { kind: "ALL" },
          })
        ).code,
        "INVALID_COMMAND",
        "a period over 366 days is refused",
      );

      // ---------- Scope ----------
      const brokerOverview = await overview(owner, {
        kind: "BROKER",
        brokerId: brokerA.actorId,
      });
      equal(
        [...new Set(brokerOverview.artists.map((a) => a.displayName))],
        ["ledger-a1", "ledger-a2"],
        "filtering by broker keeps that broker's artists",
      );
      equal(
        [
          ...new Set(
            (await overview(owner, { kind: "UNASSIGNED" })).artists.map(
              (a) => a.displayName,
            ),
          ),
        ],
        ["ledger-a4"],
        "unassigned artists alone",
      );
      const operatorView = await overview(operator);
      equal(
        total(operatorView, "LIVE", "USD"),
        total(all, "LIVE", "USD"),
        "daily operations read the whole ledger",
      );
      const mine = await overview(brokerA);
      equal(
        [...new Set(mine.artists.map((a) => a.displayName))],
        ["ledger-a1", "ledger-a2"],
        "a broker reads only its own artists",
      );
      equal(
        total(mine, "LIVE", "USD"),
        {
          completed: [1, 3000],
          pending: [1, 4000],
          refunded: 4000,
          refundPending: 1000,
          net: 7000,
        },
        "a broker's totals cover only its own artists' lines",
      );
      equal(
        (await run(brokerA, { action: "CONTEXT" })).brokers,
        [],
        "a broker gets no broker directory",
      );
      equal(
        (await run(brokerA, { action: "CONTEXT" })).scope,
        "ASSIGNED",
        "a broker's context says ASSIGNED",
      );
      equal(
        (await overview(brokerA, { kind: "BROKER", brokerId: brokerB.actorId }))
          .code,
        "FORBIDDEN",
        "a broker cannot filter to another broker",
      );
      equal(
        (await overview(brokerA, { kind: "UNASSIGNED" })).code,
        "FORBIDDEN",
        "a broker cannot read unassigned artists",
      );
      equal(
        (
          await run(brokerA, {
            action: "ARTIST",
            artistId: artists.a3,
            period: march,
          })
        ).code,
        "NOT_FOUND",
        "another broker's artist reads as missing",
      );
      equal(
        (
          await run(brokerA, {
            action: "ARTIST",
            artistId: artists.a4,
            period: march,
          })
        ).code,
        "NOT_FOUND",
        "an unassigned artist reads as missing to a broker",
      );
      equal(
        (await run(nobody, { action: "CONTEXT" })).code,
        "FORBIDDEN",
        "an account without ledger keys is refused",
      );
      equal(
        (
          await run(owner, {
            action: "ARTIST",
            artistId: randomUUID(),
            period: march,
          })
        ).code,
        "NOT_FOUND",
        "an unknown artist is missing",
      );

      // ---------- Who may reveal which message ----------
      const brokerA1 = await run(brokerA, {
        action: "ARTIST",
        artistId: artists.a1,
        period: march,
      });
      const flag = (result, lineKey) =>
        result.lines.find((line) => line.itemId === items[lineKey].item)
          ?.message ?? null;
      check(
        flag(brokerA1, "L1") !== null &&
          flag(brokerA1, "L2") === null &&
          flag(brokerA1, "L4") !== null,
        "a broker may open approved or unreviewed messages on its lines, not empty ones",
      );
      const brokerB3 = await run(brokerB, {
        action: "ARTIST",
        artistId: artists.a3,
        period: march,
      });
      check(
        flag(brokerB3, "L3") === null,
        "a rejected message is withheld from the broker",
      );
      const ownerA3 = await run(owner, {
        action: "ARTIST",
        artistId: artists.a3,
        period: march,
      });
      check(
        flag(ownerA3, "L3") !== null,
        "the studio still opens rejected messages under the orders rules",
      );

      const readMessage = (who, lineKey, reviewLocale = "en", version = 1) =>
        tx((r) =>
          r.prepareMessage({
            schemaVersion: 1,
            access: who.access(),
            command: {
              schemaVersion: 1,
              action: "READ_MESSAGE",
              orderId: items[lineKey].order,
              itemId: items[lineKey].item,
              expectedIntentVersion: version,
              reviewLocale,
            },
            timeZone: "Asia/Shanghai",
          }),
        );
      const confirm = (who, accessId) =>
        tx((r) =>
          r.confirmMessage({
            schemaVersion: 1,
            access: who.access(),
            accessId,
          }),
        );
      const audits = async (actor) =>
        Number(
          (
            await q(
              "SELECT count(*) n FROM audit_logs WHERE actor_id=$1 AND action='ORDER_PRIVATE_READ'",
              [actor.actorId],
            )
          )[0].n,
        );
      const beforeReads = await audits(brokerA);
      const snapshot = await readMessage(brokerA, "L1", "zh-CN");
      check(
        snapshot.kind === "MESSAGE" &&
          snapshot.fanMessageCiphertext?.startsWith("enc:v1:"),
        "a broker's message read returns only ciphertext to decrypt",
        snapshot.code,
      );
      equal(
        (await confirm(brokerA, snapshot.accessId)).kind,
        "PRIVATE_CONFIRMED",
        "and is confirmed after decryption",
      );
      equal(
        await audits(brokerA),
        beforeReads + 1,
        "every read writes one audit",
      );
      const second = await readMessage(brokerA, "L1", "zh-CN");
      equal(
        await audits(brokerA),
        beforeReads + 2,
        "a second read writes another audit",
      );
      equal(
        (
          await q(
            "SELECT count(*)::int n FROM admin_order_private_accesses WHERE actor_id=$1 AND kind='MESSAGE' AND expires_at<=created_at+interval '300 seconds'",
            [brokerA.actorId],
          )
        )[0].n,
        2,
        "each read leaves a five-minute access receipt",
      );
      equal(
        (await readMessage(brokerA, "L3")).code,
        "NOT_FOUND",
        "a broker cannot read another broker's artist's message",
      );
      equal(
        (await readMessage(brokerB, "L3")).code,
        "PRIVATE_CONTENT_UNAVAILABLE",
        "a broker cannot read a rejected message on its own artist",
      );
      equal(
        (await readMessage(brokerA, "L10")).code,
        "NOT_FOUND",
        "no message reads on unpaid orders",
      );
      equal(
        (await readMessage(brokerA, "L1", "en", 2)).code,
        "STALE_VERSION",
        "the line version must match",
      );
      equal(
        (await readMessage(owner, "L1", "ja")).kind,
        "MESSAGE",
        "the studio reads in a granted review language",
      );
      equal(
        (await readMessage(operator, "L1", "ja")).code,
        "LANGUAGE_REVIEW_REQUIRED",
        "without a grant for the review language the orders rules refuse",
      );
      equal(
        (await readMessage(nobody, "L1")).code,
        "FORBIDDEN",
        "no ledger keys, no message",
      );

      // Direct SQL cannot skip the broker rule: 0059's receipt check repeats it.
      const forged = async (who, lineKey) => {
        const audit = randomUUID();
        return sql([
          [
            "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'ORDER_PRIVATE_READ','ORDER',$3,$1,$1,'SUCCEEDED','ORDER_PRIVATE')",
            [audit, who.actorId, items[lineKey].order],
          ],
          [
            `INSERT INTO admin_order_private_accesses(id,actor_id,session_id,order_id,kind,item_id,support_intent_id,intent_version,review_locale,material_hash,audit_log_id,request_id,correlation_id,expires_at)
            SELECT gen_random_uuid(),$1,$2,$3,'MESSAGE',$4,s.id,s.version,'en',public.cart_private_material_hash(s.fan_message_ciphertext,s.display_mode,s.display_name_ciphertext,s.encrypted_data_key,s.encryption_key_version,s.fan_message_locale),$5,$5,$5,transaction_timestamp()+interval '60 seconds'
            FROM support_intents s WHERE s.id=$6`,
            [
              who.actorId,
              who.sessionId,
              items[lineKey].order,
              items[lineKey].item,
              audit,
              items[lineKey].intent,
            ],
          ],
        ]);
      };
      equal(
        await forged(brokerA, "L1"),
        "COMMIT",
        "the guard admits a broker's read on its own paid line",
      );
      check(
        (await forged(brokerA, "L3")).includes(
          "order receipt requires current canonical session permission",
        ),
        "the guard refuses another broker's line",
      );
      check(
        (await forged(brokerB, "L3")).includes(
          "order receipt requires current canonical session permission",
        ),
        "the guard refuses a rejected message",
      );
      check(
        (await forged(brokerA, "L10")).includes(
          "order receipt requires current canonical session permission",
        ),
        "the guard refuses an unpaid line",
      );

      // ---------- Reassignment ----------
      await seed(() => assign(artists.a1, brokerB.actorId));
      equal(
        [
          ...new Set(
            (await overview(brokerA)).artists.map((a) => a.displayName),
          ),
        ],
        ["ledger-a2"],
        "after reassignment the old broker no longer sees the artist",
      );
      equal(
        (
          await run(brokerA, {
            action: "ARTIST",
            artistId: artists.a1,
            period: march,
          })
        ).code,
        "NOT_FOUND",
        "nor its lines",
      );
      equal(
        (await confirm(brokerA, second.accessId)).code,
        "NOT_FOUND",
        "a read prepared before reassignment is not confirmed after it",
      );
      equal(
        (await readMessage(brokerA, "L1")).code,
        "NOT_FOUND",
        "nor may it open new messages",
      );
      equal(
        row(await overview(brokerB), "a1"),
        row(all, "a1"),
        "the new broker sees the artist's whole history",
      );
      check(
        (await forged(brokerA, "L1")).includes(
          "order receipt requires current canonical session permission",
        ),
        "the guard follows the reassignment",
      );

      // ---------- Exports ----------
      const exported = await run(owner, {
        action: "EXPORT",
        scope: { kind: "ALL" },
        period: march,
      });
      equal(
        [
          exported.kind,
          exported.scope,
          exported.subject,
          exported.exportedBy,
          exported.truncated,
        ],
        ["EXPORT", { kind: "ALL" }, null, "Studio Owner", false],
        "a global export names its reader",
      );
      equal(
        total(exported, "LIVE", "USD"),
        total(all, "LIVE", "USD"),
        "an export's totals equal the page's",
      );
      equal(
        exported.lines.length,
        12,
        "a global export lists every paid line of the period",
      );
      const text = JSON.stringify(exported);
      check(
        !text.includes("message") &&
          !text.includes("ciphertext") &&
          !text.includes("intentVersion") &&
          !text.includes("@"),
        "an export carries no message, signature, ciphertext or email",
      );
      const receipt = (
        await q(
          "SELECT r.scope,r.period_from::text period_from,r.time_zone,r.line_count,a.action,a.subject_type,a.reason_code FROM artist_ledger_exports r JOIN audit_logs a ON a.id=r.audit_log_id WHERE r.id=$1",
          [exported.exportId],
        )
      )[0];
      equal(
        [
          receipt?.scope,
          receipt?.period_from,
          receipt?.time_zone,
          receipt?.line_count,
          receipt?.action,
          receipt?.subject_type,
          receipt?.reason_code,
        ],
        [
          "ALL",
          "2026-03-01",
          "Asia/Shanghai",
          12,
          "ARTIST_LEDGER_EXPORT",
          "ARTIST_LEDGER_EXPORT",
          "ALL_SCOPE",
        ],
        "every export leaves a receipt and an audit",
      );
      const brokerAll = await run(brokerA, {
        action: "EXPORT",
        scope: { kind: "ALL" },
        period: march,
      });
      equal(
        [
          brokerAll.scope,
          brokerAll.subject,
          [...new Set(brokerAll.artists.map((a) => a.displayName))],
        ],
        [
          { kind: "BROKER", brokerId: brokerA.actorId },
          "Mina Park",
          ["ledger-a2"],
        ],
        "a broker's export is recorded as its own scope",
      );
      equal(
        (
          await run(brokerA, {
            action: "EXPORT",
            scope: { kind: "BROKER", brokerId: brokerB.actorId },
            period: march,
          })
        ).code,
        "FORBIDDEN",
        "a broker cannot export another broker",
      );
      equal(
        (
          await run(brokerA, {
            action: "EXPORT",
            scope: { kind: "ARTIST", artistId: artists.a1 },
            period: march,
          })
        ).code,
        "NOT_FOUND",
        "nor an artist no longer its own",
      );
      const single = await run(brokerB, {
        action: "EXPORT",
        scope: { kind: "ARTIST", artistId: artists.a1 },
        period: march,
      });
      equal(
        [single.subject, single.lines.length],
        ["ledger-a1", 5],
        "one artist's export",
      );
      equal(
        (
          await run(operator, {
            action: "EXPORT",
            scope: { kind: "BROKER", brokerId: brokerB.actorId },
            period: march,
          })
        ).subject,
        "Rui Tanaka",
        "operations export one broker",
      );
      const forgedExport = async (who, scopeKind, extra = {}) => {
        const id = randomUUID(),
          audit = randomUUID();
        return sql([
          [
            "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'ARTIST_LEDGER_EXPORT','ARTIST_LEDGER_EXPORT',$3,$1,$1,'SUCCEEDED','ARTIST_LEDGER')",
            [audit, who.actorId, extra.auditSubject ?? id],
          ],
          [
            "INSERT INTO artist_ledger_exports(id,actor_id,session_id,scope,broker_identity_id,idol_id,period_from,period_to,time_zone,line_count,truncated,audit_log_id,request_id) VALUES($1,$2,$3,$4,$5,$6,'2026-03-01','2026-03-31','Asia/Shanghai',0,false,$7,$7)",
            [
              id,
              who.actorId,
              who.sessionId,
              scopeKind,
              extra.broker ?? null,
              extra.artist ?? null,
              audit,
            ],
          ],
        ]);
      };
      check(
        (await forgedExport(brokerA, "ALL")).includes(
          "ledger export requires ledger authority over its whole scope",
        ),
        "the database refuses a broker's global export receipt",
      );
      check(
        (
          await forgedExport(brokerA, "BROKER", { broker: brokerB.actorId })
        ).includes("ledger export requires ledger authority"),
        "or one for another broker",
      );
      equal(
        await forgedExport(brokerA, "BROKER", { broker: brokerA.actorId }),
        "COMMIT",
        "a broker's own-scope receipt is admitted",
      );
      check(
        (
          await forgedExport(owner, "ALL", { auditSubject: randomUUID() })
        ).includes("ledger export requires its exact audit record"),
        "a receipt must match its audit",
      );
      check(
        (await sql([["UPDATE artist_ledger_exports SET line_count=1", []]])) !==
          "COMMIT" &&
          (await sql([["DELETE FROM artist_ledger_exports", []]])) !== "COMMIT",
        "export receipts are append-only",
      );

      // ---------- History blocks the downgrade ----------
      // Later migrations come off first, so what refuses below is 0059's own down and not a version mismatch.
      const later = await client.query(
        "SELECT version FROM schema_migrations WHERE version>'0059' ORDER BY version DESC",
      );
      for (const { version } of later.rows)
        await migrate({ direction: "down", confirmVersion: version });
      // The runner reports only which down failed; the down script itself says why.
      await client.query("BEGIN");
      const reason = await client
        .query(
          readFileSync(
            new URL(
              "../../../database/migrations/0059_artist-ledger.down.sql",
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
        "55000: artist ledger export history cannot be downgraded",
        "0059's down refuses while export receipts exist",
      );
      await client.end();
      const refused = await migrate({
        direction: "down",
        confirmVersion: "0059",
      }).then(
        () => "MIGRATED",
        (error) => String(error?.message ?? error),
      );
      equal(
        refused,
        "migration 0059 down failed",
        "and the runner leaves 0059 in place",
      );
    } catch (error) {
      // The cluster wrapper reports only that the scenario failed; keep the actual cause.
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
    suite: "artist-ledger",
    assertions,
    failures,
    evidence:
      "real migrated PostgreSQL through the actual ledger repository and direct SQL; orders, payments and refunds are replica-seeded, so this is not order lifecycle evidence",
  }),
);
process.exitCode = failures.length === 0 ? 0 : 1;
