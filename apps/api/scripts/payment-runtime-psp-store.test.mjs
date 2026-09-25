import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { URL } from "node:url";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import { createPaymentTestDatabase } from "./payment-runtime-psp-database.mjs";
import { createPaymentTestPspStore } from "./payment-runtime-psp-store.mjs";

test("independent TEST PSP persists one acceptance across concurrent calls and process-owner replacement", async () => {
  await withEphemeralPostgres(async (database) => {
    const owned = await createPaymentTestDatabase(database);
    const account = randomUUID(),
      attempt = randomUUID(),
      order = randomUUID();
    const binding = {
      schemaVersion: 1,
      providerAccountId: account,
      providerCode: "fake",
      environment: "TEST",
      localeMapping: Object.fromEntries(
        SUPPORTED_LOCALES.map((locale) => [
          locale,
          { providerLocale: "en", fallbackUsed: locale !== "en" },
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
    const command = {
      schemaVersion: 1,
      operation: "CREATE_PAYMENT",
      providerAccountId: account,
      environment: "TEST",
      attemptId: attempt,
      orderId: order,
      paymentMethod: "fake_card",
      amountMinor: 1500,
      currency: "USD",
      requestedLocale: "ja",
      merchantReference: attempt,
      providerIdempotencyKey: attempt,
      returnUrl: `https://shop.example.invalid/ja/checkout/return?session=${randomUUID()}&attempt=${attempt}`,
      cancelUrl: `https://shop.example.invalid/ja/checkout/return?session=${randomUUID()}&attempt=${attempt}`,
    };
    let store;
    try {
      store = await createPaymentTestPspStore(options);
      const [one, two] = await Promise.all([
        store.execute(command),
        store.execute(command),
      ]);
      console.log(
        JSON.stringify({ stage: "INITIAL_CREATE", outcome: one.outcome }),
      );
      assert.equal(one.outcome, "SUCCESS");
      assert.deepEqual(two, one);
      assert.equal(one.value.providerLocale, "en");
      assert.equal(one.value.fallbackUsed, true);
      assert.equal((await store.counts()).payments, 1);
      assert.equal(
        (await store.execute({ ...command, amountMinor: 1501 })).error.code,
        "IDEMPOTENCY_CONFLICT",
      );
      await store.close();
      store = await createPaymentTestPspStore(options);
      assert.deepEqual(await store.execute(command), one);
      assert.equal((await store.counts()).payments, 1);
      const hosted = new URL(one.value.action.url);
      const [, , hostedId, token] = hosted.pathname.split("/");
      assert.equal(
        (await store.readHosted(hostedId, token)).status,
        "REQUIRES_ACTION",
      );
      await assert.rejects(store.readHosted(hostedId, "invalid"));
      const reconcileCommand = {
        schemaVersion: 1,
        operation: "RECONCILE_PAYMENT",
        providerAccountId: account,
        environment: "TEST",
        attemptId: attempt,
        merchantReference: attempt,
        providerIdempotencyKey: attempt,
        amountMinor: 1500,
        currency: "USD",
        auditLogId: randomUUID(),
      };
      await store.settleHosted(hostedId, token, "PROCESSING");
      const processing = await store.execute(reconcileCommand);
      await store.settleHosted(hostedId, token, "PROCESSING");
      const repeated = await store.execute({
        ...reconcileCommand,
        auditLogId: randomUUID(),
      });
      assert.equal(
        repeated.value.event.providerEventId,
        processing.value.event.providerEventId,
      );
      assert.equal(
        repeated.value.event.occurredAt,
        processing.value.event.occurredAt,
      );
      assert.notEqual(
        repeated.value.event.evidence.auditLogId,
        processing.value.event.evidence.auditLogId,
      );
      await store.settleHosted(hostedId, token, "SUCCEEDED");
      const reconciled = await store.execute({
        schemaVersion: 1,
        operation: "RECONCILE_PAYMENT",
        providerAccountId: account,
        environment: "TEST",
        attemptId: attempt,
        merchantReference: attempt,
        providerIdempotencyKey: attempt,
        amountMinor: 1500,
        currency: "USD",
        auditLogId: randomUUID(),
      });
      assert.equal(reconciled.outcome, "SUCCESS");
      assert.equal(reconciled.value.event.status, "SUCCEEDED");
      assert.equal(reconciled.value.event.transaction.type, "CAPTURE");
      assert.equal((await store.counts()).captures, 1);
      await store.settleHosted(hostedId, token, "SUCCEEDED");
      assert.equal((await store.counts()).captures, 1);
      const capturedAgain = await store.execute({
        ...reconcileCommand,
        auditLogId: randomUUID(),
      });
      assert.equal(
        capturedAgain.value.event.providerEventId,
        reconciled.value.event.providerEventId,
      );
      assert.equal(
        capturedAgain.value.event.occurredAt,
        reconciled.value.event.occurredAt,
      );
      const wrong = await store.execute({
        ...command,
        providerAccountId: randomUUID(),
      });
      assert.equal(wrong.outcome, "FAILURE");
    } finally {
      await store?.close();
      options.secret.fill(0);
      await owned.close();
    }
  });
});
