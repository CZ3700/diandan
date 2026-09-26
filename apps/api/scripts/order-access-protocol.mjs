import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createOrderAccessUseCases } from "@fan-support/application";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "./order-payment-client.mjs";
import { createCartDailyGiftFixture } from "./cart-daily-gift-fixture.mjs";
import { createOrderAccessProtocolClient } from "./order-access-client.mjs";
import {
  captureOrderAccessBusinessState,
  requestRawOrderAccess,
} from "./order-access-observers.mjs";
import { createOrderAccessResponseLossGateway } from "./order-access-gateway.mjs";
import { verifyOrderAccessRollback } from "./order-access-commit-faults.mjs";
import { changeOrderAccessCatalog } from "./order-access-history.mjs";

export async function verifyOrderAccessProtocol(context) {
  const { check, progress, client, credentials, configuration } = context;
  const payment = createOrderPaymentProtocolClient(context);
  const canaries = [...payment.canaries],
    cases = [],
    history = [];
  const api = createOrderAccessProtocolClient({ ...context, canaries });
  const application = createOrderAccessUseCases({
    transactions: context.persistence.orderAccessTransactionManager,
  });
  const trace = () => ({
    requestId: randomUUID(),
    correlationId: randomUUID(),
    taskName: "order-access-protocol",
  });
  const same = (actual, expected, label) =>
    check(JSON.stringify(actual) === JSON.stringify(expected), label);
  async function paid(options) {
    const value = await payment.fresh(options);
    await payment.settle(value);
    const event = await payment.reconcile(value);
    check(
      (await payment.apply(event)).decision === "APPLIED",
      "Normal authenticated evidence applies the existing order before access is authorized",
    );
    value.orderId = (await payment.assertPaid(value)).order_id;
    return value;
  }
  async function issue(
    value,
    ttl = configuration.linkTtlSeconds,
    useCases = application,
  ) {
    const link = await credentials.issueLink();
    canaries.push(link.token);
    const result = await useCases.issue({
      schemaVersion: 1,
      orderId: value.orderId,
      tokenCredential: link.access,
      linkTtlSeconds: ttl,
      ...trace(),
    });
    check(
      result.outcome === "SUCCESS" &&
        result.action === "GRANTED" &&
        result.grant.publicOrderId === value.checkout.publicOrderId,
      "Trusted internal link issue binds the already-paid canonical order",
    );
    return { ...link, grant: result.grant };
  }
  const denied = { expected: 401, code: "ACCESS_DENIED" };
  const invalid = { expected: 400, code: "INVALID_REQUEST" };
  const originDenied = { expected: 403, code: "ACCESS_DENIED" };
  async function waitExpired(table, digest) {
    await waitForOrderPayment(
      "The actual stored access expiry elapses without changing its timestamp",
      async () =>
        (
          await client.query(
            `SELECT expires_at <= clock_timestamp() AS expired FROM ${table} WHERE ${table === "order_access_tokens" ? "token_digest" : "session_token_digest"}=decode($1,'hex')`,
            [digest],
          )
        ).rows[0]?.expired,
      check,
      { timeoutMs: 10000 },
    );
  }

  progress("seven locale paid orders establish protected order sessions");
  for (const locale of SUPPORTED_LOCALES) {
    const value = await paid({ locale });
    const granted = await api.bootstrap(value);
    check(
      granted.data.grant.publicOrderId === value.checkout.publicOrderId,
      "Bootstrap selects the checkout's own public order without a caller-provided order ID",
    );
    const read = await api.read(granted.session, value.checkout.publicOrderId);
    const order = read.data.order;
    check(
      order.presentationLocale === locale &&
        order.paymentStatus === "PAID" &&
        order.orderStatus === "OPEN",
      "Protected historical order keeps its original locale and canonical paid state",
    );
    same(
      order.amount,
      value.checkout.amount,
      "Historical access amount equals the immutable checkout amount exactly",
    );
    for (const [index, item] of order.items.entries()) {
      const expected = value.checkout.lines[index];
      check(
        item.idol.displayName === expected.idolDisplayName &&
          item.gift.title === expected.giftTitle &&
          item.quantity === expected.quantity &&
          item.unitAmountMinor === expected.unitAmountMinor,
        "Historical recipient, gift and quantity retain the original confirmed snapshot",
      );
      for (const language of [
        item.idol.locale,
        item.idol.portrait.locale,
        item.gift.locale,
        item.gift.image.locale,
      ])
        check(
          language.mode === "APPROVED" &&
            language.requestedLocale === locale &&
            language.resolvedLocale === locale &&
            !language.fallbackUsed,
          "Strict seven-language snapshots retain their actual approved locale",
        );
      for (const image of [item.idol.portrait, item.gift.image]) {
        const mediaResponse = await context.gateway.probe(
          new globalThis.URL(image.url).pathname,
        );
        console.log(
          `Order access media ${JSON.stringify({ status: mediaResponse.status, locale })}`,
        );
        check(
          mediaResponse.status === 200,
          "Protected order media resolves to actual historical S3 derivative bytes",
        );
      }
    }
    history.push({ value, session: granted.session, order });
  }
  cases.push({
    name: "seven-locale-bootstrap-history",
    status: "PASS",
    locales: SUPPORTED_LOCALES,
  });

  progress(
    "DAILY Chinese original retains truthful historical content and image language",
  );
  const daily = await createCartDailyGiftFixture({
    ...context,
    presentation: {
      sourceLocale: "zh-CN",
      name: "历史查单测试花束",
      description: "仅用于本机历史原文和图片快照验证的测试礼物。",
    },
  });
  const dailyValue = await paid({
    locale: "en",
    lines: [
      {
        gift: {
          id: daily.giftId,
          handle: daily.handle,
          variants: [{ id: daily.giftVariantId }],
        },
      },
    ],
  });
  const dailyAccess = await api.bootstrap(dailyValue);
  const dailyRead = (
    await api.read(dailyAccess.session, dailyValue.checkout.publicOrderId)
  ).data.order;
  for (const language of [
    dailyRead.items[0].gift.locale,
    dailyRead.items[0].gift.image.locale,
  ])
    check(
      language.mode === "DAILY" &&
        language.sourceLocale === "zh-CN" &&
        language.resolvedLocale === "zh-CN" &&
        language.requestedLocale === "en" &&
        language.fallbackUsed,
      "Daily original and information-image alt remain Chinese under the English order shell",
    );
  check(
    dailyRead.items[0].gift.title === "历史查单测试花束",
    "Actual Chinese original name survives checkout and protected order reading",
  );
  check(
    (
      await context.gateway.probe(
        new globalThis.URL(dailyRead.items[0].gift.image.url).pathname,
      )
    ).status === 200,
    "DAILY historical gift image serves actual S3 derivative bytes with its frozen Chinese provenance",
  );
  history.push({
    value: dailyValue,
    session: dailyAccess.session,
    order: dailyRead,
  });
  cases.push({ name: "daily-chinese-original", status: "PASS" });

  // All remaining tests reuse paid canonical rows; no PSP command is needed again.
  const unpaid = await payment.fresh();
  await api.bootstrap(unpaid, { expected: 409, code: "PAYMENT_NOT_CONFIRMED" });
  const unpaidCredential = await credentials.issueLink();
  canaries.push(unpaidCredential.token);
  const unpaidIssue = await application.issue({
    schemaVersion: 1,
    orderId: (await payment.state(unpaid)).order_id,
    tokenCredential: unpaidCredential.access,
    linkTtlSeconds: configuration.linkTtlSeconds,
    ...trace(),
  });
  check(
    unpaidIssue.outcome === "FAILURE" &&
      unpaidIssue.code === "PAYMENT_NOT_CONFIRMED",
    "Even trusted internal issuance rejects an order without canonical payment confirmation",
  );
  const baseline = await captureOrderAccessBusinessState(client, context.psp);
  const decryptBefore = context.kms.counts.DecryptCommand ?? 0;
  const first = history[0],
    second = history[1],
    id = first.value.checkout.publicOrderId;
  progress(
    "actual HTTP authorization, malformed input, and order scope rejection",
  );
  await api.read(undefined, id, denied);
  await api.read(first.session, second.value.checkout.publicOrderId, denied);
  await api.read(first.session, randomUUID(), denied);
  progress("public order number resolves only through its own order session");
  const numberOf = async (session, publicOrderId) =>
    (await api.read(session, publicOrderId)).data.order.publicOrderNo;
  const firstNo = await numberOf(first.session, id),
    secondNo = await numberOf(
      second.session,
      second.value.checkout.publicOrderId,
    );
  const located = await api.locate(first.session, firstNo);
  check(
    located.data.action === "LOCATED" &&
      located.data.publicOrderId === id &&
      !located.response.headers.get("set-cookie") &&
      !located.response.headers.get("x-csrf-token"),
    "A public number resolves to its order only through that order's session and issues no credential",
  );
  await api.locate(first.session, secondNo, denied);
  await api.locate(undefined, firstNo, denied);
  await api.locate(first.session, firstNo.toLowerCase(), invalid);
  await api.read(first.value.session, id, denied);
  await api.read(
    { cookie: `__Host-fan-order=${randomBytes(32).toString("base64url")}` },
    id,
    denied,
  );
  await api.read(first.session, id, {
    ...originDenied,
    headers: { origin: "https://untrusted.example.invalid" },
  });
  await api.request("READ_QUERY_REJECTED", `/api/v1/orders/${id}?locale=ja`, {
    method: "GET",
    session: first.session,
    ...invalid,
  });
  await api.bootstrap(
    { ...first.value, session: second.value.session },
    denied,
  );
  await api.bootstrap(first.value, {
    ...originDenied,
    headers: { origin: "https://untrusted.example.invalid" },
  });
  await api.bootstrap(first.value, {
    ...originDenied,
    headers: { "x-csrf-token": randomBytes(32).toString("base64url") },
  });
  await api.revoke(first.session, id, {
    ...originDenied,
    headers: { "x-csrf-token": first.value.session.csrf },
  });
  for (const token of ["x", "A".repeat(42) + "B"])
    await api.exchange(token, invalid);
  await api.exchange(randomBytes(32).toString("base64url"), denied);
  await api.request("EXTRA_EXCHANGE_FIELD", "/api/v1/order-access/exchange", {
    body: {
      schemaVersion: 1,
      token: randomBytes(32).toString("base64url"),
      publicOrderId: id,
    },
    ...invalid,
  });
  const duplicate = await requestRawOrderAccess(
    context.accessBase,
    `/api/v1/orders/${id}`,
    {
      method: "GET",
      headers: ["Cookie", first.session.cookie, "Cookie", first.session.cookie],
    },
  );
  check(
    duplicate.status === 401 &&
      JSON.parse(duplicate.body).code === "ACCESS_DENIED",
    "Actual HTTP rejects duplicate authorization Cookie headers",
  );
  const duplicateOrigin = await requestRawOrderAccess(
    context.accessBase,
    "/api/v1/order-access/exchange",
    {
      headers: [
        "Origin",
        context.origin,
        "Origin",
        context.origin,
        "Content-Type",
        "application/json",
      ],
      body: JSON.stringify({
        schemaVersion: 1,
        token: randomBytes(32).toString("base64url"),
      }),
    },
  );
  check(
    duplicateOrigin.status === 403 &&
      JSON.parse(duplicateOrigin.body).code === "ACCESS_DENIED",
    "Actual HTTP rejects duplicated Origin headers before exchanging credentials",
  );
  same(
    await captureOrderAccessBusinessState(client, context.psp),
    baseline,
    "Rejected authorization and access operations do not mutate financial, cart, inventory, fulfillment or notification state",
  );
  cases.push({ name: "http-authorization-and-private-scope", status: "PASS" });

  progress(
    "one-time link consumption, rotation, revocation and concurrent exchange",
  );
  const link = await issue(first.value);
  const rollback = await verifyOrderAccessRollback({ context, link, check });
  const exchanged = await api.exchange(link.token);
  await api.read(first.session, id, denied);
  await api.read(exchanged.session, id);
  await api.exchange(link.token, denied);
  await api.exchange(link.token, {
    ...denied,
    headers: { cookie: exchanged.session.cookie },
  });
  const linked = (
    await client.query(
      "SELECT t.status AS token_status,count(s.id)::int AS sessions FROM order_access_tokens t LEFT JOIN order_access_sessions s ON s.exchanged_token_id=t.id WHERE t.token_digest=decode($1,'hex') GROUP BY t.status",
      [link.access.tokenDigest],
    )
  ).rows[0];
  same(
    linked,
    { token_status: "EXCHANGED", sessions: 1 },
    "Token consumption and exactly one same-order session are committed together",
  );
  const nextLink = await issue(first.value);
  const replacement = await issue(first.value);
  await api.exchange(nextLink.token, denied);
  const responses = await Promise.all([
    api.exchange(replacement.token, { expected: [200, 401], code: undefined }),
    api.exchange(replacement.token, { expected: [200, 401], code: undefined }),
  ]);
  check(
    responses.filter((response) => response.data.outcome === "SUCCESS")
      .length === 1 &&
      responses.filter((response) => response.data.code === "ACCESS_DENIED")
        .length === 1,
    "Concurrent exchange consumes a real one-time link exactly once",
  );
  const winner = responses.find(
    (response) => response.data.outcome === "SUCCESS",
  );
  await api.read(winner.session, id);
  const revokedSession = { ...winner.session };
  await api.revoke(winner.session, id);
  await api.read(revokedSession, id, denied);
  await api.exchange(replacement.token, denied);
  cases.push({
    name: "one-time-concurrency-rotation-revocation",
    status: "PASS",
    rollback,
  });

  progress(
    "real token and session expiry; retained checkout can establish a new scope",
  );
  const expires = await issue(first.value, 1);
  await waitExpired("order_access_tokens", expires.access.tokenDigest);
  await api.exchange(expires.token, denied);
  const short = await context.createAccessApi({
    config: { ...configuration, sessionTtlSeconds: 1 },
  });
  const shortGrant = await api.bootstrap(first.value, { target: short.base });
  const shortRaw = shortGrant.session.cookie.split("=")[1];
  const shortProof = (await credentials.resolveSession(shortRaw)).accesses[0];
  await waitExpired("order_access_sessions", shortProof.tokenDigest);
  await api.read(shortGrant.session, id, denied);
  await short.stop();
  first.session = (await api.bootstrap(first.value)).session;
  same(
    (await api.read(first.session, id)).data.order,
    first.order,
    "Authorized checkout renewal restores the same historical order after natural session expiry",
  );
  cases.push({ name: "real-expiry-and-bootstrap-renewal", status: "PASS" });

  progress("real socket response loss with and without a received Cookie");
  for (const mode of ["BEFORE_HEADERS", "AFTER_HEADERS"]) {
    const lostLink = await issue(first.value);
    const gateway = await createOrderAccessResponseLossGateway({
      base: context.accessBase,
      path: "/api/v1/order-access/exchange",
      mode,
    });
    context.own("order access owned response loss gateway", () =>
      gateway.close(),
    );
    const send = () =>
      globalThis.fetch(`${gateway.origin}/api/v1/order-access/exchange`, {
        method: "POST",
        headers: { origin: context.origin, "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, token: lostLink.token }),
        signal: globalThis.AbortSignal.timeout(10000),
      });
    if (mode === "BEFORE_HEADERS") {
      await assert.rejects(send());
      check(
        gateway.events()[0]?.disconnected &&
          !gateway.events()[0].downstreamHeadersSent,
        "The successful exchange loses the entire real HTTP response before the Cookie arrives",
      );
      await api.exchange(lostLink.token, denied);
      first.session = (await api.bootstrap(first.value)).session;
    } else {
      const response = await send();
      const cookie = response.headers.get("set-cookie");
      check(
        cookie?.includes("HttpOnly"),
        "Real cookie headers arrive before the order exchange JSON is interrupted",
      );
      first.session = { cookie: cookie.split(";")[0] };
      canaries.push(first.session.cookie.split("=")[1]);
      await assert.rejects(response.text());
      check(
        gateway.events()[0]?.disconnected &&
          gateway.events()[0].downstreamHeadersSent,
        "The real HTTP body is lost only after successful cookie headers",
      );
      await api.exchange(lostLink.token, denied);
    }
    same(
      (await api.read(first.session, id)).data.order,
      first.order,
      "Known public order ID plus received Cookie, or independently authorized checkout renewal, reads the existing order without another payment",
    );
    // The fixture lifecycle owns the gateway close exactly once.
  }
  cases.push({
    name: "real-response-loss-two-cases",
    status: "PASS",
    actualSocketDisconnect: true,
    cookieRecoveryRequiresKnownPublicOrderId: true,
    noCookieAndNoCheckoutRequiresNewLink: true,
  });

  progress("unavailable key service rejects without consuming credentials");
  const kmsLink = await issue(first.value);
  context.kms.setUnavailable(true);
  try {
    await api.exchange(kmsLink.token, {
      expected: 503,
      code: "TEMPORARY_UNAVAILABLE",
    });
  } finally {
    context.kms.setUnavailable(false);
  }
  first.session = (await api.exchange(kmsLink.token)).session;
  const missingPepper = await context.createAccessApi({
    activePepperVersion: "unavailable-test",
    pepperVersions: ["unavailable-test"],
  });
  await api.read(first.session, id, {
    target: missingPepper.base,
    expected: 503,
    code: "TEMPORARY_UNAVAILABLE",
  });
  await missingPepper.stop();
  same(
    await captureOrderAccessBusinessState(client, context.psp),
    baseline,
    "All link/session operations remain separate from PSP and financial authority",
  );
  check(
    (context.kms.counts.DecryptCommand ?? 0) === decryptBefore,
    "Order access requires no decryption of contact email or private messages",
  );
  cases.push({
    name: "credential-key-unavailable-fails-closed",
    status: "PASS",
  });

  progress(
    "current content and prices change while historical protected snapshots remain stable",
  );
  const changes = await changeOrderAccessCatalog(context);
  for (const record of history)
    same(
      (await api.read(record.session, record.value.checkout.publicOrderId)).data
        .order,
      record.order,
      "Historical order bytes remain stable after actual current name, image, price and archive operations",
    );
  const replacementGateway = await context.createHistoricalMediaGateway();
  const replacementApi = await context.createAccessApi({
    publicMediaBaseUrl: replacementGateway.origin,
  });
  const changedRead = (
    await api.read(first.session, id, { target: replacementApi.base })
  ).data.order;
  const normalizeUrls = (order) => ({
    ...order,
    items: order.items.map((item) => ({
      ...item,
      idol: {
        ...item.idol,
        portrait: {
          ...item.idol.portrait,
          url: new globalThis.URL(item.idol.portrait.url).pathname,
        },
      },
      gift: {
        ...item.gift,
        image: {
          ...item.gift.image,
          url: new globalThis.URL(item.gift.image.url).pathname,
        },
      },
    })),
  });
  same(
    normalizeUrls(changedRead),
    normalizeUrls(first.order),
    "Changing the configured media origin preserves every historical media key, alt, price and content field",
  );
  for (const item of changedRead.items)
    for (const image of [item.idol.portrait, item.gift.image])
      check(
        new globalThis.URL(image.url).origin === replacementGateway.origin &&
          (
            await replacementGateway.probe(
              new globalThis.URL(image.url).pathname,
            )
          ).status === 200,
        "Historical protected media continues to serve actual S3 bytes on the replacement configured origin",
      );
  await replacementApi.stop();
  cases.push({
    name: "immutable-history-after-normal-catalog-changes",
    status: "PASS",
    changes,
  });

  progress(
    "persistent per-scope rate limits survive independent API instances",
  );
  const afterCatalog = await captureOrderAccessBusinessState(
    client,
    context.psp,
  );
  const limitedConfig = {
    ...configuration,
    rateLimit: {
      windowSeconds: 30,
      exchangeMax: 2,
      bootstrapMax: 2,
      readMax: 2,
      revokeMax: 2,
    },
  };
  const limitedA = await context.createAccessApi({ config: limitedConfig });
  // Existing network buckets belong to the ordinary fixture. Wait for their actual expiry, never rewrite counters.
  await waitForOrderPayment(
    "Existing rate windows naturally finish before the isolated low-limit check",
    async () =>
      (
        await client.query(
          "SELECT count(*)::int AS active FROM order_access_rate_limits WHERE window_expires_at > clock_timestamp()",
        )
      ).rows[0].active === 0,
    check,
    { timeoutMs: 10000 },
  );
  await api.exchange(randomBytes(32).toString("base64url"), {
    target: limitedA.base,
    ...denied,
  });
  await limitedA.stop();
  const limitedB = await context.createAccessApi({ config: limitedConfig });
  await api.exchange(randomBytes(32).toString("base64url"), {
    target: limitedB.base,
    ...denied,
  });
  const limited = await api.exchange(randomBytes(32).toString("base64url"), {
    target: limitedB.base,
    expected: 429,
    code: "RATE_LIMITED",
    headers: { "x-forwarded-for": "192.0.2.71" },
  });
  check(
    Number(limited.response.headers.get("retry-after")) > 0,
    "Persistent limiter returns a bounded retry interval and ignores untrusted forwarding headers",
  );
  await limitedB.stop();
  cases.push({
    name: "persistent-rate-limit-and-untrusted-forwarding",
    status: "PASS",
  });

  same(
    await captureOrderAccessBusinessState(client, context.psp),
    afterCatalog,
    "Rate-limited access never changes business state or calls the PSP",
  );
  check(
    canaries.every((value) =>
      context.logLines.every((line) => !line.includes(value)),
    ),
    "Actual API logs contain no link, session, CSRF credential, message, nickname or email canary",
  );
  return {
    schemaVersion: 1,
    status: "PASS",
    cases,
    accessRequests: api.events,
    checkoutRequests: payment.checkout.events.length,
    paymentRequests: payment.payment.events.length,
    historicalOrders: history.length,
    actualPostgres: true,
    actualIndependentTestPsp: true,
    actualPspSandbox: false,
    actualSocketDisconnect: true,
    financialReadSideEffects: false,
    notificationImplemented: false,
    orderUiImplemented: false,
    browserEvidence: false,
  };
}
