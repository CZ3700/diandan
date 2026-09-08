import { sourceHashSchema } from "@fan-support/contracts";
import { expect, test } from "vitest";
import { checkoutHarness } from "./checkout-preflight.harness.js";
import { id } from "./checkout-preflight.test-fixtures.js";

test("observation is side-effect-free for orders and checkout encrypts contact outside both transactions", async () => {
  const h = checkoutHarness();
  const command = await h.prepare();
  expect(h.state().commits).toHaveLength(0);
  expect(h.keys.encryptEnvelope).not.toHaveBeenCalled();
  const result = await h.app.create(command, h.context);
  expect(result).toMatchObject({
    outcome: "SUCCESS",
    action: "CREATED",
    checkout: {
      orderStatus: "PENDING_PAYMENT",
      paymentStatus: "UNPAID",
      amount: { totalAmountMinor: 500 },
      presentationLocale: "en",
    },
  });
  expect(h.state().commits).toHaveLength(1);
  expect(h.state().current.cart.status).toBe("LOCKED");
  expect(h.repos.inventory.loadManyForUpdate).not.toHaveBeenCalled();
  expect(h.keys.decryptEnvelope).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(
    /supportIntentId|objectKey|email|contact|fulfillmentProfileId|orderId/u,
  );
  expect(JSON.stringify(h.state())).not.toContain(command.email);
});
test("lost commit response recovers exactly one order with the original key and does not encrypt again", async () => {
  const h = checkoutHarness();
  const command = await h.prepare();
  h.makeCommitUnknown();
  expect(await h.app.create(command, h.context)).toMatchObject({
    code: "TRANSACTION_OUTCOME_UNKNOWN",
  });
  expect(h.state().commits).toHaveLength(1);
  expect(await h.app.create(command, h.context)).toMatchObject({
    action: "REPLAYED",
  });
  expect(h.state().commits).toHaveLength(1);
  expect(h.keys.encryptEnvelope).toHaveBeenCalledTimes(1);
  expect(
    await h.app.create(
      { ...command, email: "changed@example.test" },
      h.context,
    ),
  ).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(
    await h.app.create(command, {
      ...h.context,
      idempotencyKey: "second-checkout-key",
    }),
  ).toMatchObject({ code: "CART_LOCKED" });
});
test.each(["price", "policy", "media", "expiry"])(
  "%s changes during KMS prevent a stale order and roll back its provisional receipt",
  async (change) => {
    const h = checkoutHarness();
    const command = await h.prepare();
    h.afterEncryption(() => {
      if (change === "expiry")
        h.state().current.evaluatedAt = "2026-09-08T01:00:00Z";
      else if (change === "policy")
        h.state().current.consent.policies[0]!.sourceHash =
          sourceHashSchema.parse("f".repeat(64));
      else if (change === "media")
        h.state().current.consent.lines[0]!.giftImage.checksum =
          sourceHashSchema.parse("f".repeat(64));
      else h.state().current.consent.lines[0]!.priceRevision++;
    });
    expect(await h.app.create(command, h.context)).toMatchObject({
      code:
        change === "expiry"
          ? "PREFLIGHT_EXPIRED"
          : change === "policy"
            ? "POLICY_CHANGED"
            : "PREFLIGHT_CHANGED",
    });
    expect(h.state().commits).toHaveLength(0);
    expect(h.state().current.cart.status).toBe("ACTIVE");
    expect(Object.keys(h.state().receipts)).toHaveLength(1);
  },
);
test("wrong policy acceptance fails before KMS and historical reads never reload the mutable catalog", async () => {
  const h = checkoutHarness();
  const command = await h.prepare();
  expect(
    await h.app.create(
      {
        ...command,
        policyAcceptances: [
          { ...command.policyAcceptances[0], policyRevisionId: id(700) },
        ],
      },
      h.context,
    ),
  ).toMatchObject({ code: "POLICY_ACCEPTANCE_REQUIRED" });
  expect(h.keys.encryptEnvelope).not.toHaveBeenCalled();
  const created = await h.app.create(command, h.context);
  if (created.outcome !== "SUCCESS" || created.action === "VALIDATED")
    throw new Error("Checkout fixture failed");
  const old = structuredClone(created.checkout);
  h.state().current.consent.lines[0]!.giftTitle = "Changed current catalog";
  h.repos.checkoutPreflight.loadCurrent.mockClear();
  const read = await h.app.read(
    { schemaVersion: 1, operation: "READ_CHECKOUT", checkoutSessionId: old.id },
    h.context,
  );
  expect(read).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "READ",
    checkout: old,
  });
  expect(h.repos.checkoutPreflight.loadCurrent).not.toHaveBeenCalled();
});

