import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { Client, Pool } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
  selectPublishedGift,
} from "@fan-support/content";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";
import { seedPublicationRuntimeFixtures } from "./postgres-publication-runtime-fixtures.mjs";
import { createRegressionSeoFaults } from "../../../apps/api/scripts/regression-seo-faults.mjs";
import { verifyGiftBrowsePublicationCases } from "./gift-browse-publication-cases.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const publicMediaBaseUrl = "https://media.example.invalid";
let stage = "MIGRATION",
  checks = 0;
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
try {
  await withEphemeralPostgres(async (database) => {
    await runMigrations({
      clientConfig: database,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0017" },
    });
    const client = new Client(database);
    await client.connect();
    const persistence = createPostgresPersistence(database, {
      catalogPublicMediaBaseUrl: publicMediaBaseUrl,
    });
    let faultPersistence;
    try {
      stage = "NORMAL_REVIEW_FIXTURE";
      const credentials = {
        sessionTokenDigest: randomBytes(32).toString("hex"),
        csrfTokenDigest: randomBytes(32).toString("hex"),
      };
      const fixtures = await seedPublicationRuntimeFixtures(
        client,
        persistence,
        { sessions: [{ name: "publisher", actor: "editor", ...credentials }] },
      );
      await runMigrations({
        clientConfig: database,
        workspaceRoot,
        command: { direction: "up" },
      });
      const browse = (provider, locale, category) =>
        provider.contentReadTransactionManager.runInContentReadTransaction(
          ({ catalogDirectory }) =>
            catalogDirectory.browseGifts({
              schemaVersion: 1,
              query: {
                schemaVersion: 1,
                locale,
                page: 1,
                pageSize: 48,
                ...(category ? { category } : {}),
              },
            }),
        );
      const before = await browse(persistence, "en");
      equal(before.outcome, "SUCCESS", "historical baseline browses");
      stage = "STRICT_PUBLICATION";
      for (const action of ["VALIDATE", "PUBLISH"]) {
        const result =
          await persistence.publicationRuntimeTransactionManager.runInPublicationRuntimeTransaction(
            async ({ authorization, publicationRuntime }) => {
              const authority = await authorization.authorize({
                schemaVersion: 1,
                ...credentials,
                permission: "content.publish",
                locales: SUPPORTED_LOCALES,
              });
              equal(
                authority.outcome,
                "SUCCESS",
                "publisher has current seven-locale authority",
              );
              const target = {
                owner: fixtures.targets.gift,
                revisionId: fixtures.revisions.gift,
              };
              const loaded = await publicationRuntime.load({
                schemaVersion: 1,
                action: "PUBLISH",
                target,
              });
              equal(
                loaded.outcome,
                "SUCCESS",
                "full canonical gift publication loads",
              );
              const canonical = loaded.context.preflight;
              const manifest = buildPublicationManifest(canonical);
              return publicationRuntime.write({
                schemaVersion: 1,
                requestId: randomUUID(),
                principal: authority.principal,
                command: {
                  schemaVersion: 1,
                  action,
                  target,
                  expectedVersion: canonical.headVersion,
                  expectedContentHash: canonical.snapshot.contentHash,
                  reasonCode: "BROWSE_FIXTURE",
                  idempotencyKey: randomUUID(),
                },
                manifest,
                manifestHash: computePublicationManifestHash(manifest),
              });
            },
          );
        equal(
          result.outcome,
          "SUCCESS",
          "strict gift publishes through normal transaction",
        );
      }
      const after = await browse(persistence, "en");
      equal(after.outcome, "SUCCESS", "strict publication browses");
      equal(
        before.catalogVersion === after.catalogVersion,
        false,
        "gift publication changes browse version",
      );
      const matrix = await verifyGiftBrowsePublicationCases({
        persistence,
        giftId: fixtures.targets.gift.giftId,
      });
      checks += matrix.checks;

      stage = "SQL_PROJECTION_INCIDENT";
      const faults = createRegressionSeoFaults();
      let missingProjection;
      const metadataId = (
        await client.query(
          "SELECT media_metadata_revision_id FROM public.gift_revision_media WHERE gift_revision_id=$1 ORDER BY sort_order LIMIT 1",
          [fixtures.revisions.gift],
        )
      ).rows[0].media_metadata_revision_id;
      const immutableBefore = (
        await client.query(
          "SELECT publication_id,manifest_hash,manifest_text FROM public.content_publication_manifests ORDER BY publication_id",
        )
      ).rows;
      faultPersistence = createPostgresPersistenceWithPoolFactory(
        database,
        { catalogPublicMediaBaseUrl: publicMediaBaseUrl },
        (config) => {
          const pool = new Pool(config);
          return {
            end: () => pool.end(),
            on: (event, listener) => pool.on(event, listener),
            off: (event, listener) => pool.off(event, listener),
            connect: async () => {
              const connection = await pool.connect();
              const absentIds = new Set();
              return {
                release: (error) => connection.release(error),
                query: async (sql, values) => {
                  const result = faults.transform(
                    sql,
                    values,
                    await connection.query(sql, values),
                    absentIds,
                  );
                  if (
                    missingProjection?.kind === "GIFT" &&
                    typeof sql === "string" &&
                    sql.startsWith("SELECT to_jsonb(base.*) AS base")
                  ) {
                    return {
                      ...result,
                      rows: result.rows.map((row) =>
                        row.revision.id === fixtures.revisions.gift
                          ? {
                              ...row,
                              translations: row.translations.filter(
                                (translation) =>
                                  translation.locale !==
                                  missingProjection.locale,
                              ),
                            }
                          : row,
                      ),
                    };
                  }
                  if (
                    missingProjection?.kind === "MEDIA_METADATA" &&
                    typeof sql === "string" &&
                    sql.startsWith("SELECT to_jsonb(reference.*) AS reference")
                  ) {
                    return {
                      ...result,
                      rows: result.rows.map((row) =>
                        row.metadata.id === metadataId
                          ? {
                              ...row,
                              translations: row.translations.filter(
                                (translation) =>
                                  translation.locale !==
                                  missingProjection.locale,
                              ),
                            }
                          : row,
                      ),
                    };
                  }
                  return result;
                },
              };
            },
          };
        },
      );
      for (const incident of [
        { kind: "GIFT", locale: "ja", mode: "MISSING" },
        { kind: "GIFT", locale: "en", mode: "MISSING" },
        { kind: "MEDIA_METADATA", locale: "ja", mode: "MISSING" },
        { kind: "MEDIA_METADATA", locale: "en", mode: "MISSING" },
        { kind: "GIFT", locale: "ja", mode: "TAMPER" },
        { kind: "GIFT", locale: "ja", mode: "REVIEW_MISSING" },
      ]) {
        const { locale, kind, mode } = incident;
        stage = `SQL_PROJECTION_${kind}_${locale}_${mode}`;
        missingProjection = mode === "MISSING" ? incident : undefined;
        faults.set({
          ...incident,
          revisionId: kind === "GIFT" ? fixtures.revisions.gift : metadataId,
        });
        if (locale === "en" || mode !== "MISSING") {
          await assert.rejects(() => browse(faultPersistence, "ja", "FLOWERS"));
          checks++;
          continue;
        }
        const result = await browse(faultPersistence, locale, "FLOWERS");
        equal(
          result.outcome,
          "SUCCESS",
          "paired missing non-English SQL projection recovers",
        );
        const record = result.items.find(
          (item) =>
            item.schemaVersion === 1 &&
            item.source.base.id === fixtures.targets.gift.giftId,
        );
        assert.ok(record);
        checks++;
        const projection = selectPublishedGift(record.selection, record.source);
        equal(
          projection.success,
          true,
          "frozen publication and current English projection verify together",
        );
        equal(
          projection.value.localeContext.requestedLocale,
          locale,
          "incident retains requested language",
        );
        equal(
          projection.value.localeContext.resolvedLocale,
          "en",
          "incident resolves the entire object to English",
        );
        equal(
          projection.value.localeContext.fallbackUsed,
          true,
          "fallback provenance is explicit",
        );
      }
      faults.clear();
      missingProjection = undefined;
      equal(
        (
          await client.query(
            "SELECT publication_id,manifest_hash,manifest_text FROM public.content_publication_manifests ORDER BY publication_id",
          )
        ).rows,
        immutableBefore,
        "TEST fault does not mutate immutable publication evidence",
      );
      assert.ok(
        faults
          .events()
          .some((event) => event.leaf === "TRANSLATION_REVIEW_JOIN"),
      );
      checks++;
    } catch (error) {
      process.stderr.write(
        JSON.stringify({
          result: "FAIL",
          stage,
          code: /^[0-9A-Z]{5}$/u.test(error?.code ?? "")
            ? error.code
            : "UNCLASSIFIED",
          assertion:
            error instanceof assert.AssertionError
              ? error.message
              : "strict browse verification failed",
        }) + "\n",
      );
      throw error;
    } finally {
      await faultPersistence?.close();
      await persistence.close();
      await client.end();
    }
  });
  process.stdout.write(
    JSON.stringify({
      schemaVersion: 1,
      result: "PASS",
      checks,
      scope:
        "real isolated PG strict publication plus TEST SQL-leaf absence; immutable rows unchanged",
    }) + "\n",
  );
} catch {
  process.exitCode = 1;
}
