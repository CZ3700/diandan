import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createGatewayPaymentProvider } from "@fan-support/payment-gateway";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import { withNativeFinancePostgres } from "./admin-finance-native-postgres.mjs";
import { createPaymentTestDatabase } from "./payment-runtime-psp-database.mjs";
import { createPaymentTestTls } from "./payment-runtime-tls.mjs";
import { startPaymentTestPspProcess } from "./payment-runtime-psp-process.mjs";
import { testPaymentConnection } from "./admin-payment-config-connectors.mjs";
test("real normalized gateway reaches the independent authenticated TLS PSP ledger with durable idempotency", async () => {
  const run = async (database) => {
    const owned = await createPaymentTestDatabase(database),
      tls = await createPaymentTestTls();
    let psp,
      stage = "setup";
    try {
      const authorizationToken = randomBytes(32).toString("base64url"),
        binding = {
          schemaVersion: 1,
          providerAccountId: randomUUID(),
          providerCode: "normalized-gateway",
          environment: "TEST",
          localeMapping: Object.fromEntries(
            SUPPORTED_LOCALES.map((locale) => [
              locale,
              { providerLocale: "en", fallbackUsed: locale !== "en" },
            ]),
          ),
          allowedActionOrigins: [],
        };
      const deployment = {
        authorizationToken,
        binding,
        endpointOrigin: "https://payments.example.invalid",
        returnOrigin: "https://storefront.example.invalid",
        merchantAccount: "owned-normalized-test",
      };
      const initial = testPaymentConnection(deployment, true);
      const options = {
        database: owned.database,
        binding,
        authorizationToken,
        returnOrigin: deployment.returnOrigin,
        normalizedGateway: {
          merchantAccount: deployment.merchantAccount,
          instruments: initial.instruments,
        },
        ...tls.certificates["payments.example.invalid"],
      };
      stage = "start-psp";
      psp = await startPaymentTestPspProcess(options);
      const connection = testPaymentConnection(
        { ...deployment, binding: psp.binding, endpointOrigin: psp.origin },
        true,
      );
      const adapter = createGatewayPaymentProvider({
        connection,
        fetcher: tls.fetcher,
        credentials: {
          resolve: async (input) => ({
            ...input,
            version: "owned-test",
            values: [authorizationToken],
          }),
        },
      });
      const attemptId = randomUUID();
      const command = {
        schemaVersion: 1,
        operation: "CREATE_PAYMENT",
        providerAccountId: binding.providerAccountId,
        environment: "TEST",
        attemptId,
        orderId: randomUUID(),
        paymentMethod: "fake_card",
        amountMinor: 100,
        currency: "USD",
        requestedLocale: "en",
        merchantReference: attemptId,
        providerIdempotencyKey: attemptId,
        returnUrl: `${deployment.returnOrigin}/en/checkout/return`,
        cancelUrl: `${deployment.returnOrigin}/en/checkout/return`,
      };
      await psp.arm({ operation: "CREATE_PAYMENT", mode: "AFTER" });
      stage = "lost-create";
      const unknown = await adapter.createPayment(command);
      assert.equal(unknown.outcome, "FAILURE");
      assert.equal(unknown.error.recovery, "RECONCILE_REQUIRED");
      stage = "accepted-ledger";
      assert.equal((await psp.counts()).payments, 1);
      stage = "replay";
      const replay = await adapter.createPayment(command);
      assert.equal(replay.outcome, "SUCCESS");
      assert.equal((await psp.counts()).payments, 1);
      stage = "reconcile";
      const query = await adapter.reconcilePayment({
        schemaVersion: 1,
        operation: "RECONCILE_PAYMENT",
        providerAccountId: binding.providerAccountId,
        environment: "TEST",
        attemptId,
        merchantReference: attemptId,
        providerIdempotencyKey: attemptId,
        amountMinor: 100,
        currency: "USD",
        auditLogId: randomUUID(),
      });
      assert.equal(query.outcome, "SUCCESS");
      assert.equal(query.value.event.status, "REQUIRES_ACTION");
      const invalid = await tls.fetcher(`${psp.origin}/v1/payment-commands`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${authorizationToken}`,
          "content-type": "application/json",
          "idempotency-key": attemptId,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          protocol: "fan-support-gateway-v1",
          merchantAccount: "wrong-account",
          command,
          instrument: connection.instruments[0],
        }),
      });
      assert.notEqual(invalid.status, 200);
      assert.equal((await psp.counts()).payments, 1);
    } catch (error) {
      console.error(
        JSON.stringify({
          stage,
          name: error?.name,
          code: error?.code,
          actual:
            typeof error?.actual === "string" &&
            /^[A-Z_]{1,64}$/u.test(error.actual)
              ? error.actual
              : typeof error?.actual === "number"
                ? error.actual
                : null,
          expected:
            typeof error?.expected === "string" &&
            /^[A-Z_]{1,64}$/u.test(error.expected)
              ? error.expected
              : typeof error?.expected === "number"
                ? error.expected
                : null,
        }),
      );
      throw error;
    } finally {
      await psp?.close();
      await tls.close();
      await owned.close();
    }
  };
  if (process.env.ADMIN_PAYMENT_CONFIG_TEST_POSTGRES_BIN)
    await withNativeFinancePostgres(run, {
      binDirectory: process.env.ADMIN_PAYMENT_CONFIG_TEST_POSTGRES_BIN,
    });
  else await withEphemeralPostgres(run);
});
