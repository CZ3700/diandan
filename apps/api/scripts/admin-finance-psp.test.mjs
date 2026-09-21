import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { URL } from "node:url";
import test from "node:test";
import {
  SUPPORTED_LOCALES,
  paymentPortResponseMatchesCommand,
} from "@fan-support/contracts";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import { createPaymentTestDatabase } from "./payment-runtime-psp-database.mjs";
import { createPaymentTestPspStore } from "./payment-runtime-psp-store.mjs";

test("persistent TEST PSP preserves refund identity and occupied capacity through concurrency and restart", async () => {
  await withEphemeralPostgres(async (database) => {
    const owned = await createPaymentTestDatabase(database);
    const attemptId = randomUUID(),
      providerAccountId = randomUUID();
    const binding = {
      schemaVersion: 1,
      providerAccountId,
      providerCode: "fake",
      environment: "TEST",
      localeMapping: Object.fromEntries(
        SUPPORTED_LOCALES.map((locale) => [
          locale,
          { providerLocale: locale, fallbackUsed: false },
        ]),
      ),
      allowedActionOrigins: ["https://payments.example.invalid"],
    };
    const options = {
      database: owned.database,
      binding,
      origin: "https://payments.example.invalid",
      returnOrigin: "https://shop.example.invalid",
      secret: randomBytes(32),
    };
    let store;
    try {
      store = await createPaymentTestPspStore(options);
      const created = await store.execute({
        schemaVersion: 1,
        operation: "CREATE_PAYMENT",
        providerAccountId,
        environment: "TEST",
        attemptId,
        orderId: randomUUID(),
        paymentMethod: "fake_card",
        amountMinor: 1500,
        currency: "USD",
        requestedLocale: "en",
        merchantReference: attemptId,
        providerIdempotencyKey: attemptId,
        returnUrl: "https://shop.example.invalid/en/checkout/return",
        cancelUrl: "https://shop.example.invalid/en/checkout/return",
      });
      const url = new URL(created.value.action.url),
        [, , hostedId, token] = url.pathname.split("/");
      const refundId = randomUUID();
      const command = {
        schemaVersion: 1,
        operation: "REFUND_PAYMENT",
        providerAccountId,
        environment: "TEST",
        refundId,
        paymentAttemptId: attemptId,
        externalReference: created.value.externalReference,
        refundReference: `refund/${refundId}`,
        amountMinor: 900,
        currency: "USD",
        idempotencyKey: refundId,
      };
      assert.equal(
        (await store.execute(command)).outcome,
        "FAILURE",
        "uncaptured cannot refund",
      );
      await store.settleHosted(hostedId, token, "SUCCEEDED");
      const [first, replay] = await Promise.all([
        store.execute(command),
        store.execute(command),
      ]);
      console.log({
        stage: "refund-create",
        outcome: first.outcome,
        code: first.error?.code,
      });
      assert.equal(first.outcome, "SUCCESS");
      assert.equal(first.value.status, "PROCESSING");
      assert.deepEqual(replay, first);
      assert.ok(paymentPortResponseMatchesCommand(command, first));
      assert.equal(
        (await store.execute({ ...command, amountMinor: 901 })).error.code,
        "IDEMPOTENCY_CONFLICT",
      );
      const other = randomUUID();
      assert.equal(
        (
          await store.execute({
            ...command,
            refundId: other,
            idempotencyKey: other,
            refundReference: `refund/${other}`,
            amountMinor: 601,
          })
        ).outcome,
        "FAILURE",
        "pending reserves amount",
      );
      await store.close();
      store = await createPaymentTestPspStore(options);
      assert.deepEqual(
        await store.execute(command),
        first,
        "restart replays first immutable receipt",
      );
      const query = {
        ...command,
        operation: "RECONCILE_REFUND",
        auditLogId: randomUUID(),
      };
      const pending = await store.execute(query);
      assert.equal(pending.value.event.status, "PROCESSING");
      assert.ok(paymentPortResponseMatchesCommand(query, pending));
      await store.settleRefund(refundId, "SUCCEEDED");
      const success = await store.execute({
        ...query,
        auditLogId: randomUUID(),
      });
      assert.equal(success.value.event.status, "SUCCEEDED");
      assert.equal(success.value.event.transaction.type, "REFUND");
      const again = await store.execute({ ...query, auditLogId: randomUUID() });
      assert.equal(
        again.value.event.providerEventId,
        success.value.event.providerEventId,
      );
      assert.equal(
        again.value.event.occurredAt,
        success.value.event.occurredAt,
      );
      assert.equal(
        again.value.event.transaction.providerReference,
        success.value.event.transaction.providerReference,
      );
      assert.notEqual(
        again.value.event.evidence.auditLogId,
        success.value.event.evidence.auditLogId,
      );
      const final = randomUUID(),
        finalCommand = {
          ...command,
          refundId: final,
          idempotencyKey: final,
          refundReference: `refund/${final}`,
          amountMinor: 600,
        };
      assert.equal((await store.execute(finalCommand)).outcome, "SUCCESS");
      await store.settleRefund(final, "FAILED");
      const replacement = randomUUID();
      assert.equal(
        (
          await store.execute({
            ...finalCommand,
            refundId: replacement,
            idempotencyKey: replacement,
            refundReference: `refund/${replacement}`,
          })
        ).outcome,
        "SUCCESS",
        "verified failure releases PSP capacity",
      );
      assert.equal(
        (await store.readRefundWebhook(refundId)).resource.transaction.kind,
        "refund",
      );
      assert.equal((await store.counts()).refunds, 3);
      await assert.rejects(
        store.settleRefund(refundId, "FAILED"),
        "terminal cannot change",
      );
      assert.equal(
        (await store.execute({ ...query, currency: "EUR" })).outcome,
        "FAILURE",
      );
    } finally {
      await store?.close();
      options.secret.fill(0);
      await owned.close();
    }
  });
});
