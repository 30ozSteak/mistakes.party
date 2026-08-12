const DATABASE_NAME = "mistakes-party-drawing";
const DATABASE_VERSION = 1;
const STROKES_STORE = "strokes";
const ROUTE_INDEX = "route";

export const PREFERENCES_STORAGE_KEY =
  "mistakes-party.drawing.preferences.v1";

export const PALETTE = [
  { id: "acid", label: "Acid yellow", value: "#dfff00" },
  { id: "pink", label: "Hot pink", value: "#ff3ea5" },
  { id: "cyan", label: "Electric cyan", value: "#00e5ff" },
  { id: "orange", label: "Fluorescent orange", value: "#ff7a00" },
] as const;

export type HighlighterColor = (typeof PALETTE)[number]["value"];

export const DEFAULT_COLOR: HighlighterColor = "#dfff00";

// Descriptive aliases make the shared values convenient outside of the controls.
export const DRAWING_PALETTE = PALETTE;
export const DRAWING_COLORS = PALETTE.map(({ value }) => value);
export const DEFAULT_DRAWING_COLOR = DEFAULT_COLOR;
export type DrawingColor = HighlighterColor;

export interface StrokeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface StrokeRecord {
  version: 1;
  id: string;
  route: string;
  color: HighlighterColor;
  width: number;
  opacity: number;
  createdAt: number;
  points: number[];
  bounds: StrokeBounds;
}

export interface DrawingPreferences {
  version: 1;
  enabled: boolean;
  color: HighlighterColor;
}

const DEFAULT_PREFERENCES: DrawingPreferences = {
  version: 1,
  enabled: false,
  color: DEFAULT_COLOR,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isHighlighterColor(value: unknown): value is HighlighterColor {
  return PALETTE.some((choice) => choice.value === value);
}

function isStrokeBounds(value: unknown): value is StrokeBounds {
  if (!isRecord(value)) {
    return false;
  }

  const { minX, minY, maxX, maxY } = value;
  return (
    isFiniteNumber(minX) &&
    isFiniteNumber(minY) &&
    isFiniteNumber(maxX) &&
    isFiniteNumber(maxY) &&
    minX <= maxX &&
    minY <= maxY
  );
}

function isStrokeRecord(value: unknown): value is StrokeRecord {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.version !== 1 ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.route !== "string" ||
    normalizeRoute(value.route) !== value.route ||
    !isHighlighterColor(value.color) ||
    !isFiniteNumber(value.width) ||
    value.width <= 0 ||
    !isFiniteNumber(value.opacity) ||
    value.opacity <= 0 ||
    value.opacity > 1 ||
    !isFiniteNumber(value.createdAt) ||
    value.createdAt < 0 ||
    !Array.isArray(value.points) ||
    value.points.length < 2 ||
    value.points.length % 2 !== 0 ||
    !value.points.every(isFiniteNumber) ||
    !isStrokeBounds(value.bounds)
  ) {
    return false;
  }

  for (let index = 0; index < value.points.length; index += 2) {
    const x = value.points[index];
    const y = value.points[index + 1];

    if (
      x < value.bounds.minX ||
      x > value.bounds.maxX ||
      y < value.bounds.minY ||
      y > value.bounds.maxY
    ) {
      return false;
    }
  }

  return true;
}

function isDrawingPreferences(value: unknown): value is DrawingPreferences {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.enabled === "boolean" &&
    isHighlighterColor(value.color)
  );
}

export function normalizeRoute(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0]?.trim() ?? "";
  let normalized = pathOnly.length > 0 ? pathOnly : "/";

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  normalized = normalized.replace(/\/{2,}/g, "/");

  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function readPreferences(): DrawingPreferences {
  if (typeof window === "undefined") {
    return { ...DEFAULT_PREFERENCES };
  }

  try {
    const stored = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (stored === null) {
      return { ...DEFAULT_PREFERENCES };
    }

    const parsed: unknown = JSON.parse(stored);
    return isDrawingPreferences(parsed)
      ? { version: 1, enabled: parsed.enabled, color: parsed.color }
      : { ...DEFAULT_PREFERENCES };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function hasPreferenceStorageAccess(): boolean {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function writePreferences(preferences: DrawingPreferences): boolean {
  if (typeof window === "undefined" || !isDrawingPreferences(preferences)) {
    return false;
  }

  try {
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        enabled: preferences.enabled,
        color: preferences.color,
      } satisfies DrawingPreferences),
    );
    return true;
  } catch {
    // Drawing remains usable with the in-memory state held by the caller.
    return false;
  }
}

