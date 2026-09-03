#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { Client } from "pg";

import {
  EphemeralPostgresError,
  withEphemeralPostgres,
} from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const fixture = Object.freeze({
  adminId: "10000000-0000-4000-8000-000000000001",
  localeRevisionId: "10000000-0000-4000-8000-000000000002",
  contentPublicationId: "10000000-0000-4000-8000-000000000003",
  contentRequestId: "10000000-0000-4000-8000-000000000004",
  contentCorrelationId: "10000000-0000-4000-8000-000000000005",
  configVersionId: "10000000-0000-4000-8000-000000000006",
  paymentAuditId: "10000000-0000-4000-8000-000000000007",
  paymentPublicationId: "10000000-0000-4000-8000-000000000008",
  paymentRequestId: "10000000-0000-4000-8000-000000000009",
  paymentCorrelationId: "10000000-0000-4000-8000-00000000000a",
  paymentOutboxId: "10000000-0000-4000-8000-00000000000b",
  marketId: "10000000-0000-4000-8000-00000000000c",
  priceBookId: "10000000-0000-4000-8000-00000000000d",
  priceAuditId: "10000000-0000-4000-8000-00000000000e",
  pricePublicationId: "10000000-0000-4000-8000-00000000000f",
});

const contentOutboxIds = Object.freeze([
  "11000000-0000-4000-8000-000000000001",
  "11000000-0000-4000-8000-000000000002",
  "11000000-0000-4000-8000-000000000003",
  "11000000-0000-4000-8000-000000000004",
  "11000000-0000-4000-8000-000000000005",
  "11000000-0000-4000-8000-000000000006",
  "11000000-0000-4000-8000-000000000007",
]);

const publishedAt = "2026-09-03T00:00:00.000Z";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);

function databaseErrorMessage(error) {
  if (error instanceof Error) {
    const code = typeof error.code === "string" ? ` (${error.code})` : "";
    const position =
      typeof error.position === "string"
        ? ` at SQL position ${error.position}`
        : "";
    return `${error.message}${code}${position}`;
  }
  return "unknown PostgreSQL error";
}

async function readMigrationSql(version, direction) {
  const names = {
    "0001": "foundation-security",
    "0002": "content-catalog",
    "0003": "inventory-cart-private-data",
    "0004": "orders-fulfillment",
    "0005": "payments-reliable-events",
    "0006": "publication-heads-outbox",
  };
  const name = names[version];
  if (name === undefined) {
    throw new Error("unsupported publication harness migration version");
  }
  return readFile(
    path.join(
      workspaceRoot,
      `database/migrations/${version}_${name}.${direction}.sql`,
    ),
    "utf8",
  );
}

