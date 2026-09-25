import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  SUPPORTED_LOCALES,
  publishedContentResponseSchema,
  storefrontSeoResponseSchema,
} from "@fan-support/contracts";
import { acceptanceSeoCacheControl } from "./storefront-acceptance-seo.mjs";

/** Follow a link discovered in both current XML indexes; an API-derived cursor cannot bypass stale XML. */
export function selectAcceptanceSitemapShard({
  root,
  localeIndex,
  origin,
  locale,
  cursor,
}) {
  const select = (index) => {
    if (index.root !== "sitemapindex" || index.errors !== 0) return [];
    return index.sitemaps.filter((href) => {
      try {
        const url = new globalThis.URL(href);
        return (
          url.origin === origin &&
          url.pathname === `/${locale}/sitemap.xml` &&
          !url.hash &&
          [...url.searchParams.keys()].length === 1 &&
          url.searchParams.get("cursor") === cursor
        );
      } catch {
        return false;
      }
    });
  };
  const parent = select(root),
    localized = select(localeIndex);
  return parent.length === 1 &&
    localized.length === 1 &&
    parent[0] === localized[0]
    ? localized[0]
    : null;
}

/** The same fixed sixty-second budget includes every observation; stale/error observations remain evidence. */
export async function waitForAcceptanceVisibility({
  started,
  probe,
  now = () => globalThis.performance.now(),
  pause = () => delay(250),
}) {
  const observations = [];
  while (now() - started < 60_000) {
    const value = await probe();
    const elapsedMs = Math.round(now() - started);
    observations.push({ ...value, elapsedMs });
    if (value.ready && elapsedMs <= 60_000)
      return { pass: true, elapsedMs, observations };
    if (elapsedMs >= 60_000) break;
    await pause();
  }
  return { pass: false, elapsedMs: Math.round(now() - started), observations };
}

/** Normal reviewed content changes and rollback observed through real API, Chrome HTML and Next XML.
 * Zero-TTL responses are revalidated; this is not evidence of an external CDN or its purge SLA. */
