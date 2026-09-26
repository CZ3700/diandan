import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createMediaImageProcessor } from "@fan-support/media-image";
import { managementCenterResponseSchema } from "@fan-support/contracts";
import { createTestManagementCenterComposition } from "../dist/testing/index.js";

// Only configuration and a real staff grant are seeded. All gift/media/price/rule
// business rows below are written by the normal authenticated daily publisher.
export async function configureCartDailyGiftFixture({
  client,
  identity,
  content,
  fixtures,
}) {
  const actor = identity.identities.identities.manager;
  const firstArtist = fixtures.artists.find((artist) => artist.acceptingGifts);
  assert.ok(firstArtist, "daily cart fixture needs a current accepting artist");
  const original = await content.request(
    "/api/v1/admin/content-authoring/read",
    { target: firstArtist.owner, revisionId: firstArtist.revisionId },
  );
  const { themeAccent, heroTextTone } = original.snapshot.content.structure;
  const scope = fixtures.markets[0];
  assert.ok(scope, "daily cart fixture needs an explicit existing market");
  const existing = (
    await client.query(
      "SELECT c.lifecycle,d.market,d.currency,d.inventory_policy,d.inventory_location_id,d.eligibility_rule,d.artist_presentation FROM public.config_versions c LEFT JOIN public.management_defaults d ON d.config_version_id=c.id WHERE c.config_kind='MANAGEMENT_DEFAULTS' ORDER BY c.version",
    )
  ).rows;
  if (existing.length > 0) {
    assert.deepEqual(
      existing,
      [
        {
          lifecycle: "PUBLISHED",
          ...scope,
          inventory_policy: "PROCURE_ON_DEMAND",
          inventory_location_id: null,
          eligibility_rule: "ALL_ACTIVE_ARTISTS",
          artist_presentation: { themeAccent, heroTextTone },
        },
      ],
      "repeated daily publishing must reuse exact published fixture defaults",
    );
    return scope;
  }
  const role = randomUUID(),
    config = randomUUID();
  await client.query("BEGIN");
  try {
    const permission = (
      await client.query(
        "INSERT INTO public.permissions(id,permission_key,description) VALUES($1,'management.direct','TEST cart daily operator') ON CONFLICT(permission_key) DO UPDATE SET description=permissions.description RETURNING id",
        [randomUUID()],
      )
    ).rows[0].id;
    await client.query(
      "INSERT INTO public.roles(id,role_key,description) VALUES($1,$2,'TEST cart daily operator')",
      [role, `cart-daily:${role}`],
    );
    await client.query(
      "INSERT INTO public.admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$1)",
      [actor, role],
    );
    await client.query(
      "INSERT INTO public.role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
      [role, permission, actor],
    );
    await client.query(
      "INSERT INTO public.config_versions(id,config_kind,version,lifecycle,created_by) VALUES($1,'MANAGEMENT_DEFAULTS',1,'DRAFT',$2)",
      [config, actor],
    );
    await client.query(
      "INSERT INTO public.management_defaults(config_version_id,market,currency,inventory_policy,inventory_location_id,eligibility_rule,artist_presentation) VALUES($1,$2,$3,'PROCURE_ON_DEMAND',NULL,'ALL_ACTIVE_ARTISTS',$4)",
      [config, scope.market, scope.currency, { themeAccent, heroTextTone }],
    );
    await client.query(
      "UPDATE public.config_versions SET lifecycle='VALIDATED' WHERE id=$1",
      [config],
    );
    await client.query(
      "UPDATE public.config_versions SET lifecycle='PUBLISHED',published_at=clock_timestamp() WHERE id=$1",
      [config],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return scope;
}

/** Runs within the caller's real PG/S3 fixture; never starts Next or another database. */
export async function createCartDailyGiftFixture({
  database,
  client,
  identity,
  media,
  gateway,
  origin,
  workspaceRoot,
  content,
  fixtures,
  check,
  presentation = {
    sourceLocale: "en",
    name: "Daily Cart Fixture",
    description:
      "Synthetic daily gift for actual cart recipient-rule verification.",
  },
}) {
  const scope = await configureCartDailyGiftFixture({
    client,
    identity,
    content,
    fixtures,
  });
  const composition = createTestManagementCenterComposition({
    environment: "TEST",
    database,
    tokenPepper: identity.tokenPepper,
    allowedOrigin: origin,
    publicMediaBaseUrl: gateway.origin,
    ...media,
    processor: createMediaImageProcessor({
      storage: media.storage,
      now: () => new Date(),
    }),
    leaseSeconds: 300,
  });
  async function execute(command) {
    const credential = identity.credentials.manager;
    const response = managementCenterResponseSchema.parse(
      await composition.managementCenterRoute.useCases.execute({
        schemaVersion: 1,
        requestId: randomUUID(),
        sessionToken: credential.token,
        csrfToken: credential.csrf,
        command: { schemaVersion: 1, ...command },
      }),
    );
    check(
      response.outcome === "SUCCESS",
      `daily cart ${command.action} succeeds${response.outcome === "FAILURE" ? ` (${response.code})` : ""}`,
    );
    return response;
  }
  try {
    const bytes = await readFile(
      path.join(
        workspaceRoot,
        "apps/storefront/public/ui-brand/gift-rose-palace.webp",
      ),
    );
    const upload = await execute({
      action: "PREPARE_UPLOAD",
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.length,
      mimeType: "image/webp",
      rightsConfirmed: true,
      idempotencyKey: randomUUID(),
    });
    const put = await globalThis.fetch(upload.grant.url, {
      method: "PUT",
      headers: upload.grant.headers,
      body: bytes,
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    await put.body?.cancel();
    check(
      put.status === 200,
      "daily cart image uses real strict-TLS signed S3 PUT",
    );
    const submitted = await execute({
      action: "SUBMIT",
      idempotencyKey: randomUUID(),
      intent: {
        kind: "SAVE_GIFT",
        sourceLocale: presentation.sourceLocale,
        id: null,
        expectedVersion: 0,
        name: presentation.name,
        description: presentation.description,
        image: { uploadId: upload.uploadId },
        giftKind: "PHYSICAL",
        category: "FLOWERS",
        price: { ...scope, amountMinor: 1000 },
        inventory: { policy: "PROCURE_ON_DEMAND" },
        eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
      },
    });
    check(
      submitted.kind === "OPERATION",
      "daily submission returns a persisted operation",
    );
    await composition.managementCenterRuntime.start();
    const deadline = globalThis.performance.now() + 120_000;
    let operation = submitted.operation;
    while (
      operation.status === "PROCESSING" &&
      globalThis.performance.now() < deadline
    ) {
      await delay(250);
      operation = (
        await execute({
          action: "READ_OPERATION",
          operationId: operation.operationId,
        })
      ).operation;
    }
    check(
      operation.status === "PUBLISHED",
      `daily cart operation publishes${operation.failure ? ` (${operation.failure.code})` : ""}`,
    );
    const giftId = operation.result.targetId;
    const rows = (
      await client.query(
        `SELECT v.id AS variant_id,price.id AS price_id FROM public.gift_variants v
       JOIN public.gift_variant_recipient_rules rule ON rule.gift_variant_id=v.id AND rule.rule='ALL_ACTIVE_ARTISTS'
       JOIN public.price_book_publication_heads h ON h.market=$2 AND h.currency=$3
       JOIN public.prices price ON price.price_book_id=h.price_book_id AND price.price_book_revision=h.price_book_revision
        AND price.gift_variant_id=v.id AND price.status='PUBLISHED'
       WHERE v.gift_id=$1 AND NOT EXISTS(SELECT 1 FROM public.gift_variant_idol_eligibility explicit WHERE explicit.gift_variant_id=v.id)`,
        [giftId, scope.market, scope.currency],
      )
    ).rows;
    check(
      rows.length === 1,
      "daily publisher creates exactly one variant with actual rule and no synthetic explicit eligibility",
    );
    const assets = (
      await client.query(
        "SELECT checkpoint#>'{preparedMedia,assets}' AS assets FROM public.management_operations WHERE id=$1 AND status='SUCCEEDED'",
        [operation.operationId],
      )
    ).rows[0]?.assets;
    check(
      Array.isArray(assets) && assets.length === 1,
      "daily publication has an actual processed primary image",
    );
    for (const asset of assets)
      await gateway.allowPublishedAsset(client, asset.assetId);
    return {
      giftId,
      giftVariantId: rows[0].variant_id,
      handle: operation.result.handle,
      priceId: rows[0].price_id,
      operationId: operation.operationId,
      ...scope,
    };
  } finally {
    await composition.managementCenterRuntime.stop();
  }
}
