import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  publishedContentResponseSchema,
  storefrontSeoResponseSchema,
} from "@fan-support/contracts";

/** Independent expected set: do not import the production purge-path builder. */
export function assertRegressionPurgeRows(
  rows,
  { publicationId, revisionId, check },
) {
  check(
    rows.length === SUPPORTED_LOCALES.length,
    "exactly seven purge jobs exist",
  );
  for (const locale of SUPPORTED_LOCALES) {
    const matches = rows.filter((row) => row.locale === locale);
    check(matches.length === 1, "one purge job exists per canonical locale");
    const row = matches[0];
    check(
      row.publication_id === publicationId &&
        row.primary_subject_id === publicationId &&
        row.secondary_subject_id === revisionId &&
        row.event_type === "CONTENT_PUBLICATION_CHANGED" &&
        row.event_locale === locale,
      "purge is bound to the exact publication, revision and localized outbox event",
    );
    const expected = [
      `/${locale}`,
      `/${locale}/idols*`,
      `/${locale}/gifts*`,
      `/${locale}/sitemap.xml`,
      `/${locale}/sitemap.xml*`,
      "/sitemap.xml*",
      "/api/v1/storefront-seo/*",
    ].sort();
    check(
      JSON.stringify(row.paths) === JSON.stringify(expected),
      "purge paths cover exact locale and shared SEO dependencies without global wildcard",
    );
  }
}

