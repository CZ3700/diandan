import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  deliveryProofProcessingCommandSchema,
  deliveryProofProcessingResultSchema,
  deliveryProofRenditionObjectKey,
  deliveryProofRenditionSchema,
  deliveryProofSourceObjectKey,
  type DeliveryProofProcessingCommand,
} from "@fan-support/contracts";
import {
  createDeliveryProofProcessor,
  createDeliveryProofReader,
} from "./index.js";
import { hash, memoryStorage, testNow } from "./test-support/storage.js";

const uploadId = "30000000-0000-4000-8000-000000000001";
function proofCommand(
  bytes: Buffer,
  mimeType: DeliveryProofProcessingCommand["source"]["mimeType"] = "image/jpeg",
) {
  return deliveryProofProcessingCommandSchema.parse({
    schemaVersion: 1,
    profileVersion: 1,
    uploadId,
    source: {
      objectKey: deliveryProofSourceObjectKey(uploadId),
      checksumSha256: hash(bytes),
      byteSize: bytes.length,
      mimeType,
    },
  });
}
function photo(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 180, g: 120, b: 90 },
    },
  });
}

describe("private delivery proof processing", () => {
  it("removes camera and location metadata, applies orientation and writes only private renditions", async () => {
    const source = await photo(2000, 1500)
      .withExif({
        IFD0: { Make: "FixtureCam", Model: "Private Model" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "35/1 40/1 0/1" },
      })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const before = await sharp(source).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);
    const command = proofCommand(source);
    const fixture = memoryStorage(source, command);
    const result = deliveryProofProcessingResultSchema.parse(
      await createDeliveryProofProcessor({
        ...fixture,
        now: testNow,
      }).process(command),
    );
    if (result.outcome !== "SUCCESS") throw new Error(result.error.code);
    expect([result.display.width, result.display.height]).toEqual([1200, 1600]);
    expect([result.thumbnail.width, result.thumbnail.height]).toEqual([
      360, 480,
    ]);
    expect(fixture.uploads).toEqual([
      `SOURCE/${result.display.objectKey}`,
      `SOURCE/${result.thumbnail.objectKey}`,
    ]);
    expect(fixture.uploads.some((path) => path.startsWith("DERIVATIVE/"))).toBe(
      false,
    );
    for (const rendition of [result.display, result.thumbnail]) {
      expect(rendition.objectKey).toBe(
        deliveryProofRenditionObjectKey(uploadId, rendition.checksumSha256),
      );
      const stored = fixture.objects.get(`SOURCE/${rendition.objectKey}`)!;
      expect(hash(stored.bytes)).toBe(rendition.checksumSha256);
      const metadata = await sharp(stored.bytes).metadata();
      expect(metadata.format).toBe("webp");
      expect([metadata.width, metadata.height]).toEqual([
        rendition.width,
        rendition.height,
      ]);
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
      expect(stored.bytes.includes(Buffer.from("FixtureCam"))).toBe(false);
    }
  });

  it("never enlarges a modest photo", async () => {
    const source = await photo(800, 600).png().toBuffer();
    const command = proofCommand(source, "image/png");
    const fixture = memoryStorage(source, command);
    const result = await createDeliveryProofProcessor({
      ...fixture,
      now: testNow,
    }).process(command);
    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") return;
    expect([result.display.width, result.display.height]).toEqual([800, 600]);
    expect([result.thumbnail.width, result.thumbnail.height]).toEqual([
      480, 360,
    ]);
  });

  it.each([
    ["a photo too small to be useful", "SOURCE_TOO_SMALL"],
    ["bytes that disagree with the declared type", "MIME_MISMATCH"],
  ])("rejects %s before any upload", async (label, code) => {
    const source =
      code === "SOURCE_TOO_SMALL"
        ? await photo(1000, 300).jpeg().toBuffer()
        : await photo(800, 600).png().toBuffer();
    // The PNG case is served as the declared JPEG, so only the decoder's magic check can catch it.
    const command = proofCommand(source, "image/jpeg");
    const fixture = memoryStorage(source, command);
    expect(
      await createDeliveryProofProcessor({ ...fixture, now: testNow }).process(
        command,
      ),
      label,
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code, retryable: false },
    });
    expect(fixture.uploads).toHaveLength(0);
  });

  it("rejects a forged source key before touching storage", async () => {
    const source = await photo(800, 600).jpeg().toBuffer();
    const command = proofCommand(source);
    const fixture = memoryStorage(source, command);
    const forged = {
      ...command,
      source: { ...command.source, objectKey: "uploads/v1/other" },
    };
    expect(
      await createDeliveryProofProcessor({ ...fixture, now: testNow }).process(
        forged as DeliveryProofProcessingCommand,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "INVALID_COMMAND", retryable: false },
    });
    expect(fixture.uploads).toHaveLength(0);
  });
});

describe("authorized private proof reads", () => {
  async function stored() {
    const bytes = await photo(480, 360).webp().toBuffer();
    const rendition = deliveryProofRenditionSchema.parse({
      objectKey: deliveryProofRenditionObjectKey(uploadId, hash(bytes)),
      checksumSha256: hash(bytes),
      byteSize: bytes.length,
      width: 480,
      height: 360,
      mimeType: "image/webp",
    });
    return {
      bytes,
      rendition,
      fixture: memoryStorage(bytes, { source: rendition }),
    };
  }
  it("returns exactly the verified rendition bytes", async () => {
    const { bytes, rendition, fixture } = await stored();
    const result = await createDeliveryProofReader({
      ...fixture,
      now: testNow,
    }).read({ schemaVersion: 1, rendition });
    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome === "SUCCESS")
      expect(Buffer.from(result.bytes).equals(bytes)).toBe(true);
  });
  it("distinguishes a missing object from altered or unavailable storage", async () => {
    const { rendition, fixture } = await stored();
    fixture.objects.clear();
    expect(
      await createDeliveryProofReader({ ...fixture, now: testNow }).read({
        schemaVersion: 1,
        rendition,
      }),
    ).toEqual({ outcome: "FAILURE", code: "NOT_FOUND" });
    const altered = await stored();
    altered.fixture.controls.extraDownload = Buffer.from("tampered");
    expect(
      await createDeliveryProofReader({
        ...altered.fixture,
        now: testNow,
      }).read({ schemaVersion: 1, rendition: altered.rendition }),
    ).toEqual({ outcome: "FAILURE", code: "UNAVAILABLE" });
    expect(
      await createDeliveryProofReader({
        ...altered.fixture,
        now: testNow,
      }).read({
        schemaVersion: 1,
        rendition: { ...altered.rendition, mimeType: "image/png" },
      } as never),
    ).toEqual({ outcome: "FAILURE", code: "UNAVAILABLE" });
  });
});
