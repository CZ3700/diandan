import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import {
  SUPPORTED_LOCALES,
  publishedContentResponseSchema,
  storefrontSeoResponseSchema,
  publishedGiftCommerceResponseSchema,
} from "@fan-support/contracts";

const seoPrefix = "/api/v1/storefront-seo";
const entityPath = (locale, locator) =>
  `/${locale}${locator.kind === "HOMEPAGE" ? "" : locator.kind === "POLICY" ? `/policies/${locator.policyKey}` : `/${locator.kind === "IDOL" ? "idols" : "gifts"}/${locator.handle}`}`;
const apiPath = (locator) =>
  locator.kind === "HOMEPAGE"
    ? "/homepage"
    : locator.kind === "POLICY"
      ? `/policies/${locator.policyKey}`
      : `/${locator.kind === "IDOL" ? "idols" : "gifts"}/${locator.handle}`;
const key = (locator) => JSON.stringify(locator);
const expectedLinks = (origin, locator, locales) =>
  [
    ...locales.map((locale) => [locale, origin + entityPath(locale, locator)]),
    ["x-default", origin + entityPath("en", locator)],
  ].sort();
const json = async (url, headers = {}) => {
  const response = await globalThis.fetch(url, {
    headers,
    signal: globalThis.AbortSignal.timeout(30000),
  });
  return {
    response,
    value: response.status === 304 ? null : await response.json(),
  };
};

