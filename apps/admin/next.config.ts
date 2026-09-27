import path from "node:path";

import type { NextConfig } from "next";

// Remote TEST edge only (docs/runbooks/remote-test-environment.md): the development server
// listens on loopback behind an edge that forwards the validated public Host, so request URLs
// must use that Host instead of the loopback listen port. Never set for builds or production.
const remoteTestEdge =
  process.env.NODE_ENV === "development" &&
  process.env["LOCAL_EXPERIENCE_TRUST_HOST_HEADER"] === "1"
    ? ({ trustHostHeader: true } as NextConfig["experimental"])
    : undefined;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  ...(remoteTestEdge ? { experimental: remoteTestEdge } : {}),
  // Authorization codes and state must never enter Next's native URL logs.
  logging: {
    incomingRequests: { ignore: [/^\/api\/admin\/auth(?:\/|\?|$)/u] },
  },
};

export default nextConfig;
