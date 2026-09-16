#!/usr/bin/env node
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { createOrderAccessUseCases } from "@fan-support/application";
import { withEphemeralPostgres } from "../dist/index.js";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../media-s3/scripts/ephemeral-s3-harness.mjs";
import { withOrderAccessFixture } from "../../../apps/api/scripts/order-access-runtime.mjs";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "../../../apps/api/scripts/order-payment-client.mjs";
import { createCheckoutProtocolClient } from "../../../apps/api/scripts/checkout-preflight-client.mjs";
import { createTestCartRuntimeComposition } from "../../../apps/api/dist/cart-composition.js";
import { createApiApplication } from "../../../apps/api/dist/bootstrap.js";
import { preflightEnvironment } from "../../../apps/api/scripts/publication-preflight-http-fixtures.mjs";
import { publicationMediaEnvironment } from "../../../apps/api/scripts/publication-runtime-http-media.mjs";
import { createStructuredLogger } from "../../observability/dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const trace = () => ({
  requestId: randomUUID(),
  correlationId: randomUUID(),
  taskName: "commerce-expiry-protocol",
});
const safeError = (error) => ({
  name: /^[A-Za-z]{1,64}$/u.test(error?.name ?? "") ? error.name : null,
  code: /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : null,
});
function latch() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Uses normal checkout/PSP/access APIs and real elapsed PG expiry. SQL observers never fabricate business facts. */
export async function verifyCommerceExpiry({ context, s3 }) {
  const { client, persistence, check, progress } = context;
  const payment = createOrderPaymentProtocolClient(context),
    cases = [];
  const trackedGift = context.fixtures.gifts.find(
    (gift) =>
      gift.status === "active" &&
      gift.variants[0]?.policy === "TRACKED" &&
      gift.variants[0].quantity >= 4,
  );
  check(
    Boolean(trackedGift),
    "normal published fixture provides enough tracked stock for independent expiry races",
  );
  const tx = persistence.commerceExpiryTransactionManager;
  const command = (cartId) => ({ schemaVersion: 1, cartId, ...trace() });
  const expire = (cartId) =>
    tx.runInCommerceExpiryTransaction((repo) =>
      repo.expireCart(command(cartId)),
    );
  const same = (a, b, label) =>
    check(JSON.stringify(a) === JSON.stringify(b), label);
  const scalar = async (sql, args) => (await client.query(sql, args)).rows[0];
  const cartId = async (value) =>
    (
      await scalar(
        "SELECT cart_id FROM orders WHERE checkout_session_id=$1::uuid",
        [value.checkout.id],
      )
    ).cart_id;
  async function due(value) {
    await waitForOrderPayment(
      "actual checkout expiry elapses",
      async () =>
        (
          await scalar(
            "SELECT quote_expires_at<=clock_timestamp() due FROM orders WHERE checkout_session_id=$1::uuid",
            [value.checkout.id],
          )
        ).due,
      check,
      { timeoutMs: 30000 },
    );
  }
  async function accepted(value) {
    const signed = await context.signWebhook(value.attempt.id);
    check(
      (await context.sendWebhook(signed)).accepted,
      "actual signed TEST PSP webhook is durably accepted",
    );
    const event = await scalar(
      "SELECT id FROM provider_events WHERE provider_account_id=$1::uuid AND environment='TEST' AND provider_event_id=$2",
      [context.endpoint.providerAccountId, JSON.parse(signed.rawBody).event_id],
    );
    check(
      Boolean(event?.id),
      "canonical provider evidence exists in real PostgreSQL",
    );
    return event.id;
  }
  async function unknown(short) {
    const value = await payment.fresh({
      lost: true,
      checkoutBase: short.base,
      lines: [{ gift: trackedGift }],
    });
    value.attempt = {
      ...value.attempt,
      action: await context.psp.hostedAction(value.attempt.id),
    };
    return value;
  }
  async function inventory(value) {
    return (
      await client.query(
        `SELECT r.status,r.quantity,r.version,b.on_hand,b.reserved,
      (SELECT count(*)::int FROM inventory_ledger l WHERE l.reservation_id=r.id AND l.source_type='EXPIRY') expiry_ledgers,
      (SELECT count(*)::int FROM inventory_ledger l WHERE l.reservation_id=r.id AND l.delta_on_hand<0) decrements
      FROM inventory_reservations r JOIN inventory_balances b ON b.inventory_item_id=r.inventory_item_id AND b.location_id=r.location_id
      JOIN orders o ON o.id=r.locked_order_id WHERE o.checkout_session_id=$1::uuid ORDER BY r.id`,
        [value.checkout.id],
      )
    ).rows;
  }
  progress(
    "start normally created 60-second cart while other expiry cases run",
  );
  const composition = createTestCartRuntimeComposition({
    environment: "TEST",
    database: context.database,
    allowedOrigin: context.origin,
    publicMediaBaseUrl: context.gateway.origin,
    keyManagement: context.kms.adapter,
    activePepperVersion: "test-mac",
    pepperVersions: ["test-mac"],
    cartTtlMs: 60000,
  });
  context.own("expiry short cart composition", () =>
    composition.cartRuntime.stop(),
  );
  const app = await createApiApplication(
    {
      ...publicationMediaEnvironment(
        preflightEnvironment(context.database),
        s3,
      ),
      FAN_SUPPORT_SITE_ORIGIN: context.origin,
      FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: context.gateway.origin,
    },
    {
      ...composition,
      logger: createStructuredLogger({
        service: "api",
        write: (entry) => context.logLines.push(entry),
      }),
    },
  );
  context.own("expiry short cart API", () => app.close());
  await app.listen(0, "127.0.0.1");
  const shortCartClient = createCheckoutProtocolClient({
    ...context,
    base: await app.getUrl(),
    canaries: payment.canaries,
  });
  const abandoned = await shortCartClient.initialize();
  await payment.checkout.add(abandoned);
  const abandonedRow = await scalar(
    "SELECT c.id FROM carts c JOIN cart_items i ON i.cart_id=c.id WHERE i.id=$1::uuid",
    [abandoned.cart.items[0].id],
  );
  const abandonedHash = async () =>
    (
      await scalar(
        `SELECT encode(sha256(convert_to(coalesce(string_agg(encode(s.encrypted_data_key,'hex')||coalesce(encode(s.fan_message_ciphertext,'hex'),'')||coalesce(encode(s.display_name_ciphertext,'hex'),''),'' ORDER BY s.id),''),'UTF8')),'hex') hash FROM support_intents s JOIN cart_items i ON i.id=s.cart_item_id WHERE i.cart_id=$1::uuid`,
        [abandonedRow.id],
      )
    ).hash;
  const privateBefore = await abandonedHash();
  check(
    (await expire(abandonedRow.id)).decision === "NOT_DUE",
    "future active cart cannot be expired early",
  );
  const short = await context.createCheckoutApi(8000);
  try {
    progress(
      "no-attempt checkout and terminal failures cancel only after the actual quote expires",
    );
    const session = await payment.checkout.initialize();
    await payment.checkout.add(session, { gift: trackedGift });
    const preflight = (
      await payment.checkout.validate(session, { target: short.base })
    ).data.preflight;
    const noAttempt = {
      session,
      checkout: (
        await payment.checkout.create(session, preflight, payment.canaries[2], {
          target: short.base,
        })
      ).data.checkout,
    };
    const untouched = await payment.immutableSnapshot(noAttempt);
    check(
      (await expire(await cartId(noAttempt))).decision === "NOT_DUE",
      "unexpired checkout has no cancellation authority",
    );
    await due(noAttempt);
    const noAttemptCart = await cartId(noAttempt);
    const stockBeforeRollback = await inventory(noAttempt);
    let rollbackBoundaryReached = false;
    await assert.rejects(
      tx.runInCommerceExpiryTransaction(async (repo) => {
        await repo.expireCart(command(noAttemptCart));
        rollbackBoundaryReached = true;
        throw new Error("OWNED_EXPIRY_BEFORE_COMMIT");
      }),
    );
    check(
      rollbackBoundaryReached,
      "rollback fault occurs after all actual repository writes",
    );
    same(
      await inventory(noAttempt),
      stockBeforeRollback,
      "pre-COMMIT injected failure rolls back inventory and expiry ledger together",
    );
    check(
      (
        await scalar(
          "SELECT order_status FROM orders WHERE checkout_session_id=$1::uuid",
          [noAttempt.checkout.id],
        )
      ).order_status === "PENDING_PAYMENT",
      "failed cleanup does not leave a partial cancellation",
    );
    const cleanup = await expire(await cartId(noAttempt));
    check(
      cleanup.canceledOrders === 1 &&
        cleanup.canceledIntents === 1 &&
        cleanup.expiredReservations === 1 &&
        cleanup.expiredCart,
      "elapsed no-attempt checkout closes the original aggregate",
    );
    same(
      await payment.immutableSnapshot(noAttempt),
      untouched,
      "cancellation preserves immutable order items and monetary snapshots",
    );
    check(
      (await expire(await cartId(noAttempt))).decision === "NOT_DUE",
      "repeated cleanup of canceled checkout is a no-op",
    );
    cases.push({ kind: "NO_ATTEMPT_QUOTE_EXPIRY", cleanup });
    cases.push({
      kind: "PRE_COMMIT_ROLLBACK",
      scope:
        "Injected exception after real repository writes, before real COMMIT",
    });
    for (const terminal of ["FAILED", "CANCELED", "EXPIRED"]) {
      const value = await payment.fresh({
        checkoutBase: short.base,
        lines: [{ gift: trackedGift }],
      });
      await payment.settle(value, terminal);
      const event = await accepted(value);
      await payment.apply(event);
      const immutable = await payment.immutableSnapshot(value);
      await due(value);
      const result = await expire(await cartId(value));
      check(
        result.canceledOrders === 1 &&
          result.canceledIntents === 1 &&
          result.expiredReservations === 0,
        "trusted terminal failure releases once and later cancels the expired checkout",
      );
      same(
        await payment.immutableSnapshot(value),
        immutable,
        "terminal cleanup preserves quote/line provenance",
      );
      cases.push({ kind: `${terminal}_QUOTE_EXPIRY`, result });
    }
    progress(
      "cleanup wins real cart lock while signed webhook application competes",
    );
    const late = await unknown(short);
    await due(late);
    await payment.settle(late);
    await payment.reconcile(late);
    check(
      (await payment.state(late)).attempt_status === "UNKNOWN",
      "authenticated capture evidence binds the lost reference without applying financial success",
    );
    const event = await accepted(late);
    const before = await inventory(late),
      locked = latch(),
      release = latch();
    const expiring = tx.runInCommerceExpiryTransaction(async (repo) => {
      const result = await repo.expireCart(command(await cartId(late)));
      locked.resolve();
      await release.promise;
      return result;
    });
    await Promise.race([locked.promise, expiring]);
    let ended = false;
    const observedApply = context.observeSqlStates(() => payment.apply(event));
    const applying = observedApply.promise
      .then(
        (value) => ({ value }),
        (error) => ({ error: safeError(error) }),
      )
      .finally(() => {
        ended = true;
      });
    await delay(80);
    const blocked = !ended;
    release.resolve();
    const expiryResult = await expiring,
      firstApply = await applying;
    console.log(
      `Expiry competition ${JSON.stringify({ blocked, expiryDecision: expiryResult.decision, firstApply: firstApply.error ?? firstApply.value.decision, sqlStates: observedApply.sqlStates })}`,
    );
    check(
      blocked,
      "webhook application waits for the actual cleanup aggregate lock",
    );
    if (firstApply.error)
      check(
        firstApply.error.code === "PERSISTENCE_FAILURE" &&
          observedApply.sqlStates.length > 0 &&
          observedApply.sqlStates.every((code) => code === "40001"),
        "only transient application failure requires durable retry",
      );
    await payment.apply(event);
    const final = await payment.state(late),
      after = await inventory(late);
    check(
      expiryResult.expiredReservations === 1 &&
        final.payment_status === "PAID" &&
        final.fulfillment_status === "ON_HOLD",
      "late trusted capture after cleanup remains paid and held",
    );
    check(
      after[0].on_hand === before[0].on_hand &&
        after[0].expiry_ledgers === 1 &&
        after[0].decrements === 0,
      "expiry never double-releases or decrements on-hand",
    );
    await expire(await cartId(late));
    await payment.apply(event);
    same(
      await inventory(late),
      after,
      "repeated cleanup and webhook preserve exact stock counters",
    );
    cases.push({
      kind: "CLEANUP_BEFORE_WEBHOOK",
      expiryResult,
      firstApply: firstApply.error ?? firstApply.value.decision,
      sqlStates: observedApply.sqlStates,
    });

    progress(
      "webhook wins cart lock while cleanup skips and then re-reads committed state",
    );
    const paid = await unknown(short);
    await due(paid);
    await payment.settle(paid);
    await payment.reconcile(paid);
    check(
      (await payment.state(paid)).attempt_status === "UNKNOWN",
      "webhook-first concurrency starts with unapplied trusted capture evidence",
    );
    const paidEvent = await accepted(paid);
    const paidCart = await cartId(paid),
      applied = latch(),
      commit = latch();
    const pending =
      persistence.orderPaymentApplicationTransactionManager.runInOrderPaymentApplicationTransaction(
        async (repo) => {
          const result = await repo.apply(payment.command(paidEvent));
          applied.resolve();
          await commit.promise;
          return result;
        },
      );
    await Promise.race([applied.promise, pending]);
    let skipped;
    try {
      skipped = await expire(paidCart);
    } finally {
      commit.resolve();
    }
    await pending;
    check(
      skipped.decision === "BUSY",
      "cleanup skips an aggregate held by trusted webhook application",
    );
    check(
      (await expire(paidCart)).expiredReservations === 0,
      "committed inventory cannot be expired afterward",
    );
    const committed = await inventory(paid);
    check(
      committed[0].status === "COMMITTED" &&
        committed[0].decrements === 1 &&
        committed[0].expiry_ledgers === 0,
      "webhook-first path commits exactly once",
    );
    cases.push({ kind: "WEBHOOK_BEFORE_CLEANUP", skipped });

    progress("expired checkout cleanup competes with a real CREATE request");
    const createSession = await payment.checkout.initialize();
    await payment.checkout.add(createSession, {
      gift: trackedGift,
    });
    const createPreflight = (
      await payment.checkout.validate(createSession, { target: short.base })
    ).data.preflight;
    const createValue = {
      session: createSession,
      checkout: (
        await payment.checkout.create(
          createSession,
          createPreflight,
          payment.canaries[2],
          { target: short.base },
        )
      ).data.checkout,
    };
    const capability = (
      await payment.payment.capabilities(createSession, createValue.checkout.id)
    ).data.capabilities.capabilities[0];
    const providerBefore = await context.psp.counts();
    await due(createValue);
    const createRace = await Promise.allSettled([
      expire(await cartId(createValue)),
      payment.payment.create(
        createSession,
        createValue.checkout.id,
        capability,
        { key: randomUUID(), expected: [401, 409, 410, 503] },
      ),
    ]);
    check(
      createRace.every((result) => result.status === "fulfilled"),
      "actual CREATE/cleanup race completes without a deadlock",
    );
    check(
      createRace[1].value.data.outcome === "FAILURE",
      "expired quote cannot authorize a new provider attempt",
    );
    const createFinal = await expire(await cartId(createValue));
    check(
      ["APPLIED", "NOT_DUE"].includes(createFinal.decision),
      "cleanup eventually closes the expired uncharged checkout",
    );
    check(
      (
        await scalar(
          "SELECT count(*)::int count FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.checkout_session_id=$1::uuid",
          [createValue.checkout.id],
        )
      ).count === 0,
      "CREATE race cannot fabricate a second charge or attempt",
    );
    same(
      await context.psp.counts(),
      providerBefore,
      "expired CREATE never reaches the TEST PSP",
    );
    cases.push({
      kind: "CREATE_VERSUS_CLEANUP",
      createStatus: createRace[1].value.response.status,
    });

    progress(
      "uncertain reconcile and active PSP checkout remain uncanceled after quote expiry",
    );
    const live = await payment.fresh({
      checkoutBase: short.base,
      lines: [{ gift: trackedGift }],
    });
    await due(live);
    const protectedResult = await expire(await cartId(live));
    check(
      protectedResult.decision === "DEFERRED" &&
        protectedResult.canceledOrders === 0 &&
        protectedResult.expiredReservations === 0,
      "REQUIRES_ACTION checkout protects every resource",
    );
    const unknownValue = await unknown(short);
    await due(unknownValue);
    const concurrent = await Promise.allSettled([
      expire(await cartId(unknownValue)),
      payment.payment.recover(
        unknownValue.session,
        unknownValue.checkout.id,
        unknownValue.attempt.id,
      ),
    ]);
    check(
      concurrent.every((result) => result.status === "fulfilled"),
      "actual reconcile and cleanup both complete without swallowing a rejected operation",
    );
    const unknownState = await payment.state(unknownValue);
    check(
      unknownState.order_status === "PENDING_PAYMENT" &&
        unknownState.cart_status === "LOCKED",
      "reconcile race never cancels or reuses the uncertain checkout",
    );
    cases.push({
      kind: "NONTERMINAL_AND_RECONCILE",
      result: protectedResult,
      concurrent: concurrent.map((result) => ({
        status: result.status,
        ...(result.status === "rejected" ? safeError(result.reason) : {}),
      })),
    });

    progress(
      "access token/session sweeps preserve terminal history and authorization boundaries",
    );
    const access = createOrderAccessUseCases({
      transactions: persistence.orderAccessTransactionManager,
    });
    const paidOrderId = (await payment.state(paid)).order_id;
    const issue = async (ttl) => {
      const link = await context.credentials.issueLink();
      const result = await access.issue({
        schemaVersion: 1,
        orderId: paidOrderId,
        tokenCredential: link.access,
        linkTtlSeconds: ttl,
        ...trace(),
      });
      check(
        result.outcome === "SUCCESS",
        "normal paid order issues one-time access link",
      );
      return link;
    };
    const link = await issue(1);
    await waitForOrderPayment(
      "actual token expiry",
      async () =>
        (
          await scalar(
            "SELECT expires_at<=clock_timestamp() due FROM order_access_tokens WHERE token_digest=decode($1,'hex')",
            [link.access.tokenDigest],
          )
        ).due,
      check,
    );
    const tokenResult = await expire(paidCart);
    check(
      tokenResult.expiredTokens === 1,
      "only expired active link becomes EXPIRED",
    );
    const credential = await context.credentials.issueSession();
    const rejected = await access.exchange({
      schemaVersion: 1,
      tokenCandidates: [link.access],
      sessionCredential: credential.access,
      sessionTtlSeconds: 1,
      ...trace(),
    });
    check(
      rejected.outcome === "FAILURE",
      "expired link cannot produce a session",
    );
    const fresh = await issue(60),
      sessionCredential = await context.credentials.issueSession();
    const exchanged = await access.exchange({
      schemaVersion: 1,
      tokenCandidates: [fresh.access],
      sessionCredential: sessionCredential.access,
      sessionTtlSeconds: 1,
      ...trace(),
    });
    check(
      exchanged.outcome === "SUCCESS",
      "unexpired token exchanges normally",
    );
    await waitForOrderPayment(
      "actual session expiry",
      async () =>
        (
          await scalar(
            "SELECT expires_at<=clock_timestamp() due FROM order_access_sessions WHERE session_token_digest=decode($1,'hex')",
            [sessionCredential.access.tokenDigest],
          )
        ).due,
      check,
    );
    const sessionResult = await expire(paidCart);
    check(
      sessionResult.expiredSessions === 1 && sessionResult.expiredTokens === 0,
      "session expiry keeps exchanged token history intact",
    );
    const history = await scalar(
      "SELECT t.status,(SELECT count(*)::int FROM order_access_sessions s WHERE s.exchanged_token_id=t.id) sessions FROM order_access_tokens t WHERE t.token_digest=decode($1,'hex')",
      [fresh.access.tokenDigest],
    );
    check(
      history.status === "EXCHANGED" && history.sessions === 1,
      "cleanup never deletes token/session audit history",
    );
    cases.push({
      kind: "TOKEN_AND_SESSION_EXPIRY",
      tokenResult,
      sessionResult,
    });

    progress(
      "elapsed active cart and intents expire atomically without deleting encrypted data",
    );
    await waitForOrderPayment(
      "actual sixty-second cart expiry",
      async () =>
        (
          await scalar(
            "SELECT expires_at<=clock_timestamp() due FROM carts WHERE id=$1::uuid",
            [abandonedRow.id],
          )
        ).due,
      check,
      { timeoutMs: 70000 },
    );
    const candidates = await tx.runInCommerceExpiryTransaction((repo) =>
      repo.listDue({ schemaVersion: 1, limit: 100 }),
    );
    check(
      candidates.cartIds.includes(abandonedRow.id),
      "durable due scan includes the abandoned cart",
    );
    const active = await expire(abandonedRow.id);
    check(
      active.expiredCart && active.expiredIntents === 1,
      "cart and its active private intent expire in one transaction",
    );
    same(
      await abandonedHash(),
      privateBefore,
      "semantic expiry does not purge encrypted message material",
    );
    check(
      (await expire(abandonedRow.id)).decision === "NOT_DUE",
      "active-cart expiry replays without new versions or audit",
    );
    cases.push({ kind: "ACTIVE_CART_AND_INTENT", result: active });
    check(
      payment.canaries.every((value) =>
        context.logLines.every((line) => !JSON.stringify(line).includes(value)),
      ),
      "expiry and fixture logs contain no private canaries",
    );
    return {
      schemaVersion: 1,
      cases,
      actualPspSandbox: false,
      actualPostgres: true,
      clockMutations: false,
      scope:
        "Owned TEST PSP and actual PostgreSQL/TLS S3. Promise barriers pause before real COMMIT; no SQL financial fabrication.",
    };
  } finally {
    await short.stop();
  }
}

