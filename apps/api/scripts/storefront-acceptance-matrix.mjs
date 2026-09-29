import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import * as contracts from "@fan-support/contracts";
import {
  withAcceptanceBrowser,
  verifyAcceptanceBrowserBaseline,
} from "./storefront-acceptance-browser.mjs";
import { createStorefrontImageChecks } from "./storefront-image-checks.mjs";
import {
  acceptancePages,
  acceptanceViewports,
} from "./storefront-acceptance-pages.mjs";
import {
  collectAcceptanceSeoIndex,
  acceptanceSeoCacheControl,
} from "./storefront-acceptance-seo.mjs";
import {
  observeAcceptanceOverlayStacking,
  verifyAcceptanceOverlayStacking,
} from "./storefront-acceptance-overlay.mjs";

function entityPath(locale, locator) {
  return `/${locale}${locator.kind === "HOMEPAGE" ? "" : locator.kind === "POLICY" ? `/policies/${locator.policyKey}` : `/${locator.kind === "IDOL" ? "idols" : "gifts"}/${locator.handle}`}`;
}

async function verifySitemaps({ page, origin, base, check }) {
  const read = async (route) => {
    const response = await globalThis.fetch(
      base + "/api/v1/storefront-seo" + route,
    );
    check(
      response.status === 200,
      "sitemap expected owners come from actual SEO API",
    );
    return contracts.storefrontSeoResponseSchema.parse(await response.json());
  };
  const catalog = await collectAcceptanceSeoIndex(read, check);
  async function xml(url) {
    const response = await globalThis.fetch(url, {
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    check(response.status === 200, "actual sitemap returns HTTP 200");
    check(
      response.headers.get("content-type")?.includes("xml"),
      "sitemap has an XML content type",
    );
    check(
      response.headers.get("cache-control") === acceptanceSeoCacheControl &&
        Boolean(response.headers.get("etag")),
      "sitemap validator has mandatory zero-freshness revalidation",
    );
    const conditional = await globalThis.fetch(url, {
      headers: { "if-none-match": response.headers.get("etag") },
    });
    check(
      conditional.status === 304 && (await conditional.text()).length === 0,
      "sitemap conditional request revalidates without a body",
    );
    const document = await page.evaluate((source) => {
      const parsed = new globalThis.DOMParser().parseFromString(
        source,
        "application/xml",
      );
      const nodes = (element, name) => [
        ...element.getElementsByTagNameNS("*", name),
      ];
      return {
        root: parsed.documentElement.localName,
        errors: nodes(parsed, "parsererror").length,
        sitemaps: nodes(parsed, "sitemap").map(
          (node) => nodes(node, "loc")[0]?.textContent,
        ),
        urls: nodes(parsed, "url").map((node) => ({
          loc: nodes(node, "loc")[0]?.textContent,
          lastmod: nodes(node, "lastmod")[0]?.textContent,
          alternates: nodes(node, "link").map((link) => ({
            locale: link.getAttribute("hreflang"),
            href: link.getAttribute("href"),
          })),
        })),
      };
    }, text);
    check(document.errors === 0, "sitemap is well-formed actual XML");
    return document;
  }
  const expectedIndexes = contracts.SUPPORTED_LOCALES.flatMap((locale) =>
    catalog.descriptors.map(
      (shard) =>
        `${origin}/${locale}/sitemap.xml?cursor=${encodeURIComponent(shard.cursor)}`,
    ),
  );
  const root = await xml(`${origin}/sitemap.xml`);
  check(root.root === "sitemapindex", "root sitemap is a shard index");
  assert.deepEqual(
    [...root.sitemaps].sort(),
    expectedIndexes.sort(),
    "root sitemap lists all seven languages and every actual shard exactly once",
  );
  let urlCount = 0;
  for (const locale of contracts.SUPPORTED_LOCALES) {
    const index = await xml(`${origin}/${locale}/sitemap.xml`);
    assert.deepEqual(
      [...index.sitemaps].sort(),
      expectedIndexes
        .filter(
          (url) =>
            new globalThis.URL(url).pathname === `/${locale}/sitemap.xml`,
        )
        .sort(),
      "locale sitemap index lists only its actual complete shards",
    );
    const entries = [];
    for (const url of index.sitemaps) {
      const shard = await xml(url);
      check(
        shard.root === "urlset" &&
          shard.urls.length > 0 &&
          shard.urls.length <= 20,
        "sitemap shard is an actual bounded nonempty URL set",
      );
      entries.push(...shard.urls);
    }
    assert.deepEqual(
      entries.map((entry) => entry.loc).sort(),
      catalog.entities
        .map((entity) => origin + entityPath(locale, entity.locator))
        .sort(),
      "locale URL set has no duplicate, draft, missing or fabricated owner",
    );
    for (const entry of entries) {
      const entity = catalog.entities.find(
        (value) => origin + entityPath(locale, value.locator) === entry.loc,
      );
      check(
        entry.lastmod === entity.publication.publishedAt,
        "sitemap lastmod is the actual current publication time",
      );
      assert.deepEqual(
        entry.alternates
          .map((alternate) => `${alternate.locale}:${alternate.href}`)
          .sort(),
        [
          ...entity.locales.map(
            (row) =>
              `${row.locale}:${origin}${entityPath(row.locale, entity.locator)}`,
          ),
          `x-default:${origin}${entityPath(contracts.DEFAULT_LOCALE, entity.locator)}`,
        ].sort(),
        "sitemap alternatives form the exact reciprocal published cluster",
      );
    }
    urlCount += entries.length;
  }
  return {
    rootShards: root.sitemaps.length,
    localeCount: contracts.SUPPORTED_LOCALES.length,
    urls: urlCount,
  };
}

export async function verifyAcceptanceBrowser(input) {
  if (!input.ui) return verifyAcceptanceBrowserBaseline(input);
  const { origin, base, fixtures, gateway, proxy, output, check, progress } =
    input;
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    scope:
      "Seven-language actual compiled TEST UI and HTML SEO; performance runs separately",
    cases: [],
    screenshots: [],
    axe: [],
    metadata: [],
    reflow: [],
    overlayStacking: [],
    pageErrors: [],
    physicalDeviceEvidence: false,
    voiceOverEvidence: false,
  };
  const save = () =>
    writeFile(
      path.join(output, "browser-results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await save();
  return withAcceptanceBrowser({ gateway }, async (browser) => {
    report.browserVersion = browser.version();
    const context = await browser.newContext({
      viewport: acceptanceViewports[0],
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      report.pageErrors.push({
        name: error.name,
        detail: "Runtime message omitted",
      }),
    );
    const images = createStorefrontImageChecks({ origin, gateway, check });
    const require = createRequire(
      new globalThis.URL("../../../package.json", import.meta.url),
    );
    const { default: AxeBuilder } = require("@axe-core/playwright");
    let step = "initialization";
    async function goto(route, status = 200) {
      const response = await page.goto(origin + route, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      check(
        response?.status() === status,
        "actual compiled route has the expected HTTP status",
      );
      await page.evaluate(async () => {
        await globalThis.document.fonts.ready;
      });
      return response;
    }
    async function screenshot(name) {
      await page.screenshot({
        path: path.join(output, `${name}.png`),
        fullPage: true,
        animations: "disabled",
      });
      report.screenshots.push(`${name}.png`);
      await save();
    }
    async function axe(name) {
      const value = await new AxeBuilder({ page }).analyze();
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
        version: value.testEngine.version,
        violations: simplify(value.violations),
        incomplete: simplify(value.incomplete),
      });
      await save();
      check(
        value.violations.length === 0,
        `${name}: zero actual axe violations`,
      );
    }
    async function reflow(name) {
      const value = await page.evaluate(() => ({
        width: globalThis.innerWidth,
        root: globalThis.document.documentElement.scrollWidth,
        body: globalThis.document.body.scrollWidth,
      }));
      report.reflow.push({ name, ...value });
      check(
        value.root <= value.width + 1 && value.body <= value.width + 1,
        `${name}: no page-level horizontal overflow`,
      );
    }
    async function metadata(target) {
      const value = await page.evaluate(() => ({
        title: globalThis.document.title,
        description: globalThis.document.querySelector(
          'meta[name="description"]',
        )?.content,
        canonical: [
          ...globalThis.document.querySelectorAll('link[rel="canonical"]'),
        ].map((link) => link.href),
        robots: [...globalThis.document.querySelectorAll('meta[name="robots"]')]
          .map((meta) => meta.content)
          .join(","),
        alternates: [
          ...globalThis.document.querySelectorAll(
            'link[rel="alternate"][hreflang]',
          ),
        ].map((link) => ({ locale: link.hreflang, href: link.href })),
        ogUrl: globalThis.document.querySelector('meta[property="og:url"]')
          ?.content,
        ogTitle: globalThis.document.querySelector('meta[property="og:title"]')
          ?.content,
        twitter: globalThis.document.querySelector('meta[name="twitter:card"]')
          ?.content,
        structured: [
          ...globalThis.document.querySelectorAll(
            'script[type="application/ld+json"]',
          ),
        ].map((script) => JSON.parse(script.textContent)),
      }));
      const canonical = new globalThis.URL(target.path, origin);
      check(
        value.title.length > 0 && value.description?.length > 0,
        "actual document has localized title and description",
      );
      assert.deepEqual(
        value.canonical,
        [canonical.href],
        "exact one canonical preserves valid market/currency identity",
      );
      check(
        value.ogUrl === canonical.href && value.ogTitle && value.twitter,
        "actual Open Graph and Twitter identity agree with canonical",
      );
      check(
        value.robots.includes("noindex"),
        "TEST environment remains noindex without fabricated release approval",
      );
      const expected = [
        ...contracts.SUPPORTED_LOCALES.map((locale) => {
          const alternate = new globalThis.URL(canonical);
          alternate.pathname = `/${locale}${canonical.pathname.slice(target.locale.length + 1)}`;
          return `${locale}:${alternate.href}`;
        }),
        `x-default:${origin}/en${canonical.pathname.slice(target.locale.length + 1)}${canonical.search}`,
      ];
      assert.deepEqual(
        value.alternates
          .map((alternate) => `${alternate.locale}:${alternate.href}`)
          .sort(),
        expected.sort(),
        "actual page has the full reciprocal approved language cluster",
      );
      check(
        value.structured.some((data) => Array.isArray(data["@graph"])),
        "actual HTML includes a valid page JSON-LD graph",
      );
      check(
        !/(aggregateRating|reviewCount|priceValidUntil|legalName|taxID)/u.test(
          JSON.stringify(value.structured),
        ),
        "structured data invents no ratings, legal identity or price validity",
      );
      if (target.kind === "gift")
        check(
          value.structured.some((data) => data["@type"] === "Product"),
          "gift page includes an actual Product document",
        );
      report.metadata.push({ ...target, ...value });
    }
    async function navigate(locator) {
      const before = page.url();
      await Promise.all([
        page.waitForURL((url) => url.href !== before, {
          waitUntil: "networkidle",
        }),
        locator.click(),
      ]);
    }
    try {
      report.publicationVisibility = await (
        await import(
          `./storefront-acceptance-visibility.mjs?attempt=${Date.now()}`
        )
      ).verifyAcceptancePublicationVisibility({ ...input, page });
      for (const viewport of acceptanceViewports)
        for (const target of acceptancePages(fixtures)) {
          step = `${target.locale}-${viewport.width}-${target.kind}`;
          progress(`browser ${step}`);
          await page.setViewportSize(viewport);
          const response = await goto(target.path);
          await page.locator(target.selector).waitFor();
          check(
            (await page.locator("html").getAttribute("lang")) ===
              target.locale &&
              response.headers()["content-language"] === target.locale,
            "URL, HTML and response language agree",
          );
          await metadata(target);
          step = `${target.locale}-${viewport.width}-${target.kind}-footer`;
          await page.waitForFunction(
            (pathname) =>
              [...globalThis.document.querySelectorAll("footer a")].some(
                (link) => new globalThis.URL(link.href).pathname === pathname,
              ),
            `/${target.locale}/policies/${fixtures.policies[0].policyKey}`,
          );
          step = `${target.locale}-${viewport.width}-${target.kind}-images`;
          await page.locator("main img").evaluateAll(async (entries) => {
            for (const image of entries) {
              image.loading = "eager";
              try {
                await image.decode();
              } catch {
                /* Assert actual loaded state below. */
              }
            }
          });
          const loaded = await page
            .locator("main img")
            .evaluateAll((entries) =>
              entries.every(
                (image) => image.complete && image.naturalWidth > 0,
              ),
            );
          check(loaded, "all actual page images decode in the visual pass");
          await images.observe(page);
          await reflow(step);
          await screenshot(step);
          await axe(step);
          report.cases.push({ name: step, pass: true });
        }
      step = "compiled sitemap and validators";
      report.sitemaps = await verifySitemaps({ page, origin, base, check });
      await save();
      step = "artist search anchor keyboard and language restore";
      await page.setViewportSize(acceptanceViewports[1]);
      // The homepage hero search opens the artist; anchoring lives on the directory page.
      await goto("/en/idols?market=GLOBAL&currency=USD#artists");
      const search = page.locator("[data-artist-search]");
      await search.fill(fixtures.target.name);
      await page
        .locator(`[data-artist-result="${fixtures.target.id}"]`)
        .waitFor();
      await search.press("ArrowDown");
      await search.press("Enter");
      await page.waitForFunction(
        (id) =>
          globalThis.document.activeElement?.getAttribute(
            "data-artist-link",
          ) === id,
        fixtures.target.id,
      );
      check(
        new globalThis.URL(page.url()).searchParams.get("anchorId") ===
          fixtures.target.id,
        "keyboard search focuses the actual hundredth artist and stores its stable anchor",
      );
      await page.locator(".storefront-desktop-language button").click();
      await page
        .getByRole("menuitemradio", {
          name: contracts.LOCALE_NATIVE_NAMES["zh-CN"],
          exact: true,
        })
        .click();
      await page.waitForURL((url) => url.pathname === "/zh-CN/idols");
      check(
        new globalThis.URL(page.url()).searchParams.get("anchorId") ===
          fixtures.target.id,
        "language change retains stable artist anchor",
      );
      await page
        .locator(`[data-artist-link="${fixtures.target.id}"]`)
        .waitFor();
      await screenshot("keyboard-search-language-anchor");
      report.cases.push({ name: step, pass: true });

      step = "gift pagination filters and native back";
      const scope = new globalThis.URLSearchParams(fixtures.markets[0]);
      await goto(`/en/gifts?${scope}&sort=PRICE_ASC`);
      const first = await page
        .locator("[data-gift-card]")
        .evaluateAll((cards) =>
          cards.map((card) => card.getAttribute("data-gift-card")),
        );
      await navigate(page.locator("a[data-gift-next]"));
      const second = await page
        .locator("[data-gift-card]")
        .evaluateAll((cards) =>
          cards.map((card) => card.getAttribute("data-gift-card")),
        );
      check(
        first.length === 12 &&
          second.length === 12 &&
          second.every((id) => !first.includes(id)),
        "real gift page two contains no page one duplicates",
      );
      const filters = page.locator('[data-gift-filters="desktop"]');
      const toolbarSort = page.locator("[data-gift-toolbar-sort]");
      const beforeSort = page.url();
      await toolbarSort.selectOption("PRICE_DESC");
      check(
        page.url() === beforeSort,
        "changing the desktop sort selection does not navigate before explicit submit",
      );
      await navigate(page.locator("[data-gift-toolbar-apply]"));
      const sorted = new globalThis.URL(page.url());
      check(
        sorted.searchParams.get("sort") === "PRICE_DESC" &&
          sorted.searchParams.get("page") === "1" &&
          sorted.searchParams.get("market") === fixtures.markets[0].market &&
          sorted.searchParams.get("currency") === fixtures.markets[0].currency,
        "explicit desktop sort submit resets page and preserves the actual market and currency",
      );
      await page.locator(".gift-filter-disclosure summary").click();
      await filters.waitFor({ state: "visible" });
      await filters.locator("[data-gift-price-min]").fill("10.00");
      await filters.locator("[data-gift-price-max]").fill("20.00");
      await navigate(filters.locator("[data-gift-apply]"));
      check(
        new globalThis.URL(page.url()).searchParams.get("priceMinMinor") ===
          "1000" &&
          new globalThis.URL(page.url()).searchParams.get("priceMaxMinor") ===
            "2000" &&
          new globalThis.URL(page.url()).searchParams.get("sort") ===
            "PRICE_DESC" &&
          new globalThis.URL(page.url()).searchParams.get("page") === "1",
        "filter navigation preserves exact minor units and applied sort and resets page",
      );
      await page.goBack({ waitUntil: "networkidle" });
      await page.waitForFunction(
        () =>
          globalThis.document.querySelector("[data-gift-toolbar-sort]")
            ?.value === "PRICE_DESC",
      );
      check(
        (await filters.locator("[data-gift-price-min]").inputValue()) === "" &&
          new globalThis.URL(page.url()).searchParams.get("page") === "1",
        "native Back restores the directly sorted page before amount filters",
      );
      await page.goBack({ waitUntil: "networkidle" });
      await page.waitForFunction(
        () =>
          globalThis.document.querySelector("[data-gift-toolbar-sort]")
            ?.value === "PRICE_ASC",
      );
      check(
        (await filters.locator("[data-gift-price-min]").inputValue()) === "" &&
          new globalThis.URL(page.url()).searchParams.get("page") === "2",
        "native Back restores actual page, sort and amount form state",
      );
      report.cases.push({ name: step, pass: true });

      step = "mobile filter focus reduced motion and cancellation";
      await page.setViewportSize(acceptanceViewports[0]);
      await goto(`/pt/gifts?${scope}`);
      const trigger = page.locator(
        '.gift-filters__mobile [data-overlay-trigger="drawer"]',
      );
      await trigger.click();
      const mobile = page.locator('[data-gift-filters="mobile"]');
      await mobile.waitFor({ state: "visible" });
      const overlayStacking = await observeAcceptanceOverlayStacking(page);
      report.overlayStacking.push(overlayStacking);
      await save();
      verifyAcceptanceOverlayStacking(overlayStacking, check);
      for (let index = 0; index < 12; index++) {
        await page.keyboard.press("Tab");
        const focused = await page.getByRole("dialog").evaluate((dialog) => ({
          inside: dialog.contains(globalThis.document.activeElement),
          guard:
            globalThis.document.activeElement?.hasAttribute(
              "data-base-ui-focus-guard",
            ) &&
            globalThis.document.activeElement?.getAttribute("data-type") ===
              "inside",
        }));
        check(
          focused.inside || focused.guard,
          "modal focus rejects any outside element except its known inside sentinel",
        );
        if (!focused.inside)
          await page.waitForFunction(
            () =>
              globalThis.document
                .querySelector('[data-overlay-popup="drawer"]')
                ?.contains(globalThis.document.activeElement),
            undefined,
            { timeout: 500 },
          );
      }
      await mobile.locator("[data-gift-price-min]").fill("10,50");
      await axe("mobile-filter-open");
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.waitForFunction(() =>
        globalThis.document.activeElement?.matches(
          '.gift-filters__mobile [data-overlay-trigger="drawer"]',
        ),
      );
      await trigger.click();
      check(
        (await mobile.locator("[data-gift-price-min]").inputValue()) === "",
        "cancelled mobile input is discarded",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      check(
        await page.evaluate(
          () =>
            globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
        "actual browser reduced-motion preference is active",
      );
      report.cases.push({ name: step, pass: true });

      step = "unavailable transport image and missing routes";
      await goto(`/en/gifts?${scope}&category=FOOD`);
      await page.locator("[data-gift-empty]").waitFor();
      await screenshot("gift-empty");
      proxy.setFailure("/api/v1/gifts");
      await goto(`/en/gifts?${scope}`);
      await page
        .locator('[data-gift-directory][data-outcome="failure"]')
        .waitFor();
      check(
        (await page.locator("[data-gift-card]").count()) === 0,
        "transport failure does not show stale products",
      );
      await screenshot("gift-transport-error");
      proxy.setFailure(null);
      await goto("/en");
      const intact = await page.locator(".storefront-hero-image").boundingBox();
      await page.route("**/_next/image?**", (route) =>
        route.fulfill({ status: 503, body: "" }),
      );
      await page.reload({ waitUntil: "networkidle" });
      await page.locator(".storefront-image-fallback").first().waitFor();
      const failed = await page.locator(".storefront-hero-image").boundingBox();
      check(
        Math.abs(intact.height - failed.height) < 1 &&
          Math.abs(intact.width - failed.width) < 1,
        "hero image error preserves its actual reserved frame",
      );
      await screenshot("home-image-error");
      await page.unroute("**/_next/image?**");
      for (const locale of contracts.SUPPORTED_LOCALES)
        for (const kind of ["idols", "gifts"]) {
          await goto(`/${locale}/${kind}/acceptance-missing-handle`, 404);
          check(
            (await page
              .locator('meta[name="robots"][content*="noindex"]')
              .count()) > 0,
            "actual missing detail is a noindex HTTP 404",
          );
        }
      for (const width of [320, 640]) {
        await page.setViewportSize({ width, height: 844 });
        await goto(`/ja/gifts?${scope}`);
        await reflow(`narrow-${width}`);
      }
      report.cases.push({ name: step, pass: true });
      await images.verifyCandidates();
      report.images = images.evidence();
      check(
        report.pageErrors.length === 0,
        "formal browser matrix has no unhandled page errors",
      );
      report.status = "PASS";
      await save();
      return report;
    } catch (error) {
      report.status = "FAIL";
      report.failure = {
        step,
        name: error?.name,
        assertion: error?.name === "AssertionError" ? error.message : null,
      };
      await save();
      await page
        .screenshot({
          path: path.join(output, "diagnostic-failure.png"),
          fullPage: true,
        })
        .catch(() => undefined);
      throw error;
    } finally {
      proxy.setFailure(null);
      gateway.setFailure(false);
      await context.close();
    }
  });
}
