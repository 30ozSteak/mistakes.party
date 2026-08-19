import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${
    isDevelopment
      ? " http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*"
      : ""
  }`,
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "manifest-src 'self'",
  ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
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
  ...(isDevelopment
    ? []
    : [
        {
          // frame-ancestors in the CSP is authoritative in modern browsers.
          // Keep this header for older clients in deployed environments.
          key: "X-Frame-Options",
          value: "DENY",
        },
      ]),
] as const;

const nextConfig: NextConfig = {
  // E2E can run alongside an existing developer server without sharing its
  // build lock or environment-specific client bundle.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: {
    // The only Server Action accepts two short text fields. Keeping the raw
    // multipart body small prevents oversized requests from consuming a full
    // function invocation before application validation can run.
    serverActions: {
      bodySizeLimit: "32kb",
    },
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