async function run(database, s3) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p4-06-commerce-expiry",
    `run-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  let assertions = 0,
    stage = "prepare",
    status = "FAIL";
  const save = (name, value) =>
    writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
  const files = [
    ...["repository", "data", "inventory"].flatMap((part) => [
      `packages/persistence-postgres/src/commerce-expiry-${part}.ts`,
      `packages/persistence-postgres/dist/commerce-expiry-${part}.js`,
    ]),
    "packages/persistence-postgres/dist/postgres-persistence.js",
    "packages/persistence-postgres/src/payment-runtime-recovery.ts",
    "packages/persistence-postgres/dist/payment-runtime-recovery.js",
    "packages/contracts/dist/order-notification.js",
    "packages/persistence-port/dist/order-notification.js",
    "apps/api/dist/bootstrap.js",
    "apps/worker/dist/reliable-events-composition.js",
    "apps/worker/dist/reliable-events-runtime.js",
    "apps/api/scripts/payment-runtime-psp-store.mjs",
    "apps/api/scripts/payment-runtime-psp-server.mjs",
    "database/migrations/0029_notifications.up.sql",
    "packages/persistence-postgres/scripts/commerce-expiry-fixture.mjs",
  ];
  const fingerprints = async () =>
    Promise.all(
      files.map(async (name) => ({
        name,
        sha256: createHash("sha256")
          .update(await readFile(path.join(workspaceRoot, name)))
          .digest("hex"),
      })),
    );
  const before = await fingerprints();
  await save("source-before.json", before);
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (value) => {
    stage = value;
    console.log(`Commerce expiry: ${value}`);
  };
  const original = Client.prototype.query;
  const sqlStates = new AsyncLocalStorage();
  Client.prototype.query = function (...args) {
    const result = original.apply(this, args);
    return result?.catch
      ? result.catch((error) => {
          if (/^[A-Z0-9]{5}$/u.test(error?.code ?? ""))
            sqlStates.getStore()?.push(error.code);
          console.error(
            `Expiry PG ${JSON.stringify({ code: error?.code, guard: /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(error?.where ?? "")?.[1] ?? null, constraint: error?.constraint ?? null })}`,
          );
          throw error;
        })
      : result;
  };
  try {
    await withOrderAccessFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (context) => {
        const setupAssertions = assertions;
        const result = await verifyCommerceExpiry({
          context: {
            ...context,
            observeSqlStates(work) {
              const observed = [];
              return {
                sqlStates: observed,
                promise: sqlStates.run(observed, work),
              };
            },
          },
          s3,
        });
        await save("protocol-results.json", {
          status: "PASS",
          setupAssertions,
          assertions: assertions - setupAssertions,
          result,
        });
      },
    });
    status = "PASS";
    console.log(`PASS commerce expiry ${assertions}; ${output}`);
  } catch (error) {
    await save("failure.json", { stage, assertions, ...safeError(error) });
    throw error;
  } finally {
    Client.prototype.query = original;
    const after = await fingerprints();
    await save("source-after.json", after);
    await save("run-result.json", {
      status,
      assertions,
      sourceUnchanged: JSON.stringify(before) === JSON.stringify(after),
      completedAt: new Date().toISOString(),
    });
  }
}
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--run-commerce-expiry") {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) => run(database, s3));
    } else {
      assert.equal(process.argv.length, 2);
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: "--run-commerce-expiry",
          timeoutMs: 1200000,
        }),
      );
    }
  } catch (error) {
    console.error(`FAIL commerce expiry ${JSON.stringify(safeError(error))}`);
    process.exitCode = 1;
  }
}
