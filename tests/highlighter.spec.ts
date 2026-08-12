import { expect, test, type Locator, type Page } from "@playwright/test";

const PREFERENCES_KEY = "mistakes-party.drawing.preferences.v1";
const DATABASE_NAME = "mistakes-party-drawing";
const STORE_NAME = "strokes";

type StoredStroke = {
  route?: unknown;
  color?: unknown;
  points?: unknown;
};

type InkStats = {
  pixels: number;
  centerX: number | null;
  centerY: number | null;
};

const playground = (page: Page) => page.getByTestId("drawing-playground");
const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const toggle = (page: Page) => page.getByTestId("drawing-toggle");
const clear = (page: Page) => page.getByTestId("drawing-clear");
const color = (page: Page, name: "acid" | "pink" | "cyan" | "orange") =>
  page.getByTestId(`drawing-color-${name}`);

function normalizedRoute(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

async function openHome(page: Page) {
  await page.goto("/");
  await expect(playground(page)).toBeAttached();
  await expect(playground(page)).toHaveAttribute("data-hydrated", "true");
  await expect(canvas(page)).toBeVisible();
  await expect(toggle(page)).toBeVisible();
}

async function inkStats(page: Page): Promise<InkStats> {
  return canvas(page).evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error("drawing-canvas is not a canvas element");
    }

    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context || element.width === 0 || element.height === 0) {
      return { pixels: 0, centerX: null, centerY: null };
    }

    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    let minX = element.width;
    let minY = element.height;
    let maxX = -1;
    let maxY = -1;

    // Sampling every other backing-store pixel keeps this cheap while still
    // detecting a 32px stroke reliably at any supported device-pixel ratio.
    for (let y = 0; y < element.height; y += 2) {
      for (let x = 0; x < element.width; x += 2) {
        if (pixels[(y * element.width + x) * 4 + 3] === 0) continue;
        count += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (count === 0) return { pixels: 0, centerX: null, centerY: null };

    const scaleX = element.clientWidth ? element.width / element.clientWidth : 1;
    const scaleY = element.clientHeight ? element.height / element.clientHeight : 1;
    return {
      pixels: count,
      centerX: (minX + maxX) / 2 / scaleX,
      centerY: (minY + maxY) / 2 / scaleY,
    };
  });
}

async function expectBlank(page: Page) {
  await expect.poll(async () => (await inkStats(page)).pixels).toBe(0);
}

async function expectInk(page: Page) {
  await expect.poll(async () => (await inkStats(page)).pixels).toBeGreaterThan(0);
}

async function drawLine(
  page: Page,
  from: { x: number; y: number } = { x: 280, y: 360 },
  to: { x: number; y: number } = { x: 560, y: 420 },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.move(to.x, to.y, { steps: 24 });
  // The idle boundary closes the current stroke and schedules persistence.
  await page.waitForTimeout(220);
}

async function isSelected(control: Locator) {
  return control.evaluate((element) => {
    if (element instanceof HTMLInputElement) return element.checked;
    return element.getAttribute("aria-checked") === "true";
  });
}

async function storedStrokes(page: Page): Promise<StoredStroke[]> {
  return page.evaluate(
    async ({ databaseName, storeName }) => {
      if (typeof indexedDB.databases === "function") {
        const databases = await indexedDB.databases();
        if (!databases.some(({ name }) => name === databaseName)) return [];
      }

      return new Promise<StoredStroke[]>((resolve) => {
        const request = indexedDB.open(databaseName);
        request.onerror = () => resolve([]);
        request.onupgradeneeded = () => {
          request.transaction?.abort();
          resolve([]);
        };
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(storeName)) {
            database.close();
            resolve([]);
            return;
          }

          const transaction = database.transaction(storeName, "readonly");
          const getAll = transaction.objectStore(storeName).getAll();
          getAll.onerror = () => {
            database.close();
            resolve([]);
          };
          getAll.onsuccess = () => {
            const records = Array.isArray(getAll.result) ? getAll.result : [];
            database.close();
            resolve(records as StoredStroke[]);
          };
        };
      });
    },
    { databaseName: DATABASE_NAME, storeName: STORE_NAME },
  );
}

async function routeStrokes(page: Page, pathname: string) {
  const route = normalizedRoute(pathname);
  return (await storedStrokes(page)).filter(
    (stroke) =>
      typeof stroke.route === "string" && normalizedRoute(stroke.route) === route,
  );
}

test("defaults off, then paints from button-free mouse movement", async ({
  page,
}) => {
  await openHome(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");

  await drawLine(page);
  await expectBlank(page);

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await drawLine(page);
  await expectInk(page);
});

test("restores the selected color, preferences, and artwork after reload", async ({
  page,
}) => {
  await openHome(page);
  await toggle(page).click();
  await color(page, "acid").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => isSelected(color(page, "cyan"))).toBe(true);

  await drawLine(page);
  await expectInk(page);
  await expect
    .poll(async () => (await routeStrokes(page, "/")).length)
    .toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const records = await routeStrokes(page, "/");
      return records.some(
        ({ color: storedColor }) =>
          typeof storedColor === "string" &&
          storedColor.toLowerCase() === "#00e5ff",
      );
    })
    .toBe(true);

  const preferences = await page.evaluate((key) => localStorage.getItem(key), PREFERENCES_KEY);
  expect(preferences).not.toBeNull();
  expect(JSON.parse(preferences ?? "{}")).toMatchObject({
    version: 1,
    enabled: true,
    color: "#00e5ff",
  });

  await page.reload();
  await expect(playground(page)).toBeAttached();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => isSelected(color(page, "cyan"))).toBe(true);
  await expectInk(page);
});

