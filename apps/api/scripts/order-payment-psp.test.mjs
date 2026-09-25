import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { URL, URLSearchParams } from "node:url";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createFakePaymentWebhookVerifier } from "@fan-support/payment-fake";
import { createPersistentTestPaymentProvider } from "@fan-support/payment-fake/persistent-http";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import { createPaymentTestDatabase } from "./payment-runtime-psp-database.mjs";
import { startPaymentTestPspProcess } from "./payment-runtime-psp-process.mjs";
import { createPaymentTestTls } from "./payment-runtime-tls.mjs";

test("independent TEST PSP signs only its persistent payment observation and preserves capture identity across restart", async () => {
  let assertionFailure;
  await withEphemeralPostgres(async (database) => {
    const owned = await createPaymentTestDatabase(database);
    const tls = await createPaymentTestTls();
    const account = randomUUID(),
      attempt = randomUUID(),
      endpoint = randomUUID();
    const authorizationToken = randomBytes(32).toString("base64url");
    const verificationSecret = randomBytes(32);
    const keyHash = createHash("sha256")
      .update("secret-ref:v1:test:p405/webhook")
      .digest("hex");
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
      assert.equal(
        typeof psp.webhook,
        "function",
        "TEST PSP must expose authenticated source-owned webhook observations over owned IPC",
      );
      const adapter = createPersistentTestPaymentProvider({
        binding: psp.binding,
        endpointOrigin: psp.origin,
        returnOrigin: options.returnOrigin,
        authorizationToken,
        fetcher: tls.fetcher,
      });
      const command = {
        schemaVersion: 1,
        operation: "CREATE_PAYMENT",
        providerAccountId: account,
        environment: "TEST",
        attemptId: attempt,
        orderId: randomUUID(),
        paymentMethod: "fake_card",
        amountMinor: 1500,
        currency: "USD",
        requestedLocale: "ja",
        merchantReference: attempt,
        providerIdempotencyKey: attempt,
        returnUrl: `${options.returnOrigin}/ja/checkout/return?session=${randomUUID()}&attempt=${attempt}`,
        cancelUrl: `${options.returnOrigin}/ja/checkout/return?session=${randomUUID()}&attempt=${attempt}`,
      };
      const created = await adapter.createPayment(command);
      assert.equal(created.outcome, "SUCCESS");
      assert.equal(
        typeof psp.hostedAction,
        "function",
        "Owned TEST PSP can return its existing hosted action after an API response loss",
      );
      assert.deepEqual(await psp.hostedAction(attempt), created.value.action);
      const read = () =>
        psp.webhook({
          attemptId: attempt,
          verificationSecret: verificationSecret.toString("base64url"),
        });
      const initial = await read();
      assert.equal(
        JSON.parse(initial.rawBody).resource.state,
        "requires_action",
      );
      assert.equal(JSON.parse(initial.rawBody).resource.transaction, undefined);
      await assert.rejects(
        psp.webhook({
          attemptId: randomUUID(),
          verificationSecret: verificationSecret.toString("base64url"),
        }),
      );
      await assert.rejects(
        psp.webhook({ attemptId: attempt, verificationSecret: "bad" }),
      );
      await assert.rejects(
        psp.webhook({
          attemptId: attempt,
          verificationSecret: verificationSecret.toString("base64url"),
          status: "SUCCEEDED",
        }),
      );
      const page = await tls.fetcher(created.value.action.url);
      const csrf = /name="csrf" value="([A-Za-z0-9_-]+)"/u.exec(
        await page.text(),
      )?.[1];
      assert.ok(csrf);
      const capture = await tls.fetcher(created.value.action.url, {
        method: "POST",
        headers: {
          origin: psp.origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrf, outcome: "SUCCEEDED" }).toString(),
      });
      assert.equal(capture.status, 303);
      const signed = await read();
      const raw = JSON.parse(signed.rawBody);
      assert.equal(raw.resource.state, "captured");
      const reconciled = await adapter.reconcilePayment({
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
      assert.notEqual(raw.event_id, reconciled.value.event.providerEventId);
      assert.equal(
        raw.resource.transaction.reference,
        reconciled.value.event.transaction.providerReference,
      );
      assert.equal(raw.created_at, reconciled.value.event.occurredAt);
      const verifier = createFakePaymentWebhookVerifier({
        endpointId: endpoint,
        providerAccountId: account,
        environment: "TEST",
        verificationKeyReferenceHash: keyHash,
        verificationSecret,
      });
      const verifyCommand = {
        schemaVersion: 1,
        operation: "VERIFY_PAYMENT_WEBHOOK",
        endpointId: endpoint,
        providerAccountId: account,
        environment: "TEST",
        verificationKeyReferenceHash: keyHash,
        headers: signed.headers,
        rawBodyBase64: Buffer.from(signed.rawBody).toString("base64url"),
        receivedAt: new Date().toISOString(),
      };
      const verified = await verifier.verifyPaymentWebhook(verifyCommand);
      assert.equal(verified.outcome, "SUCCESS");
      assert.equal(verified.value.candidate.status, "SUCCEEDED");
      const tampered = await verifier.verifyPaymentWebhook({
        ...verifyCommand,
        rawBodyBase64: Buffer.from(signed.rawBody + " ").toString("base64url"),
      });
      assert.equal(tampered.error.code, "INVALID_SIGNATURE");
      const port = Number(new URL(psp.origin).port);
      await psp.close();
      psp = await startPaymentTestPspProcess({ ...options, port });
      assert.equal((await read()).rawBody, signed.rawBody);
      assert.equal((await psp.counts()).captures, 1);
    } catch (error) {
      if (error?.name === "AssertionError") assertionFailure = error;
      throw error;
    } finally {
      await psp?.close();
      verificationSecret.fill(0);
      await tls.close();
      await owned.close();
    }
  }).catch((error) => {
    throw assertionFailure ?? error;
  });
});