export async function verifyAcceptancePublicationVisibility({
  base,
  origin,
  fixtures,
  content,
  page,
  output,
  check,
  progress,
}) {
  const artist = fixtures.artists.at(-1);
  const source = (
    await content.request("/api/v1/admin/content-authoring/read", {
      target: artist.owner,
      revisionId: artist.revisionId,
    })
  ).snapshot;
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    scope:
      "Actual TEST publish acknowledgement to revalidated public API, Chrome document and Next sitemap visibility",
    budgetMs: 60_000,
    externalCdnEvidence: false,
    manuallyRunPurgeWorker: false,
    operations: [],
    requestTimings: [],
  };
  const save = () =>
    writeFile(
      path.join(output, "publication-visibility.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const tags = new Map();
  let diagnosticPhase = "WARM";
  async function timedRequest(url, resource, perform) {
    const parsed = new globalThis.URL(url);
    const started = globalThis.performance.now();
    const cursor = parsed.searchParams.get("cursor");
    const timing = {
      phase: diagnosticPhase,
      resource,
      path: parsed.pathname.replace(artist.handle, ":handle"),
      locale:
        parsed.searchParams.get("locale") ??
        SUPPORTED_LOCALES.find((locale) =>
          parsed.pathname.startsWith(`/${locale}/`),
        ) ??
        null,
      cursorSha256: cursor
        ? createHash("sha256").update(cursor).digest("hex")
        : null,
      startedAt: new Date().toISOString(),
      status: null,
    };
    try {
      return await perform((status) => {
        timing.status = status;
      });
    } catch (error) {
      timing.errorKind = ["TimeoutError", "AbortError", "SyntaxError"].includes(
        error.name,
      )
        ? error.name
        : "PROJECTION_UNAVAILABLE";
      throw error;
    } finally {
      timing.finishedAt = new Date().toISOString();
      timing.elapsedMs = Math.round(globalThis.performance.now() - started);
      report.requestTimings.push(timing);
    }
  }
  async function json(url, schema, conditional) {
    return timedRequest(url, "API", async (status) => {
      const previous = tags.get(url);
      const response = await globalThis.fetch(url, {
        headers: conditional && previous ? { "if-none-match": previous } : {},
        signal: globalThis.AbortSignal.timeout(8_000),
      });
      status(response.status);
      const text = await response.text();
      const parsed = text ? schema.safeParse(JSON.parse(text)) : null;
      if (
        !conditional &&
        response.status === 200 &&
        response.headers.get("etag")
      )
        tags.set(url, response.headers.get("etag"));
      return {
        status: response.status,
        value: parsed?.success ? parsed.data : null,
        cache: response.headers.get("cache-control"),
      };
    });
  }
  async function xml(url, conditional) {
    return timedRequest(url, "XML", async (status) => {
      const previous = tags.get(url);
      const response = await globalThis.fetch(url, {
        headers: conditional && previous ? { "if-none-match": previous } : {},
        signal: globalThis.AbortSignal.timeout(8_000),
      });
      status(response.status);
      const text = await response.text();
      if (
        !conditional &&
        response.status === 200 &&
        response.headers.get("etag")
      )
        tags.set(url, response.headers.get("etag"));
      const parsed = await page.evaluate((sourceText) => {
        const document = new globalThis.DOMParser().parseFromString(
          sourceText,
          "application/xml",
        );
        return {
          root: document.documentElement.localName,
          errors: document.getElementsByTagNameNS("*", "parsererror").length,
          sitemaps: [...document.getElementsByTagNameNS("*", "sitemap")].map(
            (node) => node.getElementsByTagNameNS("*", "loc")[0]?.textContent,
          ),
          entries: [...document.getElementsByTagNameNS("*", "url")].map(
            (node) => ({
              loc: node.getElementsByTagNameNS("*", "loc")[0]?.textContent,
              lastmod: node.getElementsByTagNameNS("*", "lastmod")[0]
                ?.textContent,
            }),
          ),
        };
      }, text);
      return {
        status: response.status,
        cache: response.headers.get("cache-control"),
        ...parsed,
      };
    });
  }
  async function projection(publicationId, names, conditional) {
    const observed = { ready: false, api: [], html: [], sitemap: [] };
    try {
      const entity = await json(
        `${base}/api/v1/storefront-seo/entity?kind=IDOL&handle=${artist.handle}`,
        storefrontSeoResponseSchema,
        false,
      );
      const proof =
        entity.value?.outcome === "SUCCESS" ? entity.value.entity : null;
      if (!proof || proof.publication.id !== publicationId) return observed;
      const catalog = await json(
        `${base}/api/v1/storefront-seo/catalog`,
        storefrontSeoResponseSchema,
        false,
      );
      let cursor;
      if (catalog.value?.outcome === "SUCCESS") {
        for (const descriptor of catalog.value.shards) {
          const index = await json(
            `${base}/api/v1/storefront-seo/index?cursor=${descriptor.cursor}`,
            storefrontSeoResponseSchema,
            false,
          );
          if (
            index.value?.outcome === "SUCCESS" &&
            index.value.items.some(
              (item) =>
                item.locator.kind === "IDOL" &&
                item.locator.handle === artist.handle,
            )
          ) {
            cursor = descriptor.cursor;
            break;
          }
        }
      }
      if (!cursor) return observed;
      const root = await xml(`${origin}/sitemap.xml`, conditional);
      observed.rootSitemap = {
        status: root.status,
        cache: root.cache,
        root: root.root,
        errors: root.errors,
        sitemaps: root.sitemaps,
      };
      for (const locale of SUPPORTED_LOCALES) {
        const name = names.get(locale);
        const api = await json(
          `${base}/api/v1/idols/${artist.handle}?locale=${locale}`,
          publishedContentResponseSchema,
          conditional,
        );
        observed.api.push({
          locale,
          status: api.status,
          current:
            api.value?.outcome === "SUCCESS" &&
            api.value.publication.id === publicationId &&
            api.value.content.view.displayName === name,
          cache: api.cache,
        });
        const documentPath = `/${locale}/idols/${artist.handle}`;
        const response = await timedRequest(
          origin + documentPath,
          "HTML",
          async (status) => {
            const loaded = await page.goto(origin + documentPath, {
              waitUntil: "domcontentloaded",
              timeout: 8_000,
            });
            status(loaded?.status() ?? null);
            return loaded;
          },
        );
        const title = page.locator("#artist-title");
        observed.html.push({
          locale,
          status: response?.status(),
          current:
            (await title.count()) === 1 && (await title.textContent()) === name,
          cache: response?.headers()["cache-control"] ?? null,
        });
        const localeIndex = await xml(
          `${origin}/${locale}/sitemap.xml`,
          conditional,
        );
        const shardUrl = selectAcceptanceSitemapShard({
          root,
          localeIndex,
          origin,
          locale,
          cursor,
        });
        if (
          !shardUrl ||
          localeIndex.status !== 200 ||
          localeIndex.cache !== acceptanceSeoCacheControl
        ) {
          observed.sitemap.push({
            locale,
            current: false,
            indexStatus: localeIndex.status,
            discoveredCurrentShard: false,
          });
          continue;
        }
        const sitemap = await xml(shardUrl, conditional);
        observed.sitemap.push({
          locale,
          status: sitemap.status,
          current: sitemap.entries.some(
            (entry) =>
              entry.loc === origin + documentPath &&
              entry.lastmod === proof.publication.publishedAt,
          ),
          discoveredCurrentShard: true,
          cache: sitemap.cache,
        });
      }
      observed.ready =
        root.status === 200 &&
        root.root === "sitemapindex" &&
        root.errors === 0 &&
        root.cache === acceptanceSeoCacheControl &&
        observed.api.length === SUPPORTED_LOCALES.length &&
        observed.api.every(
          (row) =>
            row.status === 200 &&
            row.current &&
            row.cache === acceptanceSeoCacheControl,
        ) &&
        observed.html.length === SUPPORTED_LOCALES.length &&
        observed.html.every((row) => row.status === 200 && row.current) &&
        observed.sitemap.length === SUPPORTED_LOCALES.length &&
        observed.sitemap.every(
          (row) =>
            row.status === 200 &&
            row.current &&
            row.cache === acceptanceSeoCacheControl,
        );
      return observed;
    } catch (error) {
      return {
        ...observed,
        errorKind: ["TimeoutError", "AbortError", "SyntaxError"].includes(
          error.name,
        )
          ? error.name
          : "PROJECTION_UNAVAILABLE",
      };
    }
  }
  const originals = new Map(
    source.content.translations.map((row) => [
      row.locale,
      row.fields.displayName,
    ]),
  );
  const original = await json(
    `${base}/api/v1/storefront-seo/entity?kind=IDOL&handle=${artist.handle}`,
    storefrontSeoResponseSchema,
    false,
  );
  check(
    original.value?.outcome === "SUCCESS",
    "visibility baseline has an actual current publication",
  );
  const warm = await projection(
    original.value.entity.publication.id,
    originals,
    false,
  );
  report.warm = warm;
  if (!warm.ready) report.status = "FAIL";
  await save();
  check(
    warm.ready,
    "all seven actual API, HTML and sitemap representations are warmed before publication",
  );
  const marker = `CACHE-${randomUUID().slice(0, 8)}`;
  const translations = source.content.translations.map((row) => ({
    ...row,
    fields: {
      ...row.fields,
      displayName: `${row.fields.displayName} ${marker}`,
      seoTitle: `${row.fields.seoTitle} ${marker}`,
    },
  }));
  const copied = await content.write("/api/v1/admin/content-authoring/copy", {
    target: artist.owner,
    sourceRevisionId: source.revisionId,
    expectedSourceHash: source.contentHash,
    expectedVersion: source.headVersion,
    changes: { kind: "IDOL", translations },
  });
  await content.approve(artist.owner, copied.resultId);
  let changed = false;
  async function measure(kind, publicationId, names, started) {
    diagnosticPhase = kind;
    const result = await waitForAcceptanceVisibility({
      started,
      probe: () => projection(publicationId, names, true),
    });
    report.operations.push({ kind, publicationId, ...result });
    await save();
    check(
      result.pass,
      `${kind}: actual seven-locale API, HTML and sitemap publication converges within sixty seconds`,
    );
  }
  async function rollback() {
    const target = { owner: artist.owner, revisionId: source.revisionId };
    const preflight = await content.request(
      "/api/v1/admin/content/publication/preflight",
      { target, action: "ROLLBACK" },
      { actor: "manager" },
    );
    check(
      preflight.ready,
      "visibility rollback satisfies the normal publication gate",
    );
    const result = await content.write(
      "/api/v1/admin/content/publication/rollback",
      {
        target,
        expectedVersion: preflight.headVersion,
        expectedContentHash: preflight.contentHash,
      },
      "manager",
    );
    changed = false;
    return result;
  }
  try {
    progress(
      "normal publish and rollback to seven-locale API, actual HTML and sitemap within sixty seconds",
    );
    const published = await content.publish(artist.owner, copied.resultId);
    const started = globalThis.performance.now();
    changed = true;
    const publishedNames = new Map(
      translations.map((row) => [row.locale, row.fields.displayName]),
    );
    await measure("PUBLISH", published.publicationId, publishedNames, started);
    diagnosticPhase = "PUBLISHED_WARM";
    report.publishedWarm = await projection(
      published.publicationId,
      publishedNames,
      false,
    );
    await save();
    check(
      report.publishedWarm.ready,
      "rollback starts from the newly published API and XML validators warmed in the actual browser",
    );
    const rolledBack = await rollback();
    await measure(
      "ROLLBACK",
      rolledBack.publicationId,
      originals,
      globalThis.performance.now(),
    );
    report.status = "PASS";
    return report;
  } catch (error) {
    report.status = "FAIL";
    throw error;
  } finally {
    try {
      if (changed) await rollback();
    } finally {
      await save();
    }
  }
}