test("passes clicks through and keeps drawings separate for each route", async ({
  page,
}) => {
  await openHome(page);
  await toggle(page).click();
  await drawLine(page, { x: 240, y: 300 }, { x: 520, y: 340 });
  await expect
    .poll(async () => (await routeStrokes(page, "/")).length)
    .toBeGreaterThan(0);

  await page.getByRole("link", { name: "THIS INDEX", exact: true }).click();
  await expect(page).toHaveURL(/\/work\/mistakes-party\/?$/);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expectBlank(page);

  const projectPath = new URL(page.url()).pathname;
  await drawLine(page, { x: 260, y: 360 }, { x: 580, y: 400 });
  await expectInk(page);
  await expect
    .poll(async () => (await routeStrokes(page, projectPath)).length)
    .toBeGreaterThan(0);

  await clear(page).click();
  await expect(clear(page)).toHaveText("SURE?");
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(clear(page)).toHaveText("CLEAR");
  await expectInk(page);
  expect(await routeStrokes(page, "/")).not.toHaveLength(0);
  expect(await routeStrokes(page, projectPath)).not.toHaveLength(0);
});

test("Clear requires confirmation, erases only the route, and disables drawing", async ({
  page,
}) => {
  await openHome(page);
  await toggle(page).click();
  await drawLine(page);
  await expectInk(page);
  await expect
    .poll(async () => (await routeStrokes(page, "/")).length)
    .toBeGreaterThan(0);

  await clear(page).click();
  await expectInk(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");

  await clear(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expectBlank(page);
  await expect.poll(async () => (await routeStrokes(page, "/")).length).toBe(0);

  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expectBlank(page);
});

test("ignores touch pointer movement while drawing is enabled", async ({ page }) => {
  await openHome(page);
  await toggle(page).click();
  await expectBlank(page);

  await page.evaluate(() => {
    for (let index = 0; index < 16; index += 1) {
      const target = document.elementFromPoint(280 + index * 16, 340) ?? document.body;
      target.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 41,
          pointerType: "touch",
          clientX: 280 + index * 16,
          clientY: 340,
          isPrimary: true,
        }),
      );
    }
  });
  await page.waitForTimeout(220);

  await expectBlank(page);
  expect(await routeStrokes(page, "/")).toHaveLength(0);
});

test("malformed preferences fail safely to first-run defaults", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.addInitScript(
    ({ key }) => localStorage.setItem(key, "{ definitely-not-json"),
    { key: PREFERENCES_KEY },
  );

  await openHome(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => isSelected(color(page, "acid"))).toBe(true);
  await expectBlank(page);
  expect(pageErrors).toEqual([]);

  await page.evaluate(async ({ databaseName, key }) => {
    localStorage.removeItem(key);
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
      request.onsuccess = () => resolve();
    });
  }, { databaseName: DATABASE_NAME, key: PREFERENCES_KEY });
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => isSelected(color(page, "acid"))).toBe(true);
  await expectBlank(page);
});

test("skips malformed IndexedDB strokes without deleting stored data", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await openHome(page);

  await page.evaluate(
    async ({ databaseName, storeName }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(storeName, "readwrite");
          transaction.objectStore(storeName).put({
            version: 1,
            id: "malformed-stroke",
            route: "/",
            color: "#dfff00",
            width: 32,
            opacity: 0.45,
            createdAt: Date.now(),
            points: ["not-a-number", 100],
            bounds: { minX: 100, minY: 100, maxX: 100, maxY: 100 },
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        };
      }),
    { databaseName: DATABASE_NAME, storeName: STORE_NAME },
  );

  await page.reload();
  await expect(playground(page)).toHaveAttribute("data-hydrated", "true");
  await expectBlank(page);
  expect(
    (await storedStrokes(page)).some(
      ({ route, points }) =>
        route === "/" && Array.isArray(points) && points[0] === "not-a-number",
    ),
  ).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("reports preference storage failures while drawing remains usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    };
  });

  await openHome(page);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("NOT SAVING", { exact: true })).toBeVisible();
  await drawLine(page);
  await expectInk(page);
});

test("redraws retained artwork after scrolling and resizing", async ({ page }) => {
  await openHome(page);
  await toggle(page).click();
  await drawLine(page, { x: 260, y: 500 }, { x: 620, y: 500 });
  await expectInk(page);

  const beforeScroll = await inkStats(page);
  expect(beforeScroll.centerY).not.toBeNull();

  await page.evaluate(() => window.scrollTo(0, 160));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await expect
    .poll(async () => (await inkStats(page)).centerY ?? Number.POSITIVE_INFINITY)
    .toBeLessThan((beforeScroll.centerY ?? 0) - 80);

  await page.setViewportSize({ width: 1024, height: 650 });
  await expectInk(page);
  const afterResize = await inkStats(page);
  expect(afterResize.centerX).not.toBeNull();
  expect(afterResize.centerY).not.toBeNull();
});
