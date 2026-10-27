import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  images: { unoptimized: true },
  devIndicators: false,
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), payment=()",
        },
      ],
    },
    {
      // The admin screens (react-admin) read the list total from this header.
      source: "/api/(.*)",
      headers: [{ key: "Content-Range", value: "bytes : 0-9/*" }],
    },
  ],
};

export default nextConfig;
