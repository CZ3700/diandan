import assert from "node:assert/strict";
import process from "node:process";
import { URL, URLSearchParams } from "node:url";
import {
  randomBytes,
  randomUUID,
  createHash,
  X509Certificate,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import test from "node:test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import { createPersistentTestPaymentProvider } from "@fan-support/payment-fake/persistent-http";
import { createPaymentTestDatabase } from "./payment-runtime-psp-database.mjs";
import { createPaymentTestTls } from "./payment-runtime-tls.mjs";
import { startPaymentTestPspProcess } from "./payment-runtime-psp-process.mjs";

test("real authenticated HTTPS preserves acceptance after lost response/restart and hosted return never invents PSP capture", async () => {
  await withEphemeralPostgres(async (database) => {
    const owned = await createPaymentTestDatabase(database),
      tls = await createPaymentTestTls();
    const authorizationToken = randomBytes(32).toString("base64url"),
      account = randomUUID(),
      attempt = randomUUID();
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
      returnUrl: `https://storefront.example.invalid/ja/checkout/return?session=${randomUUID()}&attempt=${attempt}`,
      cancelUrl: `https://storefront.example.invalid/ja/checkout/return?session=${randomUUID()}&attempt=${attempt}`,
    };
    let psp;
    try {
      psp = await startPaymentTestPspProcess(options);
      assert.notEqual(psp.pid, process.pid);
      const firstPid = psp.pid;
      const adapter = () =>
        createPersistentTestPaymentProvider({
          binding: psp.binding,
          endpointOrigin: psp.origin,
          returnOrigin: options.returnOrigin,
          authorizationToken,
          fetcher: tls.fetcher,
        });
      await psp.arm({ operation: "CREATE_PAYMENT", mode: "AFTER" });
      const lost = await adapter().createPayment(command);
      assert.equal(lost.outcome, "FAILURE");
      assert.equal(lost.error.recovery, "RECONCILE_REQUIRED");
      assert.equal((await psp.counts()).payments, 1);
      const port = Number(new URL(psp.origin).port);
      await psp.close();
      psp = await startPaymentTestPspProcess({ ...options, port });
      assert.notEqual(psp.pid, firstPid);
      const reconcile = {
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
      const observed = await adapter().reconcilePayment(reconcile);
      assert.equal(observed.outcome, "SUCCESS");
      assert.equal(observed.value.event.status, "REQUIRES_ACTION");
      assert.equal((await psp.counts()).captures, 0);
      const payment = await adapter().getPayment({
        schemaVersion: 1,
        operation: "GET_PAYMENT",
        providerAccountId: account,
        environment: "TEST",
        attemptId: attempt,
        externalReference: observed.value.event.association.externalReference,
      });
      assert.equal(payment.outcome, "SUCCESS");
      const hosted = await tls.fetcher(payment.value.action.url);
      assert.equal(hosted.status, 200);
      assert.equal(hosted.headers.get("referrer-policy"), "strict-origin");
      const html = await hosted.text();
      assert.match(html, /TEST payment/);
      assert.doesNotMatch(html, /type="(?:email|password)"|card.number|CVV/iu);
      const csrf = /name="csrf" value="([A-Za-z0-9_-]+)"/u.exec(html)[1];
      const rejected = await tls.fetcher(payment.value.action.url, {
        method: "POST",
        headers: {
          origin: "https://untrusted.example.invalid",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrf, outcome: "SUCCEEDED" }).toString(),
      });
      assert.equal(rejected.status, 403);
      assert.equal((await psp.counts()).captures, 0);
      const pin = createHash("sha256")
        .update(
          new X509Certificate(
            await readFile(options.certificatePath),
          ).publicKey.export({ type: "spki", format: "der" }),
        )
        .digest("base64");
      const browser = await chromium.launch({
        channel: "chrome",
        headless: true,
        args: [
          `--ignore-certificate-errors-spki-list=${pin}`,
          "--host-resolver-rules=MAP payments.example.invalid 127.0.0.1",
          "--no-proxy-server",
        ],
      });
      try {
        const page = await browser.newPage();
        page.on("console", (entry) => {
          if (entry.type() === "error")
            console.log(
              JSON.stringify({
                nativeConsole: true,
                cspFormAction: entry.text().includes("form-action"),
                blocked: entry.text().includes("violates"),
              }),
            );
        });
        await page.goto(payment.value.action.url);
        const responsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).origin === psp.origin,
          { timeout: 5000 },
        );
        page.on("requestfailed", (request) => {
          if (request.method() === "POST")
            console.log(
              JSON.stringify({
                nativePostFailed: true,
                cspBlocked:
                  request.failure()?.errorText === "net::ERR_BLOCKED_BY_CSP",
              }),
            );
        });
        await page
          .locator("[data-test-psp-capture]")
          .click({ noWaitAfter: true });
        const nativeResponse = await responsePromise;
        const nativeHeaders = await nativeResponse.request().allHeaders();
        console.log(
          JSON.stringify({
            nativeHostedForm: true,
            status: nativeResponse.status(),
            originMatches: nativeHeaders.origin === psp.origin,
            originIsNull: nativeHeaders.origin === "null",
            referrerContainsPath: Boolean(
              nativeHeaders.referer &&
              new URL(nativeHeaders.referer).pathname !== "/",
            ),
          }),
        );
        assert.equal(nativeResponse.status(), 303);
        assert.equal(nativeHeaders.origin, psp.origin);
        assert.ok(
          !nativeHeaders.referer ||
            new URL(nativeHeaders.referer).href === psp.origin + "/",
        );
      } catch (error) {
        console.log(
          JSON.stringify({
            nativeProbeFailure: true,
            captures: (await psp.counts()).captures,
          }),
        );
        throw error;
      } finally {
        await browser.close();
      }
      const completed = await tls.fetcher(payment.value.action.url, {
        method: "POST",
        headers: {
          origin: psp.origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrf, outcome: "SUCCEEDED" }).toString(),
      });
      assert.equal(completed.status, 303);
      assert.equal(completed.headers.get("location"), command.returnUrl);
      const captured = await adapter().reconcilePayment({
        ...reconcile,
        auditLogId: randomUUID(),
      });
      assert.equal(captured.outcome, "SUCCESS");
      assert.equal(captured.value.event.status, "SUCCEEDED");
      assert.equal(captured.value.event.transaction.type, "CAPTURE");
      assert.equal((await psp.counts()).captures, 1);
      const expiringAttempt = randomUUID();
      const expiring = await adapter().createPayment({
        ...command,
        attemptId: expiringAttempt,
        merchantReference: expiringAttempt,
        providerIdempotencyKey: expiringAttempt,
        returnUrl: command.returnUrl.replace(attempt, expiringAttempt),
        cancelUrl: command.cancelUrl.replace(attempt, expiringAttempt),
      });
      assert.equal(expiring.outcome, "SUCCESS");
      const expiredPage = await tls.fetcher(expiring.value.action.url);
      const expiredHtml = await expiredPage.text();
      const expiredCsrf = /name="csrf" value="([A-Za-z0-9_-]+)"/u.exec(
        expiredHtml,
      )[1];
      const expiredResponse = await tls.fetcher(expiring.value.action.url, {
        method: "POST",
        headers: {
          origin: psp.origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          csrf: expiredCsrf,
          outcome: "EXPIRED",
        }).toString(),
      });
      console.log(
        JSON.stringify({
          nativeExpiredOutcome: true,
          status: expiredResponse.status,
        }),
      );
      assert.equal(
        expiredResponse.status,
        303,
        "owned TEST PSP accepts its native simulated expiry outcome",
      );
      assert.match(expiredHtml, /data-test-psp-expire/u);
      const expiredObservation = await adapter().reconcilePayment({
        ...reconcile,
        attemptId: expiringAttempt,
        merchantReference: expiringAttempt,
        providerIdempotencyKey: expiringAttempt,
        auditLogId: randomUUID(),
      });
      assert.equal(expiredObservation.outcome, "SUCCESS");
      assert.equal(expiredObservation.value.event.status, "EXPIRED");
      const expiredWebhook = await psp.webhook({
        attemptId: expiringAttempt,
        verificationSecret: randomBytes(32).toString("base64url"),
      });
      assert.equal(
        JSON.parse(expiredWebhook.rawBody).resource.state,
        "expired",
      );
      assert.equal(
        JSON.parse(expiredWebhook.rawBody).resource.transaction,
        undefined,
      );
      assert.equal(
        (await psp.counts()).captures,
        1,
        "provider expiry never creates a capture",
      );
      assert.equal(
        (await psp.observations()).some((entry) => entry.unexpectedCredentials),
        false,
      );
      const unauthenticated = await tls.fetcher(psp.origin + "/v1/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      assert.equal(unauthenticated.status, 401);
      await assert.rejects(
        tls.fetcher("https://unapproved.example.invalid/test"),
      );
    } finally {
      await psp?.close();
      await tls.close();
      await owned.close();
    }
  });
});
