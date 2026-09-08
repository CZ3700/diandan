import "server-only";

/** The two applications have separate origins; an absent setting produces no guessed link. */
export function getManagementStorefrontOrigin(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const configured = environment["FAN_SUPPORT_STOREFRONT_ORIGIN"];
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    const localTest =
      environment["FAN_SUPPORT_ADMIN_MODE"] === "TEST" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" && !localTest)
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}
