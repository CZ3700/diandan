import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  checkoutBusinessCounts,
  checkoutSnapshotFingerprint,
  verifyStoredCheckout,
} from "./checkout-preflight-proofs.mjs";
import { createCartDailyGiftFixture } from "./cart-daily-gift-fixture.mjs";

/** Every post-observation business change uses its normal operator API; immutable publications are never edited in SQL. */
export async function verifyCheckoutCanonicalChanges(context) {
  const {
    client,
    content,
    fixtures,
    api,
    fresh,
    validate,
    create,
    email,
    check,
    historical,
    cases,
    kms,
  } = context;
  const same = (left, right, label) =>
    check(JSON.stringify(left) === JSON.stringify(right), label);
  async function artistStatus(artist, status, acceptingGifts) {
    const current = await content.request("/api/v1/admin/catalog/owners/read", {
      target: artist.owner,
      locale: "en",
    });
    await content.write("/api/v1/admin/catalog/idols/status", {
      idolId: artist.id,
      status,
      acceptingGifts,
      expectedBaseVersion: current.owner.baseVersion,
    });
  }
  async function giftStatus(gift, status) {
    const current = (
      await content.request("/api/v1/admin/gift-commerce/gifts/read", {
        giftId: gift.id,
        locale: "en",
      })
    ).value;
    await content.write("/api/v1/admin/gift-commerce/gifts/status", {
      giftId: gift.id,
      status,
      expectedBaseVersion: current.gift.version,
    });
  }
  async function rejectedChange(name, mutate, restore, expected, giftOptions) {
    const session = await fresh(giftOptions),
      preflight = await validate(session);
    const before = await checkoutBusinessCounts(client);
    await mutate();
    try {
      await api.create(session, preflight, email(), {
        expected: 409,
        code: expected,
      });
    } finally {
      if (restore) await restore();
    }
    same(
      await checkoutBusinessCounts(client),
      before,
      `${name} rejection writes no partial checkout business rows`,
    );
    cases.push({ name, status: "PASS" });
  }
  context.progress(
    "canonical artist, gift and inventory changes invalidate checkout",
  );
  const artist = fixtures.artists[0],
    gift = fixtures.gifts[0];
  await rejectedChange(
    "artist-paused-after-observation",
    () => artistStatus(artist, "paused", false),
    () => artistStatus(artist, "active", true),
    "IDOL_UNAVAILABLE",
  );
  await rejectedChange(
    "gift-paused-after-observation",
    () => giftStatus(gift, "paused"),
    () => giftStatus(gift, "active"),
    "GIFT_UNAVAILABLE",
  );
  const variant = gift.variants[1];
  const stock = (
    await client.query(
      "select location_id,on_hand::int from inventory_balances where inventory_item_id=$1 order by location_id",
      [variant.inventoryItemId],
    )
  ).rows;
  async function adjustStock(restore) {
    for (const location of stock) {
      const current = (
        await content.request("/api/v1/admin/gift-commerce/gifts/read", {
          giftId: gift.id,
          locale: "en",
        })
      ).value;
      const row = (
        await client.query(
          "select on_hand::int,version::int from inventory_balances where inventory_item_id=$1 and location_id=$2",
          [variant.inventoryItemId, location.location_id],
        )
      ).rows[0];
      const deltaOnHand = (restore ? location.on_hand : 0) - row.on_hand;
      if (deltaOnHand !== 0)
        await content.write(
          "/api/v1/admin/gift-commerce/inventory/adjust",
          {
            giftVariantId: variant.id,
            inventoryLocationId: location.location_id,
            expectedVariantVersion: current.variants.find(
              (item) => item.id === variant.id,
            ).version,
            expectedBalanceVersion: row.version,
            deltaOnHand,
          },
          "manager",
        );
    }
  }
  await rejectedChange(
    "stock-removed-after-observation",
    () => adjustStock(false),
    () => adjustStock(true),
    "INSUFFICIENT_STOCK",
    { variant },
  );

  context.progress(
    "normal revised artist and policy publication preserve old order snapshots",
  );
  async function republish(owner, revisionId, field, marker) {
    const source = (
      await content.request("/api/v1/admin/content-authoring/read", {
        target: owner,
        revisionId,
      })
    ).snapshot;
    const translations = source.content.translations.map((row) => ({
      ...row,
      fields: {
        ...row.fields,
        [field]:
          field === "body"
            ? `${row.fields[field]}<p>${marker}</p>`
            : `${row.fields[field]} ${marker}`,
      },
    }));
    const effectiveAt =
      owner.kind === "POLICY"
        ? (
            await client.query(
              "SELECT to_char((clock_timestamp()+interval '2 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
            )
          ).rows[0].at
        : undefined;
    const copied = await content.write("/api/v1/admin/content-authoring/copy", {
      target: owner,
      sourceRevisionId: source.revisionId,
      expectedSourceHash: source.contentHash,
      expectedVersion: source.headVersion,
      changes: {
        kind: owner.kind,
        translations,
        ...(effectiveAt === undefined
          ? {}
          : { structure: { ...source.content.structure, effectiveAt } }),
      },
    });
    await content.approve(owner, copied.resultId);
    if (effectiveAt !== undefined) {
      const deadline = globalThis.performance.now() + 10000;
      while (
        !(
          await client.query(
            "SELECT clock_timestamp()>=$1::timestamptz+interval '1 second' AS ready",
            [effectiveAt],
          )
        ).rows[0].ready
      ) {
        check(
          globalThis.performance.now() < deadline,
          "revised TEST policy becomes effective within the bounded actual-clock window",
        );
        await delay(100);
      }
    }
    await content.publish(owner, copied.resultId);
    return copied.resultId;
  }
  const publicationSession = await fresh(),
    publicationReview = await validate(publicationSession);
  const publicationCounts = await checkoutBusinessCounts(client);
  artist.revisionId = await republish(
    artist.owner,
    artist.revisionId,
    "displayName",
    "TEST",
  );
  await api.create(publicationSession, publicationReview, email(), {
    expected: 409,
    code: "PREFLIGHT_CHANGED",
  });
  same(
    await checkoutBusinessCounts(client),
    publicationCounts,
    "new artist publication cannot silently replace the reviewed order content",
  );
  const policySession = await fresh(),
    policyReview = await validate(policySession);
  const policyCounts = await checkoutBusinessCounts(client);
  const policy = fixtures.policies[0];
  policy.revisionId = await republish(
    policy.owner,
    policy.revisionId,
    "body",
    "TEST CHECKOUT POLICY REVISION",
  );
  await api.create(policySession, policyReview, email(), {
    expected: 409,
    code: "POLICY_CHANGED",
  });
  same(
    await checkoutBusinessCounts(client),
    policyCounts,
    "new policy publication requires a fresh explicit acceptance",
  );
  cases.push({ name: "new-publications-require-review", status: "PASS" });

  context.progress("normal daily publishing and price revision rejection");
  const priceSession = await fresh(),
    priceReview = await validate(priceSession);
  const priceCounts = await checkoutBusinessCounts(client);
  const daily = await createCartDailyGiftFixture({
    ...context,
    presentation: {
      sourceLocale: "zh-CN",
      name: "结算测试花束",
      description: "仅用于本机结算原文快照验证的测试礼物。",
    },
  });
  await api.create(priceSession, priceReview, email(), {
    expected: 409,
    code: "PREFLIGHT_CHANGED",
  });
  await api.validate(priceSession, { expected: 409, code: "PRICE_CHANGED" });
  same(
    await checkoutBusinessCounts(client),
    priceCounts,
    "new canonical price revision cannot be charged through stale consent",
  );
  const dailyGift = {
    id: daily.giftId,
    handle: daily.handle,
    variants: [{ id: daily.giftVariantId }],
  };
  const dailySession = await fresh({ gift: dailyGift });
  const dailyReview = await validate(dailySession, { locale: "en" });
  const dailyCreated = await create(dailySession, dailyReview);
  check(
    dailyCreated.checkout.lines[0].giftLocaleContext.schemaVersion === 2 &&
      dailyCreated.checkout.lines[0].giftLocaleContext.sourceLocale ===
        "zh-CN" &&
      dailyCreated.checkout.lines[0].giftLocaleContext.resolvedLocale ===
        "zh-CN" &&
      dailyCreated.checkout.lines[0].giftLocaleContext.requestedLocale ===
        "en" &&
      dailyCreated.checkout.lines[0].giftLocaleContext.fallbackUsed === true,
    "daily checkout preserves actual Chinese original provenance under an English order",
  );
  await verifyStoredCheckout({ client, kms, check, ...dailyCreated });
  cases.push({ name: "price-change-and-daily-original", status: "PASS" });

  context.progress(
    "normal numeric price change requires a new confirmed quote",
  );
  const amountSession = await fresh();
  const amountReview = await validate(amountSession);
  const scope = fixtures.markets[0];
  const priceHistory = await content.request(
    "/api/v1/admin/gift-commerce/prices/read",
    { ...scope, revision: null, page: 1, pageSize: 50 },
  );
  const currentPrices = await content.request(
    "/api/v1/admin/gift-commerce/prices/read",
    { ...scope, revision: priceHistory.head.revision, page: 1, pageSize: 50 },
  );
  const oldAmount = amountReview.lines[0].unitAmountMinor;
  const newAmount = oldAmount + 137;
  const changedBook = await content.write(
    "/api/v1/admin/gift-commerce/prices/create",
    {
      ...scope,
      expectedBookRevision: currentPrices.authoringVersion,
      expectedHeadVersion: currentPrices.head.version,
      source: {
        priceBookId: currentPrices.book.priceBookId,
        revision: currentPrices.book.revision,
        contentHash: currentPrices.book.contentHash,
      },
      validFrom: currentPrices.book.validFrom,
      validUntil: currentPrices.book.validUntil,
      changes: [
        { giftVariantId: gift.variants[0].id, unitAmountMinor: newAmount },
      ],
    },
    "manager",
  );
  await content.write(
    "/api/v1/admin/gift-commerce/prices/publish",
    {
      ...scope,
      priceBookId: changedBook.priceBookId,
      revision: changedBook.revision,
      expectedHeadVersion: currentPrices.head.version,
      expectedContentHash: changedBook.contentHash,
    },
    "manager",
  );
  const amountCounts = await checkoutBusinessCounts(client);
  await api.create(amountSession, amountReview, email(), {
    expected: 409,
    code: "PREFLIGHT_CHANGED",
  });
  await api.validate(amountSession, { expected: 409, code: "PRICE_CHANGED" });
  same(
    await checkoutBusinessCounts(client),
    amountCounts,
    "numeric price change cannot charge a new amount from the old reviewed consent",
  );
  const repricedSession = await fresh();
  const repricedReview = await validate(repricedSession);
  const repricedCheckout = await create(repricedSession, repricedReview);
  check(
    oldAmount !== newAmount &&
      repricedReview.lines[0].unitAmountMinor === newAmount &&
      repricedReview.amount.totalAmountMinor === newAmount &&
      repricedCheckout.checkout.lines[0].unitAmountMinor === newAmount &&
      repricedCheckout.checkout.amount.totalAmountMinor === newAmount,
    "fresh cart and explicitly confirmed server quote use the actual new numeric price",
  );
  await verifyStoredCheckout({ client, kms, check, ...repricedCheckout });
  const originalItemId = amountSession.cart.items[0].id;
  await api.request(
    "READ_CHANGED_CART_PRICE",
    "/api/v1/cart?presentationLocale=en",
    {
      target: context.base,
      method: "GET",
      session: amountSession,
      cart: true,
    },
  );
  const changedItem = amountSession.cart.items[0];
  check(
    changedItem.id === originalItemId &&
      changedItem.price.status === "CHANGED" &&
      changedItem.price.current?.unitAmountMinor === newAmount,
    "original cart exposes the actual changed price without accepting it silently",
  );
  await api.request(
    "CONFIRM_CHANGED_CART_PRICE",
    `/api/v1/cart/items/${originalItemId}`,
    {
      target: context.base,
      method: "PATCH",
      session: amountSession,
      cart: true,
      key: randomUUID(),
      body: {
        schemaVersion: 1,
        presentationLocale: "en",
        expectedCartVersion: amountSession.cart.version,
        expectedItemVersion: changedItem.version,
        change: {
          kind: "QUANTITY",
          quantity: changedItem.quantity,
          observedPriceId: changedItem.price.current.priceId,
        },
      },
    },
  );
  check(
    amountSession.cart.items.length === 1 &&
      amountSession.cart.items[0].id === originalItemId &&
      amountSession.cart.items[0].price.status === "CURRENT",
    "explicit new-price acceptance keeps the original cart item without duplicating or silently replacing it",
  );
  const confirmedReview = await validate(amountSession);
  const confirmedCheckout = await create(amountSession, confirmedReview);
  check(
    confirmedReview.lines[0].unitAmountMinor === newAmount &&
      confirmedCheckout.checkout.lines[0].cartItemId === originalItemId &&
      confirmedCheckout.checkout.amount.totalAmountMinor === newAmount,
    "the original cart can confirm a fresh server quote and checkout at the explicitly accepted new amount",
  );
  await verifyStoredCheckout({ client, kms, check, ...confirmedCheckout });
  cases.push({
    name: "numeric-price-change",
    status: "PASS",
    oldAmount,
    newAmount,
  });

  for (const record of historical) {
    same(
      (await api.read(record.session, record.checkout.id)).data.checkout,
      record.checkout,
      "historical checkout response remains unchanged after actual artist, policy and price republication",
    );
    check(
      (await checkoutSnapshotFingerprint(client, record.checkout.id)) ===
        record.fingerprint,
      "stored order, each object snapshot and policy acceptance remain byte-stable",
    );
  }
  cases.push({
    name: "all-seven-historical-snapshots-immutable",
    status: "PASS",
    count: historical.length,
  });

  // A stable key is scoped to its authenticated cart, not a global ordering identity.
  const sharedKey = randomUUID();
  const isolated = await Promise.all([fresh(), fresh()]);
  const isolatedReviews = await Promise.all(
    isolated.map((session) => validate(session)),
  );
  const isolatedCreated = await Promise.all(
    isolated.map((session, index) =>
      create(session, isolatedReviews[index], email(), { key: sharedKey }),
    ),
  );
  check(
    isolatedCreated[0].checkout.id !== isolatedCreated[1].checkout.id,
    "independent cookies may use the same idempotency key without sharing an order",
  );
  cases.push({ name: "independent-cookie-idempotency-scope", status: "PASS" });
}
