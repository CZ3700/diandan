import "server-only";

/**
 * A private Next listener may receive an internal Request.url behind HTTPS.
 * The trusted proxy must overwrite all three headers, never append client values.
 * This only checks the configured entry point; Origin, Fetch Metadata, cookies,
 * CSRF and API authorization remain the caller's independent responsibility.
 */
export function matchesConfiguredRequestOrigin(
  request: Request,
  siteOrigin: string,
): boolean {
  try {
    const configured = new URL(siteOrigin);
    const incoming = new URL(request.url);
    if (
      configured.origin !== siteOrigin ||
      !["http:", "https:"].includes(configured.protocol) ||
      !["http:", "https:"].includes(incoming.protocol)
    )
      return false;
    if (incoming.origin === siteOrigin) return true;
    return (
      request.headers.get("host") === configured.host &&
      request.headers.get("x-forwarded-host") === configured.host &&
      request.headers.get("x-forwarded-proto") ===
        configured.protocol.slice(0, -1)
    );
  } catch {
    return false;
  }
}
