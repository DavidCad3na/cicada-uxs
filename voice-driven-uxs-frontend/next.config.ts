import type { NextConfig } from "next";
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";
const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    turbopack: false,
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
    ];
  },
};
export default nextConfig;