import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // firebase-admin uses Node internals that don't survive bundling
  serverExternalPackages: ["firebase-admin"],
};

export default nextConfig;
