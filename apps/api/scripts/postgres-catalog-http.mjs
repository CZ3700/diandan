#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import { Client } from "pg";
import { createCatalogDirectoryUseCases } from "@fan-support/application";
import {
  giftDirectoryResponseSchema,
  idolDirectoryResponseSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createApiApplication } from "../dist/bootstrap.js";
import {
  seedCatalogDirectoryFixtures,
  seedUnpublishedArtistSearchFixture,
} from "../../../packages/persistence-postgres/scripts/postgres-catalog-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const applicationName = "fan-support-catalog-http-harness";
const publicMediaOrigin = "https://media.example.invalid";
const quietLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});
const forbiddenPublicKeys = new Set([
  "source",
  "selection",
  "currentPublication",
  "selectedTranslation",
  "translationManifest",
  "editorId",
  "reviewerId",
  "objectKey",
  "rightsReference",
  "supportIntent",
  "support_intent",
]);
let stage = "initialization";

function runtimeEnvironment(config) {
  const databaseUrl = new URL("postgresql://localhost");
  databaseUrl.hostname = config.host;
  databaseUrl.port = String(config.port);
  databaseUrl.username = config.user;
  databaseUrl.password = config.password;
  databaseUrl.pathname = `/${config.database}`;
  return {
    NODE_ENV: "test",
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3002",
    FAN_SUPPORT_DATABASE_URL: databaseUrl.toString(),
    FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "static",
    FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "https://object-storage:9000",
    FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT: "https://object-storage:9000",
    FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "fan-support-media-source",
    FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET:
      "fan-support-media-derivative",
    FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: publicMediaOrigin,
    FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
    FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "TEST_ACCESS_KEY_ID",
    FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY:
      "TEST_OBJECT_STORAGE_SECRET_VALUE",
    FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
  };
}

function hasOnlyPublicKeys(value) {
  if (value === null || typeof value !== "object") return true;
  if (Array.isArray(value)) return value.every(hasOnlyPublicKeys);
  return Object.entries(value).every(
    ([key, entry]) => !forbiddenPublicKeys.has(key) && hasOnlyPublicKeys(entry),
  );
}

