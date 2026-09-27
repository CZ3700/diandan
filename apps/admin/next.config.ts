import path from "node:path";

import type { NextConfig } from "next";

// Remote TEST edge only (docs/runbooks/remote-test-environment.md): the development server
// sits behind an edge that forwards the validated public Host, so request URLs use that Host
// and its dev resources accept that origin. Never set for builds or production.
const remoteTestEdge =
  process.env.NODE_ENV === "development" &&
  process.env["LOCAL_EXPERIENCE_TRUST_HOST_HEADER"] === "1";
const remoteTestHosts = (
  process.env["LOCAL_EXPERIENCE_ALLOWED_DEV_ORIGINS"] ?? ""
)
  .split(",")
  .filter((host) => /^[a-z0-9.-]+$/u.test(host));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  ...(remoteTestEdge
    ? {
        experimental: { trustHostHeader: true } as NonNullable<
          NextConfig["experimental"]
        >,
        allowedDevOrigins: remoteTestHosts,
      }
    : {}),
  // Authorization codes and state must never enter Next's native URL logs.
  logging: {
    incomingRequests: { ignore: [/^\/api\/admin\/auth(?:\/|\?|$)/u] },
  },
};

export default nextConfig;
