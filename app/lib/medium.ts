import { XMLParser } from "fast-xml-parser";

const DEFAULT_MEDIUM_FEED_URL = "https://medium.com/feed/@30ozsteak";
const MAX_FEED_BYTES = 2_000_000;
const MAX_FEED_REDIRECTS = 3;
const MAX_POSTS = 50;
const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2_048;
const MAX_ID_LENGTH = 512;

export const MEDIUM_FEED_URL =
  process.env.MEDIUM_FEED_URL ?? DEFAULT_MEDIUM_FEED_URL;
export const MEDIUM_PROFILE_URL = "https://medium.com/@30ozsteak";

export type MediumPost = {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
};

type UnknownRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  // RSS values are treated as text. Custom XML entities add expansion risk
  // without providing anything this feed reader needs.
  processEntities: false,
  trimValues: true,
});

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (!isRecord(value)) return "";

  const text = value["#text"];
  return typeof text === "string" ? text.trim() : "";
}

function normalizeMediumUrl(value: unknown): string | null {
  const rawUrl = readText(value);
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) return null;

  try {
    const url = new URL(rawUrl);
    const isMediumHost =
      url.hostname === "medium.com" || url.hostname.endsWith(".medium.com");

    if (
      url.protocol !== "https:" ||
      !isMediumHost ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }

    url.searchParams.delete("source");
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeDate(...values: unknown[]): string | null {
  for (const value of values) {
    const rawDate = readText(value);
    if (!rawDate) continue;

    const timestamp = Date.parse(rawDate);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }

  return null;
}

export function parseMediumFeed(xml: string): MediumPost[] {
  if (xml.length > MAX_FEED_BYTES || /<!DOCTYPE\b/i.test(xml)) return [];

  const parsed: unknown = parser.parse(xml);
  if (!isRecord(parsed) || !isRecord(parsed.rss)) return [];

  const channel = parsed.rss.channel;
  if (!isRecord(channel)) return [];

  const rawItems = Array.isArray(channel.item)
    ? channel.item
    : channel.item
      ? [channel.item]
      : [];
  const posts: MediumPost[] = [];
  const seen = new Set<string>();

  for (const rawItem of rawItems) {
    if (posts.length >= MAX_POSTS) break;
    if (!isRecord(rawItem)) continue;

    const title = readText(rawItem.title);
    const url = normalizeMediumUrl(rawItem.link);
    const publishedAt = normalizeDate(
      rawItem.pubDate,
      rawItem["atom:updated"],
    );

    if (
      !title ||
      title.length > MAX_TITLE_LENGTH ||
      !url ||
      !publishedAt
    ) {
      continue;
    }

    const id = readText(rawItem.guid) || url;
    if (id.length > MAX_ID_LENGTH) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    posts.push({ id, title, url, publishedAt });
  }

  return posts.sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

function getAllowedLoopbackOrigin(initialUrl: string): string | null {
  if (process.env.MEDIUM_FEED_ALLOW_LOCALHOST !== "1") return null;

  try {
    const url = new URL(initialUrl);
    const isLoopback =
      url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return url.protocol === "http:" && isLoopback ? url.origin : null;
  } catch {
    return null;
  }
}

function isAllowedFeedUrl(
  value: string,
  allowedLoopbackOrigin: string | null,
): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;

    const isMediumHost =
      url.hostname === "medium.com" || url.hostname.endsWith(".medium.com");
    if (url.protocol === "https:" && isMediumHost && !url.port) return true;

    // Production tests can opt into their ephemeral loopback RSS server. This
    // flag is intentionally ignored for every non-loopback host.
    return (
      allowedLoopbackOrigin !== null &&
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.origin === allowedLoopbackOrigin
    );
  } catch {
    return false;
  }
}

async function fetchFeedResponse(
  initialUrl: string,
  signal: AbortSignal,
): Promise<Response | null> {
  let currentUrl = initialUrl;
  const allowedLoopbackOrigin = getAllowedLoopbackOrigin(initialUrl);
  let initialOrigin: string;

  try {
    initialOrigin = new URL(initialUrl).origin;
  } catch {
    return null;
  }

  for (let redirects = 0; redirects <= MAX_FEED_REDIRECTS; redirects += 1) {
    if (!isAllowedFeedUrl(currentUrl, allowedLoopbackOrigin)) return null;

    const response = await fetch(currentUrl, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      },
      next: { revalidate: 900 },
      redirect: "manual",
      signal,
    });

    if (response.status < 300 || response.status >= 400) return response;
    if (redirects === MAX_FEED_REDIRECTS) return null;

    const location = response.headers.get("location");
    if (!location) return null;
    const redirectUrl = new URL(location, currentUrl);
    // The configured feed endpoint never needs to cross origins. Pinning the
    // entire chain avoids DNS/host pivots even within Medium-controlled hosts.
    if (redirectUrl.origin !== initialOrigin) return null;
    currentUrl = redirectUrl.toString();
  }

  return null;
}

async function readFeedText(response: Response): Promise<string | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
    await response.body?.cancel();
    return null;
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let xml = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_FEED_BYTES) {
        await reader.cancel();
        return null;
      }
      xml += decoder.decode(value, { stream: true });
    }
    return xml + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function getMediumPosts(
  feedUrl = MEDIUM_FEED_URL,
): Promise<MediumPost[]> {
  try {
    const response = await fetchFeedResponse(
      feedUrl,
      AbortSignal.timeout(7000),
    );

    if (!response?.ok) return [];

    const xml = await readFeedText(response);
    return xml === null ? [] : parseMediumFeed(xml);
  } catch {
    return [];
  }
}