/** Real PG SQL leaves → repository → domain proof → HTTP → Next metadata and XML. */
export async function verifyRegressionSeoRecovery({
  base,
  origin,
  fixtures,
  client,
  faults,
  browser,
  output,
  check,
  progress,
}) {
  const samples = [
    {
      ...fixtures.artists[0],
      locator: { kind: "IDOL", handle: fixtures.artists[0].handle },
    },
    {
      ...fixtures.gifts[0],
      locator: { kind: "GIFT", handle: fixtures.gifts[0].handle },
    },
    { ...fixtures.homepage, locator: { kind: "HOMEPAGE" } },
    {
      ...fixtures.policies.find((item) => item.kind === "DELIVERY"),
      locator: {
        kind: "POLICY",
        policyKey: fixtures.policies.find((item) => item.kind === "DELIVERY")
          .policyKey,
      },
    },
  ];
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    actualPostgres: true,
    actualHttp: true,
    compiledBrowser: true,
    faultBoundary: "TEST_ONLY_ACTUAL_SQL_TRANSLATION_REVIEW_JOIN_ROW_ABSENCE",
    immutableRowsMutated: false,
    externalCdnEvidence: false,
    humanAcceptance: false,
    policyBoundary:
      "POLICY_BODY_FAILS_CLOSED; VERIFIED_ENGLISH_METADATA_NOINDEX_ONLY",
    cases: [],
    failures: [],
  };
  const save = () =>
    writeFile(
      path.join(output, "incident-seo-recovery.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const before = await client.query(
    "SELECT publication_id,manifest_text,manifest_hash FROM public.content_publication_manifests ORDER BY publication_id",
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  async function seo(locator, headers) {
    const result = await json(
      base + seoPrefix + "/entity?" + new globalThis.URLSearchParams(locator),
      headers,
    );
    const value = storefrontSeoResponseSchema.parse(result.value);
    check(
      result.response.status === 200 && value.outcome === "SUCCESS",
      "SQL-derived SEO entity remains available",
    );
    return { ...result, value };
  }
  async function xml(url, etag) {
    const response = await globalThis.fetch(url, {
      headers: etag ? { "if-none-match": etag } : {},
      signal: globalThis.AbortSignal.timeout(30000),
    });
    check(
      response.status === 200,
      "changed sitemap must revalidate with a new body instead of stale 304",
    );
    check(
      response.headers.get("cache-control") ===
        "public, max-age=0, s-maxage=0, must-revalidate",
      "sitemap requires upstream proof on every cache reuse",
    );
    const text = await response.text();
    const document = await page.evaluate((source) => {
      const parsed = new globalThis.DOMParser().parseFromString(
        source,
        "application/xml",
      );
      const nodes = (parent, tag) => [
        ...parent.getElementsByTagNameNS("*", tag),
      ];
      return {
        errors: nodes(parsed, "parsererror").length,
        urls: nodes(parsed, "url").map((item) => ({
          loc: nodes(item, "loc")[0]?.textContent,
          alternates: nodes(item, "link").map((link) => [
            link.getAttribute("hreflang"),
            link.getAttribute("href"),
          ]),
        })),
      };
    }, text);
    check(document.errors === 0, "actual sitemap is valid XML");
    return { ...document, etag: response.headers.get("etag") };
  }
  async function shardFor(locator) {
    let cursor;
    do {
      const result = await json(
        base +
          seoPrefix +
          "/catalog" +
          (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""),
      );
      const catalog = storefrontSeoResponseSchema.parse(result.value);
      check(
        catalog.outcome === "SUCCESS" &&
          catalog.kind === "STOREFRONT_SEO_CATALOG",
        "actual catalog provides bounded shard cursors",
      );
      for (const shard of catalog.shards) {
        const indexed = storefrontSeoResponseSchema.parse(
          (
            await json(
              base +
                seoPrefix +
                `/index?cursor=${encodeURIComponent(shard.cursor)}`,
            )
          ).value,
        );
        check(indexed.outcome === "SUCCESS", "actual index proof is available");
        if (
          indexed.items.some((entity) => key(entity.locator) === key(locator))
        )
          return shard.cursor;
      }
      cursor = catalog.pageInfo.endCursor;
    } while (cursor);
    throw new Error(
      "Published regression sample absent from actual SEO catalog",
    );
  }
  async function html(sample, locale, expected, available, viewport) {
    await page.setViewportSize(viewport);
    const response = await page.goto(
      origin + entityPath(locale, sample.locator),
      { waitUntil: "networkidle" },
    );
    const document = await page.evaluate(() => ({
      lang: globalThis.document.documentElement.lang,
      title: globalThis.document.title,
      text: globalThis.document.querySelector("main")?.textContent,
      canonical: globalThis.document.querySelector('link[rel="canonical"]')
        ?.href,
      robots: [...globalThis.document.querySelectorAll('meta[name="robots"]')]
        .map((node) => node.content)
        .join(","),
      description: globalThis.document.querySelector('meta[name="description"]')
        ?.content,
      alternates: [
        ...globalThis.document.querySelectorAll(
          'link[rel="alternate"][hreflang]',
        ),
      ].map((node) => [node.hreflang, node.href]),
    }));
    const view = expected.content.view,
      fallback = view.localeContext.fallbackUsed;
    check(
      response.status() === 200 && document.lang === locale,
      "actual SSR fallback retains requested URL and document locale",
    );
    check(
      document.canonical === origin + entityPath(locale, sample.locator),
      "incident canonical remains the clean requested entity URL",
    );
    check(
      document.title.includes(view.seoTitle ?? view.title),
      "actual metadata uses the proven full English object during recovery",
    );
    const headline = view.displayName ?? view.title ?? view.heroTitle;
    if (sample.locator.kind === "POLICY" && fallback) {
      const copy = await loadStorefrontCopy(locale);
      check(
        document.text.includes(copy.policyUnavailable),
        "critical policy fallback explicitly displays its localized unavailable state",
      );
      check(
        (await page.locator("[data-policy]").count()) === 0,
        "critical policy fallback exposes no unapproved localized policy article",
      );
      check(
        !document.text.includes(view.body),
        "fallback policy terms are not silently displayed as accepted localized terms",
      );
    } else {
      if (!document.text?.includes(headline)) {
        // Diagnostics only: keep what the page actually rendered for the CI evidence.
        const name = `headline-missing-${sample.locator.kind.toLowerCase()}-${locale}-${viewport.width}`;
        await page.screenshot({
          path: path.join(output, `${name}.png`),
          fullPage: true,
        });
        await writeFile(
          path.join(output, `${name}.json`),
          JSON.stringify(
            {
              headline,
              fallback,
              main: document.text?.replace(/\s+/gu, " ").slice(0, 4000) ?? null,
            },
            null,
            2,
          ),
        );
      }
      check(
        document.text.includes(headline),
        "rendered content includes the proven object headline",
      );
    }
    assert.deepEqual(
      document.alternates.sort(),
      fallback ? [] : expectedLinks(origin, sample.locator, available),
      "actual HTML removes incident locale from both sides of the hreflang cluster",
    );
    if (fallback) {
      if (sample.locator.kind !== "POLICY") {
        const copy = await loadStorefrontCopy(locale);
        check(
          document.text.includes(copy.fallbackNotice),
          "actual incident fallback has its localized notice",
        );
        check(
          (await page
            .getByRole("heading", { name: headline, exact: true })
            .getAttribute("lang")) === "en",
          "fallback object heading explicitly declares English while page retains requested locale",
        );
      }
      check(
        document.robots.includes("noindex"),
        "actual fallback document is noindex",
      );
      const description = view.seoDescription ?? view.summary;
      check(
        document.description === description,
        "fallback metadata description is verified English",
      );
      await page.screenshot({
        path: path.join(
          output,
          `fallback-${sample.locator.kind.toLowerCase()}-${locale}-${viewport.width}.png`,
        ),
        fullPage: true,
      });
    }
    report.cases.push({
      kind: sample.locator.kind,
      locale,
      viewport,
      fallback,
      html: "PASS",
    });
  }
  try {
    for (const sample of samples) {
      progress(`incident fallback SQL/HTTP/SSR/sitemap ${sample.locator.kind}`);
      const warm = new Map();
      for (const locale of SUPPORTED_LOCALES) {
        const result = await json(
          `${base}/api/v1${apiPath(sample.locator)}?locale=${locale}`,
        );
        const value = publishedContentResponseSchema.parse(result.value);
        check(
          value.outcome === "SUCCESS",
          "warm exact seven-language actual publication before fault",
        );
        warm.set(locale, { value, etag: result.response.headers.get("etag") });
      }
      const seoBefore = await seo(sample.locator);
      const cursor = await shardFor(sample.locator),
        sitemapTags = new Map();
      for (const locale of SUPPORTED_LOCALES)
        sitemapTags.set(
          locale,
          (
            await xml(
              `${origin}/${locale}/sitemap.xml?cursor=${encodeURIComponent(cursor)}`,
            )
          ).etag,
        );
      const missingLocale = "ja";
      faults.set({
        kind: sample.locator.kind,
        revisionId: sample.revisionId,
        locale: missingLocale,
        mode: "MISSING",
      });
      const eligible = SUPPORTED_LOCALES.filter(
        (locale) => locale !== missingLocale,
      );
      const entity = await seo(sample.locator, {
        "if-none-match": seoBefore.response.headers.get("etag"),
      });
      check(
        entity.response.headers.get("etag") !==
          seoBefore.response.headers.get("etag"),
        "shared SEO validator changes for projection availability",
      );
      assert.deepEqual(
        entity.value.entity.locales.map((row) => row.locale),
        eligible,
      );
      const indexed = storefrontSeoResponseSchema.parse(
        (
          await json(
            base + seoPrefix + `/index?cursor=${encodeURIComponent(cursor)}`,
          )
        ).value,
      );
      check(
        indexed.outcome === "SUCCESS",
        "faulted actual SEO shard still enumerates its full eligible catalog",
      );
      assert.deepEqual(
        indexed.items.find((item) => key(item.locator) === key(sample.locator)),
        entity.value.entity,
        "ENTITY and INDEX derive the exact same reduced cluster",
      );
      for (const locale of SUPPORTED_LOCALES) {
        const recovered = await json(
          `${base}/api/v1${apiPath(sample.locator)}?locale=${locale}`,
          locale === missingLocale
            ? { "if-none-match": warm.get(locale).etag }
            : {},
        );
        const value = publishedContentResponseSchema.parse(recovered.value);
        check(
          recovered.response.status === 200 && value.outcome === "SUCCESS",
          "real SQL producer returns a valid current published object",
        );
        const expected = globalThis.structuredClone(
          warm.get(locale === missingLocale ? "en" : locale).value,
        );
        if (locale === missingLocale)
          Object.assign(expected.content.view.localeContext, {
            requestedLocale: locale,
            resolvedLocale: "en",
            fallbackUsed: true,
          });
        assert.deepEqual(
          value,
          expected,
          "faulted producer returns the entire English object and retains all commercial/media fields",
        );
        await html(sample, locale, value, eligible, {
          width: 1440,
          height: 900,
        });
        if (locale === missingLocale)
          await html(sample, locale, value, eligible, {
            width: 390,
            height: 844,
          });
        const sitemap = await xml(
          `${origin}/${locale}/sitemap.xml?cursor=${encodeURIComponent(cursor)}`,
          sitemapTags.get(locale),
        );
        const entry = sitemap.urls.find(
          (item) => item.loc === origin + entityPath(locale, sample.locator),
        );
        check(
          Boolean(entry) === (locale !== missingLocale),
          "faulted localized entity is excluded from its sitemap only",
        );
        for (const entry of sitemap.urls)
          if (entry.loc.endsWith(entityPath(locale, sample.locator)))
            assert.deepEqual(
              entry.alternates.sort(),
              expectedLinks(origin, sample.locator, eligible),
              "all remaining sitemap alternates remove the missing locale bidirectionally",
            );
      }
      if (sample.locator.kind === "GIFT") {
        const gift = await json(
          `${base}/api/v1/gift-content/${sample.handle}?locale=ja`,
        );
        const projected = publishedGiftCommerceResponseSchema.parse(gift.value);
        check(
          gift.response.status === 200 &&
            projected.outcome === "SUCCESS" &&
            projected.content.view.localeContext.fallbackUsed,
          "actual gift classification application and API accept verified English fallback",
        );
      }
      faults.clear();
      const healed = await seo(sample.locator);
      assert.deepEqual(
        healed.value.entity.locales.map((row) => row.locale),
        SUPPORTED_LOCALES,
        "healed read immediately restores exact original seven-locale cluster",
      );
      await save();
    }
    const sample = samples[0];
    for (const locale of SUPPORTED_LOCALES.filter(
      (value) => value !== "en" && value !== "ja",
    )) {
      faults.set({
        kind: "IDOL",
        revisionId: sample.revisionId,
        locale,
        mode: "MISSING",
      });
      const { value } = await json(
        `${base}/api/v1${apiPath(sample.locator)}?locale=${locale}`,
      );
      const parsed = publishedContentResponseSchema.parse(value);
      check(
        parsed.outcome === "SUCCESS" &&
          parsed.content.view.localeContext.fallbackUsed,
        "every canonical non-English locale supports proven incident recovery",
      );
      const available = SUPPORTED_LOCALES.filter(
        (language) => language !== locale,
      );
      assert.deepEqual(
        (await seo(sample.locator)).value.entity.locales.map(
          (row) => row.locale,
        ),
        available,
      );
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ])
        await html(sample, locale, parsed, available, viewport);
      faults.clear();
    }
    for (const fault of [
      { locale: "en", mode: "MISSING" },
      ...["REVIEW_MISSING", "TAMPER", "DUPLICATE", "SQL_ERROR"].map((mode) => ({
        locale: "ja",
        mode,
      })),
    ]) {
      faults.set({ kind: "IDOL", revisionId: sample.revisionId, ...fault });
      for (const route of [
        `/api/v1/idols/${sample.handle}?locale=ja`,
        `${seoPrefix}/entity?kind=IDOL&handle=${sample.handle}`,
      ]) {
        const result = await json(base + route);
        check(
          result.response.status === 503 && result.value.outcome === "FAILURE",
          "unpaired/tampered/duplicate/source/storage failures remain fail closed",
        );
        check(
          result.response.headers.get("cache-control").includes("no-store"),
          "invalid proof is never cached as success",
        );
      }
      report.failures.push({ ...fault, result: "FAIL_CLOSED" });
      faults.clear();
    }
    assert.deepEqual(
      (
        await client.query(
          "SELECT publication_id,manifest_text,manifest_hash FROM public.content_publication_manifests ORDER BY publication_id",
        )
      ).rows,
      before.rows,
      "fault harness never mutates any persisted immutable publication proof",
    );
    report.faultEvents = faults.events();
    check(report.faultEvents.length > 0, "actual SQL injection was exercised");
    report.status = "PASS";
    await save();
    return report;
  } catch (error) {
    report.status = "FAIL";
    report.faultEvents = faults.events();
    await save();
    throw error;
  } finally {
    faults.clear();
    await context.close();
  }
}
