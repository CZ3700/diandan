import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { chromium } from "@playwright/test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { localExperienceConfigSchema } from "./local-experience-config.mjs";
import { verifyLocalExperienceBrowser } from "./local-experience-browser.mjs";
import { observeLocalBrowserPayment } from "./local-experience-browser-payment-observer.mjs";
import {
  assertJourneyMatrix,
  assertStablePurchase,
  classifyJourneyPageError,
} from "./regression-journey-contract.mjs";
import { createJourneyState } from "./regression-journey-state.mjs";
import {
  beginJourney,
  checkLocaleCycle,
  readCurrentPurchase,
  verifyLocalizedOrder,
  verifyMailAccess,
} from "./regression-journey-browser.mjs";

/** Called by the isolated regression lifecycle. Never starts, stops or resets an instance. */
export async function verifyRegressionJourneys({
  workspaceRoot,
  instance,
  output,
  contentFacts,
}) {
  assert(
    /^test-regression-[a-z0-9-]+$/u.test(instance),
    "Requires a dedicated regression instance",
  );
  const config = localExperienceConfigSchema.parse(
    JSON.parse(
      await readFile(
        path.join(
          workspaceRoot,
          "node_modules/.cache/fan-support-local-experience",
          instance,
          "config.json",
        ),
        "utf8",
      ),
    ),
  );
  assert(
    config.workspaceRoot === workspaceRoot,
    "Instance belongs to the isolated workspace",
  );
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    instance,
    stage: "CONTENT_SETUP",
    cases: [],
    localeSwitches: [],
    recoveries: [],
    screenshots: [],
    paymentCreates: [],
    paymentReads: [],
    paymentBodyEvidenceScope: "RETURN_AND_EXPLICIT_PRE_DEPARTURE_CURRENT",
    preDepartureChecks: [],
    observations: [],
    pageErrors: [],
    invalidLocale404: false,
  };
  let browser, state;
  try {
    let factsPath = contentFacts;
    if (!factsPath) {
      const setup = await verifyLocalExperienceBrowser({
        workspaceRoot,
        instance,
        posterOnly: true,
      });
      assert(
        setup.status === "PARTIAL_PASS" && setup.mode === "POSTER",
        "Real admin uploads prepared the fixture",
      );
      factsPath = setup.factsPath;
      report.contentSetup = {
        status: setup.status,
        assertions: setup.assertions,
        cases: setup.cases,
      };
    }
    const facts = JSON.parse(await readFile(factsPath, "utf8"));
    assert(
      facts.instanceId === config.instanceId &&
        facts.artistId &&
        facts.giftId &&
        facts.commerceContext,
      "Fixture content belongs to this regression instance",
    );
    const certificate = new X509Certificate(
      await readFile(config.tls.certificatePath),
    );
    const pin = createHash("sha256")
      .update(certificate.publicKey.export({ type: "spki", format: "der" }))
      .digest("base64");
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [
        `--ignore-certificate-errors-spki-list=${pin}`,
        `--host-resolver-rules=${Object.values(config.origins)
          .map((origin) => `MAP ${new URL(origin).hostname} 127.0.0.1`)
          .join(",")}`,
        "--no-proxy-server",
      ],
    });
    state = createJourneyState(config);
    report.giftPublicationAtomicity = await state.publication(facts.giftId);
    const capture = async (page, label) => {
      const file = `${label}.png`;
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            globalThis.scrollTo(0, 0);
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolve),
            );
          }),
      );
      await page.screenshot({
        path: path.join(output, file),
        fullPage: true,
        mask: [
          page.locator(
            "[data-cart-name], [data-cart-message], [data-checkout-email], [data-private-panel], [data-private-content]",
          ),
        ],
      });
      report.screenshots.push(file);
    };
    const contextFor = async (width) => {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: "reduce",
      });
      context.setDefaultTimeout(30000);
      context.on("page", (page) =>
        page.on("pageerror", (error) =>
          report.pageErrors.push({
            stage: report.stage,
            code: classifyJourneyPageError(error),
          }),
        ),
      );
      return context;
    };
    for (const locale of SUPPORTED_LOCALES)
      for (const width of [390, 1440]) {
        const context = await contextFor(width);
        const page = await context.newPage();
        const row = { locale, width, steps: {} };
        report.cases.push(row);
        const observer = observeLocalBrowserPayment({
          page,
          config,
          report,
          // Continue-payment can destroy its document before CDP retrieves the
          // internal action-read body. Validate current state explicitly before
          // departure; retain every HTTP failure and strict return-body checks.
          readBodyForStage: (stage) => stage.endsWith("-RETURN"),
        });
        const createCount = report.paymentCreates.length;
        try {
          report.stage = `${locale}-${width}-JOURNEY`;
          console.log(JSON.stringify({ stage: report.stage }));
          const mark = (step) => {
            row.steps[step] = true;
          };
          const { checkout } = await beginJourney({
            page,
            config,
            facts,
            locale,
            mark,
            capture: (target, step) =>
              capture(target, `${locale}-${width}-${step}`),
          });
          const purchase = await state.purchase(checkout.publicOrderId);
          assert(
            purchase.locale === locale && purchase.attemptId,
            "Order freezes its initial locale and attempt",
          );
          if (locale === SUPPORTED_LOCALES[0])
            await checkLocaleCycle({
              page,
              state,
              purchase,
              report,
              stage: "CHECKOUT",
              width,
            });
          const current = await readCurrentPurchase(page);
          assert(
            current.attempt.id === purchase.attemptId &&
              current.attempt.checkoutSessionId === purchase.checkoutId &&
              current.attempt.status === "REQUIRES_ACTION" &&
              current.checkout.id === purchase.checkoutId &&
              current.checkout.publicOrderId === purchase.publicOrderId &&
              current.checkout.presentationLocale === purchase.locale &&
              current.checkout.market === purchase.market &&
              current.checkout.currency === purchase.currency &&
              current.checkout.amount.totalAmountMinor === purchase.amountMinor,
            "Pre-departure canonical contract preserves the original purchase",
          );
          report.preDepartureChecks.push({ locale, width, samePurchase: true });
          await page.locator("[data-payment-continue]").click();
          await page.locator("[data-test-psp-capture]").waitFor();
          assert(
            new URL(page.url()).origin === config.origins.psp,
            "Payment is on the configured independent TEST PSP origin",
          );
          mark("hostedPayment");
          report.stage = `${locale}-${width}-RETURN`;
          await page.locator("[data-test-psp-capture]").click();
          await page
            .locator('[data-order-payment-status="PAID"]')
            .waitFor({ timeout: 90000 });
          await observer.settled();
          assert(
            report.paymentCreates.length - createCount === 1,
            "Exactly one payment-create for a successful journey",
          );
          const reads = report.paymentReads.filter(
            (read) => read.checkoutSessionId === purchase.checkoutId,
          );
          assert(
            reads.some((read) => read.status === "SUCCEEDED") &&
              reads.every((read) => read.attemptId === purchase.attemptId),
            "Return queries the original attempt and observes trusted success",
          );
          assertStablePurchase(
            purchase,
            await state.purchase(checkout.publicOrderId),
          );
          mark("trustedConfirmation");
          await verifyLocalizedOrder(page, locale, purchase);
          mark("localizedOrder");
          await capture(page, `${locale}-${width}-paid-order`);
          if (locale === SUPPORTED_LOCALES[0])
            await checkLocaleCycle({
              page,
              state,
              purchase,
              report,
              stage: "ORDER",
              width,
            });
          const mail = await state.notification(
            purchase.publicOrderId,
            locale,
            purchase.amountMinor,
            purchase.currency,
          );
          mark("localizedMail");
          await verifyMailAccess({
            browser,
            config,
            purchase,
            locale,
            subject: mail.subject,
            width,
          });
          mark("secureOrder");
        } finally {
          observer.dispose();
          await context.close();
        }
      }
    for (const outcome of ["FAILED", "CANCELED"]) {
      report.stage = `${outcome}-RETURN-CONTEXT`;
      console.log(JSON.stringify({ stage: report.stage }));
      const context = await contextFor(390);
      try {
        const page = await context.newPage();
        const locale = SUPPORTED_LOCALES[0];
        const { checkout } = await beginJourney({
          page,
          config,
          facts,
          locale,
          mark: () => {},
          capture: async () => {},
        });
        const purchase = await state.purchase(checkout.publicOrderId);
        const privateBefore = await state.privateSnapshot(
          purchase.publicOrderId,
        );
        await page.locator("[data-payment-continue]").click();
        await page
          .locator(
            outcome === "FAILED"
              ? "[data-test-psp-fail]"
              : "[data-test-psp-cancel]",
          )
          .click();
        await page
          .locator(`[data-payment-state="${outcome}"]`)
          .waitFor({ timeout: 90000 });
        await page.locator("[data-payment-method-refresh]").click();
        await page.locator("[data-payment-create]").first().waitFor();
        assert(
          (await page.locator("[data-payment-country]").count()) === 0,
          "Retry lists methods again without asking for a country",
        );
        const current = await readCurrentPurchase(page);
        assert(
          current.attempt.status === outcome && current.attempt.canRetry,
          "Signed terminal outcome enables an explicit safe retry",
        );
        assertStablePurchase(
          purchase,
          await state.purchase(purchase.publicOrderId),
        );
        assert(
          privateBefore ===
            (await state.privateSnapshot(purchase.publicOrderId)),
          "Failure return preserves exact encrypted intent and recipient/gift/quantity",
        );
        await page.locator(`a.checkout-back[href="/${locale}/cart"]`).click();
        await page.locator("[data-cart-item]").waitFor();
        assert(
          (await page.locator("[data-cart-item]").count()) ===
            checkout.lines.length,
          "Return cart retains every original gift line",
        );
        await capture(page, `${outcome.toLowerCase()}-restored-cart`);
        await page.locator("[data-cart-checkout]").click();
        await page.locator(`[data-payment-state="${outcome}"]`).waitFor();
        assertStablePurchase(
          purchase,
          await state.purchase(purchase.publicOrderId),
        );
        report.recoveries.push({
          outcome,
          samePurchase: true,
          privateContextPreserved: true,
          explicitRetryAvailable: true,
        });
      } finally {
        await context.close();
      }
    }
    report.stage = "INVALID_LOCALE";
    const invalidContext = await contextFor(390);
    try {
      const page = await invalidContext.newPage();
      const response = await page.goto(
        `${config.origins.storefront}/xx-INVALID/gifts/${facts.giftHandle}`,
      );
      assert(response.status() === 404, "Unsupported locale deep link is 404");
      report.invalidLocale404 = true;
    } finally {
      await invalidContext.close();
    }
    assertJourneyMatrix(report.cases);
    assert(
      report.observations.length === 0 && report.pageErrors.length === 0,
      "No observer or application failures",
    );
    assert(
      report.localeSwitches.length === SUPPORTED_LOCALES.length * 4 &&
        report.recoveries.length === 2,
      "Both viewports complete every locale switch and both recovery outcomes",
    );
    report.status = "PASS";
    report.stage = "COMPLETE";
  } catch (error) {
    report.status = "FAIL";
    const source = error.stack?.match(
      /(regression-journey[\w-]*\.mjs):(\d+):\d+/u,
    );
    report.failure = {
      name: error.name,
      timeout: /Timeout|timed out/iu.test(error.message),
      source: source?.[1] ?? null,
      sourceLine: source?.[2] ?? null,
    };
  } finally {
    const cleanup = await Promise.allSettled([
      state?.close(),
      browser?.close(),
    ]);
    if (cleanup.some((result) => result.status === "rejected")) {
      report.status = "FAIL";
      report.cleanupFailed = true;
    }
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  if (report.status !== "PASS")
    throw new Error(
      `Regression journey failed at ${report.stage}; see safe report`,
    );
  return {
    status: report.status,
    reportPath: path.join(output, "report.json"),
    cases: report.cases.length,
    evidenceChecks:
      report.cases.length * 10 +
      report.localeSwitches.length +
      report.recoveries.length +
      1,
  };
}