async function verify(clientConfig) {
  stage = "migrations";
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up" },
  });
  const observer = new Client(clientConfig);
  await observer.connect();
  let app;
  let persistence;
  let maintenance;
  let connectionsDisabled = false;
  let stopCalls = 0;
  let assertions = 0;
  let requests = 0;
  const databaseIdentifier = `"${clientConfig.database.replaceAll('"', '""')}"`;
  const check = (condition, label) => {
    stage = label;
    assert.ok(condition, label);
    assertions++;
  };
  try {
    stage = "normal-trigger fixture seeding";
    const fixture = await seedCatalogDirectoryFixtures(observer, 120);
    const unpublished = await seedUnpublishedArtistSearchFixture(
      observer,
      fixture.idols[0],
      fixture.editor,
    );
    persistence = createPostgresPersistence(
      {
        ...clientConfig,
        application_name: applicationName,
        connectionTimeoutMillis: 1000,
      },
      { catalogPublicMediaBaseUrl: publicMediaOrigin },
    );
    stage = "real API startup";
    app = await createApiApplication(runtimeEnvironment(clientConfig), {
      logger: quietLogger,
      catalogDirectoryRoute: createCatalogDirectoryUseCases({
        transactions: persistence.contentReadTransactionManager,
      }),
      catalogDirectoryRuntime: {
        start: async () => undefined,
        stop: async () => {
          stopCalls++;
          await persistence.close();
        },
      },
    });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    check(
      address !== null && typeof address === "object",
      "API binds an ephemeral loopback port",
    );
    const baseUrl = `http://127.0.0.1:${address.port}`;
    async function request(
      kind,
      query,
      expectedStatus = 200,
      label = "directory HTTP request",
    ) {
      stage = label;
      const search = new URLSearchParams(
        Object.entries(query).map(([key, value]) => [key, String(value)]),
      );
      const response = await globalThis.fetch(
        `${baseUrl}/api/v1/${kind}?${search}`,
        {
          signal: globalThis.AbortSignal.timeout(30_000),
        },
      );
      requests++;
      check(response.status === expectedStatus, label);
      check(
        response.headers.get("cache-control") === "no-store",
        "HTTP responses retain no-store policy",
      );
      const text = await response.text();
      check(
        !text.includes(clientConfig.password),
        "HTTP response does not expose database credentials",
      );
      const body = (
        kind === "idols"
          ? idolDirectoryResponseSchema
          : giftDirectoryResponseSchema
      ).parse(JSON.parse(text));
      check(
        hasOnlyPublicKeys(body),
        "HTTP response exposes no persistence or private content fields",
      );
      return body;
    }
    const idols = (query = {}, status = 200, label) =>
      request("idols", { locale: "en", ...query }, status, label);
    const gifts = (query = {}, status = 200, label) =>
      request(
        "gifts",
        { locale: "en", market: "CATALOG", currency: "USD", ...query },
        status,
        label,
      );

    for (const locale of SUPPORTED_LOCALES) {
      const artists = await idols(
        { locale, limit: 1 },
        200,
        "seven-language artist HTTP publication",
      );
      check(
        artists.outcome === "SUCCESS" && artists.items.length === 1,
        "published artist reaches HTTP",
      );
      const artist = artists.items[0];
      check(
        artist.localeContext.requestedLocale === locale &&
          artist.localeContext.resolvedLocale === locale &&
          !artist.localeContext.fallbackUsed,
        "artist locale remains exact",
      );
      check(
        artist.shortBio ===
          `${locale === "en" ? "" : `${locale}: `}Fictional performer for integration tests.`,
        "artist translation matches requested locale",
      );
      check(
        artist.portrait.url.startsWith(`${publicMediaOrigin}/`),
        "artist media URL comes from trusted configuration",
      );
      const page = await gifts(
        { locale, pageSize: 1 },
        200,
        "seven-language gift HTTP publication",
      );
      check(
        page.outcome === "SUCCESS" &&
          page.items.length === 1 &&
          page.pageInfo.totalItems === 120,
        "published gift count reaches HTTP",
      );
      const entry = page.items[0];
      check(
        entry.gift.localeContext.resolvedLocale === locale &&
          entry.gift.shortDescription ===
            `${locale === "en" ? "" : `${locale}: `}Fictional gift for local tests.`,
        "gift translation matches requested locale",
      );
      check(
        entry.offer.market === "CATALOG" && entry.offer.currency === "USD",
        "locale does not change commerce context",
      );
    }

    const search = await idols(
      { q: "i̇ris ýến" },
      200,
      "search finds the hundredth artist",
    );
    check(
      search.outcome === "SUCCESS" &&
        search.items[0]?.id === fixture.idols[99].id,
      "Unicode search locates the hundredth artist",
    );
    const namedArtist = fixture.idols[110];
    for (const nameLocale of SUPPORTED_LOCALES) {
      const locale = nameLocale === "en" ? "ja" : "en";
      const found = await idols(
        { locale, q: namedArtist.names[nameLocale] },
        200,
        "cross-language published-name HTTP search",
      );
      check(
        found.outcome === "SUCCESS" &&
          found.items.length === 1 &&
          found.items[0].id === namedArtist.id,
        "every published language name finds the same artist",
      );
      check(
        found.items[0].displayName === namedArtist.names[locale] &&
          found.items[0].localeContext.resolvedLocale === locale,
        "matched foreign name never changes response language",
      );
    }
    const rankedIds = [];
    let rankedCursor;
    for (let page = 0; page < 3; page++) {
      const found = await idols(
        {
          locale: "zh-CN",
          q: "luna",
          limit: 1,
          ...(rankedCursor === undefined ? {} : { after: rankedCursor }),
        },
        200,
        "ranked cross-language HTTP continuation",
      );
      check(
        found.outcome === "SUCCESS" &&
          found.items.length === 1 &&
          found.pageInfo.hasNextPage === page < 2,
        "ranked result pages contain one distinct artist",
      );
      rankedIds.push(found.items[0].id);
      rankedCursor = found.pageInfo.endCursor;
      check(
        found.items[0].localeContext.resolvedLocale === "zh-CN",
        "cursor continuation keeps the requested locale",
      );
    }
    check(
      JSON.stringify(rankedIds) ===
        JSON.stringify([107, 105, 106].map((index) => fixture.idols[index].id)),
      "exact prefix and substring ranking deduplicates multilingual matches before pagination",
    );
    for (const locale of ["en", "ja"]) {
      const hidden = await idols(
        { locale, q: unpublished.query },
        200,
        "unpublished translated-name HTTP search",
      );
      check(
        hidden.outcome === "SUCCESS" && hidden.items.length === 0,
        "new draft revision cannot leak through any language search",
      );
    }
    const anchor = await idols(
      { anchorId: fixture.idols[99].id },
      200,
      "direct artist anchor HTTP request",
    );
    check(
      anchor.outcome === "SUCCESS" &&
        anchor.items[0]?.id === fixture.idols[99].id,
      "anchor starts at selected artist",
    );
    const first = await idols({}, 200, "first continuous artist window");
    check(
      first.outcome === "SUCCESS" &&
        first.items.length === 12 &&
        first.pageInfo.endCursor !== null,
      "first artist window provides continuation",
    );
    const second = await idols(
      { after: first.pageInfo.endCursor },
      200,
      "next continuous artist window",
    );
    check(
      second.outcome === "SUCCESS" &&
        second.items[0]?.id === fixture.idols[12].id &&
        new Set([...first.items, ...second.items].map((item) => item.id))
          .size === 24,
      "continuation has deterministic order without duplicates",
    );
    const wrongLocale = await idols(
      { locale: "ja", after: first.pageInfo.endCursor },
      400,
      "cursor cannot be reused for another locale",
    );
    check(
      wrongLocale.code === "INVALID_CURSOR",
      "locale-bound cursor returns actionable failure",
    );

    const ascending = await gifts(
      { sort: "PRICE_ASC", pageSize: 48 },
      200,
      "gift price ascending HTTP page",
    );
    check(
      ascending.outcome === "SUCCESS" &&
        ascending.items.length === 48 &&
        ascending.pageInfo.totalItems === 120 &&
        ascending.items[0].offer.priceMinor === 1000 &&
        ascending.items[0].gift.id === fixture.gifts[1].id,
      "price sorting excludes sold-out minimum and keeps server totals",
    );
    const nextGifts = await gifts(
      { sort: "PRICE_ASC", pageSize: 48, page: 2 },
      200,
      "gift next page HTTP request",
    );
    check(
      nextGifts.outcome === "SUCCESS" &&
        nextGifts.pageInfo.page === 2 &&
        new Set(
          [...ascending.items, ...nextGifts.items].map(
            (entry) => entry.gift.id,
          ),
        ).size === 96,
      "gift pages retain unique IDs in the same snapshot version",
    );
    const filtered = await gifts(
      {
        category: "FLOWERS",
        availability: "PURCHASABLE",
        priceMinMinor: 1100,
        priceMaxMinor: 1200,
      },
      200,
      "combined gift filtering HTTP request",
    );
    check(
      filtered.outcome === "SUCCESS" &&
        filtered.pageInfo.totalItems === 2 &&
        filtered.items.every(
          (entry) =>
            entry.gift.category === "FLOWERS" &&
            entry.offer.priceMinor >= 1100 &&
            entry.offer.priceMinor <= 1200,
        ),
      "gift filters share one eligible price scope",
    );
    const recipient = await gifts(
      { idol: fixture.idols[1].id, sort: "PRICE_ASC" },
      200,
      "recipient-specific gift pricing HTTP request",
    );
    check(
      recipient.outcome === "SUCCESS" &&
        recipient.items[0]?.offer.priceMinor === 11000,
      "HTTP idol parameter binds the eligible variant price",
    );
    const otherMarket = await gifts(
      {
        locale: "th",
        market: "CATALOG_OTHER",
        currency: "JPY",
        sort: "PRICE_ASC",
      },
      200,
      "independent market and currency HTTP request",
    );
    check(
      otherMarket.outcome === "SUCCESS" &&
        otherMarket.items[0]?.offer.priceMinor === 3000 &&
        otherMarket.items[0]?.offer.currency === "JPY",
      "market and currency do not follow language",
    );
    const mismatch = await gifts(
      { currency: "JPY", availability: "PURCHASABLE" },
      200,
      "missing market-currency price HTTP request",
    );
    check(
      mismatch.outcome === "SUCCESS" && mismatch.pageInfo.totalItems === 0,
      "missing price context never falls back to another market",
    );
    const emptyPage = await gifts(
      { page: 1000 },
      200,
      "out-of-range gift page HTTP request",
    );
    check(
      emptyPage.outcome === "SUCCESS" &&
        emptyPage.items.length === 0 &&
        emptyPage.pageInfo.page === 1000,
      "out-of-range page remains an explicit empty page",
    );
    const unknown = await idols(
      { unexpected: "true" },
      400,
      "unknown HTTP query parameter rejected",
    );
    check(
      unknown.code === "INVALID_QUERY",
      "unknown parameter returns safe validation failure",
    );

    stage = "artist operational status mutation";
    await observer.query(
      "UPDATE public.idols SET status='paused',accepting_gifts=false,version=version+1,updated_at=transaction_timestamp() WHERE id=$1",
      [fixture.idols[0].id],
    );
    const changed = await idols(
      { after: first.pageInfo.endCursor },
      409,
      "changed database invalidates artist cursor",
    );
    check(
      changed.code === "CATALOG_CHANGED",
      "database version conflict asks client to restart",
    );
    const paused = await idols(
      { anchorId: fixture.idols[0].id },
      200,
      "paused artist remains publicly visible",
    );
    check(
      paused.outcome === "SUCCESS" &&
        paused.items[0]?.status === "paused" &&
        paused.items[0]?.acceptingGifts === false,
      "paused artist cannot accept gifts",
    );

    // This flag affects only this harness's newly created ephemeral database.
    // PostgreSQL requires a connection to another database for this operation.
    stage = "temporary database connection rejection";
    maintenance = new Client({ ...clientConfig, database: "postgres" });
    await maintenance.connect();
    await maintenance.query(
      `ALTER DATABASE ${databaseIdentifier} ALLOW_CONNECTIONS false`,
    );
    connectionsDisabled = true;
    await maintenance.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$2 AND application_name=$1 AND pid<>pg_backend_pid()",
      [applicationName, clientConfig.database],
    );
    const unavailable = await idols(
      {},
      503,
      "database connection failure becomes safe HTTP 503",
    );
    check(
      unavailable.code === "CATALOG_UNAVAILABLE",
      "database details remain behind stable availability code",
    );
    stage = "database connection recovery";
    await maintenance.query(
      `ALTER DATABASE ${databaseIdentifier} ALLOW_CONNECTIONS true`,
    );
    connectionsDisabled = false;
    const recovered = await idols(
      {},
      200,
      "HTTP catalog recovers when database connectivity returns",
    );
    check(
      recovered.outcome === "SUCCESS",
      "catalog recovery uses the same application process",
    );

    stage = "API resource cleanup";
    await app.close();
    app = undefined;
    check(stopCalls === 1, "API close stops catalog persistence exactly once");
    const sessions = await observer.query(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1",
      [applicationName],
    );
    check(
      sessions.rows[0].count === 0,
      "API cleanup leaves no catalog database sessions",
    );
    return {
      schemaVersion: 1,
      artists: 120,
      gifts: 120,
      locales: SUPPORTED_LOCALES.length,
      requests,
      assertions,
      transport: "loopback HTTP through Nest and Fastify",
      persistence: "real ephemeral PostgreSQL with normal triggers",
      databaseFailure: "connections rejected, safe 503, same-process recovery",
      media: "metadata and trusted URLs; no image bytes claimed",
    };
  } finally {
    if (connectionsDisabled && maintenance !== undefined)
      await maintenance
        .query(`ALTER DATABASE ${databaseIdentifier} ALLOW_CONNECTIONS true`)
        .catch(() => undefined);
    if (app !== undefined) await app.close();
    if (persistence !== undefined) await persistence.close();
    if (maintenance !== undefined) await maintenance.end();
    await observer.end();
  }
}

try {
  const result = await withEphemeralPostgres(verify);
  console.log(
    `PostgreSQL catalog HTTP integration passed: ${JSON.stringify(result)}`,
  );
} catch {
  // A stage label is controlled by this script; adapter messages and credentials are omitted.
  console.error(
    `PostgreSQL catalog HTTP integration failed at stage: ${stage}`,
  );
  process.exitCode = 1;
}
