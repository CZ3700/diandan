import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { seedPaymentRuntimeConfiguration } from "./payment-runtime-config-fixture.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
await withEphemeralPostgres(async (database) => {
  try {
    await runMigrations({
      clientConfig: database,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0025" },
    });
    const client = new Client(database);
    await client.connect();
    try {
      const manager = randomUUID();
      await client.query(
        "INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required) VALUES($1,'p4-04-synthetic-test-manager',$2,'ACTIVE',true)",
        [manager, randomBytes(32)],
      );
      const seed = await seedPaymentRuntimeConfiguration({
        client,
        identity: { identities: { identities: { manager } } },
        bindings: [
          {
            schemaVersion: 1,
            providerAccountId: randomUUID(),
            providerCode: "fake",
            environment: "TEST",
            allowedActionOrigins: ["https://payments.example.test"],
            localeMapping: Object.fromEntries(
              SUPPORTED_LOCALES.map((locale) => [
                locale,
                { providerLocale: locale, fallbackUsed: false },
              ]),
            ),
          },
        ],
        configuration: {
          schemaVersion: 1,
          publicStorefrontOrigin: "https://store.example.test",
          leaseMs: 30000,
          recoveryDelayMs: 10000,
          actionTtlMs: 300000,
          returnStateTtlMs: 3600000,
          recoveryBatchSize: 10,
        },
        scope: { country: "US", market: "TEST", currency: "USD" },
        check: assert.ok,
      });
      const totals = (
        await client.query(
          "SELECT (SELECT count(*)::int FROM payment_config_publications) publications,(SELECT count(*)::int FROM payment_config_publication_heads) heads,(SELECT count(*)::int FROM payment_provider_config_translations) translations,(SELECT count(*)::int FROM payment_provider_config_translation_reviews) reviews,(SELECT count(*)::int FROM payment_provider_health_events) health_events,(SELECT count(*)::int FROM payment_attempts) attempts,(SELECT count(*)::int FROM orders) orders,(SELECT count(*)::int FROM outbox_events WHERE event_type='PAYMENT_CONFIG_PUBLISHED') outbox",
        )
      ).rows[0];
      assert.deepEqual(totals, {
        publications: 1,
        heads: 1,
        translations: 7,
        reviews: 21,
        health_events: 1,
        attempts: 0,
        orders: 0,
        outbox: 1,
      });
      assert.equal(
        (await client.query("SHOW session_replication_role")).rows[0]
          .session_replication_role,
        "origin",
      );
      await client.query("BEGIN");
      try {
        await assert.rejects(
          () =>
            client.query(
              "UPDATE payment_route_rules SET enabled=false WHERE id=$1",
              [seed.routes[0].capabilityId],
            ),
          (error) => error.code === "55000",
        );
      } finally {
        await client.query("ROLLBACK");
      }
      console.log(
        JSON.stringify({
          schemaVersion: 1,
          outcome: "PASS",
          scope:
            "normal-trigger synthetic TEST payment publication prerequisites only",
          ...totals,
          immutablePublishedRule: true,
          syntheticReviewOnly: true,
        }),
      );
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        outcome: "FAIL",
        stage: error.message,
        causeCode: error.cause?.code,
        causeMessage: error.cause?.message,
        constraint: error.cause?.constraint,
        column: error.cause?.column,
      }),
    );
    throw error;
  }
});