async function applyMigration(client, sql) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(
      `publication migration failed: ${databaseErrorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}

async function applyVersionFiveSchema(client) {
  for (const version of ["0001", "0002", "0003", "0004", "0005"]) {
    await applyMigration(client, await readMigrationSql(version, "up"));
  }
}

async function seedVersionFivePublicationHistory(client) {
  let stage = "begin";
  await client.query("BEGIN");
  try {
    // This fixture represents already-committed 0005 history. Replica mode is
    // scoped to the seed transaction so lifecycle triggers do not mistake a
    // historical snapshot for a new application command; FK/check constraints
    // remain active and migration behavior runs with normal triggers.
    await client.query("SET LOCAL session_replication_role = replica");
    stage = "admin identity";
    await client.query(
      `
INSERT INTO public.admin_identities (
  id, issuer, external_subject_hash, status, mfa_required, version,
  created_at, updated_at
)
VALUES ($1, 'fixture-issuer', decode($2, 'hex'), 'ACTIVE', true, 1, $3, $3)
`.trim(),
      [fixture.adminId, hashA, publishedAt],
    );
    stage = "locale revision";
    await client.query(
      `
INSERT INTO public.site_locale_config_revisions (
  id, revision, lifecycle, created_by, created_at, validated_at, published_at
)
VALUES ($1, 1, 'PUBLISHED', $2, $3, $3, $3)
`.trim(),
      [fixture.localeRevisionId, fixture.adminId, publishedAt],
    );
    for (const [sortOrder, locale] of SUPPORTED_LOCALES.entries()) {
      stage = `locale entry ${locale}`;
      await client.query(
        `
INSERT INTO public.site_locale_config_entries (
  site_locale_config_revision_id, locale, enabled, sort_order
)
VALUES ($1, $2, true, $3)
`.trim(),
        [fixture.localeRevisionId, locale, sortOrder],
      );
    }
    stage = "content publication";
    await client.query(
      `
INSERT INTO public.content_publications (
  id, content_type, site_locale_config_revision_id, action,
  translation_manifest_hash, approval_manifest_hash, media_manifest_hash,
  published_by, published_at, idempotency_key
)
VALUES ($1, 'SITE_LOCALE_CONFIG', $2, 'PUBLISH', $3, $4, NULL, $5, $6,
  'fixture-content-publication')
`.trim(),
      [
        fixture.contentPublicationId,
        fixture.localeRevisionId,
        hashA,
        hashB,
        fixture.adminId,
        publishedAt,
      ],
    );
    for (const [index, locale] of SUPPORTED_LOCALES.entries()) {
      stage = `content outbox ${locale}`;
      await client.query(
        `
INSERT INTO public.outbox_events (
  id, event_type, aggregate_type, aggregate_id, aggregate_version,
  primary_subject_id, secondary_subject_id, locale, market, currency,
  idempotency_key, correlation_id, request_id, occurred_at, available_at,
  created_at
)
VALUES (
  $1::uuid, 'CONTENT_PUBLICATION_CHANGED', 'CONTENT_PUBLICATION', $2::uuid, 1,
  $2::uuid, $3::uuid, $4::public.supported_locale, NULL, NULL,
  'content-publication:' || $2::uuid::text || ':' || $4::text,
  $5::uuid, $6::uuid, $7::timestamptz, $7::timestamptz, $7::timestamptz
)
`.trim(),
        [
          contentOutboxIds[index],
          fixture.contentPublicationId,
          fixture.localeRevisionId,
          locale,
          fixture.contentCorrelationId,
          fixture.contentRequestId,
          publishedAt,
        ],
      );
    }
    stage = "payment config version";
    await client.query(
      `
INSERT INTO public.config_versions (
  id, config_kind, version, lifecycle, created_by, created_at, published_at
)
VALUES ($1, 'PAYMENT_ROUTING', 1, 'PUBLISHED', $2, $3, $3)
`.trim(),
      [fixture.configVersionId, fixture.adminId, publishedAt],
    );
    stage = "payment config audit";
    await client.query(
      `
INSERT INTO public.audit_logs (
  id, actor_type, actor_id, action, subject_type, subject_id,
  request_id, correlation_id, outcome, created_at
)
VALUES (
  $1, 'ADMIN', $2, 'PAYMENT_CONFIG_PUBLISH',
  'PAYMENT_CONFIG_PUBLICATION', $3, $4, $5, 'SUCCEEDED', $6
)
`.trim(),
      [
        fixture.paymentAuditId,
        fixture.adminId,
        fixture.paymentPublicationId,
        fixture.paymentRequestId,
        fixture.paymentCorrelationId,
        publishedAt,
      ],
    );
    stage = "payment config publication";
    await client.query(
      `
INSERT INTO public.payment_config_publications (
  id, config_version_id, action, manifest_hash, published_by,
  audit_log_id, created_at
)
VALUES ($1, $2, 'PUBLISH', $3, $4, $5, $6)
`.trim(),
      [
        fixture.paymentPublicationId,
        fixture.configVersionId,
        hashC,
        fixture.adminId,
        fixture.paymentAuditId,
        publishedAt,
      ],
    );
    stage = "payment config outbox";
    await client.query(
      `
INSERT INTO public.outbox_events (
  id, event_type, aggregate_type, aggregate_id, aggregate_version,
  primary_subject_id, secondary_subject_id, locale, market, currency,
  idempotency_key, correlation_id, request_id, occurred_at, available_at,
  created_at
)
VALUES (
  $1::uuid, 'PAYMENT_CONFIG_PUBLISHED', 'PAYMENT_CONFIG', $2::uuid, 1,
  $3::uuid, NULL, NULL, NULL, NULL,
  'payment-config-publication:' || $3::uuid::text,
  $4::uuid, $5::uuid, $6::timestamptz, $6::timestamptz, $6::timestamptz
)
`.trim(),
      [
        fixture.paymentOutboxId,
        fixture.configVersionId,
        fixture.paymentPublicationId,
        fixture.paymentCorrelationId,
        fixture.paymentRequestId,
        publishedAt,
      ],
    );
    await client.query("SET LOCAL session_replication_role = origin");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(
      `publication fixture failed at ${stage}: ${databaseErrorMessage(error)}`,
      { cause: error },
    );
  }
}

async function readPublicationEvidence(client) {
  const result = await client.query(
    `
SELECT
  (SELECT count(*)::integer FROM public.content_publications) AS "contentPublications",
  (SELECT count(*)::integer FROM public.payment_config_publications) AS "paymentPublications",
  (SELECT count(*)::integer FROM public.outbox_events
    WHERE event_type IN ('CONTENT_PUBLICATION_CHANGED', 'PAYMENT_CONFIG_PUBLISHED')) AS "outboxRows",
  (SELECT count(*)::integer FROM public.audit_logs) AS "auditRows",
  (SELECT count(*)::integer FROM public.audit_logs
    WHERE reason_code = 'MIGRATION_BACKFILL') AS "syntheticAuditCount",
  (SELECT audit_log_id::text FROM public.content_publications WHERE id = $1) AS "contentAuditId"
`.trim(),
    [fixture.contentPublicationId],
  );
  const evidence = result.rows[0];
  if (evidence === undefined) {
    throw new Error("publication evidence query returned no row");
  }
  return evidence;
}

async function readImmutableHistorySnapshot(client) {
  const result = await client.query(
    `
SELECT
  COALESCE((
    SELECT jsonb_agg(to_jsonb(history) ORDER BY history.id)::text
    FROM (
      SELECT
        id, schema_version, content_type, idol_id, idol_revision_id, gift_id,
        gift_revision_id, homepage_revision_id, policy_key,
        policy_revision_id, media_asset_id, media_metadata_revision_id,
        site_locale_config_revision_id, action, replaces_publication_id,
        translation_manifest_hash, approval_manifest_hash,
        media_manifest_hash, published_by, published_at, idempotency_key
      FROM public.content_publications
    ) history
  ), '[]') AS "contentHistory",
  COALESCE((
    SELECT jsonb_agg(to_jsonb(history) ORDER BY history.id)::text
    FROM (
      SELECT
        id, schema_version, config_version_id, action,
        replaces_publication_id, manifest_hash, published_by, audit_log_id,
        created_at
      FROM public.payment_config_publications
    ) history
  ), '[]') AS "paymentHistory",
  COALESCE((
    SELECT jsonb_agg(to_jsonb(history) ORDER BY history.id)::text
    FROM (
      SELECT
        id, schema_version, event_type, aggregate_type, aggregate_id,
        aggregate_version, primary_subject_id, secondary_subject_id, locale,
        market, currency, idempotency_key, correlation_id, causation_id,
        request_id, trace_id, occurred_at, available_at, created_at
      FROM public.outbox_events
      WHERE event_type IN (
        'CONTENT_PUBLICATION_CHANGED',
        'PAYMENT_CONFIG_PUBLISHED'
      )
    ) history
  ), '[]') AS "outboxHistory",
  COALESCE((
    SELECT jsonb_agg(to_jsonb(history) ORDER BY history.id)::text
    FROM (
      SELECT
        id, schema_version, actor_type, actor_id, task_name, action,
        subject_type, subject_id, reason_code, request_id, correlation_id,
        outcome, field_category, created_at
      FROM public.audit_logs
      WHERE id = $1
    ) history
  ), '[]') AS "preexistingAuditHistory"
`.trim(),
    [fixture.paymentAuditId],
  );
  const snapshot = result.rows[0];
  if (snapshot === undefined) {
    throw new Error("immutable publication history query returned no row");
  }
  return snapshot;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch`);
  }
}

