import { MEDIA_IMAGE_PROFILE } from "@fan-support/contracts";
import { AdminClientError } from "../workspace/client";
import type { OriginalImage } from "./api";
/** The signed original is consumed only into component memory, never persisted or logged. */
export async function downloadOriginal(
  image: OriginalImage,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<Blob> {
  if (Date.parse(image.download.expiresAt) <= Date.now())
    throw new AdminClientError("NETWORK_ERROR");
  const response = await transport(image.download.url, {
    method: image.download.method,
    headers: image.download.headers,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  if (!response.ok) throw new AdminClientError("NETWORK_ERROR");
  const blob = await response.blob();
  if (
    blob.size === 0 ||
    blob.size > MEDIA_IMAGE_PROFILE.sourceByteLimit ||
    !["image/jpeg", "image/png", "image/webp"].includes(blob.type)
  )
    throw new AdminClientError("INVALID_RESPONSE");
  return blob;
}
