import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import test from "node:test";
import {
  SUPPORTED_LOCALES,
  paymentPortResponseMatchesCommand,
} from "@fan-support/contracts";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import { createPersistentTestPaymentProvider } from "@fan-support/payment-fake/persistent-http";
import { createPaymentTestDatabase } from "./payment-runtime-psp-database.mjs";
import { createPaymentTestTls } from "./payment-runtime-tls.mjs";
import { startPaymentTestPspProcess } from "./payment-runtime-psp-process.mjs";
test("independent authenticated TEST TLS PSP retains a refund after the accepted response is lost and its process restarts", async () => {
  await withEphemeralPostgres(async (database) => {
    const owned = await createPaymentTestDatabase(database),
      tls = await createPaymentTestTls();
    const account = randomUUID(),
      attempt = randomUUID(),
      authorizationToken = randomBytes(32).toString("base64url");
    const binding = {
      schemaVersion: 1,
      providerAccountId: account,
      providerCode: "fake",
      environment: "TEST",
      localeMapping: Object.fromEntries(
        SUPPORTED_LOCALES.map((locale) => [
          locale,
          { providerLocale: locale, fallbackUsed: false },
        ]),
      ),
      allowedActionOrigins: [],
    };
    const options = {
      database: owned.database,
      binding,
      returnOrigin: "https://storefront.example.invalid",
      authorizationToken,
      ...tls.certificates["payments.example.invalid"],
    };
    let psp;
    try {
      psp = await startPaymentTestPspProcess(options);
      const adapter = () =>
        createPersistentTestPaymentProvider({
          binding: psp.binding,
          endpointOrigin: psp.origin,
          returnOrigin: options.returnOrigin,
          authorizationToken,
          fetcher: tls.fetcher,
        });
      const created = await adapter().createPayment({
        schemaVersion: 1,
        operation: "CREATE_PAYMENT",
        providerAccountId: account,
        environment: "TEST",
        attemptId: attempt,
        orderId: randomUUID(),
        paymentMethod: "fake_card",
        amountMinor: 1500,
        currency: "USD",
        requestedLocale: "en",
        merchantReference: attempt,
        providerIdempotencyKey: attempt,
        returnUrl: `${options.returnOrigin}/en/checkout/return`,
        cancelUrl: `${options.returnOrigin}/en/checkout/return`,
      });
      assert.equal(created.outcome, "SUCCESS");
      const action = created.value.action.url,
        page = await tls.fetcher(action),
        csrf = /name="csrf" value="([A-Za-z0-9_-]+)"/u.exec(
          await page.text(),
        )[1];
      assert.equal(
        (
          await tls.fetcher(action, {
            method: "POST",
            headers: {
              origin: psp.origin,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              csrf,
              outcome: "SUCCEEDED",
            }).toString(),
          })
        ).status,
        303,
      );
      const refundId = randomUUID(),
        command = {
          schemaVersion: 1,
          operation: "REFUND_PAYMENT",
          providerAccountId: account,
          environment: "TEST",
          refundId,
          paymentAttemptId: attempt,
          externalReference: created.value.externalReference,
          refundReference: `refund/${refundId}`,
          amountMinor: 900,
          currency: "USD",
          idempotencyKey: refundId,
        };
      await psp.arm({ operation: "REFUND_PAYMENT", mode: "AFTER" });
      const lost = await adapter().refundPayment(command);
      assert.equal(lost.outcome, "FAILURE");
      assert.equal(lost.error.recovery, "RECONCILE_REQUIRED");
      assert.equal((await psp.counts()).refunds, 1);
      const acceptedCounts = await psp.counts();
      if (acceptedCounts.refundCalls !== 1)
        console.error(
          JSON.stringify({
            scenario: "accepted-refund-call-count",
            actual: acceptedCounts.refundCalls ?? null,
            expected: 1,
          }),
        );
      assert.equal(acceptedCounts.refundCalls, 1);
      const port = Number(new URL(psp.origin).port),
        previousPid = psp.pid;
      await psp.close();
      psp = await startPaymentTestPspProcess({ ...options, port });
      assert.notEqual(psp.pid, previousPid);
      const query = {
        ...command,
        operation: "RECONCILE_REFUND",
        auditLogId: randomUUID(),
      };
      const pending = await adapter().reconcileRefund(query);
      assert.ok(paymentPortResponseMatchesCommand(query, pending));
      assert.equal(pending.value.event.status, "PROCESSING");
      await psp.settleRefund({ refundId, status: "SUCCEEDED" });
      const confirmed = await adapter().reconcileRefund({
        ...query,
        auditLogId: randomUUID(),
      });
      assert.equal(confirmed.value.event.status, "SUCCEEDED");
      assert.equal(confirmed.value.event.transaction.type, "REFUND");
      assert.equal(
        (await psp.counts()).refundCalls,
        1,
        "recovery performs no additional refund request",
      );
      assert.equal((await psp.counts()).reconcileRefundCalls, 2);
      const signed = await psp.webhook({
        refundId,
        verificationSecret: randomBytes(32).toString("base64url"),
      });
      assert.equal(
        JSON.parse(signed.rawBody).resource.transaction.reference,
        confirmed.value.event.transaction.providerReference,
      );
      assert.equal(
        (await adapter().refundPayment(command)).value.status,
        "PROCESSING",
        "first acceptance is immutable even after completion",
      );
      assert.equal((await psp.counts()).refunds, 1);
    } finally {
      await psp?.close();
      await tls.close();
      await owned.close();
    }
  });
});