async function assertImmutableHistoryPreserved(
  client,
  expectedSnapshot,
  stage,
) {
  const actualSnapshot = await readImmutableHistorySnapshot(client);
  for (const key of [
    "contentHistory",
    "paymentHistory",
    "outboxHistory",
    "preexistingAuditHistory",
  ]) {
    assertEqual(actualSnapshot[key], expectedSnapshot[key], `${stage} ${key}`);
  }
}

async function assertVersionSixPublicationState(client, previousEvidence) {
  const result = await client.query(
    `
SELECT
  (SELECT count(*)::integer FROM public.site_locale_config_publication_heads) AS "contentHeads",
  (SELECT count(*)::integer FROM public.payment_config_publication_heads) AS "paymentHeads",
  (SELECT array_agg(outbox.locale::text ORDER BY outbox.locale::text) =
      ARRAY['en', 'es', 'ja', 'pt', 'th', 'vi', 'zh-CN']::text[]
    FROM public.outbox_events outbox
    WHERE outbox.event_type = 'CONTENT_PUBLICATION_CHANGED'
      AND outbox.primary_subject_id = $1) AS "sevenLocaleOutbox",
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    JOIN pg_catalog.pg_class relation
      ON relation.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'content_publications'
      AND trigger_row.tgname = 'content_publications_append_only_trigger'
      AND NOT trigger_row.tgisinternal
  ) AS "appendOnlyTriggerRestored",
  (SELECT count(*)::integer
    FROM public.content_publications publication
    JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE publication.id = $1
      AND audit.action = 'CONTENT_PUBLISH'
      AND audit.subject_type = 'CONTENT_PUBLICATION'
      AND audit.subject_id = publication.id
      AND audit.request_id = $2
      AND audit.correlation_id = $3
      AND audit.outcome = 'SUCCEEDED') AS "contentAuditMatches",
  (SELECT count(*)::integer
    FROM public.payment_config_publication_heads head
    WHERE head.publication_id = $4 AND head.config_version_id = $5) AS "paymentHeadMatches"
`.trim(),
    [
      fixture.contentPublicationId,
      fixture.contentRequestId,
      fixture.contentCorrelationId,
      fixture.paymentPublicationId,
      fixture.configVersionId,
    ],
  );
  const state = result.rows[0];
  assertEqual(state?.contentHeads, 1, "content publication head count");
  assertEqual(state?.paymentHeads, 1, "payment publication head count");
  assertEqual(state?.sevenLocaleOutbox, true, "seven-locale content outbox");
  assertEqual(
    state?.appendOnlyTriggerRestored,
    true,
    "content append-only trigger",
  );
  assertEqual(state?.contentAuditMatches, 1, "content audit adoption");
  assertEqual(state?.paymentHeadMatches, 1, "payment publication head binding");

  const evidence = await readPublicationEvidence(client);
  assertEqual(evidence.contentPublications, 1, "content publication rows");
  assertEqual(evidence.paymentPublications, 1, "payment publication rows");
  assertEqual(evidence.outboxRows, 8, "publication outbox rows");
  assertEqual(evidence.syntheticAuditCount, 1, "synthetic audit rows");
  if (previousEvidence !== undefined) {
    assertEqual(
      evidence.auditRows,
      previousEvidence.auditRows,
      "audit row count",
    );
    assertEqual(
      evidence.contentAuditId,
      previousEvidence.contentAuditId,
      "content audit identity",
    );
  }
  return evidence;
}

