import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, X509Certificate } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { chromium } from "@playwright/test";
import { localExperienceConfigSchema } from "./local-experience-config.mjs";
import { verifyLocalExperienceBrowser } from "./local-experience-browser.mjs";
import { createJourneyState } from "./regression-journey-state.mjs";
import { verifyAccessibilityDailyBrowse } from "./accessibility-publication.mjs";
import { classifyJourneyPageError } from "./regression-journey-contract.mjs";
import { createAccessibilityBrowserTools } from "./accessibility-browser-tools.mjs";
import {
  accessibilityAdminFlow,
  accessibilityCustomerFlow,
  accessibilityMailOrder,
  accessibilityOrderLayout,
} from "./accessibility-flows.mjs";
import { accessibilityMatrix } from "../../../scripts/accessibility-matrix.mjs";
import { assertAccessibilityCompletion } from "../../../scripts/accessibility-completion.mjs";
import {
  cleanupAccessibilityResources,
  accessibilityFailure,
} from "../../../scripts/accessibility-cleanup.mjs";
import {
  createNativeZoomProfilePreferences,
  createNativeZoomLaunchOptions,
  assessNativeZoomMeasurements,
  readPngDimensions,
} from "../../../scripts/verify-ui-primitives-browser.mjs";

async function windowMeasurement(page) {
  return page.evaluate(() => ({
    outerWidth: globalThis.outerWidth,
    outerHeight: globalThis.outerHeight,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    devicePixelRatio: globalThis.devicePixelRatio,
    visualViewport: {
      width: globalThis.visualViewport.width,
      height: globalThis.visualViewport.height,
      scale: globalThis.visualViewport.scale,
    },
  }));
}

