import type { NextConfig } from "next";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // The API and the browser share one origin: Next proxies every /api request
  // to the Express server. That keeps cookie auth same-origin (no CORS dance).
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_INTERNAL_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
