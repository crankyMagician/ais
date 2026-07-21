import type { NextConfig } from "next";

// GitHub Pages serves project sites under /<repo>; the deploy workflow sets
// NEXT_PUBLIC_BASE_PATH=/ais. Local dev leaves it unset.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
