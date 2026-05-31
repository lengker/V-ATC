import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  middlewareClientMaxBodySize: "100mb",
  outputFileTracingRoot: require("path").join(__dirname),
  async rewrites() {
    const backendUrl = process.env.ALPHA_BACKEND_URL || "http://127.0.0.1:8000";
    const a2BackendUrl = process.env.A2_BACKEND_URL || "http://127.0.0.1:8001";
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },
      {
        source: "/api/a2/:path*",
        destination: `${a2BackendUrl}/api/a2/:path*`,
      },
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
    ];
  },
  images: {
    domains: ["tile.openstreetmap.org"],
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
