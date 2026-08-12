export const DEFAULT_DRAWING_REALTIME_URL =
  "https://mistakes-party-drawing-realtime.mistakes.workers.dev";

/**
 * The relay origin is public configuration, not a credential. Production uses
 * the deployed Worker by default; an explicit environment value can still
 * point local development, previews, or tests at a different relay.
 */
const configuredDrawingRealtimeUrl =
  process.env.NEXT_PUBLIC_DRAWING_REALTIME_URL?.trim();

const rawDrawingRealtimeUrl =
  configuredDrawingRealtimeUrl ||
  (process.env.NODE_ENV === "production" ? DEFAULT_DRAWING_REALTIME_URL : "");

export function normalizeDrawingRealtimeUrl(value: string): string {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

export const DRAWING_REALTIME_URL = normalizeDrawingRealtimeUrl(
  rawDrawingRealtimeUrl,
);
