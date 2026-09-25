import { createHash } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import {
  MEDIA_IMAGE_PROFILE,
  sourceHashSchema,
  mediaObjectKeySchema,
  type MediaImageProcessingCommand,
  type MediaImageProcessingSuccess,
} from "@fan-support/contracts";
import {
  mediaProcessingObjectKey,
  planMediaFraming,
} from "@fan-support/content";
import { type ProcessingBudget, ProcessingFailure } from "./failure.js";

type Format = "PNG" | "AVIF" | "WEBP" | "JPEG";
export interface ImageArtifact {
  bytes: Buffer;
  descriptor: MediaImageProcessingSuccess["master"];
}
export interface ImageMaster extends ImageArtifact {
  orientation: number;
  plan: MediaImageProcessingSuccess["plan"];
}
interface SourceImageMetadata {
  width: number;
  height: number;
  orientation: number;
}

function matchesHeader(
  bytes: Buffer,
  mime: MediaImageProcessingCommand["source"]["mimeType"],
): boolean {
  if (mime === "image/jpeg")
    return (
      bytes.length >= 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    );
  if (mime === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp")
    return false;
  const end = bytes.readUInt32BE(0);
  if (end < 16 || end > bytes.length || end > 4096 || end % 4 !== 0)
    return false;
  const brands = [bytes.toString("ascii", 8, 12)];
  for (let offset = 16; offset < end; offset += 4)
    brands.push(bytes.toString("ascii", offset, offset + 4));
  return brands.includes("avif") || brands.includes("avis");
}

function isAnimatedPng(bytes: Buffer): boolean {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12)
      throw new ProcessingFailure("INVALID_IMAGE");
    if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL") return true;
    offset += length + 12;
  }
  return false;
}

async function codec<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProcessingFailure) throw error;
    // Native detail stays inside this adapter. Only its stable timeout category escapes.
    throw new ProcessingFailure(
      error instanceof Error && /timeout|timed out/i.test(error.message)
        ? "PROCESSING_TIMEOUT"
        : "INVALID_IMAGE",
    );
  }
}

function outputDescriptor(
  bytes: Buffer,
  width: number,
  height: number,
  format: Format,
  masterChecksum?: string,
) {
  if (bytes.length === 0 || bytes.length > MEDIA_IMAGE_PROFILE.outputByteLimit)
    throw new ProcessingFailure("OUTPUT_LIMIT_EXCEEDED");
  const checksumSha256 = sourceHashSchema.parse(
    createHash("sha256").update(bytes).digest("hex"),
  );
  return {
    objectKey: mediaObjectKeySchema.parse(
      mediaProcessingObjectKey(checksumSha256, format, masterChecksum),
    ),
    checksumSha256,
    byteSize: bytes.length,
    width,
    height,
  };
}

function inputPipeline(bytes: Buffer, budget: ProcessingBudget): Sharp {
  return sharp(bytes, {
    failOn: "warning",
    limitInputPixels: MEDIA_IMAGE_PROFILE.sourcePixelLimit,
    sequentialRead: true,
  }).timeout({ seconds: budget.codecSeconds() });
}

/** Header inspection is only a bound and format check; callers must also decode all pixels. */
export async function readSourceImageMetadata(
  bytes: Buffer,
  mimeType: MediaImageProcessingCommand["source"]["mimeType"],
  budget: ProcessingBudget,
): Promise<SourceImageMetadata> {
  if (!matchesHeader(bytes, mimeType))
    throw new ProcessingFailure("MIME_MISMATCH");
  if (mimeType === "image/png" && isAnimatedPng(bytes))
    throw new ProcessingFailure("INVALID_IMAGE");
  // metadata() reads headers only; pixel allocation is limited on every actual decode below.
  const metadata = await codec(() =>
    sharp(bytes, { failOn: "warning", limitInputPixels: false })
      .timeout({ seconds: budget.codecSeconds() })
      .metadata(),
  );
  if (metadata.width * metadata.height > MEDIA_IMAGE_PROFILE.sourcePixelLimit)
    throw new ProcessingFailure("PIXEL_LIMIT_EXCEEDED");
  if (
    !Number.isInteger(metadata.width) ||
    !Number.isInteger(metadata.height) ||
    metadata.width < 1 ||
    metadata.width > 20_000 ||
    metadata.height < 1 ||
    metadata.height > 20_000
  )
    throw new ProcessingFailure("INVALID_IMAGE");
  if ((metadata.pages ?? 1) !== 1 || (metadata.delay?.length ?? 0) > 1)
    throw new ProcessingFailure("INVALID_IMAGE");
  const actualMime =
    metadata.format === "heif" && metadata.compression === "av1"
      ? "image/avif"
      : `image/${metadata.format}`;
  if (actualMime !== mimeType) throw new ProcessingFailure("MIME_MISMATCH");
  const orientation = metadata.orientation ?? 1;
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8)
    throw new ProcessingFailure("INVALID_IMAGE");
  return { width: metadata.width, height: metadata.height, orientation };
}

