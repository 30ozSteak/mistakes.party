export const DEFAULT_PARTY_REALTIME_URL =
  "https://mistakes-party-drawing-realtime.mistakes.workers.dev";

const configuredPartyRealtimeUrl =
  process.env.NEXT_PUBLIC_PARTY_REALTIME_URL?.trim();

const rawPartyRealtimeUrl =
  configuredPartyRealtimeUrl ||
  (process.env.NODE_ENV === "production" ? DEFAULT_PARTY_REALTIME_URL : "");

export function normalizePartyRealtimeUrl(value: string): string {
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

export const PARTY_REALTIME_URL = normalizePartyRealtimeUrl(
  rawPartyRealtimeUrl,
);
