import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const PATREON_ACCESS_COOKIE = "mxp_patreon_access";
export const PATREON_ACCESS_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const TOKEN_VERSION = "v1";
const MAX_PASSWORD_LENGTH = 512;
const MINIMUM_ACCESS_PASSWORD_LENGTH = 12;
const MINIMUM_SESSION_SECRET_LENGTH = 32;
const DEFAULT_PATREON_RETURN_TO = "/patreon/room";

type PatreonConfiguration = {
  password: string;
  sessionSecret: string;
};

export type PatreonPasswordCheck = "valid" | "invalid" | "unconfigured";

function configuration(): PatreonConfiguration | null {
  const password = process.env.PATREON_ACCESS_PASSWORD;
  const sessionSecret = process.env.PATREON_SESSION_SECRET;

  if (
    !password ||
    password.length < MINIMUM_ACCESS_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH ||
    !sessionSecret ||
    sessionSecret.length < MINIMUM_SESSION_SECRET_LENGTH
  ) {
    return null;
  }

  return { password, sessionSecret };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function constantTimeEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function passwordVersion(config: PatreonConfiguration): string {
  return createHmac("sha256", config.sessionSecret)
    .update("patreon-password\0", "utf8")
    .update(config.password, "utf8")
    .digest("base64url")
    .slice(0, 22);
}

function sign(payload: string, sessionSecret: string): string {
  return createHmac("sha256", sessionSecret)
    .update(payload, "utf8")
    .digest("base64url");
}

function createAccessToken(config: PatreonConfiguration): string {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const expiresAt = issuedAt + PATREON_ACCESS_MAX_AGE_SECONDS;
  const nonce = randomBytes(16).toString("base64url");
  const payload = [
    TOKEN_VERSION,
    issuedAt,
    expiresAt,
    nonce,
    passwordVersion(config),
  ].join(".");

  return `${payload}.${sign(payload, config.sessionSecret)}`;
}

function verifyAccessToken(
  token: string | undefined,
  config: PatreonConfiguration,
): boolean {
  if (!token || token.length > 512) return false;

  const segments = token.split(".");
  if (segments.length !== 6) return false;

  const [version, issuedAtValue, expiresAtValue, nonce, versionHash, signature] =
    segments;
  if (
    version !== TOKEN_VERSION ||
    !/^\d{10}$/.test(issuedAtValue) ||
    !/^\d{10}$/.test(expiresAtValue) ||
    !/^[A-Za-z0-9_-]{22}$/.test(nonce) ||
    !/^[A-Za-z0-9_-]{22}$/.test(versionHash) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    return false;
  }

  const payload = segments.slice(0, 5).join(".");
  if (!constantTimeEqual(signature, sign(payload, config.sessionSecret))) {
    return false;
  }

  const issuedAt = Number(issuedAtValue);
  const expiresAt = Number(expiresAtValue);
  const now = Math.floor(Date.now() / 1_000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt > now + 60 ||
    expiresAt <= now ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > PATREON_ACCESS_MAX_AGE_SECONDS + 60
  ) {
    return false;
  }

  return constantTimeEqual(versionHash, passwordVersion(config));
}

/**
 * Server-derived Patreon flag for Server Components, data access helpers,
 * Server Actions, and Route Handlers. Never replace this check with client UI.
 */
export async function hasPatreonAccess(): Promise<boolean> {
  const config = configuration();
  if (!config) return false;

  const token = (await cookies()).get(PATREON_ACCESS_COOKIE)?.value;
  return verifyAccessToken(token, config);
}

/** Redirect an unauthorized page request through the shared Patreon door. */
export async function requirePatreonAccess(
  returnTo = DEFAULT_PATREON_RETURN_TO,
): Promise<void> {
  if (await hasPatreonAccess()) return;

  const safeReturnTo = normalizePatreonReturnTo(returnTo);
  redirect(`/patreon?returnTo=${encodeURIComponent(safeReturnTo)}`);
}

export function checkPatreonPassword(password: unknown): PatreonPasswordCheck {
  const config = configuration();
  if (!config) return "unconfigured";
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return "invalid";
  }

  return constantTimeEqual(password, config.password) ? "valid" : "invalid";
}

export async function grantPatreonAccess(): Promise<boolean> {
  const config = configuration();
  if (!config) return false;

  const cookieStore = await cookies();
  cookieStore.set(PATREON_ACCESS_COOKIE, createAccessToken(config), {
    httpOnly: true,
    maxAge: PATREON_ACCESS_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return true;
}

export async function revokePatreonAccess(): Promise<void> {
  (await cookies()).delete(PATREON_ACCESS_COOKIE);
}

/** Keep post-unlock redirects same-origin and path-based. */
export function normalizePatreonReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_024 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n\0]/.test(value)
  ) {
    return DEFAULT_PATREON_RETURN_TO;
  }

  try {
    const base = new URL("https://mistakes.party");
    const url = new URL(value, base);
    if (url.origin !== base.origin) return DEFAULT_PATREON_RETURN_TO;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_PATREON_RETURN_TO;
  }
}
