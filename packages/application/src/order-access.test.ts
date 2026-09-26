import { expect, test } from "vitest";
import {
  OrderAccessRepositoryError,
  type OrderAccessRepository,
  type OrderAccessTransactionManager,
} from "@fan-support/persistence-port";

const module = await import("./order-access.js").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const proof = {
  schemaVersion: 1,
  tokenDigest: "a".repeat(64),
  pepperVersion: "v1",
};
const trace = { requestId: id, correlationId: id, taskName: "order-access" };
const exchange = {
  schemaVersion: 1,
  tokenCandidates: [proof],
  sessionCredential: proof,
  sessionTtlSeconds: 3600,
  ...trace,
};
const grant = {
  schemaVersion: 1,
  publicOrderId: id,
  expiresAt: "2026-09-15T01:00:00Z",
};

function harness(result: unknown = grant, fault?: unknown) {
  const calls: string[] = [];
  let commits = 0;
  let rollbacks = 0;
  const repository = Object.fromEntries(
    [
      "issue",
      "exchange",
      "bootstrap",
      "read",
      "revoke",
      "consumeRateLimit",
    ].map((method) => [
      method,
      async () => {
        calls.push(method);
        if (fault) throw fault;
        return result;
      },
    ]),
  ) as unknown as OrderAccessRepository;
  const transactions: OrderAccessTransactionManager = {
    async runInOrderAccessTransaction(work) {
      try {
        const value = await work(repository);
        commits++;
        return value;
      } catch (error) {
        rollbacks++;
        throw error;
      }
    },
  };
  expect(module).toBeDefined();
  return {
    app: module!.createOrderAccessUseCases({ transactions }),
    calls,
    counts: () => ({ commits, rollbacks }),
  };
}

test("invalid access input never opens an authorization transaction", async () => {
  const h = harness();
  expect(
    await h.app.exchange({ ...exchange, token: "private-canary" }),
  ).toEqual({ schemaVersion: 1, outcome: "FAILURE", code: "INVALID_REQUEST" });
  expect(h.calls).toEqual([]);
  expect(h.counts()).toEqual({ commits: 0, rollbacks: 0 });
});

test("validated grant commits only the digest-scoped repository operation", async () => {
  const h = harness();
  expect(await h.app.exchange(exchange)).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "GRANTED",
    grant,
  });
  expect(h.calls).toEqual(["exchange"]);
  expect(h.counts()).toEqual({ commits: 1, rollbacks: 0 });
});

test("malformed or private repository results roll back before returning a generic failure", async () => {
  for (const result of [
    { ...grant, token: "private-canary" },
    { ...grant, expiresAt: "invalid" },
  ]) {
    const h = harness(result);
    expect(await h.app.exchange(exchange)).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "TEMPORARY_UNAVAILABLE",
    });
    expect(h.counts()).toEqual({ commits: 0, rollbacks: 1 });
  }
});

test("cross-order revocation result is rejected inside its transaction", async () => {
  const h = harness({ schemaVersion: 1, publicOrderId: other });
  expect(
    await h.app.revoke({
      schemaVersion: 1,
      publicOrderId: id,
      sessionCandidates: [proof],
      ...trace,
    }),
  ).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "TEMPORARY_UNAVAILABLE",
  });
  expect(h.counts()).toEqual({ commits: 0, rollbacks: 1 });
});

test("protected historical reads bind the response to the authorized order and reject private additions", async () => {
  const locale = {
    schemaVersion: 1,
    mode: "DAILY",
    requestedLocale: "en",
    resolvedLocale: "zh-CN",
    sourceLocale: "zh-CN",
    fallbackUsed: true,
  };
  const media = {
    url: "https://media.example.test/gift.webp",
    alt: "原图",
    locale,
  };
  const item = {
    schemaVersion: 1,
    position: 1,
    idol: { handle: "artist", displayName: "艺人", locale, portrait: media },
    gift: { title: "原礼物", variantLabel: null, locale, image: media },
    quantity: 2,
    unitAmountMinor: 100,
    lineSubtotalMinor: 200,
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    lineTotalMinor: 200,
    currency: "USD",
    displayMode: "anonymous",
    giftKind: "PHYSICAL",
    fulfillmentStatus: "PENDING",
  };
  const order = {
    schemaVersion: 1,
    publicOrderId: id,
    presentationLocale: "en",
    orderStatus: "OPEN",
    paymentStatus: "PAID",
    disputeStatus: "NONE",
    fulfillmentStatus: "PENDING",
    amount: {
      schemaVersion: 1,
      currency: "USD",
      subtotalMinor: 200,
      taxAmountMinor: 0,
      shippingAmountMinor: 0,
      feeAmountMinor: 0,
      discountAmountMinor: 0,
      totalAmountMinor: 200,
    },
    items: [item],
    createdAt: "2026-09-15T00:00:00Z",
    updatedAt: "2026-09-15T00:00:00Z",
  };
  const command = {
    schemaVersion: 1,
    publicOrderId: id,
    sessionCandidates: [proof],
  };
  const h = harness(order);
  expect(await h.app.read(command)).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "READ",
    order,
  });
  expect(h.counts()).toEqual({ commits: 1, rollbacks: 0 });
  for (const invalid of [
    { ...order, publicOrderId: other },
    { ...order, contactEmail: "private-canary" },
    { ...order, items: [{ ...item, message: "private-canary" }] },
    { ...order, items: [{ ...item, lineTotalMinor: 201 }] },
    { ...order, presentationLocale: "ja" },
  ]) {
    const bad = harness(invalid);
    expect(await bad.app.read(command)).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "TEMPORARY_UNAVAILABLE",
    });
    expect(bad.counts()).toEqual({ commits: 0, rollbacks: 1 });
  }
});

test("known denial remains stable while arbitrary infrastructure errors stay private", async () => {
  for (const [error, code] of [
    [new OrderAccessRepositoryError("ACCESS_DENIED"), "ACCESS_DENIED"],
    [new Error("private-canary"), "TEMPORARY_UNAVAILABLE"],
  ] as const) {
    const h = harness(grant, error);
    expect(await h.app.exchange(exchange)).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    });
    expect(h.counts()).toEqual({ commits: 0, rollbacks: 1 });
  }
});

test("rate limit exhaustion commits independently; malformed limiter results fail closed", async () => {
  const command = {
    schemaVersion: 1,
    scope: "EXCHANGE",
    bucket: proof,
    windowSeconds: 60,
    maxRequests: 3,
  };
  const result = { schemaVersion: 1, allowed: false, retryAfterSeconds: 15 };
  const h = harness(result);
  expect(await h.app.consumeRateLimit(command)).toEqual(result);
  expect(h.counts()).toEqual({ commits: 1, rollbacks: 0 });
  const invalid = harness({ ...result, retryAfterSeconds: 0 });
  await expect(invalid.app.consumeRateLimit(command)).rejects.toThrow(
    "Order access unavailable",
  );
  expect(invalid.counts()).toEqual({ commits: 0, rollbacks: 1 });
  await expect(
    invalid.app.consumeRateLimit({ ...command, maxRequests: 0 }),
  ).rejects.toThrow("Order access unavailable");
  expect(invalid.counts()).toEqual({ commits: 0, rollbacks: 1 });
});
