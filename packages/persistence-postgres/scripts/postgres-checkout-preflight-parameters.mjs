import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import {
  checkoutPreflightCommitCommandSchema,
  checkoutPreflightObservationSchema,
} from "@fan-support/contracts";
import {
  canonicalPublicationValue,
  hashPublicationValue,
} from "@fan-support/content";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { writeCheckout } from "../dist/checkout-preflight-write.js";
import { checkoutReceiptColumns } from "../dist/checkout-preflight-data.js";
import { cartTimestamp } from "../dist/cart-runtime-data.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const id = () => randomUUID();
const createdAt = "2026-09-08T00:00:00.123456Z",
  expiresAt = "2026-09-08T00:15:00.123456Z";
// Structurally valid TEST input exercises the real row builders only. It is never inserted
// and does not purport to be a verified publication, encrypted contact or completed checkout.
const source = {
  schemaVersion: 1,
  mode: "DAILY",
  publicationMode: "DIRECT_OPERATOR_V1",
  publicationId: id(),
  revisionId: id(),
  manifestHash: "a".repeat(64),
  sourceHash: "b".repeat(64),
  sourceLocale: "zh-CN",
  requestedLocale: "en",
  resolvedLocale: "zh-CN",
  translationRevisionId: id(),
  fallbackUsed: true,
};
const media = {
  schemaVersion: 1,
  assetId: id(),
  checksum: "c".repeat(64),
  objectKey: "test/checkout-parameters.webp",
  metadataRevisionId: source.revisionId,
  alt: "TEST image",
  altTranslation: source,
};
const line = {
  schemaVersion: 1,
  cartItemId: id(),
  itemVersion: 1,
  supportIntentId: id(),
  intentVersion: 1,
  fulfillmentProfileId: id(),
  idolId: id(),
  idolHandle: "test-idol",
  idolDisplayName: "TEST idol",
  idolTranslation: source,
  idolPortrait: media,
  giftId: id(),
  giftVariantId: id(),
  giftTitle: "TEST gift",
  giftVariantLabel: "TEST variant",
  giftTranslation: source,
  giftImage: media,
  observedPriceId: id(),
  priceId: id(),
  priceRevision: 1,
  unitAmountMinor: 25,
  quantity: 2,
  displayMode: "anonymous",
  inventoryPolicy: "PROCURE_ON_DEMAND",
  inventoryItemId: null,
  eligibility: "ALL_ACTIVE_ARTISTS",
};
const consent = {
  schemaVersion: 1,
  cartId: id(),
  cartVersion: 2,
  presentationLocale: "en",
  market: "TEST",
  currency: "USD",
  lines: [line],
  policies: [
    {
      schemaVersion: 1,
      policyKey: "terms",
      kind: "TERMS",
      locale: "en",
      policyRevisionId: id(),
      policyTranslationRevisionId: id(),
      publicationId: id(),
      manifestHash: "d".repeat(64),
      sourceHash: "e".repeat(64),
      title: "TEST terms",
      body: "TEST policy",
      effectiveAt: "2026-09-07T00:00:00.000Z",
    },
  ],
};
const observation = checkoutPreflightObservationSchema.parse({
  schemaVersion: 1,
  id: id(),
  consentHash: hashPublicationValue("fan-support.checkout-consent.v1", consent),
  consent,
  createdAt,
  expiresAt,
  quote: {
    schemaVersion: 1,
    id: id(),
    cartVersion: 2,
    expiresAt,
    amount: {
      schemaVersion: 1,
      market: "TEST",
      currency: "USD",
      quoteRevision: 1,
      quoteExpiresAt: expiresAt,
      subtotalMinor: 50,
      taxAmountMinor: 0,
      shippingAmountMinor: 0,
      feeAmountMinor: 0,
      discountAmountMinor: 0,
      totalAmountMinor: 50,
    },
    lines: [
      {
        schemaVersion: 1,
        cartItemId: line.cartItemId,
        giftVariantId: line.giftVariantId,
        priceId: line.priceId,
        priceRevision: 1,
        quantity: 2,
        unitAmountMinor: 25,
        lineSubtotalMinor: 50,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        lineTotalMinor: 50,
      },
    ],
  },
});
const command = checkoutPreflightCommitCommandSchema.parse({
  schemaVersion: 1,
  accesses: [
    {
      schemaVersion: 1,
      tokenDigest: "f".repeat(64),
      pepperVersion: "test-checkout-parameter",
    },
  ],
  cartId: consent.cartId,
  preflightId: observation.id,
  expectedCartVersion: 2,
  expectedConsentHash: observation.consentHash,
  checkoutSessionId: id(),
  orderId: id(),
  publicOrderId: id(),
  contact: {
    id: id(),
    emailCiphertext: "enc:v1:" + "a".repeat(40),
    encryptedDataKey: "enc:v1:" + "b".repeat(40),
    encryptionKeyVersion: "test-parameter",
    emailLookupHmac: "a".repeat(64),
    lookupKeyVersion: "test-parameter",
  },
  items: [
    {
      cartItemId: line.cartItemId,
      orderItemId: id(),
      fulfillmentId: id(),
      fulfillmentEventId: id(),
    },
  ],
  createdOrderEventId: id(),
  pendingOrderEventId: id(),
  eventId: id(),
  requestId: id(),
  correlationId: id(),
});
const statements = new Set();
await writeCheckout(
  {
    query: async (sql) => {
      statements.add(sql);
      if (sql.includes(" event_time "))
        return { rows: [{ event_time: createdAt }] };
      if (sql.includes(" valid")) return { rows: [{ valid: true }] };
      if (sql.startsWith("UPDATE public.support_intents"))
        return { rows: [{ id: line.supportIntentId }] };
      if (sql.startsWith("UPDATE public.carts"))
        return { rows: [{ version: "3" }] };
      return { rows: [] };
    },
  },
  command,
  observation,
);
for (const name of ["current", "data", "repository"]) {
  const text = await readFile(
    new URL(`../src/checkout-preflight-${name}.ts`, import.meta.url),
    "utf8",
  );
  for (const match of text.matchAll(/`([^`]+)`/gu)) {
    if (!match[1].includes("SELECT") && !match[1].includes("INSERT INTO"))
      continue;
    const sql = match[1]
      .replaceAll("${checkoutReceiptColumns}", checkoutReceiptColumns)
      .replace(/\$\{cartTimestamp\("([^"]+)"\)\}/gu, (_match, column) =>
        cartTimestamp(column),
      );
    assert.equal(
      sql.includes("${"),
      false,
      `all SQL substitutions must be resolved: ${name}`,
    );
    statements.add(sql);
  }
}
let assertions = 0,
  stage = "MIGRATIONS";
await withEphemeralPostgres(async (clientConfig) => {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(clientConfig);
  await client.connect();
  try {
    for (const [index, sql] of [...statements].entries()) {
      stage = `PREPARE_${index}`;
      await client.query(`PREPARE checkout_statement_${index} AS ${sql}`);
      assertions++;
    }
    stage = "OBSERVATION_CANONICAL_CHECK";
    await client.query(
      "CREATE TEMP TABLE checkout_observation_probe (LIKE public.checkout_preflight_observations INCLUDING CONSTRAINTS INCLUDING DEFAULTS)",
    );
    const observationInsert = `INSERT INTO checkout_observation_probe(id,cart_id,cart_version,consent_hash,observation,created_at,expires_at) VALUES($1::uuid,$2::uuid,$3::bigint,$4,$5::jsonb,$6::timestamptz,$7::timestamptz)`;
    const values = (json) => [
      observation.id,
      consent.cartId,
      consent.cartVersion,
      observation.consentHash,
      json,
      observation.createdAt,
      observation.expiresAt,
    ];
    const serialized = process.argv.includes("--raw-observation")
      ? JSON.stringify(observation)
      : canonicalPublicationValue(observation);
    await client.query(observationInsert, values(serialized));
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::integer count FROM checkout_observation_probe",
        )
      ).rows[0].count,
      1,
    );
    assertions++;
    await assert.rejects(
      client.query(observationInsert, values(JSON.stringify(observation))),
      (error) =>
        error.code === "23514" &&
        error.constraint === "checkout_preflight_observations_check2",
    );
    assertions++;
    const tampered = JSON.parse(serialized);
    tampered.consent.lines[0].quantity += 1;
    await assert.rejects(
      client.query(observationInsert, values(JSON.stringify(tampered))),
      (error) =>
        error.code === "23514" &&
        error.constraint === "checkout_preflight_observations_check2",
    );
    assertions++;
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "PASS",
        assertions,
        scope:
          "Actual checkout SQL parameter inference and original observation CHECKs on a temporary LIKE table without foreign keys/triggers; raw or altered consent rejected; no commerce proof claim",
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "FAIL",
        stage,
        sqlState: typeof error.code === "string" ? error.code : null,
        constraint:
          typeof error.constraint === "string" ? error.constraint : null,
      }) + "\n",
    );
    throw new Error("Checkout SQL parameter probe failed", { cause: error });
  } finally {
    await client.end();
  }
});
