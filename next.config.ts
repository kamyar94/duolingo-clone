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
          // The microphone is allowed for Lingo's own pages only (hold-to-talk questions).
          value: "camera=(), microphone=(self), geolocation=(), payment=()",
        },
      ],
    },
    {
      // The admin screens (react-admin) read the list total from this header. The voice routes
      // are left out because their audio answers carry real byte ranges in the same header.
      source: "/api/:path((?!voice/).*)",
      headers: [{ key: "Content-Range", value: "bytes : 0-9/*" }],
    },
  ],
};

export default nextConfig;
