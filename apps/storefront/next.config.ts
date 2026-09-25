import path from "node:path";

import type { NextConfig } from "next";

import { createStorefrontImageConfig } from "./src/server/image-config";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  images: createStorefrontImageConfig(process.env),
};

export default nextConfig;
