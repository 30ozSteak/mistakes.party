import { type NextRequest, NextResponse } from "next/server";
import { DRAWING_REALTIME_URL } from "./app/lib/drawingRealtimeConfig";

const isDevelopment = process.env.NODE_ENV === "development";

function drawingWebSocketOrigin(): string | null {
  try {
    const url = new URL(DRAWING_REALTIME_URL);
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function contentSecurityPolicy(nonce: string): string {
  const connectSources = ["'self'", "https://api.github.com"];
  const drawingOrigin = drawingWebSocketOrigin();
  if (drawingOrigin) connectSources.push(drawingOrigin);

  if (isDevelopment) {
    // Next development HMR and the local drawing service use loopback sockets.
    connectSources.push(
      "http://localhost:*",
      "http://127.0.0.1:*",
      "ws://localhost:*",
      "ws://127.0.0.1:*",
    );
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${
      isDevelopment ? " 'unsafe-eval'" : ""
    }`,
    "script-src-attr 'none'",
    // Next's development overlay injects transient style elements without
    // forwarding the page nonce. Production keeps the stricter nonce policy.
    isDevelopment
      ? "style-src-elem 'self' 'unsafe-inline'"
      : `style-src-elem 'self' 'nonce-${nonce}'`,
    // React positions drawing cursors and exposes palette colors with style
    // attributes. Script execution remains nonce-protected independently.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  // Use a full 128 bits of entropy and an encoding accepted by both CSP nonce
  // parsing and HTML attributes. UUID v4 fixes six bits, so stripping its
  // punctuation would leave slightly less entropy than the policy promises.
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(nonceBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);

  // Next reads the request CSP to apply this nonce to framework, RSC, and page
  // scripts. The response copy is what the browser enforces.
  requestHeaders.set("content-security-policy", policy);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
