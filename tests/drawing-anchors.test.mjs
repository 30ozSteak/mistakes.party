import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAWING_ANCHOR_SCHEMA_VERSION,
  PAGE_DRAWING_ANCHOR_ID,
  anchoredBoundsToDocumentBounds,
  anchoredPointToDocumentPoint,
  anchoredPointsToDocumentPoints,
  documentPointToAnchoredPoint,
  findDrawingAnchorAtPoint,
  normalizeDrawingRoute,
  normalizedBoundsFromPoints,
  resolveDrawingAnchor,
  splitDocumentPointsByAnchor,
  viewportPointToAnchoredPoint,
} from "../app/lib/drawingAnchors.ts";

class FakeElement {
  constructor(anchorId, rect, parentElement = null) {
    this.anchorId = anchorId;
    this.rect = rect;
    this.parentElement = parentElement;
  }

  getAttribute(name) {
    return name === "data-drawing-anchor" ? this.anchorId : null;
  }

  getBoundingClientRect() {
    return {
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
    };
  }
}

function fakeDocument({ anchors, hit, scrollX = 0, scrollY = 0 }) {
  return {
    defaultView: { scrollX, scrollY },
    documentElement: { scrollLeft: scrollX, scrollTop: scrollY },
    elementFromPoint(clientX, clientY) {
      return typeof hit === "function" ? hit(clientX, clientY) : hit;
    },
    querySelectorAll() {
      return anchors;
    },
  };
}

test("normalizes pathnames without splitting drawings by query or hash", () => {
  assert.equal(normalizeDrawingRoute(""), "/");
  assert.equal(normalizeDrawingRoute("work//lighthouse-checker///"), "/work/lighthouse-checker");
  assert.equal(
    normalizeDrawingRoute(" /blogs/example/?draft=1#notes "),
    "/blogs/example",
  );
  assert.equal(normalizeDrawingRoute("/#party=secret"), "/");
});

test("finds the nearest semantic anchor and falls back to the page root", () => {
  const pageRoot = new FakeElement(PAGE_DRAWING_ANCHOR_ID, {
    left: 0,
    top: 0,
    width: 1000,
    height: 2000,
  });
  const row = new FakeElement(
    "project:lighthouse-checker",
    { left: 50, top: 100, width: 600, height: 120 },
    pageRoot,
  );
  const rowChild = new FakeElement(null, {
    left: 60,
    top: 110,
    width: 300,
    height: 80,
  }, row);
  const unanchoredChild = new FakeElement(null, {
    left: 0,
    top: 400,
    width: 100,
    height: 100,
  });
  const drawingDocument = fakeDocument({
    anchors: [pageRoot, row],
    hit: rowChild,
  });

  assert.equal(findDrawingAnchorAtPoint(100, 150, drawingDocument), row);
  drawingDocument.elementFromPoint = () => unanchoredChild;
  assert.equal(
    findDrawingAnchorAtPoint(10, 450, drawingDocument),
    pageRoot,
  );
});

test("converts document points to normalized anchor coordinates and back after reflow", () => {
  const anchor = new FakeElement("home:hero", {
    left: 100,
    top: 50,
    width: 200,
    height: 400,
  });
  const child = new FakeElement(null, {
    left: 120,
    top: 80,
    width: 10,
    height: 10,
  }, anchor);
  const drawingDocument = fakeDocument({
    anchors: [anchor],
    hit: child,
    scrollX: 20,
    scrollY: 30,
  });

  const anchored = documentPointToAnchoredPoint(170, 280, drawingDocument);
  assert.deepEqual(anchored, {
    anchorSchemaVersion: DRAWING_ANCHOR_SCHEMA_VERSION,
    anchorId: "home:hero",
    x: 0.25,
    y: 0.5,
  });
  assert.deepEqual(viewportPointToAnchoredPoint(150, 250, drawingDocument), anchored);

  anchor.rect = { left: 10, top: 20, width: 400, height: 200 };
  assert.deepEqual(
    anchoredPointToDocumentPoint(anchored, drawingDocument),
    { x: 130, y: 150 },
  );
  assert.deepEqual(
    anchoredPointsToDocumentPoints(
      {
        anchorSchemaVersion: 1,
        anchorId: "home:hero",
        points: [0.25, 0.5, 1, 1],
      },
      drawingDocument,
    ),
    [130, 150, 430, 250],
  );
});

