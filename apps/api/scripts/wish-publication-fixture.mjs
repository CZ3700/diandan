import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { managementCenterResponseSchema } from "@fan-support/contracts";
import { createMediaImageProcessor } from "@fan-support/media-image";
import { createStructuredLogger } from "@fan-support/observability";
import { createApiApplication } from "../dist/bootstrap.js";
import { createTestManagementCenterComposition } from "../dist/testing/test-management-center-composition.js";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { publicationMediaEnvironment } from "./publication-runtime-http-media.mjs";
import { configureCartDailyGiftFixture } from "./cart-daily-gift-fixture.mjs";

/** A new synthetic WISH goes through the same upload, submit, worker and publication path as the admin. */
export async function publishWishFixture(
  context,
  {
    s3,
    workspaceRoot,
    artistId = context.fixtures.artists[0].id,
    name = "A wish beneath the stars",
  },
) {
  // Test staff/configuration only; the wish itself still uses the authenticated HTTP publisher.
  const market = await configureCartDailyGiftFixture(context);
  const composition = createTestManagementCenterComposition({
    environment: "TEST",
    database: context.database,
    tokenPepper: context.identity.tokenPepper,
    allowedOrigin: context.origin,
    publicMediaBaseUrl: context.gateway.origin,
    ...context.media,
    processor: createMediaImageProcessor({
      storage: context.media.storage,
      now: () => new Date(),
    }),
    pollIntervalMs: 20,
  });
  let closed = false;
  context.own("wish fixture management composition", () =>
    closed ? undefined : composition.managementCenterRuntime.stop(),
  );
  const app = await createApiApplication(
    {
      ...publicationMediaEnvironment(
        preflightEnvironment(context.database),
        s3,
      ),
      FAN_SUPPORT_SITE_ORIGIN: context.origin,
      FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: context.gateway.origin,
    },
    {
      ...composition,
      logger: createStructuredLogger({
        service: "api",
        write: (line) => context.logLines.push(line),
      }),
    },
  );
  context.own("wish fixture management API", async () => {
    await app.close();
    closed = true;
  });
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const credential = context.identity.credentials.manager;
  async function request(endpoint, body, mutation = false) {
    const response = await globalThis.fetch(
      `${base}/api/v1/admin/management/${endpoint}`,
      {
        method: "POST",
        headers: {
          origin: context.origin,
          "content-type": "application/json",
          cookie: `__Host-fan-admin-session=${credential.token}`,
          "x-csrf-token": credential.csrf,
          ...(mutation ? { "idempotency-key": randomUUID() } : {}),
        },
        body: JSON.stringify({ schemaVersion: 1, ...body }),
        signal: globalThis.AbortSignal.timeout(30_000),
      },
    );
    const result = managementCenterResponseSchema.parse(await response.json());
    assert.equal(
      response.status,
      200,
      `wish management ${endpoint}: ${result.outcome === "FAILURE" ? result.code : result.kind}`,
    );
    assert.equal(result.outcome, "SUCCESS");
    return result;
  }
  const config = await request("context", {});
  assert.equal(config.kind, "CONTEXT");
  const location =
    config.defaults?.inventoryLocationId ??
    (
      await context.client.query(
        "SELECT id FROM inventory_locations WHERE status='ACTIVE' ORDER BY id LIMIT 1",
      )
    ).rows[0]?.id;
  assert.ok(location, "normal fixture has an active inventory location");
  const bytes = await readFile(
    path.join(
      workspaceRoot,
      "apps/storefront/public/ui-composites/fictional-keepsake-gift.png",
    ),
  );
  const grant = await request(
    "uploads/prepare",
    {
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.length,
      mimeType: "image/png",
      rightsConfirmed: true,
    },
    true,
  );
  assert.equal(grant.kind, "UPLOAD_GRANT");
  const put = await globalThis.fetch(grant.grant.url, {
    method: "PUT",
    headers: grant.grant.headers,
    body: bytes,
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  await put.body?.cancel();
  assert.equal(
    put.status,
    200,
    "wish source bytes uploaded through signed grant",
  );
  const submitted = await request(
    "submit",
    {
      intent: {
        kind: "SAVE_GIFT",
        id: null,
        expectedVersion: 0,
        sourceLocale: "en",
        name,
        description:
          "A little dream held close, waiting for one unforgettable act of love.",
        image: { uploadId: grant.uploadId },
        giftKind: "WISH",
        category: "OTHER",
        price: { ...market, amountMinor: 1200 },
        inventory: { policy: "TRACKED", locationId: location, quantity: 1 },
        eligibility: { rule: "SINGLE_ARTIST", idolId: artistId },
      },
    },
    true,
  );
  assert.equal(submitted.kind, "OPERATION");
  const started = Date.now();
  let operation = submitted.operation;
  while (operation.status === "PROCESSING" && Date.now() - started < 90_000) {
    await delay(100);
    const read = await request("operations/read", {
      operationId: operation.operationId,
    });
    assert.equal(read.kind, "OPERATION");
    operation = read.operation;
  }
  assert.equal(
    operation.status,
    "PUBLISHED",
    `wish normal publication: ${operation.failure?.code ?? operation.status}`,
  );
  const binding = (
    await context.client.query(
      "SELECT wish_id,gift_id,gift_variant_id,idol_id,inventory_location_id FROM wish_bindings WHERE gift_id=$1",
      [operation.targetId],
    )
  ).rows[0];
  assert.equal(binding?.idol_id, artistId);
  await context.gateway.allowPublishedAsset(
    context.client,
    (
      await context.client.query(
        "SELECT media_asset_id FROM gift_revision_media WHERE gift_revision_id=$1 AND role='PRIMARY' ORDER BY sort_order LIMIT 1",
        [operation.result.revisionId],
      )
    ).rows[0].media_asset_id,
  );
  return {
    ...binding,
    id: binding.gift_id,
    handle: operation.result.handle,
    publication: operation.result,
    variants: [
      {
        id: binding.gift_variant_id,
        policy: "TRACKED",
        eligible: [artistId],
        quantity: 1,
        amounts: [1200, 1200],
      },
    ],
    request,
  };
}