/** Force complete, warning-free decoding; metadata-only probes cannot verify image integrity. */
export async function decodeSourcePixels(
  bytes: Buffer,
  metadata: SourceImageMetadata,
  budget: ProcessingBudget,
) {
  const decoded = await codec(() =>
    inputPipeline(bytes, budget)
      .autoOrient()
      .toColourspace("srgb")
      .flatten({ background: MEDIA_IMAGE_PROFILE.neutral })
      .raw()
      .toBuffer({ resolveWithObject: true }),
  );
  const swapped = metadata.orientation >= 5;
  if (
    decoded.info.width !== (swapped ? metadata.height : metadata.width) ||
    decoded.info.height !== (swapped ? metadata.width : metadata.height) ||
    decoded.info.channels !== 3
  )
    throw new ProcessingFailure("INVALID_IMAGE");
  return decoded;
}

/** Decode into metadata-free sRGB pixels before applying the pure framing geometry. */
export async function createImageMaster(
  bytes: Buffer,
  command: MediaImageProcessingCommand,
  budget: ProcessingBudget,
): Promise<ImageMaster> {
  const metadata = await readSourceImageMetadata(
    bytes,
    command.source.mimeType,
    budget,
  );
  if (
    metadata.width !== command.source.width ||
    metadata.height !== command.source.height
  )
    throw new ProcessingFailure("DIMENSION_MISMATCH");
  const { orientation } = metadata;
  const swapped = orientation >= 5;
  const framing = planMediaFraming({
    schemaVersion: 1,
    assetId: command.source.assetId,
    metadataRevisionId: command.source.metadataRevisionId,
    sourceChecksum: command.source.checksumSha256,
    sourceWidth: swapped ? metadata.height : metadata.width,
    sourceHeight: swapped ? metadata.width : metadata.height,
    role: command.role,
    fit: command.fit,
    focalPoint: command.focalPoint,
  });
  if (framing.outcome !== "SUCCESS")
    throw new ProcessingFailure(
      framing.error.code === "SOURCE_TOO_SMALL"
        ? "SOURCE_TOO_SMALL"
        : "INVALID_COMMAND",
    );
  const decoded = await decodeSourcePixels(bytes, metadata, budget);
  const { plan } = framing;
  const { sourceCrop: crop, destination: destination, target } = plan;
  const masterBytes = await codec(() =>
    sharp(decoded.data, {
      raw: {
        width: decoded.info.width,
        height: decoded.info.height,
        channels: 3,
      },
      limitInputPixels: MEDIA_IMAGE_PROFILE.sourcePixelLimit,
    })
      .timeout({ seconds: budget.codecSeconds() })
      .extract({
        left: crop.x,
        top: crop.y,
        width: crop.width,
        height: crop.height,
      })
      .resize(destination.width, destination.height, {
        fit: "fill",
        withoutEnlargement: true,
      })
      .extend({
        left: destination.x,
        top: destination.y,
        right: target.width - destination.x - destination.width,
        bottom: target.height - destination.y - destination.height,
        background: MEDIA_IMAGE_PROFILE.neutral,
      })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
  return {
    bytes: masterBytes,
    orientation,
    plan,
    descriptor: {
      ...outputDescriptor(masterBytes, target.width, target.height, "PNG"),
      mimeType: "image/png",
    },
  };
}

export async function createImageVariant(
  master: ImageMaster,
  format: "AVIF" | "WEBP" | "JPEG",
  width: number,
  budget: ProcessingBudget,
) {
  const height = (width * master.descriptor.height) / master.descriptor.width;
  if (!Number.isInteger(height)) throw new ProcessingFailure("INVALID_COMMAND");
  const pipeline = inputPipeline(master.bytes, budget).resize(width, height, {
    fit: "fill",
    withoutEnlargement: true,
  });
  let encoded: Sharp;
  switch (format) {
    case "AVIF":
      encoded = pipeline.avif({
        quality: 60,
        effort: 2,
        chromaSubsampling: "4:4:4",
      });
      break;
    case "WEBP":
      encoded = pipeline.webp({ quality: 82, effort: 4 });
      break;
    case "JPEG":
      encoded = pipeline.jpeg({ quality: 85, chromaSubsampling: "4:4:4" });
      break;
  }
  const bytes = await codec(() => encoded.toBuffer());
  return {
    bytes,
    descriptor: {
      ...outputDescriptor(
        bytes,
        width,
        height,
        format,
        master.descriptor.checksumSha256,
      ),
      format,
    },
  };
}
