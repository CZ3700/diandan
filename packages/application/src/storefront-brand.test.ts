import { expect, test, vi } from "vitest";
import { createStorefrontBrandUseCases } from "./storefront-brand.js";
const id = "abcdefab-0000-4000-8000-000000000001";
const at = "2026-10-01T00:00:00Z";
function fixture() {
  const principal = {
    schemaVersion: 1,
    actorId: id,
    sessionId: id,
    authorizedAt: at,
    expiresAt: "2026-10-02T00:00:00Z",
  };
  const authorization = {
    authorize: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal,
    })),
  };
  const storefrontBrand = {
    execute: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NOT_FOUND",
    })),
    readPrepared: vi.fn(async () => null),
    saveLogo: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "LOGO",
      logo: {
        assetId: id,
        url: `https://media.example.test/processed/v1/${id}/${"b".repeat(64)}.webp`,
        width: 40,
        height: 20,
      },
      replayed: false,
    })),
  };
  const resources = {
    readUpload: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      value: {
        schemaVersion: 1,
        uploadId: id,
        version: 1,
        actorId: id,
        sessionId: id,
        source: {
          objectKey: `uploads/v1/${id}`,
          checksumSha256: "a".repeat(64),
          byteSize: 100,
          mimeType: "image/png",
        },
        rightsReference: "STOREFRONT_BRAND",
        status: "PENDING",
        assetId: null,
        createdAt: at,
        expiresAt: "2026-10-01T00:10:00Z",
      },
    })),
  };
  const processor = {
    process: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      profileVersion: 1,
      uploadId: id,
      sourceChecksumSha256: "a".repeat(64),
      metadataPolicy: "STRIP_ALL_SRGB",
      image: {
        objectKey: `processed/v1/${id}/${"b".repeat(64)}.webp`,
        checksumSha256: "b".repeat(64),
        byteSize: 80,
        mimeType: "image/webp",
        width: 40,
        height: 20,
      },
    })),
  };
  const deps = {
    tokenPepper: "c".repeat(64),
    processor,
    transactions: {
      runInStorefrontBrandTransaction: vi.fn(
        async (work: (r: unknown) => unknown) =>
          work({ authorization, resources, storefrontBrand }),
      ),
    },
  };
  return {
    ...deps,
    authorization,
    resources,
    storefrontBrand,
    useCases: createStorefrontBrandUseCases(deps as never),
  };
}
const request = (command: unknown) => ({
  schemaVersion: 1,
  requestId: id,
  sessionToken: "a".repeat(42) + "A",
  csrfToken: "b".repeat(42) + "A",
  command,
});
test("invalid brand commands never authorize or process", async () => {
  const f = fixture();
  expect(
    await f.useCases.execute(
      request({
        schemaVersion: 1,
        action: "SAVE_DRAFT",
        brand: { url: "https://evil.test" },
      }),
    ),
  ).toMatchObject({ code: "INVALID_COMMAND" });
  expect(f.processor.process).not.toHaveBeenCalled();
  expect(f.authorization.authorize).not.toHaveBeenCalled();
});
test("logo prepare reauthorizes after image I/O and only commits the bound upload", async () => {
  const f = fixture();
  expect(
    await f.useCases.execute(
      request({
        schemaVersion: 1,
        action: "PREPARE_LOGO",
        uploadId: id,
        idempotencyKey: "prepare-logo-one",
      }),
    ),
  ).toMatchObject({ outcome: "SUCCESS", kind: "LOGO" });
  expect(f.processor.process).toHaveBeenCalledTimes(1);
  expect(f.authorization.authorize).toHaveBeenCalledTimes(6);
  expect(f.storefrontBrand.saveLogo).toHaveBeenCalledTimes(1);
});
test("foreign upload or processor source mismatch cannot persist a logo", async () => {
  for (const foreign of [true, false]) {
    const f = fixture();
    if (foreign) {
      const result = await f.resources.readUpload();
      f.resources.readUpload.mockResolvedValue({
        ...result,
        value: {
          ...result.value,
          actorId: "abcdefab-0000-4000-8000-000000000002",
        },
      });
    } else {
      const result = await f.processor.process();
      f.processor.process.mockResolvedValue({
        ...result,
        sourceChecksumSha256: "c".repeat(64),
      });
    }
    expect(
      await f.useCases.execute(
        request({
          schemaVersion: 1,
          action: "PREPARE_LOGO",
          uploadId: id,
          idempotencyKey: "prepare-logo-one",
        }),
      ),
    ).toMatchObject({ outcome: "FAILURE" });
    expect(f.storefrontBrand.saveLogo).not.toHaveBeenCalled();
  }
});

test("changing authorization identity or expired upload cannot reach processing", async () => {
  for (const kind of ["principal", "ticket"] as const) {
    const f = fixture();
    if (kind === "principal") {
      const response = await f.authorization.authorize();
      f.authorization.authorize
        .mockResolvedValueOnce(response)
        .mockResolvedValue({
          ...response,
          principal: {
            ...response.principal,
            sessionId: "abcdefab-0000-4000-8000-000000000002",
          },
        });
    } else {
      const response = await f.resources.readUpload();
      f.resources.readUpload.mockResolvedValue({
        ...response,
        value: { ...response.value, expiresAt: response.value.createdAt },
      });
    }
    f.processor.process.mockClear();
    expect(
      await f.useCases.execute(
        request({
          schemaVersion: 1,
          action: "PREPARE_LOGO",
          uploadId: id,
          idempotencyKey: "prepare-logo-one",
        }),
      ),
    ).toMatchObject({ outcome: "FAILURE" });
    expect(f.processor.process).not.toHaveBeenCalled();
  }
});

test("processing accepts an unchanged source after transaction JSON key canonicalization", async () => {
  const f = fixture();
  f.transactions.runInStorefrontBrandTransaction.mockImplementation(
    async (work) => {
      const result = await work({
        authorization: f.authorization,
        resources: f.resources,
        storefrontBrand: f.storefrontBrand,
      });
      return JSON.parse(
        JSON.stringify(result, (_key, value: unknown) =>
          value !== null && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
              )
            : value,
        ),
      ) as unknown;
    },
  );
  expect(
    await f.useCases.execute(
      request({
        schemaVersion: 1,
        action: "PREPARE_LOGO",
        uploadId: id,
        idempotencyKey: "canonical-source",
      }),
    ),
  ).toMatchObject({ outcome: "SUCCESS", kind: "LOGO" });
});
