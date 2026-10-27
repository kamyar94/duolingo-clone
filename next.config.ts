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
        {
          // Coding lessons: workers only from the app itself or from blob URLs (the code
          // runners). Scripts are not restricted further here; runner frames carry their own policy.
          key: "Content-Security-Policy",
          value: "worker-src 'self' blob:; object-src 'none'; base-uri 'self'",
        },
      ],
    },
    {
      // Browser runtimes of the coding lessons (scripts/build-runtimes.mjs, about 25 MB). The
      // browser keeps them but asks before each use (an answer of 304 when unchanged), so an
      // update never mixes old and new runtime files.
      source: "/runtimes/(.*)",
      headers: [{ key: "Cache-Control", value: "no-cache" }],
    },
    {
      // The admin screens (react-admin) read the list total from this header.
      source: "/api/(.*)",
      headers: [{ key: "Content-Range", value: "bytes : 0-9/*" }],
    },
  ],
};

export default nextConfig;
