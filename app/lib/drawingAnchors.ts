/**
 * Stable, responsive coordinate anchors for ephemeral public drawings.
 *
 * This module is safe to import during server rendering. DOM access only occurs
 * inside helpers after a document has either been supplied or detected.
 */

export const DRAWING_ANCHOR_SCHEMA_VERSION = 1 as const;
export const DRAWING_ANCHOR_ATTRIBUTE = "data-drawing-anchor" as const;
export const PAGE_DRAWING_ANCHOR_ID = "page-root" as const;

export type DrawingAnchorSchemaVersion =
  typeof DRAWING_ANCHOR_SCHEMA_VERSION;

export interface NormalizedDrawingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DocumentDrawingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DocumentDrawingPoint {
  x: number;
  y: number;
}

export interface AnchoredPoint {
  anchorSchemaVersion: DrawingAnchorSchemaVersion;
  anchorId: string;
  x: number;
  y: number;
}

export interface AnchoredPointChunk {
  anchorSchemaVersion: DrawingAnchorSchemaVersion;
  anchorId: string;
  points: number[];
  bounds: NormalizedDrawingBounds;
}

export interface AnchoredFlatPoints {
  anchorSchemaVersion: number;
  anchorId: string;
  points: readonly number[];
}

export interface AnchoredBounds {
  anchorSchemaVersion: number;
  anchorId: string;
  bounds: NormalizedDrawingBounds;
}

type UsableAnchorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const DRAWING_ANCHOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/;

