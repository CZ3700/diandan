import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as contracts from "@fan-support/contracts";

const prefix = "/api/v1/storefront-seo";
export const acceptanceSeoCacheControl =
  "public, max-age=0, s-maxage=0, must-revalidate";
const locatorKey = (locator) =>
  `${locator.kind}:${locator.handle ?? locator.policyKey ?? ""}`;

/** Traverse the actual lightweight catalog, never infer shard contents from counts or filenames. */
export async function collectAcceptanceSeoIndex(read, check) {
  const entities = [],
    descriptors = [],
    owners = new Set(),
    cursors = new Set();
  let cursor, version;
  do {
    check(!cursors.has(cursor ?? "FIRST"), "SEO catalog cursor must not loop");
    cursors.add(cursor ?? "FIRST");
    const page = await read(
      `/catalog${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    check(
      page.outcome === "SUCCESS",
      "SEO catalog cannot hide an error behind an empty success",
    );
    version ??= page.catalogVersion;
    check(
      page.catalogVersion === version,
      "SEO catalog traversal uses one version",
    );
    for (const descriptor of page.shards) {
      check(
        !descriptors.some((value) => value.cursor === descriptor.cursor),
        "SEO catalog must not repeat a shard",
      );
      descriptors.push(descriptor);
      const shard = await read(
        `/index?cursor=${encodeURIComponent(descriptor.cursor)}`,
      );
      check(
        shard.outcome === "SUCCESS" && shard.catalogVersion === version,
        "SEO shard uses the catalog's real version",
      );
      check(
        shard.items.length === descriptor.itemCount,
        "SEO descriptor item count matches actual hydrated owners",
      );
      for (const entity of shard.items) {
        const key = locatorKey(entity.locator);
        check(!owners.has(key), "SEO shards contain no duplicate owner");
        owners.add(key);
        entities.push(entity);
      }
    }
    cursor = page.pageInfo.endCursor;
  } while (cursor);
  return { catalogVersion: version, descriptors, entities };
}

/** Public proof plus normal operator mutations. No immutable row tampering or fake publication approval. */
export async function verifyAcceptanceSeo({
  base,
  fixtures,
  content,
  check,
  progress,
}) {
  const cases = [];
  async function response(route, { status = 200, code, etag } = {}) {
    const result = await globalThis.fetch(base + prefix + route, {
      headers: etag ? { "if-none-match": etag } : {},
      redirect: "manual",
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    const body = await result.text();
    check(
      result.status === status,
      `SEO ${route.split("?")[0]} HTTP ${status}`,
    );
    if (status === 304) {
      check(
        body.length === 0 && result.headers.get("etag") === etag,
        "conditional SEO read has no body and retains its exact ETag",
      );
      check(
        result.headers.get("cache-control") === acceptanceSeoCacheControl,
        "conditional SEO read requires revalidation",
      );
      return { value: null, etag };
    }
    const value = contracts.storefrontSeoResponseSchema.parse(JSON.parse(body));
    check(
      !/(sourceObjectKey|rightsReference|reviewerId|sessionToken|csrfToken|signedUrl|tokenPepper|evidenceReference)/u.test(
        body,
      ),
      "public SEO never exposes private proof fields or capabilities",
    );
    if (status === 200) {
      check(
        value.outcome === "SUCCESS",
        "SEO successful status requires successful strict DTO",
      );
      check(
        result.headers.get("cache-control") === acceptanceSeoCacheControl,
        "SEO success has zero freshness and mandatory revalidation",
      );
      check(
        Boolean(result.headers.get("etag")),
        "SEO success exposes an entity validator",
      );
    } else {
      check(
        value.outcome === "FAILURE" && (!code || value.code === code),
        "SEO failure is explicit and typed",
      );
      check(
        result.headers.get("cache-control")?.includes("no-store"),
        "SEO errors are not stored as successful empty indexes",
      );
    }
    return { value, etag: result.headers.get("etag") };
  }
  const read = async (route, options) => (await response(route, options)).value;
  const entityRoute = (locator) =>
    `/entity?${new globalThis.URLSearchParams(locator)}`;
  const entity = async (locator) => (await read(entityRoute(locator))).entity;
  const snapshot = () => collectAcceptanceSeoIndex(read, check);
  function cluster(value) {
    check(
      JSON.stringify(value.locales.map((row) => row.locale)) ===
        JSON.stringify(contracts.SUPPORTED_LOCALES),
      "actual approved SEO cluster contains all canonical locales in order",
    );
    check(
      value.locales.every(
        (row) => row.lastModified === value.publication.publishedAt,
      ),
      "each locale lastmod derives from its current publication",
    );
  }
  progress(
    "SEO full catalog, per-owner publication clusters and HTTP validators",
  );
  const initial = await snapshot();
  const expected = [
    { kind: "HOMEPAGE" },
    ...fixtures.artists.map(({ handle }) => ({ kind: "IDOL", handle })),
    ...fixtures.gifts
      .filter(({ status }) => ["active", "paused"].includes(status))
      .map(({ handle }) => ({ kind: "GIFT", handle })),
    ...fixtures.policies.map(({ policyKey }) => ({
      kind: "POLICY",
      policyKey,
    })),
  ];
  assert.deepEqual(
    initial.entities.map((value) => locatorKey(value.locator)).sort(),
    expected.map(locatorKey).sort(),
    "SEO has every visible owner exactly once, excluding archived/draft gifts",
  );
  for (const indexed of initial.entities) {
    cluster(indexed);
    const current = await entity(indexed.locator);
    assert.deepEqual(
      current,
      indexed,
      "ENTITY and INDEX expose the same current publication cluster",
    );
  }
  for (const route of ["/catalog", "/index", "/entity?kind=HOMEPAGE"]) {
    const first = await response(route);
    await response(route, { status: 304, etag: first.etag });
  }
  cases.push({
    name: "complete-catalog-entity-clusters-etag",
    entities: initial.entities.length,
    shards: initial.descriptors.length,
  });
  for (const route of [
    "/entity",
    "/entity?kind=UNKNOWN",
    "/entity?kind=IDOL",
    "/entity?kind=HOMEPAGE&handle=unexpected",
    "/entity?kind=HOMEPAGE&kind=HOMEPAGE",
    "/index?cursor=a&cursor=b",
    "/catalog?cursor=a&cursor=b",
    "/index?actorId=private",
    "/catalog?sessionToken=private",
    "/entity?kind=HOMEPAGE&rightsReference=private",
  ])
    await read(route, { status: 400, code: "INVALID_QUERY" });
  for (const route of ["/index?cursor=YQ", "/catalog?cursor=YQ"])
    await read(route, { status: 400, code: "INVALID_CURSOR" });
  await read("/entity?kind=IDOL&handle=acceptance-missing-artist", {
    status: 404,
    code: "NOT_FOUND",
  });
  await read(
    `/entity?kind=GIFT&handle=${fixtures.gifts.find((gift) => gift.status === "draft").handle}`,
    { status: 404, code: "NOT_FOUND" },
  );
  cases.push({ name: "strict-input-and-private-field-rejection" });

  // Archived identities and old handles are intentionally irreversible. Use a separate, normally
  // published probe and archive it at the end so the original 120 public samples stay intact.
  const reference = fixtures.artists.at(-1);
  const template = (
    await content.request("/api/v1/admin/content-authoring/read", {
      target: reference.owner,
      revisionId: reference.revisionId,
    })
  ).snapshot.content;
  const probeSuffix = randomUUID().slice(0, 8);
  const created = await content.write("/api/v1/admin/catalog/idols/create", {
    handle: `acceptance-lifecycle-${probeSuffix}`,
    expectedBaseVersion: 0,
  });
  const probeOwner = { kind: "IDOL", idolId: created.idolId };
  const probeRevision = await content.author(probeOwner, {
    ...template,
    structure: { ...template.structure, displayOrder: 120 },
  });
  await content.approve(probeOwner, probeRevision);
  await content.publish(probeOwner, probeRevision);
  const probeState = (
    await content.request("/api/v1/admin/catalog/owners/read", {
      target: probeOwner,
      locale: "en",
    })
  ).owner;
  await content.write("/api/v1/admin/catalog/idols/status", {
    idolId: created.idolId,
    status: "active",
    acceptingGifts: true,
    expectedBaseVersion: probeState.baseVersion,
  });
  const artist = {
    id: created.idolId,
    owner: probeOwner,
    revisionId: probeRevision,
    handle: `acceptance-lifecycle-${probeSuffix}`,
  };
  try {
    const withProbe = await snapshot();
    check(
      withProbe.entities.length === initial.entities.length + 1,
      "a normally published lifecycle probe preserves the 120 baseline artists",
    );
    const locator = { kind: "IDOL", handle: artist.handle };
    const original = await entity(locator);
    const source = (
      await content.request("/api/v1/admin/content-authoring/read", {
        target: artist.owner,
        revisionId: artist.revisionId,
      })
    ).snapshot;
    async function invalidated(old) {
      await read(`/index?cursor=${old.descriptors[0].cursor}`, {
        status: 409,
        code: "CATALOG_CHANGED",
      });
    }
    const copy = await content.write("/api/v1/admin/content-authoring/copy", {
      target: artist.owner,
      sourceRevisionId: source.revisionId,
      expectedSourceHash: source.contentHash,
      expectedVersion: source.headVersion,
      changes: { kind: "IDOL" },
    });
    const published = await content.publish(artist.owner, copy.resultId);
    await invalidated(withProbe);
    const afterPublish = await entity(locator);
    check(
      afterPublish.publication.id === published.publicationId &&
        afterPublish.publication.id !== original.publication.id &&
        afterPublish.publication.publishedAt !==
          original.publication.publishedAt,
      "normal publication changes the actual SEO publication and lastmod",
    );
    cluster(afterPublish);
    const beforeRollback = await snapshot();
    const target = { owner: artist.owner, revisionId: source.revisionId };
    const preflight = await content.request(
      "/api/v1/admin/content/publication/preflight",
      { target, action: "ROLLBACK" },
      { actor: "manager" },
    );
    check(
      preflight.ready,
      "historical revision satisfies the unchanged normal rollback gate",
    );
    const rollback = await content.write(
      "/api/v1/admin/content/publication/rollback",
      {
        target,
        expectedVersion: preflight.headVersion,
        expectedContentHash: preflight.contentHash,
      },
      "manager",
    );
    await invalidated(beforeRollback);
    const afterRollback = await entity(locator);
    check(
      afterRollback.publication.id === rollback.publicationId &&
        afterRollback.publication.revisionId ===
          original.publication.revisionId &&
        afterRollback.publication.publishedAt !==
          original.publication.publishedAt,
      "rollback creates new publication time rather than reusing old lastmod",
    );
    cluster(afterRollback);
    cases.push({
      name: "normal-publish-rollback-invalidate-cursor-and-lastmod",
    });

    const ownerState = async () =>
      (
        await content.request("/api/v1/admin/catalog/owners/read", {
          target: artist.owner,
          locale: "en",
        })
      ).owner;
    const status = async (value) =>
      content.write("/api/v1/admin/catalog/idols/status", {
        idolId: artist.id,
        status: value,
        acceptingGifts: value === "active",
        expectedBaseVersion: (await ownerState()).baseVersion,
      });
    const rename = async (handle) =>
      content.write("/api/v1/admin/catalog/idols/rename", {
        idolId: artist.id,
        newHandle: handle,
        expectedBaseVersion: (await ownerState()).baseVersion,
      });
    let before = await snapshot();
    await rename(`acceptance-renamed-${probeSuffix}`);
    await invalidated(before);
    await read(entityRoute(locator), { status: 404, code: "NOT_FOUND" });
    const renamedLocator = {
      kind: "IDOL",
      handle: `acceptance-renamed-${probeSuffix}`,
    };
    check(
      (await entity(renamedLocator)).publication.id === rollback.publicationId,
      "normal rename changes locator without inventing a new publication",
    );
    before = await snapshot();
    await status("paused");
    await invalidated(before);
    check(
      Boolean(await entity(renamedLocator)),
      "paused published artist remains in SEO",
    );
    before = await snapshot();
    await status("archived");
    await invalidated(before);
    // Archiving is deletion: the artist is gone, not temporarily unavailable (1717eda0).
    await read(entityRoute(renamedLocator), {
      status: 404,
      code: "NOT_FOUND",
    });
    check(
      (await snapshot()).entities.length === initial.entities.length,
      "archiving only the lifecycle probe preserves every original public sample",
    );
    cases.push({
      name: "normal-probe-rename-paused-archive",
      archivedProbeId: artist.id,
    });

    const hero = (
      await content.request("/api/v1/admin/content-authoring/read", {
        target: fixtures.artists[0].owner,
        revisionId: fixtures.artists[0].revisionId,
      })
    ).snapshot.content;
    const assetId = hero.media.find(
      (image) => image.role === "HERO_DESKTOP",
    ).mediaAssetId;
    const media = async () =>
      (await content.request("/api/v1/admin/resources/media/read", { assetId }))
        .media;
    const rights = async (rightsStatus) =>
      content.write("/api/v1/admin/resources/media/rights", {
        assetId,
        expectedVersion: (await media()).rightsVersion,
        rightsStatus,
        evidenceReference: "rights:internal-generated-art-fixture-only",
      });
    const beforeRights = await snapshot();
    try {
      await rights("EXPIRED");
      await invalidated(beforeRights);
      await read("/entity?kind=HOMEPAGE", {
        status: 503,
        code: "CONTENT_UNAVAILABLE",
      });
      await read(`/entity?kind=IDOL&handle=${fixtures.artists[0].handle}`, {
        status: 503,
        code: "CONTENT_UNAVAILABLE",
      });
      await read("/index", { status: 503, code: "CONTENT_UNAVAILABLE" });
    } finally {
      await rights("APPROVED");
    }
    const recovered = await snapshot();
    check(
      recovered.entities.length === initial.entities.length,
      "normal rights restoration recovers the entire real SEO catalog",
    );
    cases.push({
      name: "normal-rights-expiry-fails-proof-closed-and-restores",
    });
    return {
      schemaVersion: 1,
      cases,
      initialEntityCount: initial.entities.length,
      initialShardCount: initial.descriptors.length,
      finalEntityCount: recovered.entities.length,
      cacheControl: acceptanceSeoCacheControl,
      productionCdnEvidence: false,
    };
  } finally {
    const current = (
      await content.request("/api/v1/admin/catalog/owners/read", {
        target: probeOwner,
        locale: "en",
      })
    ).owner;
    if (current.status !== "archived")
      await content.write("/api/v1/admin/catalog/idols/status", {
        idolId: created.idolId,
        status: "archived",
        acceptingGifts: false,
        expectedBaseVersion: current.baseVersion,
      });
  }
}
