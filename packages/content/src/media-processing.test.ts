import { expect, it } from "vitest";
import * as processing from "./media-processing.js";
const command = {
  schemaVersion: 1,
  profileVersion: 1,
  source: {
    assetId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    metadataRevisionId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
    checksumSha256: "a".repeat(64),
    objectKey: "original/a.jpg",
    mimeType: "image/jpeg",
    byteSize: 100,
    width: 3000,
    height: 4000,
  },
  role: "PORTRAIT",
  fit: "COVER",
  focalPoint: { x: 0.5, y: 0.5 },
};
it("binds canonical processing hashes to source, metadata, geometry and profile", () => {
  expect(processing.hashMediaProcessingCommand?.(command)).toMatch(
    /^[0-9a-f]{64}$/,
  );
  expect(
    processing.hashMediaProcessingCommand({
      ...command,
      source: {
        ...command.source,
        assetId: command.source.assetId.toLowerCase(),
        metadataRevisionId: command.source.metadataRevisionId.toLowerCase(),
      },
    }),
  ).toBe(processing.hashMediaProcessingCommand(command));
  expect(
    processing.hashMediaProcessingCommand({ ...command, fit: "CONTAIN" }),
  ).not.toBe(processing.hashMediaProcessingCommand(command));
  expect(
    processing.hashMediaProcessingCommand({
      ...command,
      source: { ...command.source, checksumSha256: "b".repeat(64) },
    }),
  ).not.toBe(processing.hashMediaProcessingCommand(command));
});
it("content addresses immutable outputs without exposing source object keys", () => {
  expect(processing.mediaProcessingObjectKey?.("a".repeat(64), "PNG")).toBe(
    `processed/v1/${"a".repeat(64)}.png`,
  );
});

it("scopes identical derivative bytes to their master without changing master deduplication", () => {
  const checksum = "a".repeat(64);
  const masterChecksum = "b".repeat(64);
  expect(
    processing.mediaProcessingObjectKey(checksum, "WEBP", masterChecksum),
  ).toBe(`processed/v1/${masterChecksum}/${checksum}.webp`);
  expect(
    processing.mediaProcessingObjectKey(checksum, "WEBP", "c".repeat(64)),
  ).not.toBe(
    processing.mediaProcessingObjectKey(checksum, "WEBP", masterChecksum),
  );
  expect(() => processing.mediaProcessingObjectKey(checksum, "WEBP")).toThrow();
  expect(() =>
    processing.mediaProcessingObjectKey(checksum, "WEBP", "invalid"),
  ).toThrow();
});

it("accepts only complete receipts bound to measured orientation, the original recipe and immutable object keys", async () => {
  const { planMediaFraming } = await import("./media-framing.js");
  const { mediaImageProcessingCommandSchema, MEDIA_IMAGE_PROFILE } =
    await import("@fan-support/contracts");
  const parsed = mediaImageProcessingCommandSchema.parse(command);
  const framed = planMediaFraming({
    schemaVersion: 1,
    assetId: parsed.source.assetId,
    metadataRevisionId: parsed.source.metadataRevisionId,
    sourceChecksum: parsed.source.checksumSha256,
    sourceWidth: 3000,
    sourceHeight: 4000,
    role: parsed.role,
    fit: parsed.fit,
    focalPoint: parsed.focalPoint,
  });
  if (framed.outcome !== "SUCCESS") throw new Error("valid fixture must frame");
  const receipt = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    profileVersion: 1,
    orientation: 1,
    commandHash: processing.hashMediaProcessingCommand(parsed),
    plan: framed.plan,
    metadataPolicy: "STRIP_ALL_SRGB",
    master: {
      mimeType: "image/png",
      width: 1600,
      height: 2000,
      byteSize: 8000,
      checksumSha256: "b".repeat(64),
      objectKey: processing.mediaProcessingObjectKey("b".repeat(64), "PNG"),
    },
    variants: MEDIA_IMAGE_PROFILE.formats.flatMap((format, index) =>
      [320, 640, 960, 1600].map((width, sizeIndex) => {
        const checksum = (index * 4 + sizeIndex + 1)
          .toString(16)
          .padStart(64, "0");
        return {
          format,
          width,
          height: (width * 5) / 4,
          byteSize: 1000,
          checksumSha256: checksum,
          objectKey: processing.mediaProcessingObjectKey(
            checksum,
            format,
            "b".repeat(64),
          ),
        };
      }),
    ),
  };
  expect(processing.validateMediaProcessingReceipt(parsed, receipt)).toBe(true);
  for (const invalid of [
    {
      ...receipt,
      variants: receipt.variants.map((v, i) =>
        i === 0
          ? {
              ...v,
              objectKey: processing.mediaProcessingObjectKey(
                v.checksumSha256,
                v.format,
                "c".repeat(64),
              ),
            }
          : v,
      ),
    },
    { ...receipt, orientation: 6 },
    { ...receipt, commandHash: "0".repeat(64) },
    {
      ...receipt,
      master: { ...receipt.master, objectKey: "foreign/master.png" },
    },
    { ...receipt, variants: receipt.variants.slice(1) },
    {
      ...receipt,
      variants: [receipt.variants[0], ...receipt.variants.slice(0, -1)],
    },
    {
      ...receipt,
      plan: {
        ...receipt.plan,
        request: { ...receipt.plan.request, focalPoint: { x: 0.1, y: 0.5 } },
      },
    },
    {
      ...receipt,
      variants: receipt.variants.map((v, i) =>
        i === 0 ? { ...v, height: 99 } : v,
      ),
    },
  ])
    expect(processing.validateMediaProcessingReceipt(parsed, invalid)).toBe(
      false,
    );
});
