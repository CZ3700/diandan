import { resolveStorefrontPreviewConfig } from "@fan-support/config/server";

/**
 * The admin origin allowed to frame preview pages, or null. The proxy reads it, so
 * like the proxy's other server modules this one stays free of `server-only`.
 * Invalid configuration cannot broaden embedding.
 */
export function previewEmbeddingOrigin(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  try {
    return resolveStorefrontPreviewConfig({ environment }).adminOrigin;
  } catch {
    return null;
  }
}
