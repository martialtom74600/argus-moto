import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** apify-client charge `proxy-agent` en require dynamique : ne pas bundler. */
  serverExternalPackages: ["apify-client", "proxy-agent"],
  async headers() {
    return [
      {
        source: "/estimer",
        headers: [
          {
            key: "Cache-Control",
            value:
              "private, no-cache, no-store, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
