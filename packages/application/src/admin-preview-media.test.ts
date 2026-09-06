import { expect, test, vi } from "vitest";
import { createAdminPreviewMediaUseCases } from "./admin-preview-media.js";
import { translationTestId } from "./translation-test-support.js";
import { adminPreviewMediaContextSchema } from "@fan-support/contracts";
const path = "./admin-preview-media.js";
test("preview cannot turn an arbitrary object key into a download capability", async () => {
  const module = await import(path).catch(() => ({}));
  expect(module.createAdminPreviewMediaUseCases).toBeDefined();
  const run = vi.fn(),
    download = vi.fn();
  const useCases = module.createAdminPreviewMediaUseCases({
    transactions: { runInAdminPreviewMediaTransaction: run },
    storage: { createDownloadGrant: download },
    tokenPepper: "aa".repeat(32),
  });
  expect(
    (await useCases.execute({ schemaVersion: 1, objectKey: "private/source" }))
      .outcome,
  ).toBe("FAILURE");
  expect(run).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
});
function previewHarness() {
  let inTransaction = false,
    revoked = false,
    readCount = 0;
  const context = adminPreviewMediaContextSchema.parse({
    schemaVersion: 1,
    target: {
      owner: { kind: "HOMEPAGE" },
      revisionId: translationTestId(10),
      locale: "ja",
    },
    grantId: translationTestId(11),
    actorId: translationTestId(1),
    sessionId: translationTestId(2),
    evaluatedAt: "2026-09-07T00:00:00.000000Z",
    expiresAt: "2026-09-07T00:05:00.000789Z",
    images: [
      {
        status: "AVAILABLE",
        assetId: translationTestId(20),
        metadataRevisionId: translationTestId(21),
        width: 240,
        height: 300,
        mimeType: "image/webp",
        alt: "Portrait",
        presentationKind: "INFORMATIVE",
        focalPoint: { x: 0.5, y: 0.5 },
        storageClass: "DERIVATIVE",
        objectKey: "derivatives/private-fixture.webp",
        checksumSha256: "a".repeat(64),
      },
    ],
  });
  const download = vi.fn(
    async (command: { expiresAt: string; objectKey: string }) => {
      expect(inTransaction).toBe(false);
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        operation: "CREATE_DOWNLOAD_GRANT",
        value: {
          method: "GET",
          storageClass: "DERIVATIVE",
          objectKey: command.objectKey,
          url: "https://media.example.test/preview?signature=fixture",
          headers: { "x-provider-fixture": "value" },
          expiresAt: command.expiresAt,
        },
      };
    },
  );
  const useCases = createAdminPreviewMediaUseCases({
    tokenPepper: "aa".repeat(32),
    storage: { createDownloadGrant: download as never },
    transactions: {
      async runInAdminPreviewMediaTransaction(work) {
        inTransaction = true;
        try {
          return await work({
            adminPreviewMedia: {
              async read() {
                readCount++;
                return revoked && readCount > 1
                  ? {
                      schemaVersion: 1,
                      outcome: "FAILURE",
                      code: "PREVIEW_UNAVAILABLE",
                    }
                  : { schemaVersion: 1, outcome: "SUCCESS", context };
              },
            },
          });
        } finally {
          inTransaction = false;
        }
      },
    },
  });
  return {
    context,
    download,
    useCases,
    revoke: () => {
      revoked = true;
    },
    input: { schemaVersion: 1, target: context.target, token: "A".repeat(43) },
  };
}
test("media signing stays outside transactions and returns only scoped provider-neutral capabilities", async () => {
  const h = previewHarness();
  const response = await h.useCases.execute(h.input);
  expect(response.outcome).toBe("SUCCESS");
  expect(JSON.stringify(response)).not.toMatch(
    /objectKey|checksumSha256|actorId|sessionId|grantId/u,
  );
  if (
    response.outcome !== "SUCCESS" ||
    response.images[0]?.status !== "AVAILABLE"
  )
    throw new Error("fixture");
  expect(response.images[0].download.headers).toEqual({
    "x-provider-fixture": "value",
  });
  expect(response.images[0].download.expiresAt).toBe(h.context.expiresAt);
});
test("revocation during external signing returns no image credentials", async () => {
  const h = previewHarness();
  h.revoke();
  expect(await h.useCases.execute(h.input)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "PREVIEW_UNAVAILABLE",
  });
  expect(h.download).toHaveBeenCalledOnce();
});
test("a sub-minute grant is refused without extending its deadline", async () => {
  const h = previewHarness();
  h.context.expiresAt = "2026-09-07T00:00:59.999999Z";
  expect((await h.useCases.execute(h.input)).outcome).toBe("FAILURE");
  expect(h.download).not.toHaveBeenCalled();
});