async function assertVersionFiveHistoryPreserved(client, expectedEvidence) {
  const catalogResult = await client.query(
    `
SELECT
  to_regclass('public.site_locale_config_publication_heads') IS NULL AS "contentHeadRemoved",
  to_regclass('public.payment_config_publication_heads') IS NULL AS "paymentHeadRemoved",
  to_regclass('public.price_book_publications') IS NULL AS "pricePublicationRemoved",
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'content_publications'
      AND column_name = 'audit_log_id'
  ) AS "contentAuditLinkRemoved"
`.trim(),
  );
  const catalogState = catalogResult.rows[0];
  for (const key of [
    "contentHeadRemoved",
    "paymentHeadRemoved",
    "pricePublicationRemoved",
    "contentAuditLinkRemoved",
  ]) {
    assertEqual(catalogState?.[key], true, key);
  }

  const publicationRows = await client.query(
    `
SELECT
  (SELECT count(*)::integer FROM public.content_publications) AS "contentPublications",
  (SELECT count(*)::integer FROM public.payment_config_publications) AS "paymentPublications",
  (SELECT count(*)::integer FROM public.outbox_events
    WHERE event_type IN ('CONTENT_PUBLICATION_CHANGED', 'PAYMENT_CONFIG_PUBLISHED')) AS "outboxRows",
  (SELECT count(*)::integer FROM public.audit_logs) AS "auditRows",
  (SELECT count(*)::integer FROM public.audit_logs
    WHERE reason_code = 'MIGRATION_BACKFILL') AS "syntheticAuditCount"
`.trim(),
  );
  const state = publicationRows.rows[0];
  assertEqual(state?.contentPublications, 1, "downgraded content history");
  assertEqual(state?.paymentPublications, 1, "downgraded payment history");
  assertEqual(state?.outboxRows, 8, "downgraded outbox history");
  assertEqual(
    state?.auditRows,
    expectedEvidence.auditRows,
    "downgraded audit history",
  );
  assertEqual(
    state?.syntheticAuditCount,
    expectedEvidence.syntheticAuditCount,
    "downgraded synthetic audit history",
  );
}

