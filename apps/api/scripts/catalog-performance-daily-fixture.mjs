import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { managementCenterResponseSchema } from "@fan-support/contracts";
import { createMediaImageProcessor } from "@fan-support/media-image";
import { createTestManagementCenterComposition } from "../dist/testing/index.js";
import { configureCartDailyGiftFixture } from "./cart-daily-gift-fixture.mjs";
import { createPublicationMediaFixture } from "./publication-runtime-http-media.mjs";

/** One actual publisher runtime; every gift has its own upload, operation, price and immutable proof. */
export async function seedCatalogPerformanceDaily(input, count = 120) {
  assert.equal(
    count,
    120,
    "performance fixture has a fixed reproducible daily gift count",
  );
  const {
    database,
    s3,
    client,
    identity,
    gateway,
    origin,
    workspaceRoot,
    check,
  } = input;
  const scope = await configureCartDailyGiftFixture(input);
  const media = createPublicationMediaFixture(s3);
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
  const credential = identity.credentials.manager;
  async function execute(command) {
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
      `normal daily performance ${command.action} succeeds`,
    );
    return response;
  }
  const bytes = await readFile(
    path.join(
      workspaceRoot,
      "apps/storefront/public/ui-brand/gift-rose-palace.webp",
    ),
  );
  const gifts = [];
  try {
    await composition.managementCenterRuntime.start();
    for (let index = 0; index < count; index++) {
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
        "daily performance uses actual strict-TLS S3 upload",
      );
      const submitted = await execute({
        action: "SUBMIT",
        idempotencyKey: randomUUID(),
        intent: {
          kind: "SAVE_GIFT",
          sourceLocale: "en",
          id: null,
          expectedVersion: 0,
          name: `Performance Gift ${String(index + 1).padStart(3, "0")}`,
          description:
            "Synthetic gift for isolated PostgreSQL performance measurement.",
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
        "daily performance submission has a real persisted operation",
      );
      let operation = submitted.operation;
      const deadline = globalThis.performance.now() + 120_000;
      while (
        operation.status === "PROCESSING" &&
        globalThis.performance.now() < deadline
      ) {
        await delay(100);
        operation = (
          await execute({
            action: "READ_OPERATION",
            operationId: operation.operationId,
          })
        ).operation;
      }
      check(
        operation.status === "PUBLISHED",
        "every performance gift completes normal publication",
      );
      gifts.push({
        id: operation.result.targetId,
        operationId: operation.operationId,
      });
      if ((index + 1) % 12 === 0)
        console.log(
          `Catalog performance daily published ${index + 1}/${count}`,
        );
    }
    const rows = (
      await client.query(
        "SELECT p.proof_version,count(*)::int AS count FROM public.gift_publication_heads h JOIN public.content_publications p ON p.id=h.publication_id WHERE h.gift_id=ANY($1::uuid[]) GROUP BY p.proof_version",
        [gifts.map((gift) => gift.id)],
      )
    ).rows;
    assert.deepEqual(rows, [{ proof_version: 3, count }]);
    return gifts;
  } finally {
    await composition.managementCenterRuntime.stop();
  }
}