/** Existing owned regression protocol supplies the compiled storefront and isolated TEST providers. */
export async function verifyAccessibilityBrowser({
  workspaceRoot,
  instance,
  output,
  contentFacts,
}) {
  assert(
    /^test-regression-[a-z0-9-]{1,16}$/u.test(instance),
    "Accessibility runner accepts only owned regression TEST instances",
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
    config.workspaceRoot === workspaceRoot && config.instance === instance,
    "TEST instance belongs to this workspace",
  );
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    instance,
    stage: "CONTENT_SETUP",
    scope:
      "28 production-page accessibility cells; one complete keyboard TEST payment and independent email exchange/review/delivery; per-cell keyboard add/checkout form and protected order layout using an in-memory authorized TEST session",
    runtime: {
      storefront: "PRODUCTION_NEXT",
      admin: "LOCAL_NEXT_DEVELOPMENT",
      payment: "INDEPENDENT_TEST_PSP",
    },
    humanScreenReaderVerified: false,
    physicalPhoneVerified: false,
    cases: [],
    additionalScreens: [],
    keyboard: [],
    dialogs: [],
    validation: [],
    screenshots: [],
    pageErrors: [],
    observations: [],
    orderSearches: [],
    paymentCreates: [],
    paymentReads: [],
    journey: { payment: false, mailAccess: false, fulfillment: false },
  };
  const save = () =>
    writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  let browser, state, profiles, nativeContext;
  try {
    if (!contentFacts) {
      const setup = await verifyLocalExperienceBrowser({
        workspaceRoot,
        instance,
        posterOnly: true,
      });
      assert(
        setup.status === "PARTIAL_PASS" && setup.mode === "POSTER",
        "Existing real admin publishing flow creates fixture content",
      );
      contentFacts = setup.factsPath;
      report.contentSetup = {
        status: setup.status,
        assertions: setup.assertions,
      };
    }
    const facts = JSON.parse(await readFile(contentFacts, "utf8"));
    assert(
      facts.instanceId === config.instanceId &&
        facts.artistId &&
        facts.giftId &&
        facts.commerceContext,
      "Published content facts belong to the owned TEST instance",
    );
    report.stage = "DAILY_GIFT_BROWSE";
    report.actualDailyBrowse = await verifyAccessibilityDailyBrowse({
      config,
      facts,
    });
    await save();
    const certificate = new X509Certificate(
      await readFile(config.tls.certificatePath),
    );
    const pin = createHash("sha256")
      .update(certificate.publicKey.export({ type: "spki", format: "der" }))
      .digest("base64");
    const args = [
      `--ignore-certificate-errors-spki-list=${pin}`,
      `--host-resolver-rules=${Object.values(config.origins)
        .map((origin) => `MAP ${new URL(origin).hostname} 127.0.0.1`)
        .join(",")}`,
      "--no-proxy-server",
    ];
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args,
    });
    report.browserVersion = browser.version();
    state = createJourneyState(config);
    const tools = createAccessibilityBrowserTools({ report, output });
    let purchase, orderSession;
    const observedContexts = new WeakSet();
    async function runCell(context, entry) {
      const cell = {
        ...entry,
        screens: [],
        keyboard: false,
        homeNoContext: false,
        giftBeforeMarket: false,
      };
      report.cases.push(cell);
      report.stage = `${cell.id}:start`;
      console.log(`[accessibility] ${cell.id}`);
      assert(
        (await context.cookies()).length === 0,
        "Every homepage cell starts without existing cookies",
      );
      context.setDefaultTimeout(30000);
      if (!observedContexts.has(context))
        context.on("page", (page) =>
          page.on("pageerror", (error) =>
            report.pageErrors.push({
              stage: report.stage,
              code: classifyJourneyPageError(error),
            }),
          ),
        );
      observedContexts.add(context);
      const page = await context.newPage();
      const customerCookiesBefore = await context.cookies(
        config.origins.storefront,
      );
      assert(
        customerCookiesBefore.length === 0,
        "No supplied storefront session precedes homepage browsing",
      );
      try {
        purchase = await accessibilityCustomerFlow({
          page,
          cell,
          facts,
          config,
          report,
          tools,
          state,
          purchase,
        });
        // The first purchaser has checkout/order cookies. Clear all cookies before
        // entering mail, so this never depends on those previous authorizations.
        await context.clearCookies();
        if (!orderSession)
          orderSession = await accessibilityMailOrder({
            page,
            cell,
            purchase,
            config,
            tools,
            state,
            report,
          });
        else
          await accessibilityOrderLayout({
            page,
            cell,
            purchase,
            tools,
            report,
            session: orderSession,
          });
        await accessibilityAdminFlow({
          page,
          cell,
          purchase,
          config,
          report,
          tools,
        });
        await save();
      } finally {
        await page.close();
      }
    }
    for (const cell of accessibilityMatrix().filter(
      (entry) => entry.mode !== "native-zoom",
    )) {
      const context = await browser.newContext({
        viewport: { width: cell.width, height: cell.height },
        reducedMotion: cell.reducedMotion ? "reduce" : "no-preference",
      });
      try {
        await runCell(context, cell);
      } finally {
        await context.close();
      }
    }
    await browser.close();
    browser = undefined;
    profiles = await mkdtemp(
      path.join(os.tmpdir(), "fan-support-accessibility-zoom-"),
    );
    const measurements = {};
    const captures = [];
    for (const percent of [100, 200]) {
      const profile = path.join(profiles, String(percent));
      await mkdir(path.join(profile, "Default"), { recursive: true });
      await writeFile(
        path.join(profile, "Default/Preferences"),
        JSON.stringify(createNativeZoomProfilePreferences(percent)),
      );
      const options = createNativeZoomLaunchOptions(
        undefined,
        config.origins.storefront,
      );
      nativeContext = await chromium.launchPersistentContext(profile, {
        ...options,
        channel: "chrome",
        args: [...options.args, ...args],
        reducedMotion: "reduce",
      });
      const page = await nativeContext.newPage();
      await page.goto(`${config.origins.storefront}/en`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#gifts [data-gift-link]").first().waitFor();
      await page.evaluate(() => globalThis.document.fonts.ready);
      measurements[percent === 100 ? "baseline" : "zoomed"] =
        await windowMeasurement(page);
      const session = await nativeContext.newCDPSession(page);
      try {
        const { data } = await session.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        });
        const bytes = Buffer.from(data, "base64");
        const file = `native-chrome-${percent}.png`;
        await writeFile(path.join(output, file), bytes);
        captures.push({
          percent,
          file,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          ...readPngDimensions(bytes),
        });
        report.screenshots.push(file);
      } finally {
        await session.detach();
        await page.close();
      }
      if (percent === 200) {
        assert(
          assessNativeZoomMeasurements({
            ...measurements,
            expectedPercent: 200,
          }).length === 0,
          "Actual native 200% browser zoom measured before matrix execution",
        );
        for (const cell of accessibilityMatrix().filter(
          (entry) => entry.mode === "native-zoom",
        )) {
          await nativeContext.clearCookies();
          await runCell(nativeContext, cell);
        }
      }
      await nativeContext.close();
      nativeContext = undefined;
      const preferences = JSON.parse(
        await readFile(path.join(profile, "Default/Preferences"), "utf8"),
      );
      assert(
        Math.abs(
          preferences.partition.default_zoom_level.x -
            Math.log(percent / 100) / Math.log(1.2),
        ) < 0.001,
        "Chrome retains the native HostZoomMap preference",
      );
    }
    await rm(profiles, { recursive: true });
    profiles = undefined;
    report.nativeZoom = {
      ...measurements,
      captures,
      profileRemoved: true,
      method:
        "Headed Chrome temporary HostZoomMap profiles; viewport null; CDP screenshots without device-metrics or page-scale emulation",
    };
    assertAccessibilityCompletion(report);
    report.status = "PASS";
    return report;
  } catch (error) {
    report.status = "FAIL";
    report.failure =
      "Inspect safe current-stage measurements and screenshots; private browser errors and runtime values are omitted.";
    report.failureDiagnostic = accessibilityFailure(error);
    return report;
  } finally {
    await cleanupAccessibilityResources({
      context: nativeContext,
      browser,
      state,
      profiles,
      save,
      report,
    });
  }
}
