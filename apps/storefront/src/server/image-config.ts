import { isIP } from "node:net";

import type { NextConfig } from "next";

type ImageConfig = NonNullable<NextConfig["images"]>;
type Environment = Readonly<Record<string, string | undefined>>;

function imageOrigin(value: string, allowLocal: boolean): URL {
  const invalid = () => new Error("Invalid storefront image origin");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  const hostname = url.hostname;
  const ip = isIP(hostname.replace(/^\[|\]$/gu, ""));
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const dnsHostname =
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(
      hostname,
    );
  if (
    url.origin !== value ||
    url.protocol !== "https:" ||
    (!dnsHostname && ip === 0) ||
    ((ip !== 0 || loopback || hostname.endsWith(".localhost")) &&
      !(allowLocal && loopback))
  )
    throw invalid();
  return url;
}

/** Build-time, non-secret input. Missing configuration grants no image access. */
export function createStorefrontImageConfig(env: Environment): ImageConfig {
  const tier = env["FAN_SUPPORT_DEPLOYMENT_ENV"];
  if (
    tier !== undefined &&
    !["development", "test", "preview", "staging", "production"].includes(tier)
  ) {
    throw new Error("Invalid storefront image deployment environment");
  }
  const allowLocal = tier === "development" || tier === "test";
  const value = env["FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN"];
  const origin =
    value === undefined ? undefined : imageOrigin(value, allowLocal);
  return {
    localPatterns: [],
    remotePatterns:
      origin === undefined
        ? []
        : ["avif", "webp", "jpg"].map((extension) => ({
            protocol: "https" as const,
            hostname: origin.hostname,
            port: origin.port,
            // The worker writes published variants beneath the master checksum.
            // Source uploads and the intermediate PNG master are never allowed here.
            pathname: `/processed/v1/*/*.${extension}`,
            search: "",
          })),
    maximumRedirects: 0,
    minimumCacheTTL: 60,
    dangerouslyAllowLocalIP: allowLocal,
    dangerouslyAllowSVG: false,
    qualities: [75],
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1600, 1920, 2400],
    imageSizes: [32, 64, 96, 128, 256, 384],
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'none'; script-src 'none'; sandbox;",
  };
}
