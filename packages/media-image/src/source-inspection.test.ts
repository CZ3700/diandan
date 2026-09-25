import sharp from "sharp";
import { crc32 } from "node:zlib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  MEDIA_IMAGE_PROFILE,
  mediaObjectKeySchema,
  sourceHashSchema,
  type MediaImageProcessingCommand,
} from "@fan-support/contracts";
import { createMediaSourceInspector } from "./source-inspection.js";
import { hash, memoryStorage, testNow } from "./test-support/storage.js";

type Mime = MediaImageProcessingCommand["source"]["mimeType"];
function commandFor(bytes: Buffer, mimeType: Mime = "image/png") {
  return {
    schemaVersion: 1 as const,
    profileVersion: 1 as const,
    source: {
      objectKey: mediaObjectKeySchema.parse("uploads/v1/inspection-fixture"),
      checksumSha256: sourceHashSchema.parse(hash(bytes)),
      byteSize: bytes.length,
      mimeType,
    },
  };
}
function expectedFailure(code: string, retryable = false) {
  return { schemaVersion: 1, outcome: "FAILURE", error: { code, retryable } };
}
function inspectFixture(bytes: Buffer, mimeType: Mime = "image/png") {
  const command = commandFor(bytes, mimeType);
  const fixture = memoryStorage(bytes, command);
  return {
    ...fixture,
    command,
    inspector: createMediaSourceInspector({ ...fixture, now: testNow }),
  };
}
let pixels: Buffer;
beforeAll(async () => {
  pixels = await sharp({
    create: { width: 37, height: 23, channels: 4, background: "#23598788" },
  })
    .png()
    .toBuffer();
});

