import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  // Authorization codes, state and sign-in attempts never enter Next's native URL logs.
  logging: {
    incomingRequests: {
      ignore: [/^\/api\/admin\/(?:auth|local-auth)(?:\/|\?|$)/u],
    },
  },
};

export default nextConfig;
