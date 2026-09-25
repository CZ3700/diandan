import {
  assertPublicGetCaching,
  verifyPublicGetConditional,
} from "./public-get-revalidation.mjs";
import {
  SUPPORTED_LOCALES,
  idolDirectoryResponseSchema,
  publishedContentResponseSchema,
  storefrontHomepageResponseSchema,
} from "@fan-support/contracts";

/** Public HTTP contracts over the same real PostgreSQL publication heads as the browser. */
export async function verifyStorefrontProtocol({
  base,
  fixtures,
  content,
  gateway,
  check,
  mutate = false,
}) {
  const cases = [];
  const verifiedCacheScopes = new Set();
  const previousTags = new Map();
  async function get(route, schema, status = 200) {
    const response = await globalThis.fetch(base + route, {
      ...(status !== 200 && previousTags.has(route)
        ? { headers: { "if-none-match": previousTags.get(route) } }
        : {}),
      signal: globalThis.AbortSignal.timeout(30_000),
      redirect: "manual",
    });
    const value = schema.parse(await response.json());
    check(
      response.status === status,
      `public protocol ${route.split("?")[0]} matches its HTTP status`,
    );
    assertPublicGetCaching(response, value, check);
    if (response.status === 200 && value.outcome === "SUCCESS") {
      previousTags.set(route, response.headers.get("etag"));
      const resource = route.split("?")[0].split("/").slice(0, 4).join("/");
      if (!verifiedCacheScopes.has(resource)) {
        await verifyPublicGetConditional({
          base,
          route,
          response,
          schema,
          check,
        });
        verifiedCacheScopes.add(resource);
      }
    }
    return value;
  }
  const home = (locale = "en", status = 200) =>
    get(
      `/api/v1/storefront-homepage?locale=${locale}`,
      storefrontHomepageResponseSchema,
      status,
    );
  const directory = (query) =>
    get(
      `/api/v1/idols?${new globalThis.URLSearchParams({ locale: "en", limit: "12", ...query })}`,
      idolDirectoryResponseSchema,
    );
  const firstHome = await home();
  const matchesLocale = (value, locale) =>
    value.requestedLocale === locale &&
    value.resolvedLocale === locale &&
    !value.fallbackUsed;
  check(
    firstHome.outcome === "SUCCESS" &&
      firstHome.homepage.publication.id === fixtures.homepage.publicationId,
    "composed homepage resolves the actual published homepage identity",
  );
  for (const locale of SUPPORTED_LOCALES) {
    const homepage = await home(locale);
    check(
      homepage.outcome === "SUCCESS" &&
        homepage.slots.length === 7 &&
        homepage.slots.every((slot) => slot.status === "AVAILABLE"),
      "all seven configured non-policy slots are hydrated from current exact IDs",
    );
    check(
      matchesLocale(homepage.homepage.content.view.localeContext, locale) &&
        homepage.slots.every(
          (slot) =>
            slot.status === "AVAILABLE" &&
            matchesLocale(slot.content.content.view.localeContext, locale),
        ),
      "homepage and every hydrated slot resolve the exact approved requested locale",
    );
    check(
      JSON.stringify(homepage.slots.map((slot) => slot.slotKey)) ===
        JSON.stringify(
          homepage.homepage.content.view.slots
            .filter((slot) => slot.kind !== "POLICY_LINK")
            .map((slot) => slot.slotKey),
        ),
      "composed slots preserve source order and never fabricate a policy product",
    );
    check(
      !/(sourceObjectKey|rightsReference|reviewerId|sessionToken|csrfToken|signedUrl)/u.test(
        JSON.stringify(homepage),
      ),
      "public homepage does not expose internal authorization proof or capabilities",
    );
    const page = await directory({ locale });
    check(
      page.outcome === "SUCCESS" &&
        page.items.length === 12 &&
        page.items.every(
          (artist) =>
            artist.localeContext.requestedLocale === locale &&
            artist.localeContext.resolvedLocale === locale &&
            !artist.localeContext.fallbackUsed,
        ),
      "seven-language directory uses only approved actual locale content",
    );
    const detail = await get(
      `/api/v1/idols/${fixtures.artists[0].handle}?locale=${locale}`,
      publishedContentResponseSchema,
    );
    check(
      detail.outcome === "SUCCESS" &&
        detail.content.kind === "IDOL" &&
        detail.content.view.id === fixtures.artists[0].id &&
        matchesLocale(detail.content.view.localeContext, locale),
      "seven-language detail resolves the same stable published artist",
    );
    cases.push({
      name: `published-home-directory-detail-${locale}`,
      pass: true,
    });
  }
  const ids = [];
  let after;
  do {
    const page = await directory(after ? { after } : {});
    check(
      page.outcome === "SUCCESS",
      "continuous actual catalog page succeeds",
    );
    ids.push(...page.items.map((artist) => artist.id));
    after = page.pageInfo.endCursor;
    check(
      ids.length <= fixtures.artists.length,
      "catalog paging never repeats an unbounded window",
    );
  } while (after);
  check(
    ids.length === 120 && new Set(ids).size === 120,
    "ten actual PostgreSQL windows cover all 120 artist identities once",
  );
  const search = await directory({ q: "星野一百", limit: "6" });
  check(
    search.outcome === "SUCCESS" &&
      search.items.some((artist) => artist.id === fixtures.target.id),
    "cross-language approved alias locates the actual distant artist",
  );
  const anchored = await directory({ anchorId: fixtures.target.id });
  check(
    anchored.outcome === "SUCCESS" &&
      anchored.items.length <= 12 &&
      anchored.items.some((artist) => artist.id === fixtures.target.id),
    "stable ID anchor returns a bounded nearby window",
  );
  const paused = await get(
    `/api/v1/idols/${fixtures.paused.handle}?locale=en`,
    publishedContentResponseSchema,
  );
  check(
    paused.outcome === "SUCCESS" && !paused.content.view.acceptingGifts,
    "paused published artist remains readable with gifts explicitly unavailable",
  );
  const media = new Set();
  function collect(value) {
    if (
      value &&
      typeof value === "object" &&
      ["INFORMATIVE", "DECORATIVE"].includes(value.kind)
    )
      media.add(value.url);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object")
      Object.values(value).forEach(collect);
  }
  collect(firstHome);
  check(
    media.size > 0,
    "published homepage exposes concrete media for non-vacuous byte verification",
  );
  for (const url of media) {
    check(
      new globalThis.URL(url).origin === gateway.origin &&
        Boolean(gateway.publishedMetadata(url)),
      "every published DTO image is registered READY at the exact owned media origin",
    );
    check(
      (await gateway.probe(new globalThis.URL(url).pathname)).status === 200,
      "strict TLS media downloads match actual S3 bytes and READY PostgreSQL checksums",
    );
  }
  cases.push({
    name: "actual-120-pagination-alias-anchor-paused-and-media",
    pass: true,
    downloadedPublishedMedia: media.size,
  });
  if (mutate) {
    const featured = fixtures.artists[1];
    const source = await content.request(
      "/api/v1/admin/content-authoring/read",
      { target: featured.owner, revisionId: featured.revisionId },
    );
    const copied = await content.write("/api/v1/admin/content-authoring/copy", {
      target: featured.owner,
      sourceRevisionId: source.snapshot.revisionId,
      expectedSourceHash: source.snapshot.contentHash,
      expectedVersion: source.snapshot.headVersion,
      changes: { kind: "IDOL" },
    });
    const published = await content.publish(featured.owner, copied.resultId);
    const current = await home();
    check(
      current.outcome === "SUCCESS" &&
        current.homepage.publication.id === firstHome.homepage.publication.id &&
        current.slots.find(
          (slot) =>
            slot.kind === "FEATURED_IDOL" && slot.idolId === featured.id,
        )?.content.publication.id === published.publicationId,
      "unchanged homepage publication hydrates a newly published current featured head",
    );
    async function status(artist, value) {
      const owner = await content.request("/api/v1/admin/catalog/owners/read", {
        target: artist.owner,
        locale: "en",
      });
      await content.write("/api/v1/admin/catalog/idols/status", {
        idolId: artist.id,
        status: value,
        acceptingGifts: false,
        expectedBaseVersion: owner.owner.baseVersion,
      });
    }
    const owner = await content.request("/api/v1/admin/catalog/owners/read", {
      target: featured.owner,
      locale: "en",
    });
    await content.write("/api/v1/admin/catalog/idols/rename", {
      idolId: featured.id,
      newHandle: "kai-ren-updated",
      expectedBaseVersion: owner.owner.baseVersion,
    });
    const renamed = await home();
    check(
      renamed.outcome === "SUCCESS" &&
        renamed.slots.find(
          (slot) =>
            slot.kind === "FEATURED_IDOL" && slot.idolId === featured.id,
        )?.content.content.view.handle === "kai-ren-updated",
      "stable slot ID hydrates the actual renamed handle",
    );
    await status(featured, "paused");
    const pausedHome = await home();
    check(
      pausedHome.outcome === "SUCCESS" &&
        pausedHome.slots.find(
          (slot) =>
            slot.kind === "FEATURED_IDOL" && slot.idolId === featured.id,
        )?.content.content.view.acceptingGifts === false,
      "paused featured artist remains hydrated with gifts disabled",
    );
    await status(featured, "archived");
    const archivedResponse = await globalThis.fetch(
      `${base}/api/v1/storefront-homepage?locale=en`,
    );
    const archived = storefrontHomepageResponseSchema.parse(
      await archivedResponse.json(),
    );
    check(
      (archivedResponse.status === 200 &&
        archived.outcome === "SUCCESS" &&
        archived.slots.find(
          (slot) =>
            slot.kind === "FEATURED_IDOL" && slot.idolId === featured.id,
        )?.status === "UNAVAILABLE") ||
        (archivedResponse.status === 503 &&
          archived.outcome === "FAILURE" &&
          archived.code === "CONTENT_UNAVAILABLE"),
      "archived featured artist is explicitly unavailable or the source proof fails closed",
    );
    const homeSource = await content.request(
      "/api/v1/admin/content-authoring/read",
      {
        target: fixtures.homepage.owner,
        revisionId: fixtures.homepage.revisionId,
      },
    );
    const recoveredRevision = await content.write(
      "/api/v1/admin/content-authoring/copy",
      {
        target: fixtures.homepage.owner,
        sourceRevisionId: homeSource.snapshot.revisionId,
        expectedSourceHash: homeSource.snapshot.contentHash,
        expectedVersion: homeSource.snapshot.headVersion,
        changes: {
          kind: "HOMEPAGE",
          structure: {
            ...homeSource.snapshot.content.structure,
            slots: homeSource.snapshot.content.structure.slots.map((slot) =>
              slot.kind === "FEATURED_IDOL" && slot.idolId === featured.id
                ? { ...slot, idolId: fixtures.artists[3].id }
                : slot,
            ),
          },
        },
      },
    );
    await content.publish(fixtures.homepage.owner, recoveredRevision.resultId);
    check(
      (await home()).outcome === "SUCCESS",
      "normally republishing the featured selection restores a healthy homepage before the independent hero-archive check",
    );
    await status(fixtures.artists[0], "archived");
    const missingHero = await home("en", 503);
    check(
      missingHero.outcome === "FAILURE" &&
        missingHero.code === "CONTENT_UNAVAILABLE",
      "archived required hero fails the full homepage closed",
    );
    cases.push({
      name: "actual-current-head-handle-paused-featured-archive-hero-archive",
      pass: true,
    });
  }
  return { schemaVersion: 1, cases, destructiveFixtureChecks: mutate };
}