/** Uses normal authenticated author/review/publish/rollback commands; observer SQL is read-only. */
export async function verifyRegressionEnglishSourcePurge({
  base,
  origin,
  fixtures,
  content,
  client,
  page,
  output,
  check,
  faults,
}) {
  const fallbackLocale = "ja";
  const eligibleLocales = SUPPORTED_LOCALES.filter(
    (locale) => locale !== fallbackLocale,
  );
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
    scope: "ENGLISH_SOURCE_ONLY_PUBLICATION_AND_ROLLBACK",
    actualPostgres: true,
    actualHttp: true,
    actualCompiledBrowser: true,
    externalCdnEvidence: false,
    dependentFallbackLocale: fallbackLocale,
    mutations: [],
    observations: [],
  };
  const save = () =>
    writeFile(
      path.join(output, "english-source-purge.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  const tags = new Map();
  async function observe(
    publicationId,
    names,
    phase,
    started = globalThis.performance.now(),
  ) {
    const seoResponse = await globalThis.fetch(
      `${base}/api/v1/storefront-seo/entity?kind=IDOL&handle=${artist.handle}`,
    );
    const seo = storefrontSeoResponseSchema.parse(await seoResponse.json());
    check(
      seoResponse.status === 200 && seo.outcome === "SUCCESS",
      "source lifecycle SEO read succeeds",
    );
    check(
      seo.entity.publication.id === publicationId,
      "SEO publication matches current source lifecycle",
    );
    check(
      JSON.stringify(seo.entity.locales.map((row) => row.locale)) ===
        JSON.stringify(eligibleLocales),
      "English-dependent incident locale stays excluded from the exact eligible cluster",
    );
    for (const locale of SUPPORTED_LOCALES) {
      const expectedName = names.get(
        locale === fallbackLocale ? DEFAULT_LOCALE : locale,
      );
      const url = `${base}/api/v1/idols/${artist.handle}?locale=${locale}`;
      const previous = tags.get(locale);
      const response = await globalThis.fetch(url, {
        headers: previous ? { "if-none-match": previous } : {},
      });
      const value = publishedContentResponseSchema.parse(await response.json());
      check(
        response.status === 200 && value.outcome === "SUCCESS",
        "changed publication revalidates rather than serving stale 304",
      );
      check(
        value.publication.id === publicationId && value.content.kind === "IDOL",
        "public content identifies the exact source revision publication",
      );
      check(
        value.content.view.displayName === expectedName,
        "each locale retains its own exact expected text",
      );
      check(
        value.content.view.localeContext.requestedLocale === locale &&
          value.content.view.localeContext.resolvedLocale ===
            (locale === fallbackLocale ? DEFAULT_LOCALE : locale) &&
          value.content.view.localeContext.fallbackUsed ===
            (locale === fallbackLocale),
        "source update does not cross language or fabricate fallback",
      );
      const etag = response.headers.get("etag");
      check(
        Boolean(etag) && (!previous || etag !== previous),
        "all locale validators change with their shared source publication",
      );
      tags.set(locale, etag);
      const documentResponse = await page.goto(
        `${origin}/${locale}/idols/${artist.handle}`,
        { waitUntil: "networkidle" },
      );
      await page
        .getByRole("heading", { name: expectedName, exact: true })
        .waitFor();
      const document = await page.evaluate(() => ({
        lang: globalThis.document.documentElement.lang,
        title: globalThis.document.title,
        canonical: globalThis.document.querySelector('link[rel="canonical"]')
          ?.href,
        alternates: [
          ...globalThis.document.querySelectorAll(
            'link[rel="alternate"][hreflang]',
          ),
        ].map((link) => [link.hreflang, link.href]),
      }));
      check(
        documentResponse.status() === 200 && document.lang === locale,
        "actual compiled document preserves current locale",
      );
      check(
        document.title.includes(value.content.view.seoTitle),
        "actual metadata reflects exact source and translation text",
      );
      check(
        document.canonical === `${origin}/${locale}/idols/${artist.handle}`,
        "actual self-canonical remains stable during publication",
      );
      const expected =
        locale === fallbackLocale
          ? []
          : [
              ...eligibleLocales.map((language) => [
                language,
                `${origin}/${language}/idols/${artist.handle}`,
              ]),
              [
                "x-default",
                `${origin}/${DEFAULT_LOCALE}/idols/${artist.handle}`,
              ],
            ];
      check(
        JSON.stringify(document.alternates.sort()) ===
          JSON.stringify(expected.sort()),
        "actual HTML cluster remains fully reciprocal after source-only update",
      );
      report.observations.push({
        phase,
        locale,
        publicationId,
        etag,
        htmlLanguage: document.lang,
        resolvedLocale: value.content.view.localeContext.resolvedLocale,
        fallbackUsed: value.content.view.localeContext.fallbackUsed,
        observedDisplayName: value.content.view.displayName,
      });
    }
    const elapsedMs = globalThis.performance.now() - started;
    check(
      elapsedMs <= 60_000,
      "all seven revalidated API and HTML projections converge within sixty seconds",
    );
    report.mutations.push({ phase, publicationId, elapsedMs });
    await save();
  }
  async function purge(publication) {
    const { rows } = await client.query(
      `SELECT j.locale,j.publication_id,j.paths,e.primary_subject_id,e.secondary_subject_id,e.locale event_locale,e.event_type
      FROM public.content_purge_jobs j JOIN public.outbox_events e ON e.id=j.outbox_event_id
      WHERE j.publication_id=$1 ORDER BY j.locale`,
      [publication.publicationId],
    );
    assertRegressionPurgeRows(rows, {
      publicationId: publication.publicationId,
      revisionId: publication.revisionId,
      check,
    });
    return rows;
  }
  const names = new Map(
    source.content.translations.map((row) => [
      row.locale,
      row.fields.displayName,
    ]),
  );
  faults.set({
    kind: "IDOL",
    revisionId: source.revisionId,
    locale: fallbackLocale,
    mode: "MISSING",
  });
  const baseline = storefrontSeoResponseSchema.parse(
    await (
      await globalThis.fetch(
        `${base}/api/v1/storefront-seo/entity?kind=IDOL&handle=${artist.handle}`,
      )
    ).json(),
  );
  check(
    baseline.outcome === "SUCCESS",
    "source-only regression starts from valid actual publication",
  );
  await observe(
    baseline.entity.publication.id,
    names,
    "WARM_ENGLISH_DEPENDENT_FALLBACK",
  );
  faults.clear();
  const marker = `SOURCE-${randomUUID().slice(0, 8)}`;
  const translations = source.content.translations.map((row) =>
    row.locale === DEFAULT_LOCALE
      ? {
          ...row,
          fields: { ...row.fields, displayName: marker, seoTitle: marker },
        }
      : row,
  );
  const copied = await content.write("/api/v1/admin/content-authoring/copy", {
    target: artist.owner,
    sourceRevisionId: source.revisionId,
    expectedSourceHash: source.contentHash,
    expectedVersion: source.headVersion,
    changes: { kind: "IDOL", translations },
  });
  const draft = (
    await content.request("/api/v1/admin/content-authoring/read", {
      target: artist.owner,
      revisionId: copied.resultId,
    })
  ).snapshot;
  check(
    JSON.stringify(
      draft.content.translations.filter((row) => row.locale !== DEFAULT_LOCALE),
    ) ===
      JSON.stringify(
        source.content.translations.filter(
          (row) => row.locale !== DEFAULT_LOCALE,
        ),
      ),
    "source-only edit preserves every non-English content byte",
  );
  await content.approve(artist.owner, copied.resultId);
  let published;
  try {
    published = await content.publish(artist.owner, copied.resultId);
    const started = globalThis.performance.now();
    faults.set({
      kind: "IDOL",
      revisionId: copied.resultId,
      locale: fallbackLocale,
      mode: "MISSING",
    });
    report.publishPurge = await purge({
      publicationId: published.publicationId,
      revisionId: copied.resultId,
    });
    await observe(
      published.publicationId,
      new Map([...names, [DEFAULT_LOCALE, marker]]),
      "PUBLISH_ENGLISH_SOURCE",
      started,
    );
  } finally {
    faults.clear();
    if (published) {
      const target = { owner: artist.owner, revisionId: source.revisionId };
      const preflight = await content.request(
        "/api/v1/admin/content/publication/preflight",
        { target, action: "ROLLBACK" },
        { actor: "manager" },
      );
      check(
        preflight.ready,
        "rollback satisfies original strict publication gate",
      );
      const rolledBack = await content.write(
        "/api/v1/admin/content/publication/rollback",
        {
          target,
          expectedVersion: preflight.headVersion,
          expectedContentHash: preflight.contentHash,
        },
        "manager",
      );
      const started = globalThis.performance.now();
      faults.set({
        kind: "IDOL",
        revisionId: source.revisionId,
        locale: fallbackLocale,
        mode: "MISSING",
      });
      report.rollbackPurge = await purge({
        publicationId: rolledBack.publicationId,
        revisionId: source.revisionId,
      });
      await observe(rolledBack.publicationId, names, "ROLLBACK", started);
      faults.clear();
    }
  }
  report.status = "PASS";
  await save();
  return report;
}
