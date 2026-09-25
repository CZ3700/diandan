import { Client } from "pg";
import { expireOrderPaymentReservations } from "./order-payment-expiry-fixture.mjs";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createPostgresPersistence } from "../dist/index.js";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "../../../apps/api/scripts/order-payment-client.mjs";
import {
  seedAdminOrdersRoles,
  createPaidAdminOrder,
} from "../../../apps/api/scripts/admin-orders-fixtures.mjs";
const digest = () => randomBytes(32).toString("hex");
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Repository acceptance over normally paid TEST orders, never seeded payment state. */
export async function verifyAdminOrders({ context }) {
  const { client, check, progress } = context;
  const persistence = createPostgresPersistence(context.database, {
    catalogPublicMediaBaseUrl: context.gateway.origin,
  });
  const tx = (work) =>
    persistence.adminOrdersTransactionManager.runInAdminOrdersTransaction(work);
  const sql = async (query, values = []) =>
    (await client.query(query, values)).rows;
  const { actors, permissions } = await seedAdminOrdersRoles(client, {
    issuer: "https://orders-identity.example.test",
    subjectPepper: digest(),
  });
  async function session(actor, ttl = 3600) {
    const sessionId = randomUUID(),
      sessionTokenDigest = digest(),
      csrfTokenDigest = digest();
    await client.query(
      "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()+$5::int*interval '1 second')",
      [
        sessionId,
        actor.id,
        Buffer.from(sessionTokenDigest, "hex"),
        Buffer.from(csrfTokenDigest, "hex"),
        ttl,
      ],
    );
    return {
      schemaVersion: 1,
      sessionTokenDigest,
      csrfTokenDigest,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    };
  }
  const sessions = {};
  for (const [key, actor] of Object.entries(actors))
    sessions[key] = await session(actor);
  const request = (command, who = "manager", overrides = {}) => {
    const access = sessions[who];
    return {
      schemaVersion: 1,
      access: {
        ...access,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
      command: { schemaVersion: 1, ...command },
      requestHash: "idempotencyKey" in command ? hash(command) : null,
      ...overrides,
    };
  };
  const run = (command, who = "manager") =>
    tx(({ adminOrders }) => adminOrders.execute(request(command, who)));
  const detail = (id) => run({ action: "DETAIL", orderId: id });
  const failure = (result, code, label) =>
    check(result.outcome === "FAILURE" && result.code === code, label);
  const success = (result, label) => check(result.outcome === "SUCCESS", label);
  const mutate = (d, line, action, extra = {}) => ({
    action,
    orderId: d.orderId,
    expectedOrderVersion: d.version,
    fulfillmentId: line.fulfillmentId,
    expectedFulfillmentVersion: line.fulfillmentVersion,
    reasonCode: "LOCAL_ACCEPTANCE",
    idempotencyKey: randomUUID(),
    ...extra,
  });
  async function privateRead(d, line, who = "manager", locale = "ja") {
    const value = await tx(({ adminOrders }) =>
      adminOrders.preparePrivate(
        request(
          {
            action: "READ_MESSAGE",
            orderId: d.orderId,
            itemId: line.itemId,
            expectedIntentVersion: line.intentVersion,
            reviewLocale: locale,
          },
          who,
        ),
      ),
    );
    check(
      value.kind === "MESSAGE",
      "audit commits before encrypted private snapshot is returned",
    );
    check(
      (
        await sql("SELECT id FROM admin_order_private_accesses WHERE id=$1", [
          value.accessId,
        ])
      ).length === 1,
      "private read receipt is durably present",
    );
    return value;
  }
  const confirm = (snapshot, who = "manager") => {
    const access = sessions[who];
    return tx(({ adminOrders }) =>
      adminOrders.confirmPrivate({
        schemaVersion: 1,
        access,
        accessId: snapshot.accessId,
      }),
    );
  };
  const review = (d, line, snapshot, who = "manager", decision = "APPROVED") =>
    run(
      {
        action: "REVIEW_MESSAGE",
        orderId: d.orderId,
        expectedOrderVersion: d.version,
        itemId: line.itemId,
        expectedIntentVersion: line.intentVersion,
        accessId: snapshot.accessId,
        reviewLocale: snapshot.reviewLocale,
        languageConfirmed: true,
        decision,
        reasonCode: "LOCAL_REVIEW",
        idempotencyKey: randomUUID(),
      },
      who,
    );
  const payment = createOrderPaymentProtocolClient(context);
  try {
    progress("admin repository permissions and historical paid order detail");
    failure(
      await run(
        {
          action: "LIST",
          page: 1,
          pageSize: 10,
          query: "",
          fulfillment: "ALL",
          moderation: "ALL",
        },
        "editor",
      ),
      "FORBIDDEN",
      "content editor has no order authority",
    );
    const contextResult = await run({ action: "CONTEXT" }, "order");
    success(contextResult, "order role context succeeds");
    check(
      !contextResult.permissions.includes("orders.manage"),
      "order operator cannot acquire Manager permission",
    );
    const value = await createPaidAdminOrder(
        context,
        { ...payment, assertPaid: (value) => payment.assertPaid(value, 1) },
        {
          lines: [{}, { gift: context.fixtures.gifts[6] }],
        },
      ),
      id = value.orderId;
    let d = await detail(id);
    success(d, "normally paid order detail is readable");
    check(
      d.items.length === 2,
      "multi-item order retains both independent fulfillments",
    );
    check(
      d.items.every(
        (i) => i.giftKind !== "LEGACY" && i.inventoryPolicy !== "LEGACY",
      ),
      "detail reads immutable gift and checkout policy evidence",
    );
    check(
      !payment.canaries.some((v) => JSON.stringify(d).includes(v)),
      "ordinary detail contains no private message or name",
    );
    const inventoryBefore = await sql(
      "SELECT r.id,r.status,r.quantity,(SELECT count(*)::int FROM inventory_ledger l WHERE l.reservation_id=r.id) entries FROM inventory_reservations r WHERE r.locked_order_id=$1 ORDER BY r.id",
      [id],
    );
    check(
      inventoryBefore.length === 1 && inventoryBefore[0].status === "COMMITTED",
      "mixed virtual and finite gifts reserve only the tracked line",
    );
    const originalVersion = d.version;
    failure(
      await run(mutate(d, d.items[0], "PREPARE"), "order"),
      "MODERATION_REQUIRED",
      "unreviewed message or nickname cannot prepare",
    );
    failure(
      await run(mutate(d, d.items[0], "HOLD", { confirmed: true }), "order"),
      "FORBIDDEN",
      "only Manager can hold",
    );
    failure(
      await tx(({ adminOrders }) =>
        adminOrders.preparePrivate(
          request(
            {
              action: "READ_MESSAGE",
              orderId: id,
              itemId: d.items[0].itemId,
              expectedIntentVersion: d.items[0].intentVersion,
              reviewLocale: "th",
            },
            "order",
          ),
        ),
      ),
      "LANGUAGE_REVIEW_REQUIRED",
      "content grants never substitute for order-message language grant",
    );
    progress("direct SQL cannot create unaccountable HUMAN review");
    await client.query("BEGIN");
    let nakedReviewRejected = false;
    try {
      await client.query(
        "UPDATE support_intents SET moderation_status='APPROVED',moderation_reason_code=NULL,moderation_decision_kind='HUMAN',moderation_reviewer_id=$2,moderation_rule_version=NULL,moderation_evidence_id=NULL,reviewed_at=transaction_timestamp(),updated_at=transaction_timestamp(),version=version+1 WHERE id=(SELECT support_intent_id FROM order_items WHERE id=$1)",
        [d.items[0].itemId, actors.manager.id],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    } catch (error) {
      nakedReviewRejected = error.code === "23514";
    } finally {
      await client.query("ROLLBACK");
    }
    check(
      nakedReviewRejected,
      "converted HUMAN review must have the exact private-access language receipt",
    );
    progress("audited reads and same-session exact-version language review");
    for (const line of d.items) {
      const snapshot = await privateRead(d, line, "order");
      failure(
        await confirm(snapshot, "manager"),
        "PRIVATE_ACCESS_EXPIRED",
        "private receipt cannot move to another actor or session",
      );
      failure(
        await review(d, line, snapshot, "order"),
        "PRIVATE_ACCESS_EXPIRED",
        "review requires confirmation after successful decrypt",
      );
      success(
        await confirm(snapshot, "order"),
        "current same-session private material is confirmed",
      );
      success(
        await review(d, line, snapshot, "order"),
        "HUMAN review uses exact confirmed language and intent version",
      );
      failure(
        await confirm(snapshot, "order"),
        "STALE_VERSION",
        "review invalidates prior intent version private receipt",
      );
    }
    d = await detail(id);
    check(
      d.version === originalVersion,
      "message review does not change order aggregate version",
    );
    check(
      d.items.every(
        (i) =>
          i.languageConfidence === "CONFIRMED" && i.reviewedLocale === "ja",
      ),
      "review language evidence is visible independently of declared locale",
    );
    const first = mutate(d, d.items[0], "PREPARE");
    success(await run(first, "order"), "first line prepares");
    const replay = await run(first, "order");
    check(
      replay.replayed === true,
      "same key repeats after order version changed",
    );
    failure(
      await run({ ...first, reasonCode: "CHANGED" }, "order"),
      "IDEMPOTENCY_CONFLICT",
      "same key changed intent is rejected",
    );
    let next = await detail(id);
    check(
      next.version === d.version + 1,
      "first preparing line changes order aggregate once",
    );
    const second = mutate(next, next.items[1], "PREPARE"),
      beforeSecond = next.version;
    const concurrent = await Promise.all([
      run(second, "order"),
      run(second, "order"),
    ]);
    check(
      concurrent.every((r) => r.outcome === "SUCCESS") &&
        concurrent.filter((r) => r.replayed).length === 1,
      "concurrent same key creates exactly one mutation",
    );
    next = await detail(id);
    check(
      next.version === beforeSecond,
      "second preparing line preserves aggregate order version",
    );
    const held = mutate(next, next.items[0], "HOLD", { confirmed: true });
    success(
      await run(held),
      "Manager hold succeeds with reason and confirmation",
    );
    next = await detail(id);
    check(
      next.order.fulfillmentStatus === "ON_HOLD",
      "hold propagates aggregate",
    );
    success(
      await run(mutate(next, next.items[0], "RESUME", { confirmed: true })),
      "Manager may resume exact owned hold",
    );
    next = await detail(id);
    check(
      next.order.fulfillmentStatus === "PREPARING",
      "resume restores prior legal state",
    );
    success(
      await run(mutate(next, next.items[0], "DELIVER"), "order"),
      "first line delivered",
    );
    const partial = await detail(id);
    check(
      partial.version === next.version &&
        partial.order.fulfillmentStatus === "PREPARING",
      "partial delivery does not falsely complete entire order",
    );
    failure(
      await run(mutate(partial, partial.items[0], "PREPARE"), "order"),
      "TRANSITION_NOT_ALLOWED",
      "delivered line is terminal",
    );
    success(
      await run(mutate(partial, partial.items[1], "DELIVER"), "order"),
      "last line delivered",
    );
    d = await detail(id);
    check(
      d.version === partial.version + 1 &&
        d.order.fulfillmentStatus === "DELIVERED",
      "whole-order delivery increments aggregate exactly once",
    );
    check(
      JSON.stringify(inventoryBefore) ===
        JSON.stringify(
          await sql(
            "SELECT r.id,r.status,r.quantity,(SELECT count(*)::int FROM inventory_ledger l WHERE l.reservation_id=r.id) entries FROM inventory_reservations r WHERE r.locked_order_id=$1 ORDER BY r.id",
            [id],
          ),
        ),
      "prepare hold resume and delivery never mutate the paid inventory ledger",
    );
    progress("encrypted notes, append-only evidence and rollback");
    const envelope = {
      noteId: randomUUID(),
      ciphertext: `enc:v1:${randomBytes(64).toString("base64url")}`,
      encryptedDataKey: `enc:v1:${randomBytes(64).toString("base64url")}`,
      keyVersion: "test-encryption",
      algorithm: "AES_256_GCM",
    };
    const note = {
      action: "ADD_NOTE",
      orderId: id,
      expectedOrderVersion: d.version,
      idempotencyKey: randomUUID(),
      reasonCode: "LOCAL_NOTE",
      envelope,
    };
    success(await run(note, "order"), "encrypted note persists");
    const noteDetail = await detail(id);
    check(
      noteDetail.notes.length === 1 &&
        !JSON.stringify(noteDetail).includes(envelope.ciphertext),
      "ordinary note detail contains metadata only",
    );
    const notes = await tx(({ adminOrders }) =>
      adminOrders.preparePrivate(
        request({ action: "READ_NOTES", orderId: id }, "order"),
      ),
    );
    check(
      notes.kind === "NOTES" &&
        notes.notes[0].envelope.ciphertext === envelope.ciphertext,
      "audited private note snapshot retains ciphertext identity",
    );
    success(
      await confirm(notes, "order"),
      "notes permission rechecked before plaintext can return",
    );
    const count = Number(
      (
        await sql(
          "SELECT count(*) n FROM admin_order_notes WHERE order_id=$1",
          [id],
        )
      )[0].n,
    );
    let insertedBeforeFailure = false;
    try {
      await tx(async ({ adminOrders }) => {
        const result = await adminOrders.execute(
          request({
            ...note,
            idempotencyKey: randomUUID(),
            envelope: { ...envelope, noteId: randomUUID() },
          }),
        );
        insertedBeforeFailure = result.outcome === "SUCCESS";
        throw new Error("OWNED_ROLLBACK_PROBE");
      });
    } catch {
      // The transaction runner canonicalizes the intentional callback failure.
    }
    check(
      Number(
        (
          await sql(
            "SELECT count(*) n FROM admin_order_notes WHERE order_id=$1",
            [id],
          )
        )[0].n,
      ) === count && insertedBeforeFailure,
      "throw after append rolls back note audit and operation receipt",
    );
    let appendRejected = false;
    try {
      await client.query(
        "UPDATE admin_order_notes SET key_version='other' WHERE id=$1",
        [envelope.noteId],
      );
    } catch (error) {
      appendRejected = error.code === "55000";
    }
    check(appendRejected, "encrypted notes are immutable");
    const missingPermission = request(
      {
        ...note,
        idempotencyKey: randomUUID(),
        envelope: { ...envelope, noteId: randomUUID() },
      },
      "order",
    );
    await client.query(
      "DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2",
      [actors.order.roleId, permissions.get("orders.note")],
    );
    failure(
      await tx(({ adminOrders }) => adminOrders.execute(missingPermission)),
      "FORBIDDEN",
      "canonical revocation takes effect for existing session",
    );
    failure(
      await confirm(notes, "order"),
      "FORBIDDEN",
      "private notes reject revoked permission before return",
    );
    progress("unknown language remains human and cannot bypass triage");
    const unknown = await createPaidAdminOrder(context, payment, {
        messageLocale: "und",
      }),
      u = await detail(unknown.orderId),
      line = u.items[0];
    check(
      line.languageConfidence === "LOW",
      "unknown language never reports verified confidence",
    );
    failure(
      await tx(({ adminOrders }) =>
        adminOrders.preparePrivate(
          request(
            {
              action: "READ_MESSAGE",
              orderId: u.orderId,
              itemId: line.itemId,
              expectedIntentVersion: line.intentVersion,
              reviewLocale: "ja",
            },
            "order",
          ),
        ),
      ),
      "LANGUAGE_REVIEW_REQUIRED",
      "unknown message requires explicit triage permission",
    );
    const snapshot = await privateRead(u, line);
    success(await confirm(snapshot), "Manager triage read confirmed");
    success(
      await review(u, line, snapshot),
      "unknown locale receives manual HUMAN decision",
    );
    const verified = await detail(u.orderId);
    check(
      verified.items[0].declaredLocale === "und" &&
        verified.items[0].reviewedLocale === "ja",
      "human locale evidence never rewrites locked original locale",
    );
    progress("waiting locks recheck session expiration and revocation");
    const blocked = new Client(context.database);
    await blocked.connect();
    try {
      await blocked.query("BEGIN");
      await blocked.query(
        "SELECT id FROM carts WHERE id=(SELECT cart_id FROM orders WHERE id=$1) FOR UPDATE",
        [u.orderId],
      );
      sessions.expiring = await session(actors.manager, 1);
      const waiting = run(
        mutate(verified, verified.items[0], "PREPARE"),
        "expiring",
      );
      await waitForOrderPayment(
        "short admin session expires on real database clock",
        async () =>
          (
            await sql(
              "SELECT expires_at<=clock_timestamp() expired FROM admin_sessions WHERE session_token_digest=$1",
              [Buffer.from(sessions.expiring.sessionTokenDigest, "hex")],
            )
          )[0].expired,
        check,
      );
      await blocked.query("COMMIT");
      failure(
        await waiting,
        "UNAUTHENTICATED",
        "session expiration during cart lock wait prevents mutation",
      );
      sessions.revoked = await session(actors.manager);
      await blocked.query("BEGIN");
      await blocked.query(
        "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE session_token_digest=$1",
        [Buffer.from(sessions.revoked.sessionTokenDigest, "hex")],
      );
      const awaitingRevocation = run(
        { action: "DETAIL", orderId: u.orderId },
        "revoked",
      );
      await waitForOrderPayment(
        "authorization waits behind canonical session revocation",
        async () =>
          (
            await sql(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT s.admin_identity_id actor_id,%') blocked",
            )
          )[0].blocked,
        check,
      );
      await blocked.query("COMMIT");
      failure(
        await awaitingRevocation,
        "UNAUTHENTICATED",
        "pending canonical revocation rejects read after lock wait",
      );
    } finally {
      await blocked.query("ROLLBACK");
      await blocked.end();
    }
    progress("private review access expires independently of the live session");
    const recent = await privateRead(verified, verified.items[0]);
    const shortAccessId = randomUUID(),
      shortAudit = randomUUID(),
      shortRequest = randomUUID();
    await client.query("BEGIN");
    try {
      await client.query(
        "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'ORDER_PRIVATE_READ','ORDER',$3,$4,$4,'SUCCEEDED','ORDER_PRIVATE')",
        [shortAudit, actors.manager.id, u.orderId, shortRequest],
      );
      await client.query(
        "INSERT INTO admin_order_private_accesses(id,actor_id,session_id,order_id,kind,item_id,support_intent_id,intent_version,review_locale,material_hash,audit_log_id,request_id,correlation_id,expires_at) SELECT $1,actor_id,session_id,order_id,kind,item_id,support_intent_id,intent_version,review_locale,material_hash,$2,$3,$3,transaction_timestamp()+interval '1 second' FROM admin_order_private_accesses WHERE id=$4",
        [shortAccessId, shortAudit, shortRequest, recent.accessId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    const shortSnapshot = { ...recent, accessId: shortAccessId };
    success(
      await confirm(shortSnapshot),
      "short but live private receipt confirms",
    );
    await waitForOrderPayment(
      "private review TTL expires on real database clock",
      async () =>
        (
          await sql(
            "SELECT expires_at<=clock_timestamp() expired FROM admin_order_private_accesses WHERE id=$1",
            [shortAccessId],
          )
        )[0].expired,
      check,
    );
    failure(
      await review(verified, verified.items[0], shortSnapshot),
      "PRIVATE_ACCESS_EXPIRED",
      "expired private read cannot authorize a later HUMAN decision",
    );
    failure(
      await confirm(shortSnapshot),
      "PRIVATE_ACCESS_EXPIRED",
      "expired receipt cannot reveal another private response",
    );
    progress("late paid inventory hold cannot be resumed by Manager");
    const shortCheckout = await context.createCheckoutApi(8000);
    try {
      const late = await payment.fresh({
        checkoutBase: shortCheckout.base,
        lost: true,
        lines: [{ gift: context.fixtures.gifts[1] }],
      });
      const beforeCapture = await payment.state(late),
        pending = await detail(beforeCapture.order_id);
      failure(
        await run(mutate(pending, pending.items[0], "PREPARE")),
        "PAYMENT_NOT_CONFIRMED",
        "unknown payment cannot be forced into preparing",
      );
      const action = await context.psp.hostedAction(late.attempt.id);
      await expireOrderPaymentReservations({
        clientConfig: context.database,
        orderId: beforeCapture.order_id,
        timeoutMs: 20000,
      });
      late.attempt = { ...late.attempt, action };
      await payment.settle(late);
      const eventId = await payment.reconcile(late),
        applied = await payment.apply(eventId);
      check(
        applied.outcome === "PAID_REVIEW",
        "real late capture preserves paid evidence and missing stock hold",
      );
      let held = await detail(beforeCapture.order_id);
      check(
        held.order.fulfillmentStatus === "ON_HOLD" &&
          !held.items[0].allowedActions.includes("RESUME"),
        "payment-owned hold never advertises Manager resume",
      );
      const holdRead = await privateRead(held, held.items[0]);
      success(await confirm(holdRead), "held paid message can be reviewed");
      success(
        await review(held, held.items[0], holdRead),
        "hold content receives explicit HUMAN review",
      );
      held = await detail(beforeCapture.order_id);
      failure(
        await run(mutate(held, held.items[0], "RESUME", { confirmed: true })),
        "TRANSITION_NOT_ALLOWED",
        "even approved message cannot bypass missing inventory evidence",
      );
      const lateState = await payment.state(late);
      check(
        lateState.committed === 0 &&
          lateState.decrements === 0 &&
          lateState.fulfillment_status === "ON_HOLD",
        "blocked resume does not recommit expired inventory",
      );
    } finally {
      await shortCheckout.stop();
    }
    return {
      scope:
        "Real PostgreSQL repositories, normal hosted TEST PSP capture and verified webhook; no real payment, email or physical handoff.",
      orderIds: [id, u.orderId],
    };
  } finally {
    await persistence.close();
  }
}
