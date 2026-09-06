import sharp from "sharp";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createImageMaster } from "./image-pipeline.js";
import { ProcessingBudget } from "./failure.js";
import { commandFor } from "./test-support/storage.js";

const budget = () => new ProcessingBudget(15_000, 30);
async function quadrants() {
  return sharp(
    Buffer.from(
      '<svg width="1600" height="1200"><path fill="red" d="M0 0h800v600H0z"/><path fill="lime" d="M800 0h800v600H800z"/><path fill="blue" d="M0 600h800v600H0z"/><path fill="yellow" d="M800 600h800v600H800z"/></svg>',
    ),
  )
    .png()
    .toBuffer();
}
async function pixel(bytes: Buffer, left: number, top: number) {
  return [
    ...(await sharp(bytes)
      .extract({ left, top, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
}
const colors = {
  R: [255, 0, 0],
  G: [0, 255, 0],
  B: [0, 0, 255],
  Y: [255, 255, 0],
};

describe("real decoded framing", () => {
  it("rejects a decompression bomb from header dimensions before allocating decoded pixels", async () => {
    const bytes = Buffer.from(await quadrants());
    bytes.writeUInt32BE(20_000, 16);
    bytes.writeUInt32BE(2001, 20);
    bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
    const command = commandFor(bytes, { width: 20_000, height: 2001 });
    await expect(
      createImageMaster(bytes, command, budget()),
    ).rejects.toMatchObject({ code: "PIXEL_LIMIT_EXCEEDED" });
  });
  it.each([
    [1, ["R", "G", "B", "Y"]],
    [2, ["G", "R", "Y", "B"]],
    [3, ["Y", "B", "G", "R"]],
    [4, ["B", "Y", "R", "G"]],
    [5, ["R", "B", "G", "Y"]],
    [6, ["B", "R", "Y", "G"]],
    [7, ["Y", "G", "B", "R"]],
    [8, ["G", "Y", "R", "B"]],
  ] as const)(
    "corrects EXIF orientation %i before framing, including mirrored variants",
    async (orientation, expected) => {
      const bytes = await sharp(await quadrants())
        .withMetadata({ orientation })
        .png()
        .toBuffer();
      const command = commandFor(bytes, { width: 1600, height: 1200 });
      const master = await createImageMaster(bytes, command, budget());
      expect(master.orientation).toBe(orientation);
      expect([
        master.plan.request.sourceWidth,
        master.plan.request.sourceHeight,
      ]).toEqual(orientation >= 5 ? [1200, 1600] : [1600, 1200]);
      const points = [
        [10, 10],
        [1190, 10],
        [10, 1190],
        [1190, 1190],
      ] as const;
      for (const [index, [x, y]] of points.entries())
        expect(await pixel(master.bytes, x, y)).toEqual(
          colors[expected[index]!],
        );
      const metadata = await sharp(master.bytes).metadata();
      expect(metadata.orientation).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    },
  );

  it.each([0, 1])(
    "keeps an edge focal point %i inside the maximal exact-aspect crop",
    async (x) => {
      const bytes = await quadrants();
      const command = commandFor(bytes, { width: 1600, height: 1200 });
      command.focalPoint = { x, y: 0.5 };
      const master = await createImageMaster(bytes, command, budget());
      expect(master.plan.sourceCrop).toEqual({
        x: x * 400,
        y: 0,
        width: 1200,
        height: 1200,
      });
      expect(await pixel(master.bytes, x === 0 ? 790 : 410, 100)).toEqual(
        x === 0 ? colors.R : colors.G,
      );
    },
  );

  it("contains a panorama without clipping and fills the centered canvas with the neutral surface", async () => {
    const bytes = await sharp({
      create: { width: 2400, height: 600, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const command = commandFor(bytes, { width: 2400, height: 600 });
    command.fit = "CONTAIN";
    const master = await createImageMaster(bytes, command, budget());
    expect(master.plan.destination).toEqual({
      x: 0,
      y: 450,
      width: 1200,
      height: 300,
    });
    expect(await pixel(master.bytes, 600, 449)).toEqual([18, 18, 22]);
    expect(await pixel(master.bytes, 600, 450)).toEqual(colors.R);
    expect(await pixel(master.bytes, 600, 750)).toEqual([18, 18, 22]);
  });

  it("flattens fully transparent pixels consistently before all output encoders", async () => {
    const bytes = await sharp({
      create: {
        width: 1200,
        height: 1200,
        channels: 4,
        background: { r: 255, g: 0, b: 255, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const master = await createImageMaster(bytes, commandFor(bytes), budget());
    expect(await pixel(master.bytes, 500, 500)).toEqual([18, 18, 22]);
    expect((await sharp(master.bytes).metadata()).hasAlpha).toBe(false);
  });

  it("strips the real EXIF including GPS, XMP and embedded ICC profile", async () => {
    const bytes = await sharp(await quadrants())
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD0: { Artist: "Fictional private artist" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "1/1 2/1 3/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "4/1 5/1 6/1",
        },
      })
      .withXmp(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">Fictional private GPS fixture</x:xmpmeta>',
      )
      .jpeg()
      .toBuffer();
    const original = await sharp(bytes).metadata();
    expect(original.exif?.length).toBeGreaterThan(0);
    expect(original.icc?.length).toBeGreaterThan(0);
    expect(original.xmp?.length).toBeGreaterThan(0);
    const command = commandFor(bytes, {
      width: 1600,
      height: 1200,
      mimeType: "image/jpeg",
    });
    const master = await createImageMaster(bytes, command, budget());
    const metadata = await sharp(master.bytes).metadata();
    for (const field of ["exif", "icc", "xmp", "iptc", "orientation"] as const)
      expect(metadata[field]).toBeUndefined();
    expect(master.bytes.includes(Buffer.from("Fictional private"))).toBe(false);
  });

  it("rejects a genuine animated WebP before taking only its first frame", async () => {
    const pixels = Buffer.concat([
      Buffer.alloc(16 * 16 * 3, 0),
      Buffer.alloc(16 * 16 * 3, 255),
    ]);
    const bytes = await sharp(pixels, {
      raw: { width: 16, height: 32, channels: 3, pageHeight: 16 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(bytes).metadata()).pages).toBe(2);
    const command = commandFor(bytes, {
      width: 16,
      height: 16,
      mimeType: "image/webp",
    });
    await expect(
      createImageMaster(bytes, command, budget()),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it.each(["WEBP", "AVIF"] as const)(
    "decodes actual %s input using its file header and codec",
    async (format) => {
      const input = sharp(await quadrants());
      const bytes = await (
        format === "WEBP" ? input.webp() : input.avif({ effort: 0 })
      ).toBuffer();
      const command = commandFor(bytes, {
        width: 1600,
        height: 1200,
        mimeType: format === "WEBP" ? "image/webp" : "image/avif",
      });
      const master = await createImageMaster(bytes, command, budget());
      expect([master.descriptor.width, master.descriptor.height]).toEqual([
        1200, 1200,
      ]);
    },
  );
});
