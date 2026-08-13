import type { NextConfig } from "next";

const partyRealtimeUrl =
  process.env.NEXT_PUBLIC_PARTY_REALTIME_URL?.trim() ||
  (process.env.NODE_ENV === "production"
    ? "https://mistakes-party-drawing-realtime.mistakes.workers.dev"
    : "");

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  {
    // frame-ancestors in the CSP is authoritative in modern browsers. Keep
    // this header for older clients that do not support that directive.
    key: "X-Frame-Options",
    value: "DENY",
  },
] as const;

const nextConfig: NextConfig = {
  // E2E can run alongside an existing developer server without sharing its
  // build lock or environment-specific client bundle.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Freeze one public relay value into both the browser and proxy bundles so
  // the CSP and WebSocket target cannot diverge at runtime.
  env: {
    NEXT_PUBLIC_PARTY_REALTIME_URL: partyRealtimeUrl,
  },
  poweredByHeader: false,
  trailingSlash: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders],
      },
    ];
  },
};

export default nextConfig;
