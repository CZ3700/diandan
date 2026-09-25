import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { selectPublishedGift } from "@fan-support/content";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";
import { seedAdminCatalogOperator } from "./postgres-admin-catalog-fixtures.mjs";
import { seedGiftCommerceAuthority } from "./postgres-gift-commerce-fixtures.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
let stage = "MIGRATIONS",
  checks = 0;
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
try {
  await withEphemeralPostgres(async (clientConfig) => {
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0017" },
    });
    const client = new Client(clientConfig);
    await client.connect();
    let persistence;
    try {
      stage = "NORMAL_TRIGGER_SEED";
      const fixture = await seedCatalogDirectoryFixtures(client, 25);
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "up" },
      });
      persistence = createPostgresPersistence(clientConfig, {
        catalogPublicMediaBaseUrl: "https://media.example.invalid",
      });
      const browse = (query = {}) =>
        persistence.contentReadTransactionManager.runInContentReadTransaction(
          ({ catalogDirectory }) =>
            catalogDirectory.browseGifts({
              schemaVersion: 1,
              query: {
                schemaVersion: 1,
                locale: "en",
                page: 1,
                pageSize: 12,
                ...query,
              },
            }),
        );
      stage = "SEVEN_LOCALES_PAGINATION";
      for (const locale of SUPPORTED_LOCALES) {
        const pages = [];
        for (const page of [1, 2, 3, 4]) {
          const result = await browse({ locale, page });
          equal(result.outcome, "SUCCESS", "database returns a real page");
          equal(result.totalItems, 25, "database counts all visible gifts");
          equal(
            result.items.length,
            [12, 12, 1, 0][page - 1],
            "database window size is bounded",
          );
          for (const record of result.items) {
            equal(
              record.schemaVersion,
              1,
              "seed is explicitly historical proof",
            );
            const projected = selectPublishedGift(
              record.selection,
              record.source,
            );
            equal(
              projected.success,
              true,
              "every selected row has valid publication proof",
            );
            equal(
              projected.value.localeContext.requestedLocale,
              locale,
              "localized projection matches query",
            );
            equal(
              "offer" in record,
              false,
              "independent browsing exposes no offer",
            );
            pages.push(record.source.base.id);
          }
        }
        equal(
          pages,
          fixture.gifts.map((row) => row.id).sort(),
          "stable timestamp tie-break visits every gift exactly once",
        );
      }
      stage = "FILTERS_AND_REAL_EMPTY";
      equal(
        (await browse({ category: "FLOWERS", pageSize: 48 })).totalItems,
        13,
        "category filtering runs before pagination",
      );
      equal(
        (await browse({ idolId: fixture.idols[0].id, pageSize: 48 }))
          .totalItems,
        25,
        "explicit eligibility matches accepting artist",
      );
      equal(
        (await browse({ idolId: fixture.idols[2].id })).totalItems,
        0,
        "unmatched artist has a real empty directory",
      );
      stage = "GIFT_STATUS_VERSION";
      const credentials = await seedGiftCommerceAuthority(client, {
        actorId: fixture.editor,
      });
      const before = await browse();
      const status =
        await persistence.giftCommerceTransactionManager.runInGiftCommerceTransaction(
          async ({ authorization, catalog }) => {
            const authority = await authorization.authorize({
              schemaVersion: 1,
              sessionTokenDigest: credentials.sessionTokenDigest,
              csrfTokenDigest: credentials.csrfTokenDigest,
              permission: "gift.manage",
              locales: [],
            });
            equal(
              authority.outcome,
              "SUCCESS",
              "gift status operator is authorized",
            );
            const base = (
              await client.query(
                "SELECT version FROM public.gifts WHERE id=$1",
                [fixture.gifts[0].id],
              )
            ).rows[0];
            return catalog.write({
              schemaVersion: 1,
              principal: authority.principal,
              requestId: randomUUID(),
              command: {
                schemaVersion: 1,
                action: "SET_GIFT_STATUS",
                giftId: fixture.gifts[0].id,
                expectedBaseVersion: Number(base.version),
                status: "paused",
                reasonCode: "BROWSE_FIXTURE",
                idempotencyKey: randomUUID(),
              },
            });
          },
        );
      equal(
        status.outcome,
        "SUCCESS",
        "gift status changes through audited command",
      );
      const paused = await browse();
      equal(
        paused.totalItems,
        25,
        "paused gifts remain browsable without an offer",
      );
      equal(
        paused.catalogVersion === before.catalogVersion,
        false,
        "gift status changes directory version",
      );
      stage = "RECIPIENT_CLOSURE";
      const operateCatalog = await seedAdminCatalogOperator(
        client,
        persistence,
        fixture.editor,
      );
      const prior = (
        await client.query("SELECT version FROM public.idols WHERE id=$1", [
          fixture.idols[0].id,
        ])
      ).rows[0];
      await operateCatalog({
        action: "SET_IDOL_STATUS",
        idolId: fixture.idols[0].id,
        expectedBaseVersion: Number(prior.version),
        status: "paused",
        acceptingGifts: false,
      });
      equal(
        (await browse({ idolId: fixture.idols[0].id })).totalItems,
        25,
        "explicit relationship remains discoverable for a paused artist without promising eligibility to buy",
      );
      equal(
        (await browse()).totalItems,
        25,
        "recipient closure does not hide independent gifts",
      );
      stage = "MEDIA_VERSION";
      const mediaBefore = await browse();
      const permissionId = randomUUID();
      await client.query(
        "INSERT INTO public.permissions(id,permission_key,description,created_at) VALUES($1,'content.media.rights','TEST browse media rights',clock_timestamp()-interval '1 hour')",
        [permissionId],
      );
      await client.query(
        "INSERT INTO public.role_permissions(role_id,permission_id,granted_by,granted_at) SELECT role_id,$2,$1,clock_timestamp()-interval '1 hour' FROM public.admin_identity_roles WHERE admin_identity_id=$1",
        [fixture.editor, permissionId],
      );
      const rights =
        await persistence.resourceManagementTransactionManager.runInResourceManagementTransaction(
          ({ resources }) =>
            resources.setRights({
              schemaVersion: 1,
              actorId: fixture.editor,
              sessionId: credentials.sessionId,
              requestId: randomUUID(),
              eventId: randomUUID(),
              reasonCode: "BROWSE_FIXTURE",
              assetId: fixture.media[3].assetId,
              expectedVersion: 0,
              rightsStatus: "EXPIRED",
              evidenceReference: "rights:browse-test-expiry",
            }),
        );
      equal(
        rights.outcome,
        "SUCCESS",
        `media rights change through audited command (${rights.code ?? "OK"})`,
      );
      const expired = await browse();
      equal(
        expired.catalogVersion === mediaBefore.catalogVersion,
        false,
        "media eligibility changes directory version",
      );
      equal(
        expired.items.every(
          (record) =>
            !selectPublishedGift(record.selection, record.source).success,
        ),
        true,
        "revoked media is rejected by public projection",
      );
    } catch (error) {
      process.stderr.write(
        JSON.stringify({
          diagnostic: "CALLBACK",
          stage,
          assertion:
            error instanceof assert.AssertionError ? error.message : null,
          errorType: error?.constructor?.name,
          code: error?.code,
          line:
            error?.stack?.match(/gift-browse-postgres\.mjs:(\d+):/u)?.[1] ??
            null,
        }) + "\n",
      );
      throw error;
    } finally {
      await persistence?.close();
      await client.end();
    }
  });
  process.stdout.write(
    JSON.stringify({
      schemaVersion: 1,
      result: "PASS",
      checks,
      scope:
        "isolated real PostgreSQL; historical strict catalog; no services or browser",
    }) + "\n",
  );
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      schemaVersion: 1,
      result: "FAIL",
      stage,
      errorType: error?.constructor?.name,
      line:
        error?.stack?.match(/gift-browse-postgres\.mjs:(\d+):/u)?.[1] ?? null,
      code: /^[0-9A-Z]{5}$/u.test(error?.code ?? "")
        ? error.code
        : "UNCLASSIFIED",
      assertion:
        error instanceof assert.AssertionError
          ? error.message
          : "gift browse verification failed",
    }) + "\n",
  );
  process.exitCode = 1;
}
