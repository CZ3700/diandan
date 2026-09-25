import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  mediaImageProcessingResultSchema,
  type MediaImageProcessingCommand,
} from "@fan-support/contracts";
import { validateMediaProcessingReceipt } from "@fan-support/content";
import { createMediaImageProcessor } from "./index.js";
import {
  commandFor,
  hash,
  memoryStorage,
  testNow,
} from "./test-support/storage.js";

let source: Buffer;
beforeAll(async () => {
  source = await sharp({
    create: {
      width: 1200,
      height: 1200,
      channels: 4,
      background: { r: 200, g: 100, b: 50, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
});

describe("real image processing and immutable storage", () => {
  it.each(["truncated", "extraneous-marker-bytes"])(
    "rejects %s JPEG even when a tolerant decoder can reconstruct its pixels",
    async (damage) => {
      const complete = await sharp(source).jpeg().toBuffer();
      const firstSegmentEnd = 4 + complete.readUInt16BE(4);
      const bytes =
        damage === "truncated"
          ? complete.subarray(0, complete.length - 2)
          : Buffer.concat([
              complete.subarray(0, firstSegmentEnd),
              Buffer.alloc(4, 1),
              complete.subarray(firstSegmentEnd),
            ]);
      await expect(
        sharp(bytes, { failOn: "none" }).raw().toBuffer(),
      ).resolves.toBeInstanceOf(Buffer);
      const command = commandFor(bytes, { mimeType: "image/jpeg" });
      const fixture = memoryStorage(bytes, command);
      expect(
        await createMediaImageProcessor({ ...fixture, now: testNow }).process(
          command,
        ),
      ).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        error: { code: "INVALID_IMAGE", retryable: false },
      });
      expect(fixture.uploads).toHaveLength(0);
    },
  );
  it("scopes identical small derivative bytes to each distinct role master", async () => {
    const bytes = await sharp({
      create: { width: 1600, height: 2000, channels: 3, background: "#203050" },
    })
      .png()
      .toBuffer();
    const command = commandFor(bytes, { width: 1600, height: 2000 });
    command.role = "PORTRAIT";
    const fixture = memoryStorage(bytes, command);
    const processor = createMediaImageProcessor({ ...fixture, now: testNow });
    const portrait = await processor.process(command);
    const mobile = await processor.process({ ...command, role: "HERO_MOBILE" });
    expect(portrait.outcome).toBe("SUCCESS");
    expect(mobile.outcome).toBe("SUCCESS");
    if (portrait.outcome !== "SUCCESS" || mobile.outcome !== "SUCCESS") return;
    expect(portrait.master.checksumSha256).not.toBe(
      mobile.master.checksumSha256,
    );
    for (const format of ["AVIF", "WEBP", "JPEG"] as const) {
      const left = portrait.variants.find(
        (variant) => variant.width === 320 && variant.format === format,
      )!;
      const right = mobile.variants.find(
        (variant) => variant.width === 320 && variant.format === format,
      )!;
      expect(left.checksumSha256).toBe(right.checksumSha256);
      expect(left.objectKey).not.toBe(right.objectKey);
      expect(left.objectKey).toContain(`/${portrait.master.checksumSha256}/`);
      expect(right.objectKey).toContain(`/${mobile.master.checksumSha256}/`);
    }
  }, 30_000);
  it.each([
    ["PORTRAIT", 1600, 2000],
    ["HERO_DESKTOP", 2400, 1350],
    ["HERO_MOBILE", 1080, 1350],
  ] as const)(
    "keeps all four sizes in each format at the exact %s aspect ratio",
    async (role, width, height) => {
      const bytes = await sharp({
        create: { width, height, channels: 3, background: "#203050" },
      })
        .png()
        .toBuffer();
      const command = commandFor(bytes, { width, height });
      command.role = role;
      const fixture = memoryStorage(bytes, command);
      const result = await createMediaImageProcessor({
        ...fixture,
        now: testNow,
      }).process(command);
      expect(result.outcome).toBe("SUCCESS");
      if (result.outcome !== "SUCCESS") return;
      expect(validateMediaProcessingReceipt(command, result)).toBe(true);
      expect([result.master.width, result.master.height]).toEqual([
        width,
        height,
      ]);
      for (const variant of result.variants) {
        expect(variant.height * width).toBe(variant.width * height);
        const metadata = await sharp(
          fixture.objects.get(`DERIVATIVE/${variant.objectKey}`)!.bytes,
        ).metadata();
        expect([metadata.width, metadata.height]).toEqual([
          variant.width,
          variant.height,
        ]);
      }
    },
    30_000,
  );

  it("detects changed source bytes even when object HEAD metadata still matches", async () => {
    const command = commandFor(source);
    const fixture = memoryStorage(source, command);
    const changed = Buffer.from(source);
    changed[100] = changed[100]! ^ 255;
    fixture.objects.get(`SOURCE/${command.source.objectKey}`)!.bytes = changed;
    expect(
      await createMediaImageProcessor({ ...fixture, now: testNow }).process(
        command,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "SOURCE_CHANGED", retryable: false },
    });
  });

  it("returns source-not-found when the registered object has been removed", async () => {
    const command = commandFor(source);
    const fixture = memoryStorage(source, command);
    fixture.objects.clear();
    expect(
      await createMediaImageProcessor({ ...fixture, now: testNow }).process(
        command,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "SOURCE_NOT_FOUND", retryable: false },
    });
  });

  it("rejects a signed download whose content header disagrees with the registered MIME", async () => {
    const command = commandFor(source);
    const fixture = memoryStorage(source, command);
    fixture.controls.downloadMime = "text/html";
    expect(
      await createMediaImageProcessor({ ...fixture, now: testNow }).process(
        command,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "MIME_MISMATCH", retryable: false },
    });
  });
  it("creates a private qualified PNG and all 12 checked responsive images with metadata-only receipt", async () => {
    const command = commandFor(source);
    const fixture = memoryStorage(source, command);
    const result = await createMediaImageProcessor({
      ...fixture,
      now: testNow,
    }).process(command);
    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") return;
    expect(validateMediaProcessingReceipt(command, result)).toBe(true);
    expect(fixture.objects.size).toBe(14);
    expect(fixture.objects.has(`SOURCE/${result.master.objectKey}`)).toBe(true);
    expect(result.variants).toHaveLength(12);
    for (const artifact of [result.master, ...result.variants]) {
      const key =
        artifact === result.master
          ? `SOURCE/${artifact.objectKey}`
          : `DERIVATIVE/${artifact.objectKey}`;
      const object = fixture.objects.get(key)!;
      expect(hash(object.bytes)).toBe(artifact.checksumSha256);
      expect(object.bytes.length).toBe(artifact.byteSize);
      const metadata = await sharp(object.bytes).metadata();
      expect([metadata.width, metadata.height]).toEqual([
        artifact.width,
        artifact.height,
      ]);
      expect(metadata.hasAlpha).toBe(false);
      expect(metadata.space).toBe("srgb");
      for (const field of [
        "exif",
        "icc",
        "iptc",
        "xmp",
        "orientation",
      ] as const)
        expect(metadata[field]).toBeUndefined();
    }
    expect(
      mediaImageProcessingResultSchema.parse(
        JSON.parse(JSON.stringify(result)),
      ),
    ).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(
      /signature|storage\.example|Buffer/,
    );
  }, 30000);

  it("resumes after a transient partial upload, only reusing exact immutable objects", async () => {
    const command = commandFor(source);
    const fixture = memoryStorage(source, command);
    fixture.controls.failPut = 3;
    const processor = createMediaImageProcessor({ ...fixture, now: testNow });
    expect(await processor.process(command)).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "STORAGE_UNAVAILABLE", retryable: true },
    });
    fixture.controls.failPut = 0;
    const result = await processor.process(command);
    expect(result.outcome).toBe("SUCCESS");
    expect(fixture.objects.size).toBe(14);
  }, 30000);

  it.each(["conflict", "corruptHead"] as const)(
    "rejects %s without returning a successful receipt",
    async (control) => {
      const command = commandFor(source);
      const fixture = memoryStorage(source, command);
      fixture.controls[control] = true;
      const result = await createMediaImageProcessor({
        ...fixture,
        now: testNow,
      }).process(command);
      expect(result).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        error: { code: "OBJECT_CONFLICT", retryable: false },
      });
    },
  );

  it.each([
    ["MIME_MISMATCH", { mimeType: "image/jpeg" }],
    ["DIMENSION_MISMATCH", { width: 1199 }],
  ] as const)("rejects actual source %s", async (code, override) => {
    const command = commandFor(source, override);
    const fixture = memoryStorage(source, command);
    expect(
      await createMediaImageProcessor({ ...fixture, now: testNow }).process(
        command,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code, retryable: false },
    });
    expect(fixture.uploads).toHaveLength(0);
  });

  it("rejects low resolution without enlargement", async () => {
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const command = commandFor(bytes, { width: 20, height: 20 });
    const fixture = memoryStorage(bytes, command);
    expect(
      await createMediaImageProcessor({ ...fixture, now: testNow }).process(
        command,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "SOURCE_TOO_SMALL", retryable: false },
    });
  });

  it("rejects corrupt images and does not leak decoder exception detail", async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0]);
    const command = commandFor(bytes);
    const fixture = memoryStorage(bytes, command);
    expect(
      await createMediaImageProcessor({ ...fixture, now: testNow }).process(
        command,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "INVALID_IMAGE", retryable: false },
    });
  });

  it("bounds the actual streamed source bytes even when Content-Length is omitted", async () => {
    const command = commandFor(source);
    const fixture = memoryStorage(source, command);
    fixture.controls.extraDownload = Buffer.from("extra");
    expect(
      await createMediaImageProcessor({ ...fixture, now: testNow }).process(
        command,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "SOURCE_CHANGED", retryable: false },
    });
  });

  it("rejects a forged command before any storage call", async () => {
    const fixture = memoryStorage(source, commandFor(source));
    expect(
      await createMediaImageProcessor({ ...fixture, now: testNow }).process(
        {} as MediaImageProcessingCommand,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "INVALID_COMMAND", retryable: false },
    });
  });

  it("bounds hanging downloads and removes private signed URLs from timeout errors", async () => {
    const command = commandFor(source);
    const fixture = memoryStorage(source, command);
    const fetch: typeof globalThis.fetch = async () => new Promise(() => {});
    expect(
      await createMediaImageProcessor({
        storage: fixture.storage,
        fetch,
        now: testNow,
        requestTimeoutMs: 10,
      }).process(command),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "PROCESSING_TIMEOUT", retryable: true },
    });
  });
});
