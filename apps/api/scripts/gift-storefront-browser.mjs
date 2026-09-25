import { createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  SUPPORTED_LOCALES,
  LOCALE_NATIVE_NAMES,
  CART_RUNTIME_MAX_QUANTITY,
  giftDirectoryResponseSchema,
} from "@fan-support/contracts";
import { createStorefrontImageChecks } from "./storefront-image-checks.mjs";

/** Synthetic fixture only. No cookies, HAR, traces, request payloads or signed URLs are persisted. */
export async function verifyGiftStorefrontBrowser({
  origin,
  base,
  output,
  gateway,
  proxy,
  fixtures,
  check,
  ui,
  attempt = 1,
}) {
  const directory = path.join(output, `browser-attempt-${attempt}`);
  await mkdir(directory, { recursive: true });
  const certificate = new X509Certificate(
    await readFile(gateway.certificatePath),
  );
  const pin = createHash("sha256")
    .update(certificate.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
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
  const page = await context.newPage();
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    browserVersion: browser.version(),
    attempt,
    cases: [],
    screenshots: [],
    axe: [],
    reflow: [],
    metrics: [],
    pageErrors: [],
  };
  const images = createStorefrontImageChecks({ origin, gateway, check });
  let step = "initialization";
  page.on("pageerror", (error) =>
    report.pageErrors.push({
      name: error.name,
      detail: "Runtime message omitted; inspect locally",
    }),
  );
  await context.addInitScript(() => {
    globalThis.__giftTestVitals = { lcp: 0, cls: 0 };
    for (const type of ["largest-contentful-paint", "layout-shift"]) {
      if (!globalThis.PerformanceObserver.supportedEntryTypes.includes(type))
        continue;
      new globalThis.PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (type === "largest-contentful-paint")
            globalThis.__giftTestVitals.lcp = entry.startTime;
          else if (!entry.hadRecentInput)
            globalThis.__giftTestVitals.cls += entry.value;
        }
      }).observe({ type, buffered: true });
    }
  });
  const scope = fixtures.markets[0];
  const params = (extra = {}) =>
    new globalThis.URLSearchParams({ ...scope, ...extra }).toString();
  const detail = (index = 0, extra = {}, locale = "en") =>
    `/${locale}/gifts/${fixtures.gifts[index].handle}?${params(extra)}`;
  const same = (actual, expected, label) =>
    check(JSON.stringify(actual) === JSON.stringify(expected), label);
  async function goto(route, status = 200) {
    step = route.split("?")[0];
    const response = await page.goto(origin + route, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    check(
      response?.status() === status,
      `browser ${step} has expected HTTP ${status}`,
    );
    await page.locator("main").waitFor();
    await page.evaluate(() =>
      globalThis.document.fonts.ready.then(() => undefined),
    );
    return response;
  }
  async function screenshot(name, force = false) {
    if (!ui && !force) return;
    await page.screenshot({
      path: path.join(directory, `${name}.png`),
      fullPage: true,
      animations: "disabled",
    });
    report.screenshots.push(`${name}.png`);
  }
  async function reflow(name) {
    const value = await page.evaluate(() => ({
      width: globalThis.innerWidth,
      scrollWidth: globalThis.document.documentElement.scrollWidth,
      bodyWidth: globalThis.document.body.scrollWidth,
    }));
    report.reflow.push({ name, ...value });
    check(
      value.scrollWidth <= value.width + 1 &&
        value.bodyWidth <= value.width + 1,
      `${name} has no page-level horizontal overflow`,
    );
  }
  async function axe(name) {
    const require = createRequire(
      new globalThis.URL("../../../package.json", import.meta.url),
    );
    const { default: AxeBuilder } = require("@axe-core/playwright");
    const result = await new AxeBuilder({ page }).analyze();
    const simplify = (items) =>
      items.map(({ id, impact, nodes }) => ({
        id,
        impact,
        nodes: nodes.map(({ target, failureSummary }) => ({
          target,
          failureSummary,
        })),
      }));
    report.axe.push({
      name,
      engineVersion: result.testEngine.version,
      violations: simplify(result.violations),
      incomplete: simplify(result.incomplete),
    });
    check(result.violations.length === 0, `${name} has zero axe violations`);
  }
  async function loadedImages(name) {
    await page.locator("main img").evaluateAll(async (entries) => {
      for (const image of entries) {
        image.loading = "eager";
        try {
          await image.decode();
        } catch {
          /* Verified below. */
        }
      }
    });
    const loaded = await page
      .locator("main img")
      .evaluateAll((entries) =>
        entries.map((image) => image.complete && image.naturalWidth > 0),
      );
    check(
      loaded.length > 0 && loaded.every(Boolean),
      `${name} renders actual published media bytes`,
    );
    await images.observe(page);
    const metric = await page.evaluate(() => ({
      ...globalThis.__giftTestVitals,
      imageTransferBytes: globalThis.performance
        .getEntriesByType("resource")
        .filter((entry) => entry.initiatorType === "img")
        .reduce((sum, entry) => sum + entry.transferSize, 0),
    }));
    report.metrics.push({ name, ...metric });
  }
  async function cardsMatchUrl() {
    const url = new globalThis.URL(page.url());
    url.searchParams.set("locale", url.pathname.split("/")[1]);
    url.searchParams.set("pageSize", "12");
    for (const key of [...url.searchParams.keys()])
      if (
        ![
          "locale",
          "market",
          "currency",
          "idol",
          "page",
          "pageSize",
          "sort",
          "category",
          "availability",
          "priceMinMinor",
          "priceMaxMinor",
        ].includes(key)
      )
        url.searchParams.delete(key);
    const response = await globalThis.fetch(
      `${base}/api/v1/gifts?${url.searchParams}`,
    );
    const expected = giftDirectoryResponseSchema.parse(await response.json());
    check(
      response.status === 200 && expected.outcome === "SUCCESS",
      "browser oracle reads the same actual scoped PostgreSQL directory",
    );
    same(
      await page
        .locator("[data-gift-card]")
        .evaluateAll((entries) =>
          entries.map((entry) => entry.getAttribute("data-gift-card")),
        ),
      expected.items.map((item) => item.gift.id),
      "rendered gift sequence equals the real API for the exact URL query",
    );
    return expected;
  }
  async function openDesktopFilters() {
    const disclosure = page.locator(".gift-filter-disclosure");
    if ((await disclosure.getAttribute("open")) === null)
      await disclosure.locator("summary").click();
    await page.locator('[data-gift-filters="desktop"]').waitFor({
      state: "visible",
    });
  }
  async function navigateBy(locator) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle" }),
      locator.click(),
    ]);
  }
  try {
    step = "market selection without implicit defaults";
    await goto("/en/gifts");
    check(
      (await page.locator("[data-market-choices]").count()) === 1 &&
        (await page.locator("[data-gift-card]").count()) === 0,
      "no market scope presents actual region choices without guessed prices",
    );
    check(
      (await page.locator("[data-market]").count()) === 2,
      "region choices come from both actual enabled TEST scopes",
    );
    await goto(`/${SUPPORTED_LOCALES[0]}/gifts?${params()}`);
    check(
      (await cardsMatchUrl()).items.length === 12,
      "default storefront page contains twelve gifts",
    );
    await loadedImages("smoke-directory");
    if (!ui) await screenshot("smoke-mobile-directory", true);
    await goto(detail());
    check(
      (await page
        .locator(`[data-gift-detail="${fixtures.gifts[0].id}"]`)
        .count()) === 1,
      "published detail belongs to actual gift identity",
    );
    check(
      (await page.locator("[data-gift-variant]").count()) === 3,
      "detail exposes all three actually published variants",
    );
    check(
      (await page.locator("form[data-cart-add]").count()) === 0 &&
        (await page.locator("[data-cart-add-state]").count()) === 0 &&
        (await page.getByRole("spinbutton").count()) === 0,
      "gift browsing without a valid recipient exposes no add form, submit action or quantity",
    );
    check(
      (await page.locator(".gift-description-blocks > *").count()) === 5 &&
        (await page.locator(".gift-description-blocks dl dd").count()) === 2,
      "all five approved block kinds render with actual specifications and media",
    );
    await loadedImages("smoke-detail");
    if (!ui) {
      await screenshot("smoke-mobile-detail", true);
      await page.setViewportSize({ width: 1440, height: 900 });
      await screenshot("smoke-desktop-detail", true);
    }
    if (!ui) {
      report.status = "PASS";
      return report;
    }

    for (const locale of SUPPORTED_LOCALES)
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        const label = `${locale}-${viewport.width}`;
        for (const [kind, route] of [
          ["directory", `/${locale}/gifts?${params()}`],
          ["detail", detail(0, {}, locale)],
          ["policy", `/${locale}/policies/terms?${params()}`],
        ]) {
          await goto(route);
          check(
            (await page.locator(".storefront").getAttribute("lang")) === locale,
            `${label} public document owns requested locale`,
          );
          check(
            (
              await page.locator('link[rel="canonical"]').getAttribute("href")
            )?.includes(`/${locale}/`),
            `${label} canonical URL owns its language`,
          );
          if (kind === "directory") await cardsMatchUrl();
          if (kind !== "policy") await loadedImages(`${label}-${kind}`);
          else
            check(
              (await page
                .locator('[data-policy="terms"] .gift-policy-body p')
                .count()) > 0,
              "policy renders approved HTML structure as paragraphs",
            );
          await reflow(`${label}-${kind}`);
          await screenshot(`${label}-${kind}`);
          if (
            locale === "en" ||
            (viewport.width === 390 &&
              kind === "directory" &&
              ["zh-CN", "th", "vi", "pt"].includes(locale))
          )
            await axe(`${label}-${kind}`);
        }
      }
    report.cases.push({
      name: "seven-locales-two-viewports-directory-detail-policy",
      pass: true,
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(`/en/gifts?${params({ sort: "PRICE_ASC", page: "1" })}`);
    const first = await cardsMatchUrl();
    await navigateBy(page.locator("a[data-gift-next]"));
    const second = await cardsMatchUrl();
    check(
      new globalThis.URL(page.url()).searchParams.get("page") === "2" &&
        !second.items.some((item) =>
          first.items.some((previous) => previous.gift.id === item.gift.id),
        ),
      "real page two has no page-one duplicates",
    );
    await navigateBy(page.locator("a[data-gift-next]"));
    check(
      (await cardsMatchUrl()).items.length === 1 &&
        (await page
          .locator('[data-gift-next][aria-disabled="true"]')
          .count()) === 1,
      "last page contains the actual remaining gift and cannot advance",
    );
    await page.goBack({ waitUntil: "networkidle" });
    await cardsMatchUrl();
    check(
      (await page
        .locator('[data-gift-page="2"]')
        .getAttribute("aria-current")) === "page",
      "native Back restores the previous SSR page",
    );
    const filters = page.locator('[data-gift-filters="desktop"]');
    const toolbarSort = page.locator("[data-gift-toolbar-sort]");
    const beforeSort = page.url();
    await toolbarSort.selectOption("PRICE_DESC");
    check(
      page.url() === beforeSort,
      "changing the desktop sort selection does not navigate before explicit submit",
    );
    await navigateBy(page.locator("[data-gift-toolbar-apply]"));
    const sorted = new globalThis.URL(page.url());
    check(
      sorted.searchParams.get("sort") === "PRICE_DESC" &&
        sorted.searchParams.get("page") === "1" &&
        sorted.searchParams.get("market") === scope.market &&
        sorted.searchParams.get("currency") === scope.currency,
      "explicit desktop sort submit resets page and preserves the actual market and currency",
    );
    await cardsMatchUrl();
    await openDesktopFilters();
    await filters.locator("[data-gift-price-min]").fill("10.00");
    await filters.locator("[data-gift-price-max]").fill("20.00");
    await navigateBy(filters.locator("[data-gift-apply]"));
    const applied = new globalThis.URL(page.url());
    check(
      applied.searchParams.get("page") === "1" &&
        applied.searchParams.get("sort") === "PRICE_DESC" &&
        applied.searchParams.get("priceMinMinor") === "1000" &&
        applied.searchParams.get("priceMaxMinor") === "2000",
      "filter apply resets page and transports exact integer minor amounts",
    );
    await cardsMatchUrl();
    await page.goBack({ waitUntil: "networkidle" });
    await cardsMatchUrl();
    check(
      (await toolbarSort.inputValue()) === "PRICE_DESC" &&
        (await filters.locator("[data-gift-price-min]").inputValue()) === "" &&
        new globalThis.URL(page.url()).searchParams.get("page") === "1",
      "native Back restores the directly sorted page before amount filters",
    );
    await page.goBack({ waitUntil: "networkidle" });
    await cardsMatchUrl();
    check(
      (await toolbarSort.inputValue()) === "PRICE_ASC" &&
        (await filters.locator("[data-gift-price-min]").inputValue()) === "" &&
        new globalThis.URL(page.url()).searchParams.get("page") === "2",
      "native Back restores the URL's original page and applied filter controls",
    );
    await openDesktopFilters();
    const beforeInvalidRange = page.url();
    await filters.locator("[data-gift-price-min]").fill("30.00");
    await filters.locator("[data-gift-price-max]").fill("20.00");
    await filters.locator("[data-gift-apply]").click();
    await filters
      .locator('[data-gift-price-max][aria-invalid="true"]')
      .waitFor();
    check(
      page.url() === beforeInvalidRange,
      "reversed price range reports a field error without navigating",
    );
    await goto(`/en/gifts?${params({ page: "4" })}`);
    check(
      (await page.locator('[data-gift-page-out-of-range="true"]').count()) ===
        1,
      "out-of-range page has explicit recovery state",
    );
    await screenshot("en-page-out-of-range");
    await goto(`/en/gifts?${params({ category: "FOOD" })}`);
    check(
      (await page.locator("[data-gift-empty]").count()) === 1 &&
        (await page.locator("[data-gift-card]").count()) === 0,
      "real empty filter result does not fabricate products",
    );
    await screenshot("en-filter-empty");
    report.cases.push({
      name: "pagination-sort-precise-money-back-empty-range",
      pass: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await goto(`/pt/gifts?${params()}`);
    const trigger = page.locator(
      '.gift-filters__mobile [data-overlay-trigger="drawer"]',
    );
    await trigger.click();
    const mobile = page.locator('[data-gift-filters="mobile"]');
    await mobile.waitFor({ state: "visible" });
    report.filterFocus = [];
    for (let tab = 0; tab < 12; tab++) {
      await page.keyboard.press("Tab");
      const focus = await page.getByRole("dialog").evaluate((element) => ({
        inside: element.contains(globalThis.document.activeElement),
        guard:
          globalThis.document.activeElement?.hasAttribute(
            "data-base-ui-focus-guard",
          ) === true,
        guardType: globalThis.document.activeElement?.getAttribute("data-type"),
      }));
      report.filterFocus.push({ tab: tab + 1, ...focus });
      // Match the audited P2 interaction verifier: only its known inside sentinel may be transient.
      check(
        focus.inside || (focus.guard && focus.guardType === "inside"),
        "mobile modal rejects every outside focus except the known Base UI inside sentinel",
      );
      if (!focus.inside)
        await page.waitForFunction(
          () =>
            globalThis.document
              .querySelector('[data-overlay-popup="drawer"]')
              ?.contains(globalThis.document.activeElement) === true,
          undefined,
          { timeout: 500 },
        );
      check(
        await page
          .getByRole("dialog")
          .evaluate((element) =>
            element.contains(globalThis.document.activeElement),
          ),
        "mobile filter keyboard focus remains within the open modal",
      );
    }
    await mobile.locator("[data-gift-price-min]").fill("10,50");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      globalThis.document.activeElement?.matches(
        '.gift-filters__mobile [data-overlay-trigger="drawer"]',
      ),
    );
    check(
      await trigger.evaluate(
        (element) => element === globalThis.document.activeElement,
      ),
      "Escape closes mobile filters and restores trigger focus",
    );
    await trigger.click();
    check(
      (await mobile.locator("[data-gift-price-min]").inputValue()) === "",
      "cancelled mobile draft does not leak into reopened filters",
    );
    const composingInput = mobile.locator("[data-gift-price-min]");
    const beforeComposition = page.url();
    await composingInput.dispatchEvent("compositionstart", { data: "10" });
    await composingInput.fill("10,50");
    await composingInput.press("Enter");
    await page.waitForTimeout(300);
    check(
      page.url() === beforeComposition,
      "IME composition Enter does not apply a partial mobile price draft",
    );
    await composingInput.dispatchEvent("compositionend", { data: "10,50" });
    await mobile.locator("[data-gift-price-max]").fill("20,00");
    await navigateBy(mobile.locator("[data-gift-apply]"));
    check(
      new globalThis.URL(page.url()).searchParams.get("priceMinMinor") ===
        "1050",
      "Portuguese mobile comma input transports 1050 exact minor units",
    );
    await cardsMatchUrl();
    await screenshot("pt-mobile-filter-applied");
    report.cases.push({
      name: "mobile-drawer-keyboard-ime-localized-price",
      pass: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(
      `/ja/gifts?${new globalThis.URLSearchParams(fixtures.markets[1])}`,
    );
    await openDesktopFilters();
    const beforeFraction = page.url();
    await filters.locator("[data-gift-price-min]").fill("10.5");
    await filters.locator("[data-gift-apply]").click();
    await filters
      .locator('[data-gift-price-min][aria-invalid="true"]')
      .waitFor();
    check(
      page.url() === beforeFraction,
      "JPY rejects a fractional major amount without navigation",
    );
    await filters.locator("[data-gift-price-min]").fill("1000");
    await filters.locator("[data-gift-price-max]").fill("2000");
    await navigateBy(filters.locator("[data-gift-apply]"));
    check(
      new globalThis.URL(page.url()).searchParams.get("priceMinMinor") ===
        "1000" &&
        new globalThis.URL(page.url()).searchParams.get("priceMaxMinor") ===
          "2000",
      "JPY whole major amounts stay equal to exact minor units",
    );
    await cardsMatchUrl();
    report.cases.push({
      name: "invalid-range-and-jpy-integer-price-input",
      pass: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });

    await goto(detail());
    check(
      (await page.getByRole("spinbutton").count()) === 0,
      "unselected artist keeps quantity unavailable while showing starting-price context",
    );
    await page
      .locator('[data-gift-recipient-picker] [data-overlay-trigger="drawer"]')
      .click();
    check(
      await page
        .locator(`[data-recipient-option="${fixtures.artists[2].id}"]`)
        .isDisabled(),
      "paused artist cannot be chosen as a new gift recipient",
    );
    await navigateBy(
      page.locator(`[data-recipient-option="${fixtures.artists[0].id}"]`),
    );
    check(
      (await page
        .locator(`[data-selected-recipient="${fixtures.artists[0].id}"]`)
        .count()) === 1,
      "chosen real artist persists in URL-backed detail",
    );
    await navigateBy(
      page.locator(`[data-gift-variant="${fixtures.gifts[0].variants[1].id}"]`),
    );
    const quantity = page.getByRole("spinbutton");
    const selectedAdd = page.locator("form[data-cart-add]");
    check(
      (await selectedAdd.count()) === 1 &&
        (await selectedAdd
          .locator('[data-cart-add-state][type="submit"]')
          .count()) === 1 &&
        (await selectedAdd.locator("[data-cart-add-state]").isEnabled()),
      "choosing a valid recipient and available variant exposes the real enabled add form",
    );
    check(
      (await quantity.getAttribute("aria-valuemax")) === "5",
      "TRACKED quantity bound equals actual available stock",
    );
    await quantity.focus();
    await page.keyboard.press("End");
    check(
      (await quantity.inputValue()) === "5",
      "keyboard quantity cannot exceed tracked stock",
    );
    await page.keyboard.press("ArrowUp");
    check(
      (await quantity.inputValue()) === "5",
      "tracked stock upper bound holds on repeated increase",
    );
    await screenshot("en-tracked-selected");
    await navigateBy(page.locator(".gift-breadcrumb a"));
    await navigateBy(
      page.locator(`[data-gift-link="${fixtures.gifts[23].id}"]`),
    );
    check(
      !new globalThis.URL(page.url()).searchParams.has("variant") &&
        new globalThis.URL(page.url()).searchParams.get("idol") ===
          fixtures.artists[0].id,
      "browsing from gift A to gift B drops A's variant while preserving the recipient",
    );
    check(
      (await page
        .locator(`[data-gift-detail="${fixtures.gifts[23].id}"]`)
        .count()) === 1 &&
        (await page
          .locator("[data-gift-offer]")
          .getAttribute("data-availability")) === "AVAILABLE",
      "gift B selects its own actual available offer instead of inheriting a foreign variant",
    );
    report.cases.push({
      name: "cross-gift-navigation-clears-foreign-variant",
      pass: true,
    });
    await goto(
      detail(0, {
        idol: fixtures.artists[1].id,
        variant: fixtures.gifts[0].variants[1].id,
      }),
    );
    check(
      (await page
        .locator("[data-gift-offer]")
        .getAttribute("data-availability")) === "UNAVAILABLE" &&
        (await page.getByRole("spinbutton").count()) === 0 &&
        (await page.locator("form[data-cart-add]").count()) === 0 &&
        (await page.locator("[data-cart-add-state]").count()) === 0,
      "known but ineligible artist prevents this tracked variant and exposes no add submission",
    );
    await screenshot("en-ineligible-recipient");
    for (const [index, availability, policy, extra] of [
      [1, "AVAILABLE", "TRACKED", { idol: fixtures.artists[0].id }],
      [2, "UNAVAILABLE", "TRACKED", { idol: fixtures.artists[0].id }],
      [3, "PREORDER", "PREORDER", { idol: fixtures.artists[0].id }],
      [4, "AVAILABLE", "PROCURE_ON_DEMAND", { idol: fixtures.artists[0].id }],
      [
        24,
        "UNAVAILABLE",
        "PROCURE_ON_DEMAND",
        { idol: fixtures.artists[0].id },
      ],
      [7, "UNAVAILABLE", "PROCURE_ON_DEMAND", { idol: fixtures.artists[2].id }],
    ]) {
      await goto(detail(index, extra));
      const offer = page.locator("[data-gift-offer]");
      check(
        (await offer.getAttribute("data-availability")) === availability &&
          (await offer.getAttribute("data-inventory-policy")) === policy,
        "detail preserves actual stock, procurement, preorder and paused semantics",
      );
      const addForm = offer.locator("form[data-cart-add]");
      if (availability === "UNAVAILABLE") {
        check(
          (await addForm.count()) === 0 &&
            (await page.locator("[data-cart-add-state]").count()) === 0 &&
            (await page.getByRole("spinbutton").count()) === 0,
          "unavailable stock, price or recipient exposes no add form, submit action or quantity",
        );
      } else {
        check(
          (await addForm.count()) === 1 &&
            (await addForm
              .locator('[data-cart-add-state][type="submit"]')
              .count()) === 1 &&
            (await addForm.locator("[data-cart-add-state]").isEnabled()) &&
            (await addForm.getByRole("spinbutton").count()) === 1,
          "available or preorder offers for a valid recipient expose the real enabled add form",
        );
      }
      if (index === 1)
        check(
          (await page.getByRole("spinbutton").getAttribute("aria-valuemax")) ===
            "1",
          "one remaining tracked unit has exact quantity maximum one",
        );
      if (index === 4)
        check(
          (await page.getByRole("spinbutton").getAttribute("aria-valuemax")) ===
            String(CART_RUNTIME_MAX_QUANTITY) &&
            (await page.locator("[data-stock-remaining]").count()) === 0,
          "on-demand enforces the canonical cart quantity limit without claiming stock exists",
        );
      await screenshot(`en-gift-state-${index + 1}`);
    }
    await goto(
      detail(0, {
        idol: fixtures.artists[0].id,
        variant: fixtures.gifts[0].variants[2].id,
        page: "2",
        priceMinMinor: "1000",
        priceMaxMinor: "2000",
      }),
    );
    const beforeScope = new globalThis.URL(page.url()).searchParams;
    await navigateBy(
      page.locator('[data-market="JAPAN"][data-currency="JPY"]'),
    );
    const afterScope = new globalThis.URL(page.url()).searchParams;
    check(
      afterScope.get("market") === "JAPAN" &&
        afterScope.get("currency") === "JPY" &&
        afterScope.get("idol") === beforeScope.get("idol") &&
        !afterScope.has("variant") &&
        !afterScope.has("page") &&
        !afterScope.has("priceMinMinor") &&
        !afterScope.has("priceMaxMinor"),
      "explicit market switch preserves gift and artist while clearing old variant, page and scoped price filters",
    );
    await navigateBy(
      page.locator(`[data-gift-variant="${fixtures.gifts[0].variants[2].id}"]`),
    );
    report.cases.push({
      name: "recipient-variant-quantity-availability-market",
      pass: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const preservedQuery = new globalThis.URL(page.url()).search;
    for (const locale of SUPPORTED_LOCALES.filter((value) => value !== "en")) {
      await page.locator(".storefront-desktop-language button").click();
      await navigateBy(
        page.getByRole("menuitemradio", {
          name: LOCALE_NATIVE_NAMES[locale],
          exact: true,
        }),
      );
      const changed = new globalThis.URL(page.url());
      check(
        changed.pathname === `/${locale}/gifts/${fixtures.gifts[0].handle}` &&
          changed.search === preservedQuery,
        "actual language control preserves exact gift, recipient, variant, market and currency query",
      );
      check(
        (await page
          .locator(`[data-selected-recipient="${fixtures.artists[0].id}"]`)
          .count()) === 1 &&
          (await page
            .locator(
              `[data-gift-variant="${fixtures.gifts[0].variants[2].id}"]`,
            )
            .getAttribute("aria-current")) === "true",
        "language change restores the actual selected recipient and preorder variant",
      );
    }
    report.cases.push({
      name: "seven-language-context-preservation",
      pass: true,
    });

    proxy.setFailure("/api/v1/gifts");
    await goto(`/en/gifts?${params()}`);
    check(
      (await page
        .locator('[data-gift-directory][data-outcome="failure"]')
        .count()) === 1 &&
        (await page.locator("[data-gift-card]").count()) === 0,
      "real API transport failure renders explicit retry without stale products",
    );
    await screenshot("en-directory-transport-error");
    proxy.setFailure(null);
    await navigateBy(page.locator("[data-gift-retry]"));
    await cardsMatchUrl();
    await goto(detail());
    const frame = await page.locator(".gift-main-image").boundingBox();
    await page.route("**/_next/image?**", (route) =>
      route.fulfill({ status: 503, body: "" }),
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('.gift-main-image [role="img"]').waitFor();
    const failedFrame = await page.locator(".gift-main-image").boundingBox();
    check(
      Math.abs(frame.height - failedFrame.height) < 1,
      "failed gift image preserves its real image frame",
    );
    await screenshot("en-gift-image-error");
    await page.unroute("**/_next/image?**");
    for (const locale of SUPPORTED_LOCALES)
      await goto(`/${locale}/gifts/missing-gift-handle`, 404);
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 844 });
      await goto(detail());
      await reflow(`narrow-${width}`);
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await goto(detail());
    await loadedImages("normal-motion-detail");
    await page.emulateMedia({ reducedMotion: "reduce" });
    check(
      await page.evaluate(
        () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "real browser reduced-motion preference is active",
    );
    report.cases.push({
      name: "transport-image-failures-404-reflow-motion",
      pass: true,
    });
    await images.verifyCandidates();
    report.responsiveImages = images.evidence();
    check(
      report.pageErrors.length === 0,
      "real browsing has no unhandled page errors",
    );
    report.status = "PASS";
    return report;
  } catch (error) {
    report.status = "FAIL";
    report.failure = {
      step,
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    };
    await screenshot("diagnostic-failure", true);
    throw error;
  } finally {
    proxy.setFailure(null);
    report.metricScope =
      "Local unthrottled observations; imageTransferBytes is sampled after eagerly decoding all DOM images, not a first-viewport budget. Formal performance budget remains P3-06.";
    await writeFile(
      path.join(directory, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    await browser.close();
  }
}