function currentDocument(root?: Document): Document | null {
  if (root) return root;
  return typeof document === "undefined" ? null : document;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNormalizedCoordinate(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function clampNormalizedCoordinate(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isDrawingAnchorId(value: unknown): value is string {
  return typeof value === "string" && DRAWING_ANCHOR_ID_PATTERN.test(value);
}

function documentScroll(root: Document): DocumentDrawingPoint {
  const view = root.defaultView;
  return {
    x: view?.scrollX ?? root.documentElement?.scrollLeft ?? 0,
    y: view?.scrollY ?? root.documentElement?.scrollTop ?? 0,
  };
}

function usableAnchorRect(anchor: HTMLElement): UsableAnchorRect | null {
  const rect = anchor.getBoundingClientRect();
  const width = isFiniteNumber(rect.width) ? rect.width : rect.right - rect.left;
  const height = isFiniteNumber(rect.height)
    ? rect.height
    : rect.bottom - rect.top;

  if (
    !isFiniteNumber(rect.left) ||
    !isFiniteNumber(rect.top) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return { left: rect.left, top: rect.top, width, height };
}

function anchorIdFromElement(element: HTMLElement): string | null {
  const anchorId = element.getAttribute(DRAWING_ANCHOR_ATTRIBUTE);
  return isDrawingAnchorId(anchorId) ? anchorId : null;
}

function isNormalizedDrawingBounds(
  bounds: NormalizedDrawingBounds,
): boolean {
  return (
    isNormalizedCoordinate(bounds.minX) &&
    isNormalizedCoordinate(bounds.minY) &&
    isNormalizedCoordinate(bounds.maxX) &&
    isNormalizedCoordinate(bounds.maxY) &&
    bounds.minX <= bounds.maxX &&
    bounds.minY <= bounds.maxY
  );
}

export function normalizeDrawingRoute(value: string): string {
  const pathOnly = value.split(/[?#]/, 1)[0]?.trim() ?? "";
  let route = pathOnly || "/";

  if (!route.startsWith("/")) route = `/${route}`;
  route = route.replace(/\/{2,}/g, "/");
  while (route.length > 1 && route.endsWith("/")) {
    route = route.slice(0, -1);
  }

  return route.slice(0, 512);
}

export function normalizedBoundsFromPoints(
  points: readonly number[],
): NormalizedDrawingBounds | null {
  if (points.length < 2 || points.length % 2 !== 0) return null;

  const bounds: NormalizedDrawingBounds = {
    minX: 1,
    minY: 1,
    maxX: 0,
    maxY: 0,
  };

  for (let index = 0; index < points.length; index += 2) {
    const x = points[index];
    const y = points[index + 1];
    if (!isNormalizedCoordinate(x) || !isNormalizedCoordinate(y)) {
      return null;
    }

    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }

  return bounds;
}

export function resolveDrawingAnchor(
  anchorId: string,
  anchorSchemaVersion: number,
  root?: Document,
): HTMLElement | null {
  if (
    anchorSchemaVersion !== DRAWING_ANCHOR_SCHEMA_VERSION ||
    !isDrawingAnchorId(anchorId)
  ) {
    return null;
  }

  const drawingDocument = currentDocument(root);
  if (!drawingDocument) return null;

  const matches = drawingDocument.querySelectorAll<HTMLElement>(
    `[${DRAWING_ANCHOR_ATTRIBUTE}]`,
  );
  let match: HTMLElement | null = null;

  for (const element of matches) {
    if (element.getAttribute(DRAWING_ANCHOR_ATTRIBUTE) !== anchorId) continue;
    if (match) return null;
    match = element;
  }

  return match;
}

export function findDrawingAnchorAtPoint(
  clientX: number,
  clientY: number,
  root?: Document,
): HTMLElement | null {
  if (!isFiniteNumber(clientX) || !isFiniteNumber(clientY)) return null;

  const drawingDocument = currentDocument(root);
  if (!drawingDocument) return null;

  let hit: Element | null;
  try {
    hit = drawingDocument.elementFromPoint(clientX, clientY);
  } catch {
    return null;
  }

  if (!hit) return null;

  for (let element: Element | null = hit; element; element = element.parentElement) {
    const candidate = element as HTMLElement;
    if (anchorIdFromElement(candidate)) return candidate;
  }

  return resolveDrawingAnchor(
    PAGE_DRAWING_ANCHOR_ID,
    DRAWING_ANCHOR_SCHEMA_VERSION,
    drawingDocument,
  );
}

export function viewportPointToAnchoredPoint(
  clientX: number,
  clientY: number,
  root?: Document,
): AnchoredPoint | null {
  const anchor = findDrawingAnchorAtPoint(clientX, clientY, root);
  if (!anchor) return null;

  const anchorId = anchorIdFromElement(anchor);
  const rect = usableAnchorRect(anchor);
  if (!anchorId || !rect) return null;

  return {
    anchorSchemaVersion: DRAWING_ANCHOR_SCHEMA_VERSION,
    anchorId,
    x: clampNormalizedCoordinate((clientX - rect.left) / rect.width),
    y: clampNormalizedCoordinate((clientY - rect.top) / rect.height),
  };
}

export function documentPointToAnchoredPoint(
  documentX: number,
  documentY: number,
  root?: Document,
): AnchoredPoint | null {
  if (!isFiniteNumber(documentX) || !isFiniteNumber(documentY)) return null;

  const drawingDocument = currentDocument(root);
  if (!drawingDocument) return null;
  const scroll = documentScroll(drawingDocument);

  return viewportPointToAnchoredPoint(
    documentX - scroll.x,
    documentY - scroll.y,
    drawingDocument,
  );
}

export function anchoredPointToDocumentPoint(
  point: AnchoredPoint,
  root?: Document,
): DocumentDrawingPoint | null {
  if (!isNormalizedCoordinate(point.x) || !isNormalizedCoordinate(point.y)) {
    return null;
  }

  const drawingDocument = currentDocument(root);
  if (!drawingDocument) return null;
  const anchor = resolveDrawingAnchor(
    point.anchorId,
    point.anchorSchemaVersion,
    drawingDocument,
  );
  if (!anchor) return null;

  const rect = usableAnchorRect(anchor);
  if (!rect) return null;
  const scroll = documentScroll(drawingDocument);

  return {
    x: rect.left + point.x * rect.width + scroll.x,
    y: rect.top + point.y * rect.height + scroll.y,
  };
}

export function anchoredPointsToDocumentPoints(
  anchored: AnchoredFlatPoints,
  root?: Document,
): number[] | null {
  const bounds = normalizedBoundsFromPoints(anchored.points);
  if (!bounds) return null;

  const drawingDocument = currentDocument(root);
  if (!drawingDocument) return null;
  const anchor = resolveDrawingAnchor(
    anchored.anchorId,
    anchored.anchorSchemaVersion,
    drawingDocument,
  );
  if (!anchor) return null;

  const rect = usableAnchorRect(anchor);
  if (!rect) return null;
  const scroll = documentScroll(drawingDocument);
  const points: number[] = [];

  for (let index = 0; index < anchored.points.length; index += 2) {
    points.push(
      rect.left + anchored.points[index] * rect.width + scroll.x,
      rect.top + anchored.points[index + 1] * rect.height + scroll.y,
    );
  }

  return points;
}

export function anchoredBoundsToDocumentBounds(
  anchored: AnchoredBounds,
  root?: Document,
): DocumentDrawingBounds | null {
  if (!isNormalizedDrawingBounds(anchored.bounds)) return null;

  const drawingDocument = currentDocument(root);
  if (!drawingDocument) return null;
  const anchor = resolveDrawingAnchor(
    anchored.anchorId,
    anchored.anchorSchemaVersion,
    drawingDocument,
  );
  if (!anchor) return null;

  const rect = usableAnchorRect(anchor);
  if (!rect) return null;
  const scroll = documentScroll(drawingDocument);

  return {
    minX: rect.left + anchored.bounds.minX * rect.width + scroll.x,
    minY: rect.top + anchored.bounds.minY * rect.height + scroll.y,
    maxX: rect.left + anchored.bounds.maxX * rect.width + scroll.x,
    maxY: rect.top + anchored.bounds.maxY * rect.height + scroll.y,
  };
}

export function splitDocumentPointsByAnchor(
  documentPoints: readonly number[],
  root?: Document,
): AnchoredPointChunk[] {
  if (documentPoints.length < 2 || documentPoints.length % 2 !== 0) return [];

  const drawingDocument = currentDocument(root);
  if (!drawingDocument) return [];

  const chunks: AnchoredPointChunk[] = [];
  let current: AnchoredPointChunk | null = null;

  for (let index = 0; index < documentPoints.length; index += 2) {
    const point = documentPointToAnchoredPoint(
      documentPoints[index],
      documentPoints[index + 1],
      drawingDocument,
    );

    if (!point) {
      current = null;
      continue;
    }

    if (!current || current.anchorId !== point.anchorId) {
      current = {
        anchorSchemaVersion: DRAWING_ANCHOR_SCHEMA_VERSION,
        anchorId: point.anchorId,
        points: [],
        bounds: {
          minX: point.x,
          minY: point.y,
          maxX: point.x,
          maxY: point.y,
        },
      };
      chunks.push(current);
    }

    current.points.push(point.x, point.y);
    current.bounds.minX = Math.min(current.bounds.minX, point.x);
    current.bounds.minY = Math.min(current.bounds.minY, point.y);
    current.bounds.maxX = Math.max(current.bounds.maxX, point.x);
    current.bounds.maxY = Math.max(current.bounds.maxY, point.y);
  }

  return chunks;
}
