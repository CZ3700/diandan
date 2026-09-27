import {
  dailyManagementRecommendedSourceSize,
  type DailyManagementImageKind,
} from "@fan-support/contracts";
import type { ManagementCopy } from "./copy";

type Size = Readonly<{ width: number; height: number }>;

const tips = {
  SAVE_ARTIST: "imageTipArtist",
  SAVE_GIFT: "imageTipGift",
  REPLACE_POSTER: "imageTipPoster",
} as const satisfies Record<DailyManagementImageKind, keyof ManagementCopy>;

function withSize(template: string, size: Size): string {
  return template
    .replace("{width}", String(size.width))
    .replace("{height}", String(size.height));
}

/** Format, best size and composition tip for one kind of daily image. */
export function imageSizeHint(
  copy: ManagementCopy,
  kind: DailyManagementImageKind,
): string {
  return [
    copy.imageHint,
    withSize(copy.imageBestSize, dailyManagementRecommendedSourceSize(kind)),
    copy[tips[kind]],
  ].join(" ");
}

/** A non-blocking note when either side is below the size that avoids enlargement. */
export function smallImageWarning(
  copy: ManagementCopy,
  kind: DailyManagementImageKind,
  size: Size | null,
): string | null {
  if (!size) return null;
  const recommended = dailyManagementRecommendedSourceSize(kind);
  return size.width < recommended.width || size.height < recommended.height
    ? withSize(copy.imageTooSmall, size)
    : null;
}

/** Decoded pixel size of a chosen file, or null where the browser cannot decode it here. */
export async function measureImage(file: Blob): Promise<Size | null> {
  if (typeof globalThis.createImageBitmap !== "function") return null;
  try {
    const bitmap = await globalThis.createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}
