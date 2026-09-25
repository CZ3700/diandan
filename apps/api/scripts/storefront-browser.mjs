import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createStorefrontImageChecks } from "./storefront-image-checks.mjs";
import { refreshStorefrontNext } from "./storefront-next-refresh.mjs";
import {
  SUPPORTED_LOCALES,
  LOCALE_NATIVE_NAMES,
  storefrontHomepageResponseSchema,
} from "@fan-support/contracts";

/** No HAR, traces, cookies, signed URLs or request bodies are persisted. */
export async function createStorefrontBrowserVerifier({
  origin,
  base,
  output,
  check,
  serve,
  ui,
  production,
  proxy,
  gateway,
}) {
  if (
    production &&
    serve &&
    new globalThis.URL(import.meta.url).searchParams.has("attempt")
  )
    await refreshStorefrontNext({ origin, proxy, gateway, output, check });
  const certificate = new X509Certificate(
    await readFile(gateway.certificatePath),
  );
  const pin = createHash("sha256")
    .update(certificate.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: !serve,
    args: [
      `--ignore-certificate-errors-spki-list=${pin}`,
      "--host-resolver-rules=MAP media.example.invalid 127.0.0.1",
      "--no-proxy-server",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    globalThis.__storefrontTestVitals = { lcp: 0, cls: 0 };
    for (const type of ["largest-contentful-paint", "layout-shift"]) {
      if (!globalThis.PerformanceObserver.supportedEntryTypes.includes(type))
        continue;
      new globalThis.PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (type === "largest-contentful-paint")
            globalThis.__storefrontTestVitals.lcp = entry.startTime;
          else if (!entry.hadRecentInput)
            globalThis.__storefrontTestVitals.cls += entry.value;
        }
      }).observe({ type, buffered: true });
    }
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  const report = {
    schemaVersion: 1,
    diagnosticRetry: Number(
      new globalThis.URL(import.meta.url).searchParams.get("attempt") ?? 0,
    ),
    browserVersion: browser.version(),
    cases: [],
    screenshots: [],
    axe: [],
    reflow: [],
    metrics: [],
    consoleErrors: [],
  };
  const imageChecks = createStorefrontImageChecks({ origin, gateway, check });
  page.on("pageerror", (error) =>
    report.consoleErrors.push({
      name: error.name,
      message:
        "Browser page error; inspect locally without copying runtime data",
    }),
  );
  let step = "startup";
  async function goto(route) {
    step = route;
    const response = await page.goto(origin + route, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    check(
      response?.status() === 200,
      `storefront ${route.split("?")[0]} responds successfully`,
    );
    await page.locator("main h1").waitFor();
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready;
      await new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      );
    });
    return response;
  }
  async function screenshot(name) {
    if (!ui) return;
    await page.screenshot({
      path: path.join(output, name),
      fullPage: true,
      animations: "disabled",
    });
    report.screenshots.push(name);
  }
  async function axe(name) {
    const require = createRequire(
      new globalThis.URL("../../../package.json", import.meta.url),
    );
    const { default: AxeBuilder } = require("@axe-core/playwright");
    const result = await new AxeBuilder({ page }).analyze();
    const violations = result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      count: nodes.length,
    }));
    report.axe.push({
      name,
      engineVersion: result.testEngine.version,
      violations,
      incomplete: result.incomplete.map(({ id, nodes }) => ({
        id,
        count: nodes.length,
        nodes: nodes.map(({ target, failureSummary }) => ({
          target,
          failureSummary,
        })),
      })),
    });
    check(
      !violations.some((violation) =>
        ["critical", "serious"].includes(violation.impact),
      ),
      `${name} axe has no critical/serious violations`,
    );
  }
  async function noOverflow(name) {
    const dimensions = await page.evaluate(() => ({
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
      scrollWidth: globalThis.document.documentElement.scrollWidth,
      bodyWidth: globalThis.document.body.scrollWidth,
    }));
    report.reflow.push({ name, ...dimensions });
    check(
      dimensions.scrollWidth <= dimensions.width + 1 &&
        dimensions.bodyWidth <= dimensions.width + 1,
      `${name} has no horizontal page overflow`,
    );
  }
  async function images(name) {
    await page.locator("main img").evaluateAll(async (entries) => {
      for (const image of entries) {
        image.loading = "eager";
        try {
          await image.decode();
        } catch {
          /* A failed image is asserted below. */
        }
      }
    });
    const result = await page.locator("main img").evaluateAll((entries) =>
      entries.map((image) => ({
        loaded: image.complete && image.naturalWidth > 0,
        width: image.width,
        height: image.height,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        host: new globalThis.URL(image.currentSrc).hostname,
        priority: image.fetchPriority,
      })),
    );
    check(
      result.length > 0 &&
        result.every(
          (image) =>
            image.loaded &&
            image.width > 0 &&
            image.height > 0 &&
            image.host === new globalThis.URL(origin).hostname,
        ),
      `${name} renders actual published S3 derivatives`,
    );
    await imageChecks.observe(page);
    if (
      (page.viewportSize()?.width ?? 0) < 768 &&
      (await page.locator(".storefront-hero-image img").count())
    ) {
      const geometry = await page
        .locator(".storefront-hero-image")
        .evaluate((element) => {
          const image = element.querySelector("img");
          const frame = element.getBoundingClientRect();
          return {
            width: frame.width,
            height: frame.height,
            sourceWidth: Number(image.getAttribute("width")),
            sourceHeight: Number(image.getAttribute("height")),
          };
        });
      check(
        Math.abs(
          geometry.width / geometry.height -
            geometry.sourceWidth / geometry.sourceHeight,
        ) < 0.005,
        "mobile hero reserves the actual published composition ratio without cropping it into a shorter frame",
      );
      report.cases.push({ name: `${name}-mobile-hero-ratio`, ...geometry });
    }
    report.metrics.push({
      name,
      ...(await page.evaluate(() => ({
        ...globalThis.__storefrontTestVitals,
        domContentLoaded:
          globalThis.performance.getEntriesByType("navigation")[0]
            ?.domContentLoadedEventEnd,
        imageTransferBytes: globalThis.performance
          .getEntriesByType("resource")
          .filter((entry) => entry.name.includes("/_next/image?"))
          .reduce((sum, entry) => sum + entry.transferSize, 0),
        devicePixelRatio: globalThis.devicePixelRatio,
      }))),
    });
    report.cases.push({ name, images: result });
  }
  async function settleDirectory() {
    await page.waitForFunction(
      () =>
        globalThis.document
          .querySelector("[data-artist-directory-status]")
          ?.getAttribute("data-loading") === "false",
    );
  }
  async function publicHome(locale = "en") {
    const response = await globalThis.fetch(
      `${base}/api/v1/storefront-homepage?locale=${locale}`,
      { signal: globalThis.AbortSignal.timeout(30_000) },
    );
    const result = storefrontHomepageResponseSchema.parse(
      await response.json(),
    );
    check(
      response.status === 200 && result.outcome === "SUCCESS",
      "actual public homepage uses strict composed contract",
    );
    return result;
  }
  async function verifyEmpty() {
    await goto("/en");
    check(
      (await page.locator(".storefront-state").count()) === 1,
      "unpublished home has an explicit stable empty state",
    );
    await screenshot("en-home-empty.png");
    await goto("/en/idols");
    check(
      (await page.locator("[data-artist-card]").count()) === 0,
      "actual empty PostgreSQL catalog is empty in the browser",
    );
    check(
      (await page.locator("[data-artist-directory-status]").innerText()).trim()
        .length > 0,
      "empty directory explains its state",
    );
    await screenshot("en-directory-empty.png");
    report.cases.push({
      name: "empty-before-any-published-artist",
      pass: true,
    });
  }
  async function verifyPublished(fixtures, content) {
    try {
      step = "actual browser HTTP 404 before any page matrix";
      for (const route of [
        "/xx",
        ...SUPPORTED_LOCALES.map((locale) => `/${locale}/idols/no-such-artist`),
      ]) {
        const response = await page.goto(origin + route, {
          waitUntil: "networkidle",
        });
        check(
          response?.status() === 404,
          `${route} returns actual browser HTTP 404 before streaming any success response`,
        );
      }
      const home = await publicHome();
      check(
        home.homepage.publication.id === fixtures.homepage.publicationId,
        "homepage content is the actual publication created by the fixture",
      );
      check(
        home.slots.filter((slot) => slot.status === "AVAILABLE").length === 7,
        "homepage resolves only its seven configured current slot objects",
      );
      check(
        JSON.stringify(home.slots.map((slot) => slot.slotKey)) ===
          JSON.stringify(
            home.homepage.content.view.slots
              .filter((slot) => slot.kind !== "POLICY_LINK")
              .map((slot) => slot.slotKey),
          ),
        "homepage hydration preserves configured slot order and excludes policy links",
      );
      check(
        !/(sourceObjectKey|rightsReference|reviewerId|sessionToken|csrfToken|signedUrl)/u.test(
          JSON.stringify(home),
        ),
        "public homepage excludes private proof and capabilities",
      );
      for (const viewport of ui
        ? [
            { width: 390, height: 844 },
            { width: 1440, height: 900 },
          ]
        : [{ width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        for (const locale of ui ? SUPPORTED_LOCALES : ["en"]) {
          const label = `${locale}-${viewport.width}`;
          for (const [kind, route] of [
            ["home", `/${locale}`],
            ["directory", `/${locale}/idols`],
            ["detail", `/${locale}/idols/${fixtures.artists[0].handle}`],
          ]) {
            const response = await goto(route);
            check(
              (await page.locator("html").getAttribute("lang")) === locale,
              `${label} ${kind} HTML language is explicit`,
            );
            check(
              response.headers()["content-language"] === locale,
              `${label} ${kind} Content-Language matches globalThis.URL`,
            );
            await images(`${label}-${kind}`);
            if (kind === "detail")
              check(
                (await page.locator(".storefront-story p").count()) > 0 &&
                  !(
                    await page.locator(".storefront-story").innerText()
                  ).includes("<p>"),
                "published biography renders controlled paragraphs rather than literal tags",
              );
            if (kind === "home")
              check(
                (await page
                  .locator(
                    '.storefront-policy-links a[href$="/policies/delivery"]',
                  )
                  .count()) === 1,
                "home retains its configured policy navigation link",
              );
            await noOverflow(`${label}-${kind}`);
            await screenshot(`${label}-${kind}.png`);
            if (viewport.width === 390 && (kind === "home" || locale === "en"))
              await axe(`${label}-${kind}`);
          }
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      step = "server rendered crawlable artist links without JavaScript";
      const noScript = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 1440, height: 900 },
      });
      const noScriptPage = await noScript.newPage();
      await noScriptPage.goto(`${origin}/en/idols`, {
        waitUntil: "domcontentloaded",
      });
      check(
        (await noScriptPage.locator("[data-artist-link]").count()) === 12,
        "SSR delivers first real artist window with crawlable hrefs without JavaScript",
      );
      await noScript.close();
      step = "homepage search locates a distant actual artist";
      await goto("/en?market=GLOBAL&currency=USD#artists");
      await page.locator("[data-artist-search]").fill(fixtures.target.name);
      await page
        .locator(`[data-artist-result="${fixtures.target.id}"]`)
        .waitFor();
      await page
        .locator(`[data-artist-result="${fixtures.target.id}"]`)
        .click();
      await page.waitForFunction(
        (id) =>
          globalThis.document.activeElement?.getAttribute(
            "data-artist-link",
          ) === id,
        fixtures.target.id,
      );
      check(
        new globalThis.URL(page.url()).pathname === "/en" &&
          new globalThis.URL(page.url()).searchParams.get("anchorId") ===
            fixtures.target.id,
        "homepage retains its route while focusing the actual distant artist window",
      );
      await screenshot("en-home-search-anchor.png");
      await page.locator(".storefront-desktop-language button").click();
      await page
        .getByRole("menuitemradio", {
          name: LOCALE_NATIVE_NAMES["zh-CN"],
          exact: true,
        })
        .click();
      await page.waitForURL((url) => url.pathname === "/zh-CN");
      await page
        .locator(`[data-artist-link="${fixtures.target.id}"]`)
        .waitFor();
      check(
        new globalThis.URL(page.url()).searchParams.get("anchorId") ===
          fixtures.target.id &&
          new globalThis.URL(page.url()).searchParams.get("currency") === "USD",
        "homepage language navigation restores the actual anchored artist and independent currency context",
      );
      await goto(
        "/en/idols?market=GLOBAL&currency=USD&gift=rose-palace#artists",
      );
      check(
        (await page.locator("[data-artist-card]").count()) === 12,
        "initial directory does not globalThis.fetch all artists",
      );
      const secondArtist = await page
        .locator("[data-artist-link]")
        .nth(1)
        .getAttribute("data-artist-link");
      await page.locator("[data-artist-link]").first().focus();
      await page.keyboard.press("ArrowRight");
      check(
        await page.evaluate(
          (id) =>
            globalThis.document.activeElement?.getAttribute(
              "data-artist-link",
            ) === id,
          secondArtist,
        ),
        "horizontal artist track supports keyboard movement between real links",
      );
      const input = page.locator("[data-artist-search]");
      const priorQueries = proxy.observed.filter((request) => request.q).length;
      await input.dispatchEvent("compositionstart");
      await input.fill("星野一百");
      await page.waitForTimeout(400);
      check(
        proxy.observed.filter((request) => request.q).length === priorQueries,
        "IME composition does not send incomplete searches",
      );
      await input.dispatchEvent("compositionend", { data: "星野一百" });
      await page
        .locator(`[data-artist-result="${fixtures.target.id}"]`)
        .waitFor();
      check(
        (await page.locator("[data-artist-search-results] img").count()) === 0,
        "suggestions do not download unrelated portrait images",
      );
      await input.press("ArrowDown");
      await input.press("Enter");
      await page.waitForFunction(
        (id) =>
          globalThis.document.activeElement?.getAttribute(
            "data-artist-link",
          ) === id,
        fixtures.target.id,
      );
      const destination = new globalThis.URL(page.url());
      check(
        destination.searchParams.get("anchorId") === fixtures.target.id &&
          destination.searchParams.get("market") === "GLOBAL" &&
          destination.searchParams.get("currency") === "USD" &&
          destination.searchParams.get("gift") === "rose-palace",
        "search locates stable ID and preserves independent commerce query context",
      );
      check(
        (await page.locator("[data-artist-card]").count()) <= 12,
        "target 100 uses a bounded nearby window rather than preceding 100 images",
      );
      check(
        proxy.observed.some(
          (request) =>
            request.anchor === fixtures.target.id &&
            !request.q &&
            !request.after,
        ),
        "target lookup sends an independent anchor query",
      );
      await screenshot("en-directory-search-anchor.png");
      step = "language switch preserves exact deep artist and query";
      await goto(
        `/en/idols/${fixtures.target.handle}?market=GLOBAL&currency=USD&gift=rose-palace`,
      );
      for (const locale of SUPPORTED_LOCALES.filter(
        (value) => value !== "en",
      )) {
        await page.locator(".storefront-desktop-language button").click();
        await page
          .getByRole("menuitemradio", {
            name: LOCALE_NATIVE_NAMES[locale],
            exact: true,
          })
          .click();
        await page.waitForURL(
          (url) =>
            url.pathname === `/${locale}/idols/${fixtures.target.handle}`,
        );
        await page.waitForLoadState("networkidle");
        await page.locator("#artist-title").waitFor();
        const url = new globalThis.URL(page.url());
        check(
          url.searchParams.get("market") === "GLOBAL" &&
            url.searchParams.get("currency") === "USD" &&
            url.searchParams.get("gift") === "rose-palace",
          "language changes presentation while preserving all supplied commerce context",
        );
        check(
          (await page.locator("#artist-title").innerText()).includes(
            fixtures.target.name,
          ),
          "language switch preserves the selected real artist",
        );
      }
      await goto("/en/idols");
      let loads = 0;
      while (await page.locator("[data-artist-load-more]").count()) {
        check(
          loads++ < 12,
          "continuous directory loading terminates within actual total pages",
        );
        await page.locator("[data-artist-load-more]").click();
        await settleDirectory();
      }
      const ids = await page
        .locator("[data-artist-card]")
        .evaluateAll((cards) =>
          cards.map((card) => card.getAttribute("data-artist-card")),
        );
      check(
        ids.length === 120 && new Set(ids).size === 120,
        "continuous paging renders all 120 real identities exactly once",
      );
      check(
        (
          await page.locator("[data-artist-directory-status]").innerText()
        ).trim().length > 0,
        "last actual page exposes an end state",
      );
      await screenshot("en-directory-end.png");
      step = "paused artist remains readable without a purchase entry";
      await goto(`/en/idols/${fixtures.paused.handle}`);
      check(
        (await page.locator("main").innerText()).length >
          fixtures.paused.name.length,
        "paused detail has explanatory content",
      );
      check(
        (await page.locator('main a[href*="/gifts"]').count()) === 0,
        "paused artist detail offers no gift selection action",
      );
      await screenshot("en-artist-paused.png");
      step = "actual BFF failure and retry";
      const absentAnchor = await globalThis.fetch(
        `${origin}/api/storefront/idols?locale=en&limit=12&anchorId=${randomUUID()}`,
      );
      const absentAnchorValue = await absentAnchor.json();
      check(
        absentAnchor.status === 404 &&
          absentAnchorValue.code === "ANCHOR_NOT_FOUND" &&
          absentAnchor.headers.get("x-robots-tag")?.includes("noindex"),
        "actual same-origin BFF maps an absent valid anchor to 404 and noindex",
      );
      await goto("/en/idols");
      proxy.setFailure("/api/v1/idols");
      await page.locator("[data-artist-load-more]").click();
      await page.locator("[data-artist-retry]").waitFor();
      check(
        (await page.locator("[data-artist-card]").count()) === 12,
        "failed append retains the last successful artist window",
      );
      await screenshot("en-directory-network-error.png");
      proxy.setFailure(null);
      await page.locator("[data-artist-retry]").click();
      await settleDirectory();
      check(
        (await page.locator("[data-artist-card]").count()) === 24,
        "explicit retry resumes the same actual next window",
      );
      step = "stale cursor after actual catalog change";
      await goto("/en/idols");
      const changed = fixtures.artists[10];
      const current = await content.request(
        "/api/v1/admin/catalog/owners/read",
        { target: changed.owner, locale: "en" },
      );
      await content.write("/api/v1/admin/catalog/idols/status", {
        idolId: changed.id,
        status: current.owner.status === "paused" ? "active" : "paused",
        acceptingGifts: current.owner.status === "paused",
        expectedBaseVersion: current.owner.baseVersion,
      });
      await page.locator("[data-artist-load-more]").click();
      await page.locator("[data-artist-reload]").waitFor();
      await screenshot("en-directory-catalog-changed.png");
      await page.locator("[data-artist-reload]").click();
      await settleDirectory();
      check(
        (await page.locator("[data-artist-card]").count()) === 12,
        "stale catalog reload resets instead of duplicating or mixing cursor versions",
      );
      step = "real image gateway failure";
      await page.setViewportSize({ width: 390, height: 844 });
      await goto("/en");
      const intactFrame = await page
        .locator(".storefront-hero-image")
        .boundingBox();
      await page.route("**/_next/image?**", (route) => route.abort("failed"));
      await goto("/en");
      await page.locator(".storefront-image-fallback").waitFor();
      const failedFrame = await page
        .locator(".storefront-hero-image")
        .boundingBox();
      check(
        Math.abs(intactFrame.height - failedFrame.height) < 1 &&
          Math.abs(intactFrame.width - failedFrame.width) < 1,
        "mobile hero image failure retains the same reserved geometry",
      );
      await screenshot("en-home-image-error.png");
      await page.unroute("**/_next/image?**");
      await goto("/en");
      await images("image-failure-recovery");
      proxy.setFailure("/api/v1/storefront-homepage");
      await goto("/en");
      check(
        (await page.locator(".storefront-state").count()) === 1,
        "real homepage transport failure renders stable recovery content",
      );
      await screenshot("en-home-network-error.png");
      proxy.setFailure(null);
      await goto("/en");
      step = "narrow and equivalent zoom reflow";
      for (const width of [320, 720])
        for (const route of [
          "/pt",
          "/th/idols",
          `/ja/idols/${fixtures.artists[0].handle}`,
        ]) {
          await page.setViewportSize({
            width,
            height: width === 720 ? 450 : 844,
          });
          await goto(route);
          await noOverflow(`${route}-${width}`);
        }
      await page.setViewportSize({ width: 390, height: 844 });
      await goto("/en");
      const menu = page.locator(".storefront-mobile-menu button").first();
      await menu.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor();
      await page.waitForFunction(() =>
        [globalThis.document.body, globalThis.document.documentElement].some(
          (element) =>
            ["hidden", "clip"].includes(
              globalThis.getComputedStyle(element).overflow,
            ),
        ),
      );
      const beforeWheel = await page.evaluate(() => globalThis.scrollY);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(120);
      check(
        Math.abs(
          (await page.evaluate(() => globalThis.scrollY)) - beforeWheel,
        ) <= 1,
        "mobile menu prevents actual background wheel scrolling after its lock effect mounts",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          globalThis.document.activeElement ===
          globalThis.document.querySelector(".storefront-mobile-menu button"),
      );
      check(
        await menu.evaluate(
          (element) => element === globalThis.document.activeElement,
        ),
        "closing mobile menu returns keyboard focus",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await goto("/en");
      await screenshot("en-home-normal-motion.png");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await axe("mobile-menu-closed");
      for (const route of ["/xx", "/en/idols/no-such-artist"]) {
        const response = await page.goto(origin + route, {
          waitUntil: "domcontentloaded",
        });
        check(response?.status() === 404, `${route} correctly returns 404`);
      }
      check(
        report.consoleErrors.length === 0,
        "real browsing raises no unhandled browser page errors",
      );
      step =
        "actual responsive candidates and strict optimizer transport boundaries";
      await imageChecks.verifyCandidates();
      report.images = imageChecks.evidence();
      report.cases.push({
        name: "complete-directory-search-language-errors-keyboard",
        pass: true,
      });
      await writeFile(
        path.join(output, "accessibility.json"),
        JSON.stringify(
          {
            ...report,
            performanceEvidence: production
              ? "Local production-build laboratory observations only"
              : "Development server; no production globalThis.performance claim",
            nativeZoomEvidence: false,
          },
          null,
          2,
        ) + "\n",
      );
    } catch (error) {
      console.error(`Storefront browser failed at ${step}`);
      await writeFile(
        path.join(output, "browser-failure.json"),
        JSON.stringify(
          {
            step,
            name: error?.name,
            assertion:
              error?.name === "AssertionError" ? error.message : "OMITTED",
            report,
          },
          null,
          2,
        ) + "\n",
      );
      await page
        .screenshot({
          path: path.join(output, "browser-failure.png"),
          fullPage: true,
        })
        .catch(() => undefined);
      throw error;
    } finally {
      proxy.setFailure(null);
      gateway.setFailure(false);
    }
  }
  return {
    verifyEmpty,
    verifyPublished,
    evidence: () => report,
    close: () => browser.close(),
  };
}
