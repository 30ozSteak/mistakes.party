import { XMLParser } from "fast-xml-parser";

const DEFAULT_MEDIUM_FEED_URL = "https://medium.com/feed/@30ozsteak";

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
  processEntities: true,
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
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const isMediumHost =
      url.hostname === "medium.com" || url.hostname.endsWith(".medium.com");

    if (url.protocol !== "https:" || !isMediumHost) return null;

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
    if (!isRecord(rawItem)) continue;

    const title = readText(rawItem.title);
    const url = normalizeMediumUrl(rawItem.link);
    const publishedAt = normalizeDate(
      rawItem.pubDate,
      rawItem["atom:updated"],
    );

    if (!title || !url || !publishedAt) continue;

    const id = readText(rawItem.guid) || url;
    if (seen.has(id)) continue;
    seen.add(id);
    posts.push({ id, title, url, publishedAt });
  }

  return posts.sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

export async function getMediumPosts(
  feedUrl = MEDIUM_FEED_URL,
): Promise<MediumPost[]> {
  try {
    const response = await fetch(feedUrl, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(7000),
    });

    if (!response.ok) return [];

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 2_000_000) return [];

    return parseMediumFeed(await response.text());
  } catch {
    return [];
  }
}