describe("trusted source inspection", () => {
  it.each(["png", "jpeg", "webp", "avif"] as const)(
    "fully inspects real %s bytes without role geometry or asset identity",
    async (format) => {
      const bytes = await sharp(pixels).toFormat(format).toBuffer();
      const fixture = inspectFixture(bytes, `image/${format}`);
      expect(await fixture.inspector.inspect(fixture.command)).toEqual({
        schemaVersion: 1,
        outcome: "SUCCESS",
        receipt: {
          schemaVersion: 1,
          profileVersion: 1,
          source: fixture.command.source,
          width: 37,
          height: 23,
          orientation: 1,
        },
      });
      expect(fixture.uploads).toHaveLength(0);
      expect(fixture.objects.size).toBe(1);
    },
  );

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "reports encoded dimensions and EXIF orientation %i while preserving private bytes",
    async (orientation) => {
      const bytes = await sharp(pixels)
        .withMetadata({ orientation })
        .jpeg()
        .toBuffer();
      const fixture = inspectFixture(bytes, "image/jpeg");
      const result = await fixture.inspector.inspect(fixture.command);
      expect(result).toMatchObject({
        outcome: "SUCCESS",
        receipt: { width: 37, height: 23, orientation },
      });
      expect(
        fixture.objects.get(`SOURCE/${fixture.command.source.objectKey}`)
          ?.bytes,
      ).toEqual(bytes);
      expect(JSON.stringify(result)).not.toMatch(
        /exif|signature|storage\.example|Buffer/i,
      );
    },
  );

  it("accepts a 20000-pixel edge without imposing role-specific minimum size", async () => {
    const bytes = await sharp({
      create: { width: 20000, height: 1, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const fixture = inspectFixture(bytes);
    expect(await fixture.inspector.inspect(fixture.command)).toMatchObject({
      outcome: "SUCCESS",
      receipt: { width: 20000, height: 1 },
    });
  });

  it("rejects an encoded edge beyond 20000 even below the total pixel limit", async () => {
    const bytes = await sharp({
      create: { width: 20001, height: 1, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const fixture = inspectFixture(bytes);
    expect(await fixture.inspector.inspect(fixture.command)).toEqual(
      expectedFailure("INVALID_IMAGE"),
    );
  });

  it("rejects more than 40M header pixels before full decode or allocation", async () => {
    const bytes = Buffer.from(pixels);
    bytes.writeUInt32BE(20000, 16);
    bytes.writeUInt32BE(2001, 20);
    bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
    const fixture = inspectFixture(bytes);
    expect(await fixture.inspector.inspect(fixture.command)).toEqual(
      expectedFailure("PIXEL_LIMIT_EXCEEDED"),
    );
  });

  it("rejects real animated WebP instead of accepting only its first frame", async () => {
    const frames = Buffer.concat([
      Buffer.alloc(16 * 16 * 3),
      Buffer.alloc(16 * 16 * 3, 255),
    ]);
    const bytes = await sharp(frames, {
      raw: { width: 16, height: 32, channels: 3, pageHeight: 16 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(bytes).metadata()).pages).toBe(2);
    const fixture = inspectFixture(bytes, "image/webp");
    expect(await fixture.inspector.inspect(fixture.command)).toEqual(
      expectedFailure("INVALID_IMAGE"),
    );
  });

  it("rejects PNG animation control chunks even when the codec sees one page", async () => {
    const animation = Buffer.alloc(20);
    animation.writeUInt32BE(8, 0);
    animation.write("acTL", 4);
    animation.writeUInt32BE(2, 8);
    animation.writeUInt32BE(crc32(animation.subarray(4, 16)), 16);
    const bytes = Buffer.concat([
      pixels.subarray(0, 33),
      animation,
      pixels.subarray(33),
    ]);
    const fixture = inspectFixture(bytes);
    expect(await fixture.inspector.inspect(fixture.command)).toEqual(
      expectedFailure("INVALID_IMAGE"),
    );
  });

  it("rejects excessive declared source bytes before any storage call", async () => {
    const fixture = inspectFixture(pixels);
    const inspect = vi.spyOn(fixture.storage, "inspectObject");
    expect(
      await fixture.inspector.inspect({
        ...fixture.command,
        source: {
          ...fixture.command.source,
          byteSize: MEDIA_IMAGE_PROFILE.sourceByteLimit + 1,
        },
      }),
    ).toEqual(expectedFailure("INVALID_COMMAND"));
    expect(inspect).not.toHaveBeenCalled();
  });

  it.each(["width", "assetId", "url"])(
    "rejects browser-injected %s before storage",
    async (field) => {
      const fixture = inspectFixture(pixels);
      const inspect = vi.spyOn(fixture.storage, "inspectObject");
      expect(
        await fixture.inspector.inspect({
          ...fixture.command,
          source: { ...fixture.command.source, [field]: "forged" },
        }),
      ).toEqual(expectedFailure("INVALID_COMMAND"));
      expect(inspect).not.toHaveBeenCalled();
    },
  );

  it.each(["truncated", "extraneous-marker-bytes"])(
    "rejects %s JPEG after metadata can still be decoded",
    async (damage) => {
      const complete = await sharp(pixels).jpeg().toBuffer();
      const segmentEnd = 4 + complete.readUInt16BE(4);
      const bytes =
        damage === "truncated"
          ? complete.subarray(0, complete.length - 2)
          : Buffer.concat([
              complete.subarray(0, segmentEnd),
              Buffer.alloc(4, 1),
              complete.subarray(segmentEnd),
            ]);
      expect(await sharp(bytes, { failOn: "none" }).metadata()).toMatchObject({
        width: 37,
        height: 23,
      });
      const fixture = inspectFixture(bytes, "image/jpeg");
      expect(await fixture.inspector.inspect(fixture.command)).toEqual(
        expectedFailure("INVALID_IMAGE"),
      );
    },
  );

  it("rejects a forged MIME despite matching storage metadata and checksum", async () => {
    const fixture = inspectFixture(pixels, "image/jpeg");
    expect(await fixture.inspector.inspect(fixture.command)).toEqual(
      expectedFailure("MIME_MISMATCH"),
    );
  });

  it("hashes downloaded bytes even if HEAD still matches", async () => {
    const fixture = inspectFixture(pixels);
    const changed = Buffer.from(pixels);
    changed[100] = changed[100]! ^ 255;
    fixture.objects.get(`SOURCE/${fixture.command.source.objectKey}`)!.bytes =
      changed;
    expect(await fixture.inspector.inspect(fixture.command)).toEqual(
      expectedFailure("SOURCE_CHANGED"),
    );
  });

  it("bounds a streaming response that omits Content-Length", async () => {
    const fixture = inspectFixture(pixels);
    fixture.controls.extraDownload = Buffer.from("extra");
    expect(await fixture.inspector.inspect(fixture.command)).toEqual(
      expectedFailure("SOURCE_CHANGED"),
    );
  });

  it("returns a safe not-found result for the fixed missing object", async () => {
    const fixture = inspectFixture(pixels);
    fixture.objects.clear();
    expect(await fixture.inspector.inspect(fixture.command)).toEqual(
      expectedFailure("SOURCE_NOT_FOUND"),
    );
  });

  it("keeps a usable internal download grant when the provider clock advances by 1ms", async () => {
    const fixture = inspectFixture(pixels);
    const createDownloadGrant = fixture.storage.createDownloadGrant;
    fixture.storage.createDownloadGrant = async (command) => {
      const remaining =
        Date.parse(command.expiresAt) - (testNow().getTime() + 1);
      if (remaining < 60_000)
        return {
          schemaVersion: 1,
          operation: "CREATE_DOWNLOAD_GRANT",
          outcome: "FAILURE",
          error: {
            schemaVersion: 1,
            code: "INVALID_COMMAND",
            recovery: "NONE",
          },
        };
      return createDownloadGrant(command);
    };
    expect(await fixture.inspector.inspect(fixture.command)).toMatchObject({
      outcome: "SUCCESS",
      receipt: { width: 37, height: 23 },
    });
  });

  it("bounds hanging private downloads without exposing URLs or native detail", async () => {
    const fixture = inspectFixture(pixels);
    const fetch: typeof globalThis.fetch = async () => new Promise(() => {});
    const inspector = createMediaSourceInspector({
      ...fixture,
      fetch,
      now: testNow,
      requestTimeoutMs: 5,
    });
    expect(await inspector.inspect(fixture.command)).toEqual(
      expectedFailure("PROCESSING_TIMEOUT", true),
    );
  });
});
