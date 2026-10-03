#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  wishGalleryReadResponseSchema,
  wishGalleryWithdrawResponseSchema,
  cartEditorResponseSchema,
  storefrontGiftResponseSchema,
} from "@fan-support/contracts";
import { withEphemeralPostgres, runMigrations } from "../dist/index.js";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../media-s3/scripts/ephemeral-s3-harness.mjs";
import { verifyWishBindingGuards } from "./wish-binding-postgres-cases.mjs";
import { withOrderAccessFixture } from "../../../apps/api/scripts/order-access-runtime.mjs";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "../../../apps/api/scripts/order-payment-client.mjs";
import { createOrderAccessProtocolClient } from "../../../apps/api/scripts/order-access-client.mjs";
import { createAdminFinanceFixture } from "../../../apps/api/scripts/admin-finance-fixture.mjs";
import { publishWishFixture } from "../../../apps/api/scripts/wish-publication-fixture.mjs";
import { observeFinancePostgres } from "../../../apps/api/scripts/admin-finance-diagnostics.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const output = path.join(
  workspaceRoot,
  "output/wish-gallery-2026-10-01",
  `http-registered-0061-${new Date().toISOString().replaceAll(":", "-")}`,
);
let assertions = 0,
  stage = "setup";
const check = (condition, label) => {
  assertions++;
  assert.ok(condition, label);
};
const progress = (label) => {
  stage = label;
  console.log(`Wish gallery: ${label}`);
};
const safeError = (error) => ({
  name: error?.name,
  code: error?.code,
  guard:
    /PL\/pgSQL function ([a-z_][a-z_0-9]+)\(/u.exec(error?.where ?? "")?.[1] ??
    null,
  constraint: error?.constraint ?? null,
  message: error instanceof assert.AssertionError ? error.message : undefined,
});

async function verify(context, s3) {
  const { client } = context,
    payment = createOrderPaymentProtocolClient(context),
    access = createOrderAccessProtocolClient({
      ...context,
      canaries: payment.canaries,
    });
  const gallery = async (extra = "") => {
    const response = await globalThis.fetch(
      `${context.accessBase}/api/v1/storefront/wish-gallery?locale=en${extra}`,
    );
    const text = await response.text(),
      data = wishGalleryReadResponseSchema.parse(JSON.parse(text));
    check(
      response.status === 200 && data.outcome === "SUCCESS",
      "public gallery HTTP succeeds",
    );
    check(
      response.headers.get("cache-control")?.includes("no-store"),
      "gallery is never cached",
    );
    check(
      payment.canaries.every((value) => !text.includes(value)),
      "gallery never reveals private message, name, or email",
    );
    check(
      !/publicOrderId|orderId|supportIntentId|amountMinor|tokenDigest/u.test(
        text,
      ),
      "gallery DTO contains no order, finance or credential references",
    );
    return data.page;
  };
  async function updatePreference(session, itemId, preference) {
    const item = session.cart.items.find((value) => value.id === itemId);
    await payment.checkout.request(
      "WISH_PUBLICITY",
      `/api/v1/cart/items/${item.id}`,
      {
        target: context.base,
        method: "PATCH",
        cart: true,
        session,
        key: randomUUID(),
        body: {
          schemaVersion: 1,
          expectedCartVersion: session.cart.version,
          expectedItemVersion: item.version,
          presentationLocale: "en",
          change: {
            kind: "PERSONALIZATION",
            displayMode: "nickname",
            displayName: payment.canaries[1],
            fanMessage: payment.canaries[0],
            fanMessageLocale: "ja",
            galleryPreference: preference,
          },
        },
      },
    );
  }
  async function readEditor(session, itemId) {
    const item = session.cart.items.find((value) => value.id === itemId);
    const response = await globalThis.fetch(
      `${context.base}/api/v1/cart/items/${itemId}/editor`,
      {
        method: "POST",
        headers: {
          origin: context.origin,
          "content-type": "application/json",
          cookie: session.cookie,
          "x-csrf-token": session.csrf,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedCartVersion: session.cart.version,
          expectedItemVersion: item.version,
          presentationLocale: "en",
        }),
      },
    );
    const data = cartEditorResponseSchema.parse(await response.json());
    check(
      response.status === 200 && data.outcome === "SUCCESS",
      "authorized editor reads frozen current consent",
    );
    check(
      response.headers.get("cache-control")?.includes("no-store"),
      "private editor is not cached",
    );
    if (response.headers.get("x-csrf-token"))
      session.csrf = response.headers.get("x-csrf-token");
    return data.content;
  }
  async function add(session, gift, preference) {
    const { cartItemId } = await payment.checkout.add(session, { gift });
    await updatePreference(session, cartItemId, preference);
    if (preference?.visibility === "PUBLIC_NAMED") {
      const original = await readEditor(session, cartItemId);
      check(
        original.galleryPreference?.publicAlias === preference.publicAlias &&
          original.displayName === payment.canaries[1] &&
          original.displayName !== original.galleryPreference.publicAlias,
        "editor retains separate public alias and encrypted private name",
      );
      await updatePreference(session, cartItemId, { visibility: "PRIVATE" });
      const hidden = await readEditor(session, cartItemId);
      check(
        hidden.galleryPreference?.visibility === "PRIVATE" &&
          !Object.hasOwn(hidden.galleryPreference, "publicAlias"),
        "editor switching to PRIVATE removes public alias",
      );
      check(
        session.cart.items.find((value) => value.id === cartItemId)
          .galleryPreference?.visibility === "PRIVATE",
        "safe cart reflects explicit PRIVATE update",
      );
      await updatePreference(session, cartItemId, preference);
    }
  }
  async function attempt(session, checkout) {
    const capability = (
      await payment.payment.capabilities(session, checkout.id)
    ).data.capabilities.capabilities[0];
    const created = (
      await payment.payment.create(session, checkout.id, capability)
    ).data.attempt;
    return { session, checkout, attempt: created };
  }
  async function paid(value) {
    await payment.settle(value);
    const signed = await context.signWebhook(value.attempt.id);
    check(
      (await context.sendWebhook(signed)).accepted,
      "actual signed capture enters webhook ingress",
    );
    const event = (
      await client.query(
        "SELECT id FROM provider_events WHERE provider_account_id=$1 AND environment='TEST' AND provider_event_id=$2",
        [
          context.endpoint.providerAccountId,
          JSON.parse(signed.rawBody).event_id,
        ],
      )
    ).rows[0];
    const applied = await payment.apply(event.id);
    check(
      ["APPLIED", "ALREADY_APPLIED"].includes(applied.decision) &&
        applied.outcome === "PAID",
      "trusted capture applied through production application",
    );
    const state = await payment.assertPaid(value, 1);
    check(
      (await payment.apply(event.id)).decision === "ALREADY_APPLIED",
      "duplicate provider evidence replays",
    );
    check(
      (await context.sendWebhook(signed)).accepted,
      "duplicate signed webhook is idempotent",
    );
    const record = (
      await client.query(
        "SELECT e.entry_id,s.wish_id FROM wish_gallery_entries e JOIN wish_supports s ON s.order_item_id=e.order_item_id JOIN order_items i ON i.id=e.order_item_id WHERE i.order_id=$1",
        [state.order_id],
      )
    ).rows;
    check(
      record.length === 1,
      "exactly one unique support and gallery history record",
    );
    const grant = await access.bootstrap(value),
      privateRead = await access.read(
        grant.session,
        grant.data.grant.publicOrderId,
      );
    check(
      privateRead.data.order.items[0].wishSupport?.entryId ===
        record[0].entry_id,
      "private order exposes the support receipt immediately while fulfillment remains pending",
    );
    check(
      privateRead.data.order.items[0].fulfillmentStatus === "PENDING",
      "support never claims physical delivery",
    );
    return {
      ...value,
      orderId: state.order_id,
      entryId: record[0].entry_id,
      publicOrderId: grant.data.grant.publicOrderId,
      accessSession: grant.session,
    };
  }
  async function freshWish(name, preference, { keepBuyer = false } = {}) {
    const gift = await publishWishFixture(context, { s3, workspaceRoot, name });
    const session = await payment.checkout.initialize();
    await add(session, gift, preference);
    let competingBuyer;
    if (keepBuyer) {
      const waiting = await payment.checkout.initialize();
      await payment.checkout.add(waiting, { gift });
      competingBuyer = {
        session: waiting,
        preflight: (await payment.checkout.validate(waiting)).data.preflight,
      };
    }
    const preflight = (await payment.checkout.validate(session)).data.preflight;
    const checkout = (
      await payment.checkout.create(session, preflight, payment.canaries[2])
    ).data.checkout;
    return {
      gift,
      competingBuyer,
      ...(await paid(await attempt(session, checkout))),
    };
  }
  async function wishPurchaseSnapshot(gift) {
    return (
      await client.query(
        `WITH stock AS (SELECT id FROM inventory_items WHERE gift_variant_id=$2),
          supports AS (SELECT * FROM wish_supports WHERE wish_id=$1),
          balances AS (SELECT b.* FROM inventory_balances b JOIN stock s ON s.id=b.inventory_item_id),
          reservations AS (SELECT * FROM inventory_reservations WHERE gift_variant_id=$2),
          ledger AS (SELECT l.* FROM inventory_ledger l JOIN stock s ON s.id=l.inventory_item_id)
         SELECT
          (SELECT count(*)::int FROM supports) supports,
          (SELECT count(*)::int FROM balances) balances,
          (SELECT coalesce(sum(on_hand),0)::int FROM balances) on_hand,
          (SELECT coalesce(sum(reserved),0)::int FROM balances) reserved,
          (SELECT count(*)::int FROM reservations WHERE status='COMMITTED') committed,
          (SELECT count(*)::int FROM ledger) ledger_entries,
          (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.wish_id)::text,'[]')) FROM supports s) support_hash,
          (SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.inventory_item_id,b.location_id)::text,'[]')) FROM balances b) balance_hash,
          (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text,'[]')) FROM reservations r) reservation_hash,
          (SELECT md5(coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id)::text,'[]')) FROM ledger l) ledger_hash,
          (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.order_item_id)::text,'[]')) FROM wish_purchase_links p WHERE p.wish_id=$1) purchase_hash,
          (SELECT md5(coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id)::text,'[]')) FROM order_items i WHERE i.gift_variant_id=$2) order_item_hash`,
        [gift.wish_id, gift.gift_variant_id],
      )
    ).rows[0];
  }
  async function verifyConsumedWish(value, buyer, baseline, reason) {
    progress(`${reason} wish stays supported and cannot be purchased again`);
    check(
      baseline.supports === 1 &&
        baseline.balances === 1 &&
        baseline.on_hand === 0 &&
        baseline.reserved === 0 &&
        baseline.committed === 1 &&
        baseline.ledger_entries > 0,
      `${reason} baseline contains actual consumed stock and support history`,
    );
    check(
      JSON.stringify(await wishPurchaseSnapshot(value.gift)) ===
        JSON.stringify(baseline),
      `${reason} keeps support, inventory, ledger and original order lines unchanged`,
    );
    const query = new globalThis.URLSearchParams({
      locale: "en",
      ...context.fixtures.markets[0],
      idol: value.gift.idol_id,
    });
    const response = await globalThis.fetch(
      `${context.base}/api/v1/storefront-gifts/${value.gift.handle}?${query}`,
      { signal: globalThis.AbortSignal.timeout(30_000) },
    );
    const detail = storefrontGiftResponseSchema.parse(await response.json());
    check(
      response.status === 200 &&
        detail.outcome === "SUCCESS" &&
        detail.content.view.wish?.status === "SUPPORTED" &&
        detail.offers.length === 1 &&
        detail.offers[0].availability === "UNAVAILABLE",
      `${reason} public gift still shows SUPPORTED and no purchasable offer`,
    );
    const fresh = await payment.checkout.initialize();
    await payment.checkout.request(`${reason}_ADD`, "/api/v1/cart/items", {
      target: context.base,
      cart: true,
      session: fresh,
      key: randomUUID(),
      expected: 409,
      code: "RECIPIENT_INELIGIBLE",
      body: {
        schemaVersion: 1,
        presentationLocale: fresh.cart.presentationLocale,
        market: fresh.cart.market,
        currency: fresh.cart.currency,
        idolId: value.gift.idol_id,
        giftId: value.gift.id,
        giftVariantId: value.gift.gift_variant_id,
        observedPriceId: buyer.session.cart.items[0].price.observedPriceId,
        quantity: 1,
        displayMode: "anonymous",
        fanMessageLocale: "en",
      },
    });
    const reread = await payment.checkout.request(
      `${reason}_EMPTY_CART`,
      "/api/v1/cart?presentationLocale=en",
      { target: context.base, method: "GET", session: fresh, cart: true },
    );
    check(
      reread.data.cart.items.length === 0,
      `${reason} rejected add leaves the new buyer's cart empty`,
    );
    await payment.checkout.validate(buyer.session, {
      expected: 409,
      code: "RECIPIENT_INELIGIBLE",
    });
    await payment.checkout.create(
      buyer.session,
      buyer.preflight,
      payment.canaries[2],
      { expected: 409, code: "RECIPIENT_INELIGIBLE" },
    );
    check(
      JSON.stringify(await wishPurchaseSnapshot(value.gift)) ===
        JSON.stringify(baseline),
      `${reason} rejected cart and checkout attempts create no support, reservation, ledger or order line`,
    );
  }
  progress("normal management publication and concurrent checkout");
  const gift = await publishWishFixture(context, {
    s3,
    workspaceRoot,
    name: "One wish beneath the stars",
  });
  const guards = await verifyWishBindingGuards({
    client,
    wish: gift,
    otherArtistId: context.fixtures.artists[1].id,
  });
  assertions += guards.checks;
  let boundOffer;
  for (const idol of [undefined, context.fixtures.artists[1].id]) {
    const query = new globalThis.URLSearchParams({
      locale: "en",
      ...context.fixtures.markets[0],
      ...(idol ? { idol } : {}),
    });
    const response = await globalThis.fetch(
      `${context.base}/api/v1/storefront-gifts/${gift.handle}?${query}`,
    );
    const data = storefrontGiftResponseSchema.parse(await response.json());
    console.log(
      `Wish bound read ${JSON.stringify({ requestedArtist: idol === undefined ? "NONE" : "OTHER", status: response.status, outcome: data.outcome, code: data.outcome === "FAILURE" ? data.code : null, recipient: data.recipient?.kind, hasWish: Boolean(data.content?.view?.wish), matches: data.recipient?.idol?.id === gift.idol_id })}`,
    );
    check(
      response.status === 200 &&
        data.outcome === "SUCCESS" &&
        data.recipient.kind === "PUBLISHED" &&
        data.recipient.idol.id === gift.idol_id,
      "wish recipient stays bound with missing or different artist query",
    );
    boundOffer = data.offers[0];
  }
  const sessions = await Promise.all([
    payment.checkout.initialize(),
    payment.checkout.initialize(),
  ]);
  await payment.checkout.request("WRONG_WISH_ARTIST", "/api/v1/cart/items", {
    target: context.base,
    cart: true,
    session: sessions[0],
    key: randomUUID(),
    expected: 409,
    code: "IDOL_UNAVAILABLE",
    body: {
      schemaVersion: 1,
      presentationLocale: "en",
      ...context.fixtures.markets[0],
      idolId: context.fixtures.artists[1].id,
      giftId: gift.id,
      giftVariantId: gift.gift_variant_id,
      observedPriceId: boundOffer.price.priceId,
      quantity: 1,
      displayMode: "nickname",
      displayName: payment.canaries[1],
      fanMessage: payment.canaries[0],
      fanMessageLocale: "ja",
    },
  });
  for (const session of sessions)
    await add(session, gift, {
      visibility: "PUBLIC_NAMED",
      publicAlias: "Moon friend",
    });
  const quotes = await Promise.all(
    sessions.map((session) => payment.checkout.validate(session)),
  );
  const attempts = await Promise.all(
    sessions.map((session, index) =>
      payment.checkout.create(
        session,
        quotes[index].data.preflight,
        payment.canaries[2],
        { expected: [200, 409] },
      ),
    ),
  );
  const winners = attempts.flatMap((result, index) =>
    result.data.outcome === "SUCCESS" ? [index] : [],
  );
  check(
    winners.length === 1,
    "two concurrent checkouts reserve the single wish only once",
  );
  const winner = winners[0],
    named = {
      gift,
      ...(await paid(
        await attempt(sessions[winner], attempts[winner].data.checkout),
      )),
    };
  check(
    (await gallery()).entries.length === 1,
    "paid named opt-in becomes publicly visible immediately",
  );
  check(
    (await gallery()).entries[0].supporter.alias === "Moon friend",
    "only the separate public alias is displayed",
  );
  check(
    (await gallery(`&idol=${context.fixtures.artists[1].id}`)).entries
      .length === 0,
    "artist filter excludes other artists",
  );
  const anonymous = await freshWish("A quiet shared wish", {
    visibility: "PUBLIC_ANONYMOUS",
  });
  const privateWish = await freshWish("A private little wish");
  const first = await gallery("&limit=1"),
    second = await gallery(
      `&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
    );
  check(
    first.entries.length === 1 &&
      second.entries.length === 1 &&
      first.entries[0].entryId !== second.entries[0].entryId &&
      second.nextCursor === null,
    "bounded stable pagination returns distinct public entries",
  );
  check(
    !(await gallery()).entries.some(
      (entry) => entry.entryId === privateWish.entryId,
    ),
    "private default still consumes a wish but does not enter public gallery",
  );
  const withdraw = async (
    value,
    entryId,
    {
      session = value.accessSession,
      status = 200,
      origin = context.origin,
      csrf = session.csrf,
    } = {},
  ) => {
    const response = await globalThis.fetch(
      `${context.accessBase}/api/v1/orders/${value.publicOrderId}/wish-gallery/${entryId}/withdraw`,
      {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: session.cookie,
          ...(csrf === undefined ? {} : { "x-csrf-token": csrf }),
        },
        body: JSON.stringify({ schemaVersion: 1 }),
      },
    );
    const data = wishGalleryWithdrawResponseSchema.parse(await response.json());
    console.log(
      `Wish withdrawal HTTP ${JSON.stringify({ status: response.status, expected: status, code: data.outcome === "FAILURE" ? data.code : null })}`,
    );
    check(
      response.status === status,
      "wish withdrawal returns expected protected HTTP result",
    );
    return data;
  };
  check(
    (await withdraw(privateWish, anonymous.entryId, { status: 401 }))
      .outcome === "FAILURE",
    "another valid order session cannot withdraw someone else's support",
  );
  check(
    (
      await withdraw(anonymous, anonymous.entryId, {
        status: 403,
        origin: "https://other.example.invalid",
      })
    ).outcome === "FAILURE",
    "cross-origin withdrawal is rejected",
  );
  check(
    (
      await withdraw(anonymous, anonymous.entryId, {
        status: 403,
        csrf: "invalid",
      })
    ).outcome === "FAILURE",
    "invalid CSRF cannot withdraw a valid owned entry",
  );
  const withdrawals = await Promise.all([
    withdraw(anonymous, anonymous.entryId),
    withdraw(anonymous, anonymous.entryId),
  ]);
  check(
    withdrawals.every((result) => result.outcome === "SUCCESS"),
    "concurrent duplicate withdrawal is idempotent",
  );
  check(
    !(await gallery()).entries.some(
      (entry) => entry.entryId === anonymous.entryId,
    ),
    "withdrawal disappears immediately from uncached public query",
  );
  check(
    (
      await client.query(
        "SELECT count(*)::int count FROM wish_gallery_withdrawals WHERE entry_id=$1",
        [anonymous.entryId],
      )
    ).rows[0].count === 1,
    "withdrawal retains one immutable history fact",
  );
  check(
    (await client.query("SELECT count(*)::int count FROM wish_supports"))
      .rows[0].count === 3,
    "withdrawal and private consent do not reopen supported wishes",
  );
  progress("real financial HTTP refund and signed dispute eligibility");
  const finance = await createAdminFinanceFixture(context, payment),
    manager = await finance.login("manager"),
    worker = await context.createOrderWorker();
  async function refund(value, amount) {
    const detail = await finance.detail(manager, value.orderId),
      line = detail.items[0];
    const result = await finance.mutation(manager, "refund", {
      orderId: value.orderId,
      expectedOrderVersion: detail.order.version,
      amountMinor: amount,
      currency: detail.order.currency,
      allocations: [{ orderItemId: line.orderItemId, amountMinor: amount }],
    });
    await context.psp.settleRefund({
      refundId: result.refundId,
      status: "SUCCEEDED",
    });
    check(
      (
        await context.sendWebhook(
          await context.signRefundWebhook(result.refundId),
        )
      ).accepted,
      "signed real TEST refund reaches inbox",
    );
    await waitForOrderPayment(
      "refund applied",
      async () => {
        await worker.maintenance();
        return (
          (
            await client.query("SELECT status FROM refunds WHERE id=$1", [
              result.refundId,
            ])
          ).rows[0]?.status === "SUCCEEDED"
        );
      },
      check,
    );
  }
  const namedConsumption = await wishPurchaseSnapshot(named.gift);
  await refund(named, 600);
  check(
    (await gallery()).entries.some((entry) => entry.entryId === named.entryId),
    "partial succeeded refund retains support badge",
  );
  await refund(named, 600);
  check(
    !(await gallery()).entries.some((entry) => entry.entryId === named.entryId),
    "cumulative full line refund hides public support without deleting history",
  );
  await verifyConsumedWish(
    named,
    {
      session: sessions[1 - winner],
      preflight: quotes[1 - winner].data.preflight,
    },
    namedConsumption,
    "FULL_REFUND",
  );
  const disputed = await freshWish(
      "A wish in morning light",
      { visibility: "PUBLIC_ANONYMOUS" },
      { keepBuyer: true },
    ),
    disputedConsumption = await wishPurchaseSnapshot(disputed.gift),
    disputeId = randomUUID();
  for (const status of ["OPEN", "LOST"]) {
    await context.psp.settleDispute({
      attemptId: disputed.attempt.id,
      disputeId,
      status,
      amountMinor: 1200,
    });
    check(
      (await context.sendWebhook(await context.signDisputeWebhook(disputeId)))
        .accepted,
      "signed actual dispute evidence accepted",
    );
    await waitForOrderPayment(
      `dispute ${status} applied`,
      async () => {
        await worker.maintenance();
        return (
          (
            await client.query(
              "SELECT dispute_status FROM orders WHERE id=$1",
              [disputed.orderId],
            )
          ).rows[0].dispute_status === status
        );
      },
      check,
    );
    check(
      (await gallery()).entries.some(
        (entry) => entry.entryId === disputed.entryId,
      ) ===
        (status === "OPEN"),
      `${status} dispute controls current public eligibility`,
    );
  }
  check(
    (await client.query("SELECT count(*)::int count FROM wish_supports"))
      .rows[0].count === 4,
    "refund and lost dispute preserve every consumed wish",
  );
  await verifyConsumedWish(
    disputed,
    disputed.competingBuyer,
    disputedConsumption,
    "LOST_DISPUTE",
  );
  progress(
    "actual reservation expiry and late capture after a second buyer succeeds",
  );
  const expiringGift = await publishWishFixture(context, {
    s3,
    workspaceRoot,
    name: "A wish that finds its supporter",
  });
  const short = await context.createCheckoutApi(8000);
  try {
    const session = await payment.checkout.initialize();
    await add(session, expiringGift, { visibility: "PUBLIC_ANONYMOUS" });
    const preflight = (
      await payment.checkout.validate(session, { target: short.base })
    ).data.preflight;
    const checkout = (
      await payment.checkout.create(session, preflight, payment.canaries[2], {
        target: short.base,
      })
    ).data.checkout;
    await context.psp.arm({ operation: "CREATE_PAYMENT", mode: "AFTER" });
    const late = await attempt(session, checkout);
    check(
      late.attempt.status === "UNKNOWN",
      "real lost PSP response leaves an uncertain payment",
    );
    const action = await context.psp.hostedAction(late.attempt.id);
    check(
      action?.type === "REDIRECT",
      "actual provider retains the original hosted action",
    );
    const { expireOrderPaymentReservations } =
      await import("./order-payment-expiry-fixture.mjs");
    await expireOrderPaymentReservations({
      clientConfig: context.database,
      orderId: (await payment.state(late)).order_id,
      timeoutMs: 20000,
    });
    const replacementSession = await payment.checkout.initialize();
    await add(replacementSession, expiringGift, {
      visibility: "PUBLIC_ANONYMOUS",
    });
    const replacementQuote = (
      await payment.checkout.validate(replacementSession)
    ).data.preflight;
    const replacementCheckout = (
      await payment.checkout.create(
        replacementSession,
        replacementQuote,
        payment.canaries[2],
      )
    ).data.checkout;
    const replacement = await paid(
      await attempt(replacementSession, replacementCheckout),
    );
    late.attempt = { ...late.attempt, action };
    await payment.settle(late);
    const signed = await context.signWebhook(late.attempt.id);
    check(
      (await context.sendWebhook(signed)).accepted,
      "late actual capture reaches signed ingress",
    );
    const event = (
      await client.query(
        "SELECT id FROM provider_events WHERE provider_account_id=$1 AND environment='TEST' AND provider_event_id=$2",
        [
          context.endpoint.providerAccountId,
          JSON.parse(signed.rawBody).event_id,
        ],
      )
    ).rows[0];
    const unmatched = await payment.apply(event.id);
    check(
      unmatched.decision === "UNMATCHED",
      "lost create response cannot match a webhook until authenticated recovery binds the provider reference",
    );
    const recoveredEventId = await payment.reconcile(late);
    const applied = await payment.apply(recoveredEventId),
      state = await payment.state(late);
    console.log(
      `Late wish capture ${JSON.stringify({ decision: applied.decision, outcome: applied.outcome, payment: state.payment_status, fulfillment: state.fulfillment_status, committed: state.committed })}`,
    );
    check(
      ["APPLIED", "ALREADY_APPLIED"].includes(applied.decision) &&
        applied.outcome === "PAID_REVIEW" &&
        state.fulfillment_status === "ON_HOLD" &&
        state.committed === 0,
      "late capture keeps funds in review without recommitting stock",
    );
    check(
      (await payment.apply(recoveredEventId)).decision === "ALREADY_APPLIED",
      "late capture replay is idempotent",
    );
    const rows = (
      await client.query(
        "SELECT s.order_item_id,e.entry_id FROM wish_supports s JOIN wish_gallery_entries e ON e.order_item_id=s.order_item_id WHERE s.wish_id=$1",
        [expiringGift.wish_id],
      )
    ).rows;
    check(
      rows.length === 1 && rows[0].entry_id === replacement.entryId,
      "late paid order cannot replace the committed winner or gain a second gallery record",
    );
  } finally {
    await short.stop();
  }
  progress(
    "registered migration refuses to discard existing consent and support history",
  );
  // Later, still empty migrations come off first, so what refuses below is 0061's own down.
  const later = await client.query(
    "SELECT version FROM schema_migrations WHERE version>'0061' ORDER BY version DESC",
  );
  for (const { version } of later.rows)
    await runMigrations({
      clientConfig: context.database,
      workspaceRoot,
      command: { direction: "down", confirmVersion: version },
    });
  const headBefore = (
    await client.query("SELECT max(version) head FROM schema_migrations")
  ).rows[0].head;
  check(
    headBefore === "0061",
    "history rollback probe executes the registered gallery head",
  );
  await assert.rejects(
    runMigrations({
      clientConfig: context.database,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0061" },
    }),
    { name: "MigrationExecutionError", message: "migration 0061 down failed" },
  );
  check(
    (await client.query("SELECT max(version) head FROM schema_migrations"))
      .rows[0].head === headBefore,
    "refused registered rollback retains migration history",
  );
  check(
    (await client.query("SELECT count(*)::int count FROM wish_supports"))
      .rows[0].count === 5,
    "refused rollback retains all five completed wishes",
  );
  return {
    scope:
      "Normal management HTTP publication, cart/checkout, TEST hosted payment, signed webhook, production payment application, order access, gallery and financial HTTP; no business state seeded",
    publicEntries: (await gallery()).entries.length,
    supports: 5,
  };
}

async function run(database, s3) {
  await mkdir(output, { recursive: true });
  const restoreDiagnostics = observeFinancePostgres();
  try {
    const migrated = await runMigrations({
      clientConfig: database,
      workspaceRoot,
      command: { direction: "up" },
    });
    check(
      Number(migrated.currentVersion) >= 61,
      "the full registered migration chain includes 0061 wish gallery",
    );
    let result;
    await withOrderAccessFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (context) => {
        result = await verify(context, s3);
      },
    });
    await writeFile(
      path.join(output, "result.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          status: "PASS",
          assertions,
          stage,
          result,
          registeredMigrationHead: migrated.currentVersion,
        },
        null,
        2,
      ),
    );
    console.log(`PASS wish gallery HTTP ${assertions}; ${output}`);
  } catch (error) {
    await writeFile(
      path.join(output, "result.json"),
      JSON.stringify(
        { status: "FAIL", assertions, stage, error: safeError(error) },
        null,
        2,
      ),
    );
    console.error(JSON.stringify(safeError(error)));
    throw error;
  } finally {
    restoreDiagnostics();
  }
}
try {
  if (process.argv[2] === "--run-wish-gallery") {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) => run(database, s3));
  } else
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: "--run-wish-gallery",
        timeoutMs: 1200000,
      }),
    );
} catch (error) {
  console.error(`FAIL wish gallery ${JSON.stringify(safeError(error))}`);
  process.exitCode = 1;
}
