import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createCheckoutProtocolClient } from "./checkout-preflight-client.mjs";
import { createCheckoutResponseLossGateway } from "./checkout-preflight-gateway.mjs";
import {
  checkoutBusinessCounts,
  checkoutSnapshotFingerprint,
  verifyStoredCheckout,
} from "./checkout-preflight-proofs.mjs";

export async function verifyCheckoutPreflightProtocol(context) {
  const { fixtures, client, kms, check, logLines, origin, checkoutBase } =
    context;
  const canaries = [
    `TEST_${randomUUID()}_私密`,
    `TEST_${randomUUID().slice(0, 8)}`,
  ];
  const email = () => {
    const value = `${randomUUID()}@example.test`;
    canaries.push(value);
    return value;
  };
  const api = createCheckoutProtocolClient({ ...context, canaries });
  const cases = [],
    historical = [];
  const same = (left, right, label) =>
    check(JSON.stringify(left) === JSON.stringify(right), label);
  const fresh = async (options) => {
    const session = await api.initialize();
    await api.add(session, options);
    return session;
  };
  const validate = async (session, options) =>
    (await api.validate(session, options)).data.preflight;
  const create = async (session, preflight, address = email(), options) => {
    const value = (await api.create(session, preflight, address, options)).data;
    check(
      value.outcome === "SUCCESS",
      "checkout create completes through the actual application",
    );
    return { checkout: value.checkout, email: address, action: value.action };
  };

  context.progress("checkout authorization and untrusted input");
  const unauthorized = await fresh();
  for (const path of ["/api/v1/cart/validate", "/api/v1/checkout/sessions"]) {
    const body = path.endsWith("validate")
      ? {
          schemaVersion: 1,
          expectedCartVersion: unauthorized.cart.version,
          presentationLocale: "en",
        }
      : {
          schemaVersion: 1,
          preflightId: randomUUID(),
          expectedCartVersion: unauthorized.cart.version,
          email: email(),
          policyAcceptances: [
            {
              policyKey: "terms",
              policyRevisionId: fixtures.policies[0].revisionId,
              policyTranslationRevisionId: randomUUID(),
              accepted: true,
            },
          ],
        };
    await api.request("NO_COOKIE", path, {
      body,
      key: randomUUID(),
      expected: 401,
      code: "INVALID_ACCESS",
    });
    for (const headers of [
      { origin: "https://other.example.invalid" },
      { "x-csrf-token": "invalid" },
      { "sec-fetch-site": "cross-site" },
    ])
      await api.request("INVALID_AUTHORIZATION", path, {
        body,
        session: unauthorized,
        key: randomUUID(),
        headers,
        expected: 403,
        code: "INVALID_ACCESS",
      });
    await api.request("MISSING_IDEMPOTENCY", path, {
      body,
      session: unauthorized,
      expected: 400,
      code: "INVALID_COMMAND",
    });
  }
  const beforeInvalid = await checkoutBusinessCounts(client);
  const review = await validate(unauthorized);
  same(
    await checkoutBusinessCounts(client),
    beforeInvalid,
    "validate alone creates no order, contact, quote session or stock reservation",
  );
  const body = api.createBody(unauthorized, review, email());
  for (const changes of [
    { totalAmountMinor: 1 },
    { market: "FORGED" },
    { currency: "JPY" },
    { presentationLocale: "ja" },
    { email: "invalid" },
    { policyAcceptances: [] },
    { operation: "CREATE_CHECKOUT" },
    { supportIntentId: randomUUID() },
  ])
    await api.request("REJECT_CLIENT_AUTHORITY", "/api/v1/checkout/sessions", {
      session: unauthorized,
      key: randomUUID(),
      body: { ...body, ...changes },
      expected: 400,
      code: "INVALID_COMMAND",
    });
  await api.request("UNCONFIRMED_POLICY", "/api/v1/checkout/sessions", {
    session: unauthorized,
    key: randomUUID(),
    body: {
      ...body,
      policyAcceptances: body.policyAcceptances.map((value) => ({
        ...value,
        accepted: false,
      })),
    },
    expected: 400,
    code: "INVALID_COMMAND",
  });
  await api.request("WRONG_POLICY_REVISION", "/api/v1/checkout/sessions", {
    session: unauthorized,
    key: randomUUID(),
    body: {
      ...body,
      policyAcceptances: body.policyAcceptances.map((value) => ({
        ...value,
        policyRevisionId: randomUUID(),
      })),
    },
    expected: 409,
    code: "POLICY_ACCEPTANCE_REQUIRED",
  });
  const foreign = await api.initialize();
  await api.request("WRONG_CART_VERSION", "/api/v1/checkout/sessions", {
    session: unauthorized,
    key: randomUUID(),
    body: { ...body, expectedCartVersion: unauthorized.cart.version + 1 },
    expected: 409,
    code: "VERSION_CONFLICT",
  });
  // Same public version makes UUID-only authorization rejection observable independently of version validation.
  await api.add(foreign);
  await api.create(foreign, review, email(), {
    expected: 404,
    code: "PREFLIGHT_NOT_FOUND",
  });
  await api.read(foreign, randomUUID(), {
    expected: 404,
    code: "CHECKOUT_NOT_FOUND",
  });
  same(
    await checkoutBusinessCounts(client),
    beforeInvalid,
    "all rejected input leaves checkout business tables unchanged",
  );
  cases.push({ name: "authorization-and-input", status: "PASS" });

  context.progress("seven-language immutable order and policy snapshots");
  for (const locale of SUPPORTED_LOCALES) {
    const session = await fresh();
    await api.add(session, { artist: fixtures.artists[1] });
    await api.add(session, { variant: fixtures.gifts[0].variants[2] });
    const key = randomUUID();
    const counts = await checkoutBusinessCounts(client);
    const preflight = await validate(session, { locale, key });
    const replay = (await api.validate(session, { locale, key })).data;
    check(
      replay.replayed === true && replay.preflight.id === preflight.id,
      "validation replay returns the same persisted observation",
    );
    same(
      await checkoutBusinessCounts(client),
      counts,
      "seven-language preflight does not reserve stock or create contact/order rows",
    );
    check(
      preflight.presentationLocale === locale &&
        preflight.currency === session.cart.currency &&
        preflight.market === session.cart.market,
      "presentation language does not change the cart commerce scope",
    );
    const created = await create(session, preflight, email(), { key });
    const stored = await verifyStoredCheckout({
      client,
      kms,
      check,
      ...created,
    });
    const read = (
      await api.read(session, created.checkout.id, {
        headers: { "accept-language": locale === "en" ? "ja" : "en" },
      })
    ).data.checkout;
    same(
      read,
      created.checkout,
      "status returns immutable checkout language, lines, policy and amount despite another requested browser language",
    );
    await api.request(
      "REJECT_STATUS_LOCALE_REWRITE",
      `/api/v1/checkout/sessions/${created.checkout.id}/status?presentationLocale=en`,
      { method: "GET", session, expected: 400, code: "INVALID_COMMAND" },
    );
    await api.read(foreign, created.checkout.id, {
      expected: 404,
      code: "CHECKOUT_NOT_FOUND",
    });
    historical.push({
      session,
      checkout: created.checkout,
      fingerprint: await checkoutSnapshotFingerprint(
        client,
        created.checkout.id,
      ),
    });
    cases.push({
      name: "historical-language",
      locale,
      status: "PASS",
      ...stored,
    });
  }

  context.progress("stock aggregation and genuine concurrent checkout");
  const trackedGift = fixtures.gifts[6];
  const tracked = await fresh({ gift: trackedGift, quantity: 2 });
  await api.add(tracked, {
    gift: trackedGift,
    artist: fixtures.artists[1],
    quantity: 3,
  });
  const trackedCreated = await create(tracked, await validate(tracked));
  await verifyStoredCheckout({
    client,
    kms,
    check,
    ...trackedCreated,
    expectedReservations: 2,
  });
  const reserved = (
    await client.query(
      "select sum(quantity)::int as quantity from inventory_reservations where checkout_session_id=$1 and status='ACTIVE'",
      [trackedCreated.checkout.id],
    )
  ).rows[0].quantity;
  check(
    reserved === 5,
    "shared tracked inventory reserves the sum of independent recipient lines exactly once",
  );
  const scarce = fixtures.gifts[1];
  const competitors = await Promise.all([
    fresh({ gift: scarce }),
    fresh({ gift: scarce }),
  ]);
  const observations = await Promise.all(
    competitors.map((session) => validate(session)),
  );
  const competition = await Promise.all(
    competitors.map((session, index) =>
      api.create(session, observations[index], email(), {
        expected: [200, 409],
      }),
    ),
  );
  check(
    competition.filter((value) => value.data.outcome === "SUCCESS").length ===
      1 &&
      competition.filter(
        (value) =>
          value.data.outcome === "FAILURE" &&
          value.data.code === "INSUFFICIENT_STOCK",
      ).length === 1,
    "last-stock concurrent carts have one winner and one exact stock rejection",
  );
  const scarceBalance = (
    await client.query(
      "select b.on_hand, b.reserved from inventory_balances b join inventory_items i on i.id=b.inventory_item_id where i.gift_variant_id=$1",
      [scarce.variants[0].id],
    )
  ).rows;
  check(
    scarceBalance.length === 1 &&
      Number(scarceBalance[0].on_hand) === 1 &&
      Number(scarceBalance[0].reserved) === 1,
    "last-stock real balance never oversells",
  );
  cases.push({ name: "concurrent-stock-and-multi-recipient", status: "PASS" });

  const duplicate = await fresh();
  const duplicateReview = await validate(duplicate),
    duplicateEmail = email(),
    duplicateKey = randomUUID();
  const duplicateCounts = await checkoutBusinessCounts(client);
  const duplicates = await Promise.all([
    api.create(duplicate, duplicateReview, duplicateEmail, {
      key: duplicateKey,
      expected: [200, 409],
    }),
    api.create(duplicate, duplicateReview, duplicateEmail, {
      key: duplicateKey,
      expected: [200, 409],
    }),
  ]);
  for (let index = 0; index < duplicates.length; index++)
    if (duplicates[index].data.outcome === "FAILURE") {
      check(
        duplicates[index].data.code === "IN_PROGRESS",
        "same-key concurrent pending outcome is explicit",
      );
      duplicates[index] = await api.create(
        duplicate,
        duplicateReview,
        duplicateEmail,
        { key: duplicateKey },
      );
    }
  check(
    duplicates.filter(({ data }) => data.action === "CREATED").length === 1 &&
      duplicates.filter(({ data }) => data.action === "REPLAYED").length ===
        1 &&
      duplicates[0].data.checkout.id === duplicates[1].data.checkout.id,
    "same-key concurrent creates return one actual checkout and one replay",
  );
  check(
    (await checkoutBusinessCounts(client)).orders ===
      duplicateCounts.orders + 1,
    "same-key concurrency writes one order only",
  );
  const duplicateFingerprint = await checkoutSnapshotFingerprint(
    client,
    duplicates[0].data.checkout.id,
  );
  kms.setEncryptionUnavailable(true);
  try {
    check(
      (
        await api.create(duplicate, duplicateReview, duplicateEmail, {
          key: duplicateKey,
        })
      ).data.action === "REPLAYED",
      "committed checkout replay needs no new contact encryption",
    );
  } finally {
    kms.setEncryptionUnavailable(false);
  }
  await api.create(duplicate, duplicateReview, email(), {
    key: duplicateKey,
    expected: 409,
    code: "IDEMPOTENCY_CONFLICT",
  });
  await api.create(duplicate, duplicateReview, duplicateEmail, {
    expected: 409,
    code: "CART_LOCKED",
  });
  await verifyStoredCheckout({
    client,
    kms,
    check,
    checkout: duplicates[0].data.checkout,
    email: duplicateEmail,
  });
  check(
    (await checkoutSnapshotFingerprint(
      client,
      duplicates[0].data.checkout.id,
    )) === duplicateFingerprint,
    "same-key replay and rejected conflicts preserve the exact order and fulfillment outbox identity set",
  );
  cases.push({ name: "same-key-concurrency-and-recovery", status: "PASS" });

  context.progress("actual successful response loss recovery");
  const lost = await fresh(),
    lostReview = await validate(lost),
    lostEmail = email(),
    lostKey = randomUUID();
  const gateway = await createCheckoutResponseLossGateway(checkoutBase);
  context.own("checkout response-loss gateway", () => gateway.close());
  const beforeLoss = await checkoutBusinessCounts(client);
  let disconnected = false;
  try {
    await globalThis.fetch(gateway.origin + "/api/v1/checkout/sessions", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: lost.cookie,
        "x-csrf-token": lost.csrf,
        "idempotency-key": lostKey,
      },
      body: JSON.stringify(api.createBody(lost, lostReview, lostEmail)),
      signal: globalThis.AbortSignal.timeout(30_000),
    });
  } catch {
    disconnected = true;
  }
  check(
    disconnected &&
      gateway.events().length === 1 &&
      gateway.events()[0].upstreamStatus === 200 &&
      gateway.events()[0].disconnected &&
      !gateway.events()[0].downstreamHeadersSent,
    "actual upstream checkout success is followed by a real downstream disconnect",
  );
  const recovered = (
    await api.create(lost, lostReview, lostEmail, { key: lostKey })
  ).data;
  check(
    recovered.action === "REPLAYED" &&
      (await checkoutBusinessCounts(client)).orders === beforeLoss.orders + 1,
    "lost-response retry returns the existing order without a duplicate",
  );
  await api.read(lost, recovered.checkout.id);
  cases.push({
    name: "actual-network-disconnect",
    status: "PASS",
    events: gateway.events(),
  });

  context.progress("expired observations and KMS failure rollback");
  const failing = await fresh(),
    failingReview = await validate(failing);
  const failingCounts = await checkoutBusinessCounts(client);
  kms.setEncryptionUnavailable(true);
  try {
    await api.create(failing, failingReview, email(), {
      expected: 503,
      code: "TEMPORARY_UNAVAILABLE",
    });
  } finally {
    kms.setEncryptionUnavailable(false);
  }
  same(
    await checkoutBusinessCounts(client),
    failingCounts,
    "contact KMS failure leaves no partial order or reservation",
  );
  const short = await context.createCheckoutApi(3000);
  const expired = await fresh(),
    expiredReview = await validate(expired, { target: short.base });
  const deadline = globalThis.performance.now() + 6000;
  while (
    !(
      await client.query(
        "select clock_timestamp()>$1::timestamptz+interval '1 second' as expired",
        [expiredReview.expiresAt],
      )
    ).rows[0].expired
  ) {
    check(
      globalThis.performance.now() < deadline,
      "bounded TEST observation expiry wait completes",
    );
    await delay(50);
  }
  const expiredCounts = await checkoutBusinessCounts(client);
  await api.create(expired, expiredReview, email(), {
    target: short.base,
    expected: 409,
    code: "PREFLIGHT_EXPIRED",
  });
  same(
    await checkoutBusinessCounts(client),
    expiredCounts,
    "expired preflight cannot create checkout business rows",
  );
  const expiringSession = await fresh();
  const expiringReview = await validate(expiringSession, {
    target: short.base,
  });
  const expiringCheckout = (
    await api.create(expiringSession, expiringReview, email(), {
      target: short.base,
    })
  ).data.checkout;
  const initialStatus = (
    await api.read(expiringSession, expiringCheckout.id, { target: short.base })
  ).data.checkout;
  check(
    !initialStatus.expired,
    "actual short-lived checkout is readable before its quote expires",
  );
  const expiryDeadline = globalThis.performance.now() + 6000;
  while (
    !(
      await client.query(
        "select clock_timestamp()>$1::timestamptz+interval '250 milliseconds' as expired",
        [initialStatus.quoteExpiresAt],
      )
    ).rows[0].expired
  ) {
    check(
      globalThis.performance.now() < expiryDeadline,
      "bounded actual quote expiry wait completes",
    );
    await delay(50);
  }
  const afterExpiryCounts = await checkoutBusinessCounts(client);
  const expiredStatus = (
    await api.read(expiringSession, expiringCheckout.id, { target: short.base })
  ).data.checkout;
  check(
    expiredStatus.expired &&
      expiredStatus.paymentStatus === "UNPAID" &&
      expiredStatus.orderStatus === "PENDING_PAYMENT",
    "status observes actual expiry without advancing payment or order state",
  );
  same(
    { ...expiredStatus, expired: false },
    initialStatus,
    "quote expiry preserves all historical lines, language, policy and amounts",
  );
  same(
    await checkoutBusinessCounts(client),
    afterExpiryCounts,
    "expired status read creates no order, reservation or payment action",
  );
  await short.stop();
  cases.push({ name: "expiry-and-kms-failure", status: "PASS" });

  await (
    await import("./checkout-preflight-changes.mjs")
  ).verifyCheckoutCanonicalChanges({
    ...context,
    api,
    fresh,
    validate,
    create,
    email,
    historical,
    cases,
  });
  const finalCounts = await checkoutBusinessCounts(client);
  check(
    finalCounts.payment_attempts === 0,
    "the complete checkout protocol creates no PSP payment attempts",
  );
  check(
    canaries.every((value) => !JSON.stringify(logLines).includes(value)),
    "structured API logs never include private checkout or cart input",
  );
  return {
    schemaVersion: 1,
    status: "PASS",
    cases,
    requests: api.events.length,
    requestEvents: api.events,
    counts: finalCounts,
    actualNetworkDisconnect: true,
    browserEvidence: false,
    awsKmsEvidence: false,
    paymentProviderEvidence: false,
  };
}