async function assertPriceBookDowngradeGuard(client, downSql) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `
INSERT INTO public.markets (
  id, market, default_currency, status, version, created_at, updated_at
)
VALUES ($1, 'TEST', 'USD', 'ACTIVE', 1, $2, $2)
`.trim(),
      [fixture.marketId, publishedAt],
    );
    await client.query(
      `
INSERT INTO public.price_books (
  id, market_id, market, currency, revision, lifecycle, valid_from,
  created_by, created_at, validated_at, published_at
)
VALUES (
  $1::uuid, $2::uuid, 'TEST', 'USD', 1, 'PUBLISHED',
  $3::timestamptz, $4::uuid, $3::timestamptz, $3::timestamptz,
  $3::timestamptz
)
`.trim(),
      [fixture.priceBookId, fixture.marketId, publishedAt, fixture.adminId],
    );
    await client.query(
      `
INSERT INTO public.audit_logs (
  id, actor_type, actor_id, action, subject_type, subject_id,
  request_id, correlation_id, outcome, created_at
)
VALUES (
  $1, 'ADMIN', $2, 'PRICE_BOOK_PUBLISH', 'PRICE_BOOK_PUBLICATION', $3,
  $4, $5, 'SUCCEEDED', $6
)
`.trim(),
      [
        fixture.priceAuditId,
        fixture.adminId,
        fixture.pricePublicationId,
        fixture.paymentRequestId,
        fixture.paymentCorrelationId,
        publishedAt,
      ],
    );
    await client.query(
      `
INSERT INTO public.price_book_publications (
  id, price_book_id, price_book_revision, market_id, market, currency,
  action, manifest_hash, published_by, audit_log_id, published_at,
  idempotency_key
)
VALUES (
  $1, $2, 1, $3, 'TEST', 'USD', 'PUBLISH', $4, $5, $6, $7,
  'fixture-price-book-publication'
)
`.trim(),
      [
        fixture.pricePublicationId,
        fixture.priceBookId,
        fixture.marketId,
        hashA,
        fixture.adminId,
        fixture.priceAuditId,
        publishedAt,
      ],
    );
    await client.query("SET LOCAL session_replication_role = origin");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`price fixture failed: ${databaseErrorMessage(error)}`, {
      cause: error,
    });
  }

  let rejected = false;
  try {
    await applyMigration(client, downSql);
  } catch (error) {
    rejected =
      error instanceof Error &&
      error.message.includes(
        "cannot be reverted after price-book publication history exists",
      );
  }
  assertEqual(rejected, true, "price-book downgrade guard");
  const row = await client.query(
    "SELECT count(*)::integer AS count FROM public.price_book_publications WHERE id = $1",
    [fixture.pricePublicationId],
  );
  assertEqual(row.rows[0]?.count, 1, "guarded price publication history");
}

async function runHarness(clientConfig) {
  const client = new Client(clientConfig);
  await client.connect();
  try {
    await applyVersionFiveSchema(client);
    await seedVersionFivePublicationHistory(client);
    const versionFiveHistory = await readImmutableHistorySnapshot(client);
    const migrationSql = {
      up: await readMigrationSql("0006", "up"),
      down: await readMigrationSql("0006", "down"),
    };

    await applyMigration(client, migrationSql.up);
    const firstUpgradeEvidence = await assertVersionSixPublicationState(client);
    await assertImmutableHistoryPreserved(
      client,
      versionFiveHistory,
      "first upgrade",
    );
    await applyMigration(client, migrationSql.down);
    await assertVersionFiveHistoryPreserved(client, firstUpgradeEvidence);
    await assertImmutableHistoryPreserved(
      client,
      versionFiveHistory,
      "downgrade",
    );
    await applyMigration(client, migrationSql.up);
    const secondUpgradeEvidence = await assertVersionSixPublicationState(
      client,
      firstUpgradeEvidence,
    );
    await assertImmutableHistoryPreserved(
      client,
      versionFiveHistory,
      "second upgrade",
    );
    await assertPriceBookDowngradeGuard(client, migrationSql.down);

    return {
      publicationRows:
        secondUpgradeEvidence.contentPublications +
        secondUpgradeEvidence.paymentPublications,
      outboxRows: secondUpgradeEvidence.outboxRows,
      syntheticAuditCount: secondUpgradeEvidence.syntheticAuditCount,
    };
  } catch (error) {
    throw new EphemeralPostgresError(databaseErrorMessage(error));
  } finally {
    await client.end();
  }
}

try {
  const result = await withEphemeralPostgres(runHarness);
  console.log(
    `PostgreSQL data-bearing publication migration passed (${result.publicationRows} publications, ${result.outboxRows} outbox rows, ${result.syntheticAuditCount} migration audit).`,
  );
} catch (error) {
  const message =
    error instanceof EphemeralPostgresError || error instanceof Error
      ? error.message
      : "PostgreSQL publication migration harness failed";
  console.error(message);
  process.exitCode = 1;
}
