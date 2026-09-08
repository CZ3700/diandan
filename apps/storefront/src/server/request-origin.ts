/**
 * Next may construct Request.url using its internal listener behind a proxy.
 * That deployment must keep the listener private and overwrite all three headers
 * with the configured public host/protocol, never append client-supplied values.
 * This checks the fixed public entry point only: callers still enforce Origin,
 * Fetch Metadata, Cookie, CSRF and route authorization. Forwarded grants nothing.
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