test("PostgreSQL JSON key ordering cannot invalidate an otherwise identical saved observation", async () => {
  const h = checkoutHarness();
  const save = h.repos.checkoutPreflight.savePreflight.getMockImplementation()!;
  h.repos.checkoutPreflight.savePreflight.mockImplementation(
    async (command) => {
      const observation = await save(command);
      return Object.fromEntries(
        Object.entries(observation).reverse(),
      ) as typeof observation;
    },
  );
  await h.prepare();
});

test("a receipt mismatch after order writes aborts all changes and never creates a completed retry record", async () => {
  const h = checkoutHarness();
  const command = await h.prepare();
  const commit = h.repos.checkoutPreflight.commit.getMockImplementation()!;
  h.repos.checkoutPreflight.commit.mockImplementation(async (input) => ({
    ...(await commit(input)),
    cartVersion: 999,
  }));
  expect(await h.app.create(command, h.context)).toMatchObject({
    code: "CONTENT_UNAVAILABLE",
  });
  expect(h.state().commits).toHaveLength(0);
  expect(h.state().current.cart.status).toBe("ACTIVE");
  expect(Object.keys(h.state().receipts)).toHaveLength(1);
});

test("initial fulfillments record their matching durable event in the same order transaction exactly once", async () => {
  const h = checkoutHarness();
  const command = await h.prepare();
  expect(await h.app.create(command, h.context)).toMatchObject({
    action: "CREATED",
  });
  const commit = h.state().commits[0]!;
  const events = h.state().events;
  expect(events).toHaveLength(commit.items.length);
  expect(events[0]).toMatchObject({
    operation: "APPEND_OUTBOX_EVENT",
    aggregateVersion: 1,
    primarySubjectId: commit.items[0]!.fulfillmentId,
    secondarySubjectId: commit.orderId,
    market: h.state().current.cart.market,
    currency: h.state().current.cart.currency,
    event: {
      eventType: "FULFILLMENT_STATUS_CHANGED",
      aggregateId: commit.items[0]!.fulfillmentId,
      requestId: commit.requestId,
      correlationId: commit.correlationId,
      occurredAt: h.state().current.evaluatedAt,
      payload: {
        fulfillmentId: commit.items[0]!.fulfillmentId,
        orderId: commit.orderId,
        status: "PENDING",
      },
    },
  });
  expect(JSON.stringify(events)).not.toMatch(
    /email|supportIntentId|objectKey|fulfillmentProfileId/u,
  );
  expect(await h.app.create(command, h.context)).toMatchObject({
    action: "REPLAYED",
  });
  expect(h.state().events).toHaveLength(commit.items.length);
});

test("a missing durable fulfillment event aborts the complete order and its retry receipt", async () => {
  const h = checkoutHarness();
  const command = await h.prepare();
  h.repos.outbox.append.mockRejectedValueOnce(new Error("TEST outbox failure"));
  expect(await h.app.create(command, h.context)).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
  expect(h.state().commits).toHaveLength(0);
  expect(h.state().events).toHaveLength(0);
  expect(h.state().current.cart.status).toBe("ACTIVE");
  expect(Object.keys(h.state().receipts)).toHaveLength(1);
});
