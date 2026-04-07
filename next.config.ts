import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "media.motoblouz.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "media-imgproxy.motoblouz.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "www.motoblouz.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "motoblouz.com",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "media.motoblouz.com",
        pathname: "/**",
      },
    ],
  },
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
