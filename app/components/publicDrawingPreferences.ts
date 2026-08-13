import { PREFERENCES_STORAGE_KEY } from "./drawingStorage";

export type DrawingScope = "public" | "solo" | "private";
export type PersistedDrawingScope = Exclude<DrawingScope, "private">;

const DRAWING_SCOPE_KEY = "mistakes-party.drawing.scope.v1";
const PUBLIC_NUDGE_KEY = "mistakes-party.drawing.public-nudge.v1";
const DRAWING_DATABASE_NAME = "mistakes-party-drawing";
const DRAWING_STROKES_STORE = "strokes";
let nudgeDismissedInMemory = false;

type StoredScope = {
  version: 1;
  scope: PersistedDrawingScope;
};

function isStoredScope(value: unknown): value is StoredScope {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "scope" in value &&
    (value.scope === "public" || value.scope === "solo")
  );
}

export function readPersistedDrawingScope(): PersistedDrawingScope | null {
  try {
    const value = window.localStorage.getItem(DRAWING_SCOPE_KEY);
    if (value === null) return null;
    const parsed: unknown = JSON.parse(value);
    return isStoredScope(parsed) ? parsed.scope : null;
  } catch {
    return null;
  }
}

export function writePersistedDrawingScope(
  scope: PersistedDrawingScope,
): boolean {
  try {
    window.localStorage.setItem(
      DRAWING_SCOPE_KEY,
      JSON.stringify({ version: 1, scope } satisfies StoredScope),
    );
    return true;
  } catch {
    return false;
  }
}

function hasLegacyPreferences(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCES_STORAGE_KEY) !== null;
  } catch {
    // If localStorage cannot be inspected, defaulting to Solo is the safer
    // migration: it cannot expose an existing private drawing to realtime.
    return true;
  }
}

async function hasLegacyArtwork(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;

  try {
    if (typeof indexedDB.databases === "function") {
      const databases = await indexedDB.databases();
      if (!databases.some(({ name }) => name === DRAWING_DATABASE_NAME)) {
        return false;
      }
    }

    return await new Promise<boolean>((resolve) => {
      const request = indexedDB.open(DRAWING_DATABASE_NAME);
      let createdDatabase = false;

      request.onupgradeneeded = () => {
        createdDatabase = true;
        request.transaction?.abort();
      };
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const database = request.result;
        if (
          createdDatabase ||
          !database.objectStoreNames.contains(DRAWING_STROKES_STORE)
        ) {
          database.close();
          resolve(false);
          return;
        }

        const transaction = database.transaction(
          DRAWING_STROKES_STORE,
          "readonly",
        );
        const count = transaction.objectStore(DRAWING_STROKES_STORE).count();
        count.onerror = () => {
          database.close();
          resolve(false);
        };
        count.onsuccess = () => {
          database.close();
          resolve(count.result > 0);
        };
      };
    });
  } catch {
    return false;
  }
}

/**
 * Existing highlighter installations migrate to Solo. A genuinely new browser
 * profile starts in Public Ambient; neither path uploads local IndexedDB data.
 */
export async function resolveInitialDrawingScope(): Promise<{
  scope: PersistedDrawingScope;
  migrated: boolean;
}> {
  const storedScope = readPersistedDrawingScope();
  if (storedScope) return { scope: storedScope, migrated: false };

  const migrated = hasLegacyPreferences() || (await hasLegacyArtwork());
  const scope = migrated ? "solo" : "public";
  writePersistedDrawingScope(scope);
  return { scope, migrated };
}

export function isPublicNudgeDismissed(): boolean {
  if (nudgeDismissedInMemory) return true;
  try {
    if (window.localStorage.getItem(PUBLIC_NUDGE_KEY) === "dismissed") {
      nudgeDismissedInMemory = true;
      return true;
    }
  } catch {
    // Fall through to per-tab storage when durable storage is unavailable.
  }
  try {
    const dismissed =
      window.sessionStorage.getItem(PUBLIC_NUDGE_KEY) === "dismissed";
    if (dismissed) nudgeDismissedInMemory = true;
    return dismissed;
  } catch {
    return nudgeDismissedInMemory;
  }
}

export function dismissPublicNudge(): boolean {
  nudgeDismissedInMemory = true;
  let saved = false;
  try {
    window.localStorage.setItem(PUBLIC_NUDGE_KEY, "dismissed");
    saved = true;
  } catch {
    // A session fallback still prevents repeated prompts in this tab.
  }
  try {
    window.sessionStorage.setItem(PUBLIC_NUDGE_KEY, "dismissed");
    saved = true;
  } catch {
    // The in-memory fallback remains valid for this document.
  }
  return saved;
}