test("computes and renders normalized bounds", () => {
  assert.deepEqual(normalizedBoundsFromPoints([0.8, 0.1, 0.2, 0.9, 0.5, 0.4]), {
    minX: 0.2,
    minY: 0.1,
    maxX: 0.8,
    maxY: 0.9,
  });
  assert.equal(normalizedBoundsFromPoints([0.2, 0.3, 0.4]), null);
  assert.equal(normalizedBoundsFromPoints([-0.1, 0.3]), null);

  const anchor = new FakeElement("blogs:list", {
    left: 50,
    top: 100,
    width: 500,
    height: 800,
  });
  const drawingDocument = fakeDocument({
    anchors: [anchor],
    hit: anchor,
    scrollX: 10,
    scrollY: 25,
  });

  assert.deepEqual(
    anchoredBoundsToDocumentBounds(
      {
        anchorSchemaVersion: 1,
        anchorId: "blogs:list",
        bounds: { minX: 0.2, minY: 0.1, maxX: 0.8, maxY: 0.9 },
      },
      drawingDocument,
    ),
    { minX: 160, minY: 205, maxX: 460, maxY: 845 },
  );
});

test("splits a flat document path whenever its closest anchor changes", () => {
  const first = new FakeElement("project:first", {
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  });
  const second = new FakeElement("project:second", {
    left: 100,
    top: 0,
    width: 100,
    height: 100,
  });
  const drawingDocument = fakeDocument({
    anchors: [first, second],
    hit(clientX) {
      return clientX < 100 ? first : second;
    },
  });

  assert.deepEqual(
    splitDocumentPointsByAnchor(
      [10, 10, 20, 20, 110, 10, 150, 50, 20, 30],
      drawingDocument,
    ),
    [
      {
        anchorSchemaVersion: 1,
        anchorId: "project:first",
        points: [0.1, 0.1, 0.2, 0.2],
        bounds: { minX: 0.1, minY: 0.1, maxX: 0.2, maxY: 0.2 },
      },
      {
        anchorSchemaVersion: 1,
        anchorId: "project:second",
        points: [0.1, 0.1, 0.5, 0.5],
        bounds: { minX: 0.1, minY: 0.1, maxX: 0.5, maxY: 0.5 },
      },
      {
        anchorSchemaVersion: 1,
        anchorId: "project:first",
        points: [0.2, 0.3],
        bounds: { minX: 0.2, minY: 0.3, maxX: 0.2, maxY: 0.3 },
      },
    ],
  );
});

test("fails closed for missing, duplicated, malformed, or incompatible anchors", () => {
  const first = new FakeElement("home:hero", {
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  });
  const duplicate = new FakeElement("home:hero", {
    left: 100,
    top: 0,
    width: 100,
    height: 100,
  });
  const zeroSized = new FakeElement("home:empty", {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const drawingDocument = fakeDocument({
    anchors: [first, duplicate, zeroSized],
    hit: first,
  });

  assert.equal(resolveDrawingAnchor("home:hero", 1, drawingDocument), null);
  assert.equal(resolveDrawingAnchor("home:missing", 1, drawingDocument), null);
  assert.equal(resolveDrawingAnchor("home:empty", 2, drawingDocument), null);
  assert.equal(resolveDrawingAnchor("bad anchor", 1, drawingDocument), null);
  assert.equal(
    anchoredPointToDocumentPoint(
      { anchorSchemaVersion: 1, anchorId: "home:empty", x: 0.5, y: 0.5 },
      drawingDocument,
    ),
    null,
  );
  assert.equal(
    anchoredPointsToDocumentPoints(
      {
        anchorSchemaVersion: 2,
        anchorId: "home:empty",
        points: [0.5, 0.5],
      },
      drawingDocument,
    ),
    null,
  );
});

test("DOM helpers remain safe when imported in Node or rendered on the server", () => {
  assert.equal(resolveDrawingAnchor("page-root", 1), null);
  assert.equal(findDrawingAnchorAtPoint(10, 10), null);
  assert.equal(documentPointToAnchoredPoint(10, 10), null);
});
