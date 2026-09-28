import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  SUPPORTED_LOCALES,
  checkoutPreflightResponseSchema,
  paymentRuntimeResponseSchema,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n";
import { observePaymentBrowserCart } from "./payment-runtime-browser-observer.mjs";
import { switchHeaderLocale } from "./regression-journey-browser.mjs";

/** Owns Chrome only. The caller owns the compiled Next and withOrderAccessFixture lifecycle. */
export async function verifyPaymentActionRecoveryBrowser(context) {
  const { origin, psp, fixtures, client, check, gateway, tls } = context;
  if (
    new globalThis.URL(origin).hostname !== "storefront.example.invalid" ||
    new globalThis.URL(origin).protocol !== "https:" ||
    new globalThis.URL(psp.origin).hostname !== "payments.example.invalid" ||
    new globalThis.URL(psp.origin).protocol !== "https:" ||
    context.paymentActionTtlMs !== 5000 ||
    ![
      context.signWebhook,
      context.sendWebhook,
      context.createOrderWorker,
    ].every((value) => typeof value === "function")
  )
    throw new Error("RECOVERY_BROWSER_REQUIRES_OWNED_TEST_FIXTURE");
  const output = path.join(context.output, "action-recovery-browser");
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    actualProductionNext: true,
    actualPostgres: true,
    actualOwnedTlsPsp: true,
    actualExternalPsp: false,
    physicalDeviceEvidence: false,
    humanTranslationReview: false,
    paymentActionTtlMs: context.paymentActionTtlMs,
    cases: [],
    axe: [],
    screenshots: [],
    privacyChecks: [],
    pageErrors: 0,
    cartResponses: [],
    browserClosed: false,
    workerStopped: false,
    privatePlaintextPersisted: false,
  };
  const save = () =>
    writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const pins = await Promise.all(
    [
      gateway.certificatePath,
      ...Object.values(tls.certificates).map((v) => v.certificatePath),
    ].map(async (file) =>
      createHash("sha256")
        .update(
          new X509Certificate(await readFile(file)).publicKey.export({
            type: "spki",
            format: "der",
          }),
        )
        .digest("base64"),
    ),
  );
  const require = createRequire(
    new globalThis.URL("../../../package.json", import.meta.url),
  );
  const { default: AxeBuilder } = require("@axe-core/playwright");
  let browser,
    worker,
    stage = "START";
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [
        `--ignore-certificate-errors-spki-list=${pins.join(",")}`,
        "--host-resolver-rules=MAP media.example.invalid 127.0.0.1,MAP storefront.example.invalid 127.0.0.1,MAP payments.example.invalid 127.0.0.1",
        "--no-proxy-server",
      ],
    });
    report.browserVersion = browser.version();
    worker = await context.createOrderWorker();
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      for (const locale of SUPPORTED_LOCALES) {
        const name = `${locale}-${viewport.width}`;
        stage = `${name}:CHECKOUT`;
        context.progress?.(`action recovery browser ${name}`);
        const owned = await browser.newContext({
          viewport,
          reducedMotion: "reduce",
        });
        let observer;
        const copy = await loadStorefrontCopy(locale);
        const email = `recovery-${randomUUID()}@example.invalid`;
        const secrets = new Map([[email, "EMAIL"]]);
        const requestKeys = [];
        let routeFailure = false,
          dropped = false;
        try {
          const page = await owned.newPage();
          page.setDefaultTimeout(20_000);
          page.on("pageerror", () => {
            report.pageErrors++;
          });
          page.on("request", (request) => {
            if (
              request.url().startsWith(origin + "/api/storefront/checkout/") &&
              request.method() === "POST"
            ) {
              const headers = request.headers();
              for (const key of ["x-csrf-token", "cookie"])
                if (headers[key])
                  secrets.set(
                    headers[key],
                    key === "cookie" ? "COOKIE_HEADER" : "CSRF",
                  );
              if (request.url().endsWith("/recover")) {
                const key = headers["idempotency-key"];
                requestKeys.push(
                  key ? createHash("sha256").update(key).digest("hex") : null,
                );
              }
            }
          });
          observer = observePaymentBrowserCart({
            page,
            origin,
            accept: (value) => report.cartResponses.push({ name, ...value }),
          });
          const responsePost = async (
            suffix,
            action,
            schema = paymentRuntimeResponseSchema,
          ) => {
            const waiting = page.waitForResponse(
              (response) =>
                new globalThis.URL(response.url()).pathname === suffix &&
                response.request().method() === "POST",
            );
            await action();
            const response = await waiting;
            const parsed = schema.safeParse(await response.json());
            check(
              response.status() === 200 &&
                parsed.success &&
                parsed.data.outcome === "SUCCESS",
              "Recovery browser receives a genuine schema-valid mutation result",
            );
            check(
              response.headers()["cache-control"] === "private, no-store",
              "Recovery mutation is private and uncached",
            );
            return parsed.data;
          };
          const capture = async (suffix, analyze = true) => {
            await page.evaluate(() => globalThis.scrollTo(0, 0));
            const credentialCookies = (await owned.cookies()).filter(
              ({ name: cookieName }) =>
                ["__Host-fan-cart", "__Host-fan-order"].includes(cookieName),
            );
            const values = [
              ...[...secrets].map(([value, kind]) => ({ value, kind })),
              ...credentialCookies.map((cookie) => ({
                value: cookie.value,
                kind: "CREDENTIAL_COOKIE",
                cookieName: cookie.name,
              })),
            ];
            const hits = await page.evaluate((canaries) => {
              const html = globalThis.document.documentElement.outerHTML;
              const storage = JSON.stringify([
                Object.entries(globalThis.localStorage),
                Object.entries(globalThis.sessionStorage),
              ]);
              return canaries.flatMap(({ value, kind, cookieName }) =>
                html.includes(value) || storage.includes(value)
                  ? [{ kind, ...(cookieName ? { cookieName } : {}) }]
                  : [],
              );
            }, values);
            report.privacyChecks.push({
              name: `${name}-${suffix}`,
              credentialCookieNames: credentialCookies.map(({ name }) => name),
              hits,
            });
            check(
              hits.length === 0,
              "No email, cookie or CSRF credential appears in rendered HTML or browser storage",
            );
            check(
              await page.evaluate(
                () =>
                  globalThis.document.documentElement.scrollWidth <=
                  globalThis.innerWidth + 1,
              ),
              "Recovery UI has no horizontal overflow",
            );
            const filename = `${name}-${suffix}.png`;
            await page.screenshot({
              path: path.join(output, filename),
              fullPage: true,
              mask: [page.locator("input,textarea")],
            });
            report.screenshots.push(filename);
            if (analyze) {
              const result = await new AxeBuilder({ page }).analyze();
              const safeEntries = (items) =>
                items.map(({ id, impact, nodes }) => ({
                  id,
                  impact,
                  targets: nodes.map(({ target }) => target),
                }));
              report.axe.push({
                name: `${name}-${suffix}`,
                violations: safeEntries(result.violations),
                incomplete: safeEntries(result.incomplete),
              });
              check(
                result.violations.length === 0,
                "Actual recovery page has zero axe violations",
              );
            }
          };
          const gift = fixtures.gifts[0];
          const giftResponse = await page.goto(
            `${origin}/${locale}/gifts/${gift.handle}?${new globalThis.URLSearchParams({ ...fixtures.markets[0], idol: fixtures.artists[0].id, variant: gift.variants[0].id })}`,
            { waitUntil: "networkidle" },
          );
          check(
            giftResponse?.status() === 200,
            "Recovery purchase starts from a real published gift",
          );
          await observer.settled();
          await page.locator("button[data-cart-add-state]").click();
          await expect(
            page.locator('[data-cart-add-state="confirmed"]'),
          ).toBeVisible();
          await observer.settled();
          await page.goto(`${origin}/${locale}/cart`, {
            waitUntil: "networkidle",
          });
          await observer.settled();
          await page.locator("[data-cart-checkout]").click();
          await page.locator("[data-checkout-email]").fill(email);
          for (const policy of await page
            .locator("[data-checkout-policy]")
            .all())
            await policy.check();
          const created = await responsePost(
            "/api/storefront/checkout/sessions",
            () => page.locator("[data-checkout-confirm]").click(),
            checkoutPreflightResponseSchema,
          );
          const sessionId = created.checkout.id;
          const beforeCreate = await psp.counts();
          const initial = await responsePost(
            `/api/storefront/checkout/sessions/${sessionId}/attempts`,
            () => page.locator("[data-payment-create]").first().click(),
          );
          let attemptId = initial.attempt.id;
          check(
            initial.attempt.status === "REQUIRES_ACTION" &&
              initial.attempt.environment === "TEST",
            "Real checkout creates a payable TEST attempt",
          );
          const afterCreate = await psp.counts();
          check(
            afterCreate.payments === beforeCreate.payments + 1 &&
              afterCreate.createCalls === beforeCreate.createCalls + 1,
            "Initial explicit payment creates exactly one PSP session",
          );
          const immutable = async () => {
            const { rows } = await client.query(
              "SELECT a.id,a.provider_account_id,a.amount_minor::text,a.currency,a.requested_locale,a.provider_locale,o.presentation_locale,o.checkout_session_id,o.total_amount_minor::text FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.id=$1::uuid",
              [attemptId],
            );
            return createHash("sha256")
              .update(JSON.stringify(rows))
              .digest("hex");
          };
          const frozen = await immutable();
          const waitExpired = async () => {
            await expect
              .poll(
                async () => {
                  const {
                    rows: [row],
                  } = await client.query(
                    "SELECT status='REQUIRES_ACTION' AND action_expires_at<=clock_timestamp() AS expired FROM payment_attempts WHERE id=$1::uuid",
                    [attemptId],
                  );
                  return row?.expired === true;
                },
                { timeout: 20_000, intervals: [100] },
              )
              .toBe(true);
          };
          stage = `${name}:EXPIRED`;
          await waitExpired();
          await page.reload({ waitUntil: "networkidle" });
          await expect(page.locator("[data-payment-recover]")).toHaveText(
            copy.checkoutResumePayment,
          );
          check(
            (await page
              .locator("[data-payment-continue], [data-payment-create]")
              .count()) === 0,
            "Expired action offers recovery without a new payment or stale continue link",
          );
          // Use the real locale menu, then return to the original UI language; frozen order language stays unchanged.
          const otherLocale = locale === "ja" ? "en" : "ja";
          for (const selected of [otherLocale, locale]) {
            await switchHeaderLocale(page, selected);
            await expect(page.locator("[data-payment-recover]")).toBeVisible();
          }
          check(
            (await immutable()) === frozen,
            "Reload and actual locale switching preserve frozen payment identity, locale, amount and currency",
          );
          const afterReads = await psp.counts();
          check(
            afterReads.payments === afterCreate.payments &&
              afterReads.createCalls === afterCreate.createCalls &&
              afterReads.reconcileCalls === afterCreate.reconcileCalls,
            "Reload and language switching only read; no PSP create or hidden recovery",
          );
          check(
            await page.evaluate(
              () =>
                globalThis.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches,
            ),
            "Recovery matrix uses the browser's actual reduced-motion preference",
          );
          await capture("expired");
          const recoveryPath = `/api/storefront/checkout/sessions/${sessionId}/attempts/${attemptId}/recover`;
          await expect
            .poll(
              async () => {
                const {
                  rows: [row],
                } = await client.query(
                  "SELECT next_attempt_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) AS ready FROM payment_runtime_operations WHERE attempt_id=$1::uuid",
                  [attemptId],
                );
                return row?.ready === true;
              },
              { timeout: 15_000, intervals: [100] },
            )
            .toBe(true);
          stage = `${name}:RECOVER`;
          const lostResponse = locale === "en" && viewport.width === 390;
          if (lostResponse) {
            await page.route(
              origin + recoveryPath,
              async (route) => {
                try {
                  // Forward the real browser request through the fixture CA/SAN verifier.
                  // Playwright route.fetch has a separate DNS/TLS stack from Chrome's pins.
                  const request = route.request();
                  const upstream = await tls.fetcher(request.url(), {
                    method: request.method(),
                    headers: await request.allHeaders(),
                    body: request.postData(),
                    signal: globalThis.AbortSignal.timeout(15_000),
                  });
                  const parsed = paymentRuntimeResponseSchema.safeParse(
                    await upstream.json(),
                  );
                  routeFailure =
                    upstream.status !== 200 ||
                    !parsed.success ||
                    parsed.data.outcome !== "SUCCESS";
                  dropped = true;
                  await route.abort("failed");
                } catch {
                  routeFailure = true;
                  await route.abort("failed").catch(() => undefined);
                }
              },
              { times: 1 },
            );
          }
          const resume = page.locator("[data-payment-recover]");
          await resume.focus();
          await page.keyboard.press("Tab");
          await page.keyboard.press("Shift+Tab");
          check(
            await resume.evaluate(
              (element) => element === globalThis.document.activeElement,
            ),
            "Keyboard returns to the actual recovery control",
          );
          check(
            await resume.evaluate((element) => {
              const style = globalThis.getComputedStyle(element);
              return (
                (style.outlineStyle !== "none" &&
                  Number.parseFloat(style.outlineWidth) > 0) ||
                style.boxShadow !== "none"
              );
            }),
            "Keyboard recovery focus is visibly rendered",
          );
          if (lostResponse) {
            await page.keyboard.press("Enter");
            await expect(page.locator("[data-checkout-error]")).toBeVisible();
            check(
              dropped && !routeFailure,
              "Only a genuine committed recovery response is discarded",
            );
            check(
              await page.locator("[data-payment-recover]").isDisabled(),
              "Uncertain committed response blocks a competing fresh recovery",
            );
            await capture("lost-response", false);
            await page.locator("[data-checkout-retry]").focus();
            await responsePost(recoveryPath, () =>
              page.keyboard.press("Enter"),
            );
            check(
              requestKeys.length === 2 &&
                requestKeys[0] !== null &&
                requestKeys[0] === requestKeys[1],
              "Uncertain response retries the exact original recovery idempotency key",
            );
          } else
            await responsePost(recoveryPath, () =>
              page.keyboard.press("Enter"),
            );
          await expect(page.locator("[data-payment-continue]")).toBeVisible();
          await expect
            .poll(() =>
              page
                .locator("[data-checkout-root]")
                .evaluate((element) =>
                  element.contains(globalThis.document.activeElement),
                ),
            )
            .toBe(true);
          check(
            true,
            "Recovery and uncertain-response keyboard retry keep focus inside checkout after replacing the activated control",
          );
          check(
            (await immutable()) === frozen,
            "Recovered action preserves the exact original attempt and order facts",
          );
          const recoveredCounts = await psp.counts();
          check(
            recoveredCounts.payments === afterCreate.payments &&
              recoveredCounts.createCalls === afterCreate.createCalls,
            "Recovery never creates another PSP payment",
          );
          // Do not run axe while the intentionally short renewed action is ticking.
          await page.locator("[data-payment-continue]").click();
          await page.waitForURL((url) => url.origin === psp.origin);
          check(
            await page.locator("[data-test-psp-capture]").isVisible(),
            "Explicit continue enters the same real owned HTTPS payment page",
          );
          check(
            (await page.locator('input:not([type="hidden"])').count()) === 0,
            "Owned PSP never asks for real card or wallet credentials",
          );
          const cancelCase = locale === "en" && viewport.width === 1440;
          if (cancelCase) {
            stage = `${name}:CANCEL_RETURN`;
            await page.locator("[data-test-psp-cancel]").click();
            await page.waitForURL(
              (url) =>
                url.origin === origin &&
                url.pathname === `/${locale}/checkout/return`,
            );
            await waitExpired();
            await page.reload({ waitUntil: "networkidle" });
            await responsePost(recoveryPath, () =>
              page.locator("[data-payment-recover]").click(),
            );
            await expect(
              page.locator('[data-payment-state="CANCELED"]'),
            ).toBeVisible();
            await expect(
              page.locator("[data-payment-create]").first(),
            ).toBeVisible();
            check(
              (await page.locator("[data-payment-method-refresh]").count()) ===
                0,
              "Trusted canceled attempt automatically reloads permitted payment methods",
            );
            await capture("canceled-retry");
            const next = await responsePost(
              `/api/storefront/checkout/sessions/${sessionId}/attempts`,
              () => page.locator("[data-payment-create]").first().click(),
            );
            check(
              next.attempt.id !== attemptId &&
                next.attempt.checkoutSessionId === sessionId,
              "Explicit retry after trusted cancellation creates a new attempt on the original valid checkout",
            );
            attemptId = next.attempt.id;
            await page.locator("[data-payment-continue]").click();
            await page.waitForURL((url) => url.origin === psp.origin);
          }
          stage = `${name}:SUCCESS_RETURN`;
          await page.locator("[data-test-psp-capture]").click();
          await page.waitForURL(
            (url) =>
              url.origin === origin &&
              url.pathname === `/${locale}/checkout/return`,
          );
          check(
            new globalThis.URL(page.url()).searchParams.get("attempt") ===
              attemptId,
            "Actual PSP return keeps the original current attempt and frozen locale",
          );
          const {
            rows: [beforeEvidence],
          } = await client.query(
            "SELECT o.payment_status,a.status FROM orders o JOIN payment_attempts a ON a.order_id=o.id WHERE a.id=$1::uuid",
            [attemptId],
          );
          check(
            beforeEvidence?.payment_status === "PENDING" &&
              beforeEvidence.status !== "SUCCEEDED",
            "Browser return alone cannot mark a payment or order successful",
          );
          const signed = await context.signWebhook(attemptId);
          check(
            (await context.sendWebhook(signed)).accepted,
            "Original signed TEST webhook is durably accepted by the actual HTTP API",
          );
          stage = `${name}:WORKER_ORDER`;
          await expect
            .poll(
              async () => {
                await worker.maintenance();
                const {
                  rows: [row],
                } = await client.query(
                  "SELECT payment_status FROM orders WHERE checkout_session_id=$1::uuid",
                  [sessionId],
                );
                return row?.payment_status;
              },
              { timeout: 30_000, intervals: [100, 250] },
            )
            .toBe("PAID");
          await page.reload({ waitUntil: "networkidle" });
          await expect(page.locator("[data-order-detail]")).toBeVisible({
            timeout: 30_000,
          });
          await expect(page).toHaveURL(new RegExp(`/${locale}/thank-you/`));
          await expect(page.locator("[data-order-total]")).toBeVisible();
          const {
            rows: [paid],
          } = await client.query(
            "SELECT o.presentation_locale,o.currency,o.total_amount_minor::text AS amount,(SELECT count(*)::int FROM payment_attempts a WHERE a.order_id=o.id) AS attempts,(SELECT count(*)::int FROM payment_transactions t JOIN payment_attempts a ON a.id=t.payment_attempt_id WHERE a.order_id=o.id AND t.transaction_type='CAPTURE') AS captures,(SELECT count(*)::int FROM outbox_events x WHERE x.aggregate_id=o.id AND x.event_type='ORDER_PAYMENT_CONFIRMED') AS confirmations FROM orders o WHERE o.checkout_session_id=$1::uuid",
            [sessionId],
          );
          check(
            paid?.captures === 1 &&
              paid.confirmations === 1 &&
              paid.attempts === (cancelCase ? 2 : 1),
            "Actual worker records one capture and confirmation with only explicitly authorized attempts",
          );
          check(
            paid.presentation_locale === locale &&
              paid.currency === created.checkout.currency &&
              paid.amount === String(created.checkout.amount.totalAmountMinor),
            "Final paid order keeps frozen locale, currency and amount",
          );
          check(
            (await context.sendWebhook(signed)).accepted,
            "Duplicate original signature is accepted idempotently",
          );
          await worker.maintenance();
          const {
            rows: [duplicate],
          } = await client.query(
            "SELECT count(*)::int AS captures FROM payment_transactions WHERE payment_attempt_id=$1::uuid AND transaction_type='CAPTURE'",
            [attemptId],
          );
          check(
            duplicate?.captures === 1,
            "Signed webhook replay cannot create a second capture",
          );
          await capture("paid");
          const finalCounts = await psp.counts();
          check(
            finalCounts.captures === beforeCreate.captures + 1 &&
              finalCounts.payments ===
                beforeCreate.payments + (cancelCase ? 2 : 1),
            "Independent PSP confirms exactly one capture for this browser journey",
          );
          report.cases.push({
            locale,
            ...viewport,
            status: "PASS",
            naturalExpiry: true,
            localeSwitch: true,
            keyboard: true,
            reducedMotion: true,
            lostResponse,
            canceledThenExplicitRetry: cancelCase,
            attempts: paid.attempts,
            captures: paid.captures,
            confirmations: paid.confirmations,
          });
        } finally {
          try {
            await observer?.settled();
            observer?.dispose();
          } finally {
            await owned.close();
          }
        }
      }
    }
    check(
      report.pageErrors === 0,
      "All fourteen recovery journeys have zero uncaught browser errors",
    );
    check(
      !report.cartResponses.some((entry) =>
        ["BODY_UNAVAILABLE", "SCHEMA_INVALID", "TRANSPORT_FAILED"].includes(
          entry.code,
        ),
      ),
      "Every cart response is drained and schema validated",
    );
    check(
      (await psp.observations()).every(
        (entry) => entry.unexpectedCredentials !== true,
      ),
      "Hosted PSP receives no storefront cookies or authorization credentials",
    );
    report.status = "CHECKS_PASSED";
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      stage,
      kind: error?.name === "AssertionError" ? "ASSERTION" : "BROWSER",
      timeout: error?.name === "TimeoutError",
      callsites: [
        ...(error?.stack ?? "").matchAll(
          /payment-action-recovery-browser\.mjs:\d+:\d+/gu,
        ),
      ].map((match) => match[0]),
    };
    // eslint-disable-next-line preserve-caught-error -- Browser errors can contain hosted credentials; only allowlisted diagnostics leave this harness.
    throw new Error("PAYMENT_ACTION_RECOVERY_BROWSER_FAILED");
  } finally {
    try {
      await worker?.stop();
      report.workerStopped = true;
    } catch {
      report.status = "FAIL";
      report.cleanupFailure = "WORKER";
    }
    try {
      await browser?.close();
      report.browserClosed = true;
    } catch {
      report.status = "FAIL";
      report.cleanupFailure = "BROWSER";
    }
    if (report.status === "CHECKS_PASSED") report.status = "PASS";
    await save();
  }
  check(
    report.status === "PASS",
    "Browser recovery passes only after owned Chrome and worker cleanup",
  );
  return report;
}