function storageError(message: string): Error {
  return new Error(message);
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      storageError("IndexedDB is unavailable; drawings cannot be persisted."),
    );
  }

  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let settled = false;

    const rejectOnce = (reason: unknown) => {
      if (!settled) {
        settled = true;
        reject(reason);
      }
    };

    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      rejectOnce(error);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;
      let store: IDBObjectStore;

      if (database.objectStoreNames.contains(STROKES_STORE)) {
        if (transaction === null) {
          throw storageError("IndexedDB opened without an upgrade transaction.");
        }
        store = transaction.objectStore(STROKES_STORE);
      } else {
        store = database.createObjectStore(STROKES_STORE, { keyPath: "id" });
      }

      if (!store.indexNames.contains(ROUTE_INDEX)) {
        store.createIndex(ROUTE_INDEX, "route", { unique: false });
      }
    };

    request.onerror = () => {
      rejectOnce(
        request.error ??
          storageError("IndexedDB could not open the drawings database."),
      );
    };

    request.onblocked = () => {
      rejectOnce(
        storageError(
          "IndexedDB is blocked by another page; drawings cannot be persisted.",
        ),
      );
    };

    request.onsuccess = () => {
      const database = request.result;

      if (settled) {
        database.close();
        return;
      }

      if (!database.objectStoreNames.contains(STROKES_STORE)) {
        database.close();
        rejectOnce(storageError("The drawings database has an invalid schema."));
        return;
      }

      database.onversionchange = () => database.close();
      settled = true;
      resolve(database);
    };
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(request.error ?? storageError("An IndexedDB request failed."));
    };
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => {
      reject(
        transaction.error ?? storageError("An IndexedDB transaction aborted."),
      );
    };
    transaction.onerror = () => {
      // The subsequent abort event provides the final transaction error.
    };
  });
}

export async function loadStrokes(route: string): Promise<StrokeRecord[]> {
  const normalizedRoute = normalizeRoute(route);
  const database = await openDatabase();

  try {
    const transaction = database.transaction(STROKES_STORE, "readonly");
    const completion = transactionComplete(transaction);
    const index = transaction.objectStore(STROKES_STORE).index(ROUTE_INDEX);
    const [stored] = await Promise.all([
      requestResult(index.getAll(IDBKeyRange.only(normalizedRoute))),
      completion,
    ]);

    return stored
      .filter(
        (candidate): candidate is StrokeRecord =>
          isStrokeRecord(candidate) && candidate.route === normalizedRoute,
      )
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      );
  } finally {
    database.close();
  }
}

export async function saveStroke(stroke: StrokeRecord): Promise<void> {
  const normalizedStroke: StrokeRecord = {
    ...stroke,
    route: normalizeRoute(stroke.route),
    points: [...stroke.points],
    bounds: { ...stroke.bounds },
  };

  if (!isStrokeRecord(normalizedStroke)) {
    throw new TypeError("Cannot persist an invalid drawing stroke.");
  }

  const database = await openDatabase();

  try {
    const transaction = database.transaction(STROKES_STORE, "readwrite");
    const completion = transactionComplete(transaction);
    transaction.objectStore(STROKES_STORE).put(normalizedStroke);
    await completion;
  } finally {
    database.close();
  }
}

export async function clearStrokes(route: string): Promise<void> {
  const normalizedRoute = normalizeRoute(route);
  const database = await openDatabase();

  try {
    const transaction = database.transaction(STROKES_STORE, "readwrite");
    const completion = transactionComplete(transaction);
    const index = transaction.objectStore(STROKES_STORE).index(ROUTE_INDEX);
    const cursorRequest = index.openCursor(IDBKeyRange.only(normalizedRoute));

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor === null) {
        return;
      }

      cursor.delete();
      cursor.continue();
    };

    await completion;
  } finally {
    database.close();
  }
}
