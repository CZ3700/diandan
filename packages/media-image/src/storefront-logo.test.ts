import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  storefrontLogoProcessingCommandSchema,
  storefrontLogoProcessingResultSchema,
  storefrontLogoObjectKey,
  type StorefrontLogoProcessingCommand,
} from "@fan-support/contracts";
import { createStorefrontLogoProcessor } from "./storefront-logo.js";
import { hash, memoryStorage, testNow } from "./test-support/storage.js";

const uploadId = "30000000-0000-4000-8000-000000000001";
function commandForLogo(
  bytes: Buffer,
  mimeType: StorefrontLogoProcessingCommand["source"]["mimeType"] = "image/png",
) {
  return storefrontLogoProcessingCommandSchema.parse({
    schemaVersion: 1,
    profileVersion: 1,
    uploadId,
    source: {
      objectKey: `uploads/v1/${uploadId}`,
      checksumSha256: hash(bytes),
      byteSize: bytes.length,
      mimeType,
    },
  });
}
function logo(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 190, g: 20, b: 90, alpha: 0.5 },
    },
  });
}
async function process(bytes: Buffer) {
  const command = commandForLogo(bytes);
  const fixture = memoryStorage(bytes, command);
  const result = storefrontLogoProcessingResultSchema.parse(
    await createStorefrontLogoProcessor({ ...fixture, now: testNow }).process(
      command,
    ),
  );
  return { command, fixture, result };
}

describe("storefront logo processing", () => {
  it("keeps translucent pixels and full proportions without a photo canvas", async () => {
    const bytes = await logo(1800, 600).png().toBuffer();
    const { command, fixture, result } = await process(bytes);
    if (result.outcome !== "SUCCESS") throw new Error(result.error.code);
    expect([result.image.width, result.image.height]).toEqual([1024, 341]);
    expect(result.sourceChecksumSha256).toBe(command.source.checksumSha256);
    expect(result.image.objectKey).toBe(
      storefrontLogoObjectKey(uploadId, result.image.checksumSha256),
    );
    expect(fixture.uploads).toEqual([`DERIVATIVE/${result.image.objectKey}`]);
    const stored = fixture.objects.get(`DERIVATIVE/${result.image.objectKey}`)!;
    expect(hash(stored.bytes)).toBe(result.image.checksumSha256);
    const metadata = await sharp(stored.bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.hasAlpha).toBe(true);
    const { data, info } = await sharp(stored.bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(data[3]).toBeGreaterThanOrEqual(126);
    expect(data[3]).toBeLessThanOrEqual(129);
    // Alpha premultiplication during resizing may round each 8-bit color channel by one.
    for (const [index, channel] of [190, 20, 90].entries())
      expect(Math.abs(data[index]! - channel)).toBeLessThanOrEqual(1);
  });

  it("retains fully transparent margins instead of flattening or cropping", async () => {
    const mark = await logo(60, 60).png().toBuffer();
    const source = await sharp({
      create: { width: 120, height: 100, channels: 4, background: "#00000000" },
    })
      .composite([{ input: mark, top: 20, left: 30 }])
      .png()
      .toBuffer();
    const { fixture, result } = await process(source);
    if (result.outcome !== "SUCCESS") throw new Error(result.error.code);
    expect([result.image.width, result.image.height]).toEqual([120, 100]);
    const stored = fixture.objects.get(`DERIVATIVE/${result.image.objectKey}`)!;
    const { data, info } = await sharp(stored.bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
    expect(data[(50 * info.width + 60) * info.channels + 3]).toBeGreaterThan(0);
  });

  it("corrects orientation and strips metadata while retaining modest dimensions", async () => {
    const source = await logo(300, 100)
      .withExif({ IFD0: { Make: "PrivateLogoFixture" } })
      .withMetadata({ orientation: 6 })
      .png()
      .toBuffer();
    const { fixture, result } = await process(source);
    if (result.outcome !== "SUCCESS") throw new Error(result.error.code);
    expect([result.image.width, result.image.height]).toEqual([100, 300]);
    const stored = fixture.objects.get(`DERIVATIVE/${result.image.objectKey}`)!;
    const metadata = await sharp(stored.bytes).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(stored.bytes.includes(Buffer.from("PrivateLogoFixture"))).toBe(
      false,
    );
  });

  it("reuses an identical derivative after a lost response", async () => {
    const source = await logo(300, 100).png().toBuffer();
    const { command, fixture, result } = await process(source);
    const again = await createStorefrontLogoProcessor({
      ...fixture,
      now: testNow,
    }).process(command);
    expect(again).toEqual(result);
    expect(fixture.uploads).toHaveLength(1);
  });

  it("rejects animated WebP before creating a public derivative", async () => {
    const frames = Buffer.concat([
      Buffer.alloc(16 * 16 * 3),
      Buffer.alloc(16 * 16 * 3, 255),
    ]);
    const source = await sharp(frames, {
      raw: { width: 16, height: 32, channels: 3, pageHeight: 16 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(source).metadata()).pages).toBe(2);
    const command = commandForLogo(source, "image/webp");
    const fixture = memoryStorage(source, command);
    expect(
      await createStorefrontLogoProcessor({ ...fixture, now: testNow }).process(
        command,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "INVALID_IMAGE", retryable: false },
    });
    expect(fixture.uploads).toHaveLength(0);
  });

  it.each([
    "foreign-key",
    "svg",
    "mime",
    "corrupt",
    "changed-source",
    "storage",
  ] as const)("fails closed for %s without claiming success", async (kind) => {
    let source = await logo(120, 80).png().toBuffer();
    if (kind === "svg")
      source = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );
    if (kind === "corrupt")
      source = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    // The MIME case is served as the declared JPEG so it reaches the image-header check.
    const command = commandForLogo(
      source,
      kind === "mime" ? "image/jpeg" : "image/png",
    );
    const fixture = memoryStorage(source, command);
    if (kind === "changed-source")
      fixture.controls.extraDownload = Buffer.from("changed");
    if (kind === "storage") fixture.controls.failPut = 1;
    const input =
      kind === "foreign-key"
        ? {
            ...command,
            source: { ...command.source, objectKey: "uploads/v1/other" },
          }
        : command;
    const result = await createStorefrontLogoProcessor({
      ...fixture,
      now: testNow,
    }).process(input as StorefrontLogoProcessingCommand);
    const codes = {
      "foreign-key": "INVALID_COMMAND",
      svg: "MIME_MISMATCH",
      mime: "MIME_MISMATCH",
      corrupt: "INVALID_IMAGE",
      "changed-source": "SOURCE_CHANGED",
      storage: "STORAGE_UNAVAILABLE",
    };
    expect(result).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: codes[kind], retryable: kind === "storage" },
    });
  });
});
