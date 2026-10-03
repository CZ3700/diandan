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
          "kind",
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
    // An in-place change (L2-17) updates the address and the cards together; give the
    // transition a moment before the exact comparison below records any mismatch.
    await page
      .waitForFunction(
        (ids) =>
          JSON.stringify(
            [...globalThis.document.querySelectorAll("[data-gift-card]")].map(
              (entry) => entry.getAttribute("data-gift-card"),
            ),
          ) === JSON.stringify(ids) &&
          !globalThis.document.querySelector("[data-gift-pending]"),
        expected.outcome === "SUCCESS"
          ? expected.items.map((item) => item.gift.id)
          : [],
        { timeout: 15000 },
      )
      .catch(() => undefined);
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
  /** Follow a gift toolbar or pagination link: the address changes without a page load. */
  async function inPlace(locator) {
    const before = page.url();
    await page.evaluate(() => {
      globalThis.__giftDocument = "kept";
    });
    await locator.click();
    await page.waitForURL((url) => url.href !== before);
    await page
      .locator("[data-gift-navigation]:not([data-gift-pending])")
      .first()
      .waitFor();
    await page.waitForLoadState("networkidle");
    check(
      (await page.evaluate(() => globalThis.__giftDocument)) === "kept",
      "a gift toolbar or pagination link changes the list without loading a new document",
    );
  }
  async function back() {
    const before = page.url();
    await page.goBack();
    await page.waitForURL((url) => url.href !== before);
    await page.waitForLoadState("networkidle");
  }
  async function navigateBy(locator) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle" }),
      locator.click(),
    ]);
  }
  try {
    step = "market selection without implicit defaults";
    // ADR-017 addendum: with two published scopes the directory is readable but never priced.
    await goto("/en/gifts");
    check(
      (await page.locator("[data-gift-browse]").count()) === 1 &&
        (await page.locator("[data-gift-card]").count()) > 0 &&
        (await page.locator("[data-gift-browse][data-gift-priced]").count()) ===
          0 &&
        (await page.locator(".gift-directory-card__price").count()) === 0,
      "no market scope presents the content directory without guessed prices",
    );
    await goto("/en/region");
    check(
      (await page.locator("[data-market-choices] [data-market]").count()) === 2,
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
    // L2-17 (user request 2026-09-30): the gift page is the photo, the summary and the
    // purchase; the separate details and delivery sections are gone.
    check(
      (await page
        .locator(
          ".gift-detail-information, .gift-description-blocks, #gift-information-title, #gift-delivery-title",
        )
        .count()) === 0 &&
        // This fixture's summary repeats its subtitle and its long text is a structured
        // legacy document, which the page no longer shows (SPEC 6.1.0): the subtitle stays.
        (await page
          .locator(
            ".gift-detail-summary :is(.gift-subtitle, .gift-short-description)",
          )
          .count()) >= 1,
      "the gift page shows its summary and no separate details or delivery section",
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
    await inPlace(page.locator("a[data-gift-next]"));
    const second = await cardsMatchUrl();
    check(
      new globalThis.URL(page.url()).searchParams.get("page") === "2" &&
        !second.items.some((item) =>
          first.items.some((previous) => previous.gift.id === item.gift.id),
        ),
      "real page two has no page-one duplicates",
    );
    await inPlace(page.locator("a[data-gift-next]"));
    check(
      (await cardsMatchUrl()).items.length === 1 &&
        (await page
          .locator('[data-gift-next][aria-disabled="true"]')
          .count()) === 1,
      "last page contains the actual remaining gift and cannot advance",
    );
    await back();
    await cardsMatchUrl();
    check(
      (await page
        .locator('[data-gift-page="2"]')
        .getAttribute("aria-current")) === "page",
      "native Back restores the previous page",
    );
    // L2-17 (user request 2026-09-30): the toolbar is one row of kinds and a price order.
    // Each choice is a link that takes effect at once; there is no panel and no apply step.
    check(
      (await page
        .locator(
          "[data-gift-directory] form, [data-gift-directory] select, [data-gift-directory] details, [data-gift-directory] button",
        )
        .count()) === 0,
      "the gift toolbar has no form, select, disclosure or apply button",
    );
    const ascending = page.locator('[data-gift-sort-option="PRICE_ASC"]');
    const descending = page.locator('[data-gift-sort-option="PRICE_DESC"]');
    check(
      (await ascending.getAttribute("aria-current")) === "true" &&
        (await descending.getAttribute("aria-current")) === null,
      "the toolbar marks the address's price order",
    );
    await inPlace(descending);
    const sorted = new globalThis.URL(page.url());
    check(
      sorted.searchParams.get("sort") === "PRICE_DESC" &&
        sorted.searchParams.get("page") === "1" &&
        sorted.searchParams.get("market") === scope.market &&
        sorted.searchParams.get("currency") === scope.currency,
      "choosing a price order returns to page one and preserves the actual market and currency",
    );
    check(
      (await descending.getAttribute("aria-current")) === "true" &&
        (await ascending.getAttribute("aria-current")) === null,
      "the chosen price order is marked",
    );
    await cardsMatchUrl();
    const kinds = await page
      .locator("[data-gift-kind-option]")
      .evaluateAll((links) =>
        links.map((link) => link.getAttribute("data-gift-kind-option")),
      );
    check(
      kinds[0] === "ALL" && kinds.length >= 5,
      "the toolbar offers all kinds first, then the four gift kinds",
    );
    await inPlace(page.locator(`[data-gift-kind-option="${kinds[1]}"]`));
    const chosen = new globalThis.URL(page.url());
    check(
      chosen.searchParams.get("kind") === kinds[1] &&
        chosen.searchParams.get("sort") === "PRICE_DESC" &&
        chosen.searchParams.get("page") === "1" &&
        (await page
          .locator(`[data-gift-kind-option="${kinds[1]}"]`)
          .getAttribute("aria-current")) === "true",
      "choosing a kind keeps the price order, returns to page one and is marked",
    );
    await cardsMatchUrl();
    await back();
    await cardsMatchUrl();
    check(
      !new globalThis.URL(page.url()).searchParams.has("kind") &&
        (await descending.getAttribute("aria-current")) === "true",
      "native Back restores the list before the kind was chosen",
    );
    await inPlace(descending);
    check(
      new globalThis.URL(page.url()).searchParams.get("sort") ===
        "RECOMMENDED" &&
        (await page
          .locator("[data-gift-sort-option][aria-current]")
          .count()) === 0,
      "choosing the active price order again returns to the recommended order",
    );
    await cardsMatchUrl();
    // Amount, availability and category filters are no longer offered, but an address that
    // carries them is still honoured, named and clearable.
    await goto(
      `/en/gifts?${params({ sort: "PRICE_DESC", priceMinMinor: "1000", priceMaxMinor: "2000" })}`,
    );
    await cardsMatchUrl();
    check(
      (await page.locator("[data-gift-applied-filters] li").count()) === 2,
      "an address's amount filters are named above the list",
    );
    await inPlace(
      page.locator("[data-gift-applied-filters] [data-gift-reset]"),
    );
    const cleared = new globalThis.URL(page.url());
    check(
      !cleared.searchParams.has("priceMinMinor") &&
        !cleared.searchParams.has("priceMaxMinor") &&
        cleared.searchParams.get("sort") === "PRICE_DESC" &&
        (await page.locator("[data-gift-applied-filters]").count()) === 0,
      "clearing them keeps the price order",
    );
    await cardsMatchUrl();
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
    // An empty choice left by the older filter form means no choice; the list stays priced.
    await goto(`/en/gifts?${params({ category: "", kind: "" })}`);
    check(
      (await page.locator("[data-gift-directory] [data-gift-card]").count()) ===
        12 &&
        (await page.locator(".gift-directory-card .fs-price").count()) > 0,
      "empty kind and category values still load the priced directory",
    );
    report.cases.push({
      name: "pagination-kind-price-order-in-place-back-empty-range",
      pass: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await goto(`/pt/gifts?${params()}`);
    await cardsMatchUrl();
    await reflow("pt-390-toolbar");
    const summaryLines = await page
      .locator(".gift-directory-card__summary")
      .evaluateAll((entries) =>
        entries.map((entry) =>
          Math.round(
            entry.getBoundingClientRect().height /
              Number.parseFloat(globalThis.getComputedStyle(entry).lineHeight),
          ),
        ),
      );
    check(
      summaryLines.length > 0 && summaryLines.every((lines) => lines === 1),
      "a phone shows one line of each gift's summary",
    );
    await inPlace(page.locator('[data-gift-sort-option="PRICE_ASC"]'));
    check(
      new globalThis.URL(page.url()).searchParams.get("sort") === "PRICE_ASC",
      "the price order works in place on a phone",
    );
    await cardsMatchUrl();
    await screenshot("pt-mobile-price-order");
    report.cases.push({
      name: "mobile-toolbar-one-line-summary-price-order",
      pass: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(
      `/ja/gifts?${new globalThis.URLSearchParams({ ...fixtures.markets[1], priceMinMinor: "1000", priceMaxMinor: "2000" })}`,
    );
    await cardsMatchUrl();
    check(
      (await page.locator("[data-gift-applied-filters] li").count()) === 2,
      "JPY amount filters carried by an address stay exact minor units",
    );
    report.cases.push({
      name: "address-amount-filters-jpy",
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
