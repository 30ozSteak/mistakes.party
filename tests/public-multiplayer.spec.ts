import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

type Point = { x: number; y: number };
type Region = Point & { width: number; height: number };
type RecordedSocket = { url: string; sent: string[]; received: string[] };

const SCOPE_KEY = "mistakes-party.drawing.scope.v1";
const PREFERENCES_KEY = "mistakes-party.drawing.preferences.v1";
const PUBLIC_SESSION_KEY = "mistakes-party.drawing.public-session.v1";
const DATABASE_NAME = "mistakes-party-drawing";
const STORE_NAME = "strokes";
const RUN_ID = `${Date.now().toString(36)}-${process.pid.toString(36)}`;

const root = (page: Page) => page.getByTestId("drawing-playground");
const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const toggle = (page: Page) => page.getByTestId("drawing-toggle");
const sessionCount = (page: Page) => page.getByTestId("drawing-session-count");
const menuToggle = (page: Page) => page.getByTestId("drawing-menu-toggle");

const FIRST_REGION: Region = { x: 120, y: 185, width: 340, height: 105 };
const SECOND_REGION: Region = { x: 120, y: 335, width: 340, height: 105 };

function isolatedRoute(testInfo: TestInfo, suffix = "page") {
  const title = testInfo.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `/__public-e2e/${RUN_ID}-${testInfo.retry}-${title}-${suffix}`;
}

async function installSocketRecorder(context: BrowserContext) {
  await context.addInitScript(() => {
    const scope = window as typeof window & {
      __publicSockets?: RecordedSocket[];
      __publicSocketInstances?: WebSocket[];
    };
    const NativeWebSocket = window.WebSocket;
    scope.__publicSockets = [];
    scope.__publicSocketInstances = [];
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, argumentsList) {
        const socket = Reflect.construct(target, argumentsList) as WebSocket;
        const record: RecordedSocket = {
          url: String(argumentsList[0]),
          sent: [],
          received: [],
        };
        scope.__publicSockets?.push(record);
        scope.__publicSocketInstances?.push(socket);
        const nativeSend = socket.send.bind(socket);
        Object.defineProperty(socket, "send", {
          configurable: true,
          value(value: string | ArrayBufferLike | Blob | ArrayBufferView) {
            if (typeof value === "string") record.sent.push(value);
            return nativeSend(value);
          },
        });
        socket.addEventListener("message", (event) => {
          if (typeof event.data === "string") record.received.push(event.data);
        });
        return socket;
      },
    });
  });
}

async function newPage(
  browser: Browser,
  baseURL: string | undefined,
  contexts: BrowserContext[],
  options: Parameters<Browser["newContext"]>[0] = {},
) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1_100, height: 760 },
    ...options,
  });
  contexts.push(context);
  await installSocketRecorder(context);
  return context.newPage();
}

async function openPublic(page: Page, pathname: string) {
  await page.goto(pathname);
  await expect(root(page)).toBeAttached();
  await expect(root(page)).toHaveAttribute("data-hydrated", "true");
  await expect(root(page)).toHaveAttribute("data-scope", "public");
  await expect(root(page)).toHaveAttribute(
    "data-public-state",
    /^(ambient|watching|offline)$/,
  );
  await expect(canvas(page)).toBeVisible();
  await expect(sessionCount(page)).toBeVisible();
}

async function openMenu(page: Page) {
  if ((await menuToggle(page).getAttribute("aria-expanded")) !== "true") {
    await menuToggle(page).click();
  }
  await expect(menuToggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("drawing-companion-menu")).toBeVisible();
}

async function joinAsDrawer(page: Page, withKeyboard = false) {
  if (withKeyboard) await page.keyboard.press("p");
  else await toggle(page).click();
  await expect(root(page)).toHaveAttribute("data-public-state", "drawing", {
    timeout: 15_000,
  });
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
}

async function drawLine(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.waitForTimeout(240);
}

async function inkPixels(page: Page, region?: Region) {
  return canvas(page).evaluate((element, requestedRegion) => {
    if (!(element instanceof HTMLCanvasElement)) return 0;
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context || element.width === 0 || element.height === 0) return 0;
    const scaleX = element.clientWidth ? element.width / element.clientWidth : 1;
    const scaleY = element.clientHeight ? element.height / element.clientHeight : 1;
    const source = requestedRegion ?? {
      x: 0,
      y: 0,
      width: element.clientWidth,
      height: element.clientHeight,
    };
    const x = Math.max(0, Math.floor(source.x * scaleX));
    const y = Math.max(0, Math.floor(source.y * scaleY));
    const width = Math.min(
      element.width - x,
      Math.max(1, Math.ceil(source.width * scaleX)),
    );
    const height = Math.min(
      element.height - y,
      Math.max(1, Math.ceil(source.height * scaleY)),
    );
    if (width <= 0 || height <= 0) return 0;
    const pixels = context.getImageData(x, y, width, height).data;
    let count = 0;
    for (let index = 3; index < pixels.length; index += 16) {
      if (pixels[index] > 0) count += 1;
    }
    return count;
  }, region);
}

async function expectInk(page: Page, region?: Region) {
  await expect.poll(() => inkPixels(page, region)).toBeGreaterThan(0);
}

async function expectNoInk(page: Page, region?: Region) {
  await expect.poll(() => inkPixels(page, region)).toBe(0);
}

async function publicOutgoingTypes(page: Page) {
  return page.evaluate(() => {
    const scope = window as typeof window & {
      __publicSockets?: RecordedSocket[];
    };
    return (scope.__publicSockets ?? [])
      .filter(({ url }) => url.includes("/v2/public/"))
      .flatMap(({ sent }) => sent)
      .flatMap((value) => {
        try {
          const message = JSON.parse(value) as { type?: unknown };
          return typeof message.type === "string" ? [message.type] : [];
        } catch {
          return [];
        }
      });
  });
}

async function publicPodIds(page: Page) {
  return page.evaluate(() => {
    const scope = window as typeof window & {
      __publicSockets?: RecordedSocket[];
    };
    return (scope.__publicSockets ?? [])
      .map(({ url }) => new URL(url))
      .filter(({ pathname }) => pathname.startsWith("/v2/public/pods/"))
      .map(({ pathname }) =>
        decodeURIComponent(pathname.slice("/v2/public/pods/".length)),
      );
  });
}

async function publicPodRoutes(page: Page) {
  return page.evaluate(() => {
    const scope = window as typeof window & {
      __publicSockets?: RecordedSocket[];
    };
    return (scope.__publicSockets ?? [])
      .map(({ url }) => new URL(url))
      .filter(({ pathname }) => pathname.startsWith("/v2/public/pods/"))
      .map((url) => url.searchParams.get("route"));
  });
}

async function latestOpenPublicPodSocket(page: Page) {
  return page.evaluateHandle(() => {
    const scope = window as typeof window & {
      __publicSocketInstances?: WebSocket[];
    };
    const socket = [...(scope.__publicSocketInstances ?? [])]
      .reverse()
      .find(
        (candidate) =>
          candidate.url.includes("/v2/public/pods/") &&
          candidate.readyState === WebSocket.OPEN,
      );
    if (!socket) throw new Error("No open public pod socket was recorded");
    return socket;
  });
}

async function closeContexts(contexts: BrowserContext[]) {
  await Promise.allSettled(
    contexts.flatMap((context) =>
      context.pages().map((page) =>
        page.evaluate(() => {
          const scope = window as typeof window & {
            __publicSocketInstances?: WebSocket[];
          };
          for (const socket of scope.__publicSocketInstances ?? []) {
            if (
              socket.readyState === WebSocket.OPEN ||
              socket.readyState === WebSocket.CONNECTING
            ) {
              socket.close(1000, "Playwright cleanup");
            }
          }
        }),
      ),
    ),
  );
  await Promise.allSettled(contexts.map((context) => context.close()));
}

async function storedSoloStrokeCount(page: Page) {
  return page.evaluate(
    async ({ databaseName, storeName }) => {
      if (typeof indexedDB.databases === "function") {
        const databases = await indexedDB.databases();
        if (!databases.some(({ name }) => name === databaseName)) return 0;
      }
      return new Promise<number>((resolve) => {
        const request = indexedDB.open(databaseName);
        request.onerror = () => resolve(0);
        request.onupgradeneeded = () => {
          request.transaction?.abort();
          resolve(0);
        };
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(storeName)) {
            database.close();
            resolve(0);
            return;
          }
          const transaction = database.transaction(storeName, "readonly");
          const count = transaction.objectStore(storeName).count();
          count.onerror = () => {
            database.close();
            resolve(0);
          };
          count.onsuccess = () => {
            database.close();
            resolve(count.result);
          };
        };
      });
    },
    { databaseName: DATABASE_NAME, storeName: STORE_NAME },
  );
}

test("counts ambient sessions, emits no spectator movement, and does not reveal ink before opting in", async ({
  baseURL,
  browser,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const route = isolatedRoute(testInfo);
    const drawer = await newPage(browser, baseURL, contexts);
    const spectator = await newPage(browser, baseURL, contexts);

    await openPublic(drawer, route);
    await openPublic(spectator, route);
    await expect(sessionCount(drawer)).toContainText("2");
    await expect(sessionCount(spectator)).toContainText("2");

    await drawLine(spectator, { x: 140, y: 230 }, { x: 420, y: 230 });
    expect(await publicOutgoingTypes(spectator)).not.toEqual(
      expect.arrayContaining([
        "cursor:move",
        "stroke:start",
        "stroke:append",
        "stroke:end",
      ]),
    );
    await expectNoInk(spectator);

    await joinAsDrawer(drawer);
    await drawLine(drawer, { x: 150, y: 230 }, { x: 430, y: 230 });
    await expect(drawer.getByTestId("public-nudge")).toHaveCount(0);
    await expect(spectator.getByTestId("public-remote-cursor")).toBeVisible();
    await expectNoInk(spectator);
    expect(await publicOutgoingTypes(spectator)).not.toEqual(
      expect.arrayContaining(["cursor:move", "stroke:start", "stroke:append"]),
    );

    await expect(spectator.getByTestId("public-nudge")).toBeVisible();
    const dismissHitTarget = await spectator
      .getByTestId("public-nudge-dismiss")
      .evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const x = bounds.left + bounds.width / 2;
        const y = bounds.top + bounds.height / 2;
        return {
          bounds: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          },
          stack: document.elementsFromPoint(x, y).map((candidate) => ({
            tag: candidate.tagName.toLowerCase(),
            className:
              typeof candidate.className === "string" ? candidate.className : "",
            testId: candidate.getAttribute("data-testid"),
          })),
        };
      });
    expect(
      dismissHitTarget.stack[0]?.testId,
      JSON.stringify(dismissHitTarget),
    ).toBe("public-nudge-dismiss");
    await spectator.getByTestId("public-nudge-dismiss").click();
    await expect(spectator.getByTestId("public-nudge")).toHaveCount(0);
    expect(
      await spectator.evaluate(() =>
        localStorage.getItem("mistakes-party.drawing.public-nudge.v1"),
      ),
    ).toBe("dismissed");
    await drawer.getByTestId("public-leave").click();
    await expect(root(drawer)).toHaveAttribute("data-public-state", "ambient");
  } finally {
    await closeContexts(contexts);
  }
});

test("P joins and pauses without opening the menu while the balloon joins and opens it", async ({
  baseURL,
  browser,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const keyboardPage = await newPage(browser, baseURL, contexts);
    await openPublic(keyboardPage, isolatedRoute(testInfo, "keyboard"));
    await expect(toggle(keyboardPage)).toHaveAttribute("aria-keyshortcuts", "P");
    await joinAsDrawer(keyboardPage, true);
    await expect(menuToggle(keyboardPage)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await keyboardPage.keyboard.press("p");
    await expect(root(keyboardPage)).toHaveAttribute("data-public-state", "paused");
    await expect(toggle(keyboardPage)).toHaveAttribute("aria-pressed", "false");

    await keyboardPage.keyboard.press("p");
    await expect(root(keyboardPage)).toHaveAttribute("data-public-state", "drawing");
    await keyboardPage.keyboard.press("Escape");
    await expect(root(keyboardPage)).toHaveAttribute("data-public-state", "paused");

    const balloonPage = await newPage(browser, baseURL, contexts);
    await openPublic(balloonPage, isolatedRoute(testInfo, "balloon"));
    await joinAsDrawer(balloonPage);
    await expect(menuToggle(balloonPage)).toHaveAttribute("aria-expanded", "true");
  } finally {
    await closeContexts(contexts);
  }
});

test("guards keyboard shortcuts in editable and modal states, while Escape always pauses", async ({
  page,
}, testInfo) => {
  await installSocketRecorder(page.context());
  await openPublic(page, isolatedRoute(testInfo));

  await page.evaluate(() => {
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Public shortcut input");
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press("p");
  await expect(page.getByRole("textbox", { name: "Public shortcut input" })).toHaveValue("p");
  await expect(root(page)).toHaveAttribute("data-public-state", "ambient");

  await page.evaluate(() => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.setAttribute("role", "textbox");
    editable.setAttribute("aria-label", "Public editable shortcut");
    document.body.append(editable);
    editable.focus();
  });
  await page.keyboard.press("p");
  await expect(root(page)).toHaveAttribute("data-public-state", "ambient");

  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  for (const init of [
    { key: "p", ctrlKey: true },
    { key: "p", altKey: true },
    { key: "p", metaKey: true },
    { key: "p", repeat: true },
    { key: "p", isComposing: true },
  ]) {
    await page.evaluate((eventInit) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...eventInit }),
      );
    }, init);
  }
  await expect(root(page)).toHaveAttribute("data-public-state", "ambient");

  const menu = page.getByRole("button", { name: "Open primary navigation" });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("p");
    await expect(root(page)).toHaveAttribute("data-public-state", "ambient");
    await menu.click();
  }

  await joinAsDrawer(page);
  await openMenu(page);
  await page.keyboard.press("Escape");
  await expect(root(page)).toHaveAttribute("data-public-state", "paused");
  await expect(menuToggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
});

test("keeps controls usable at 320px and visible in forced colors", async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL,
    forcedColors: "active",
    viewport: { width: 320, height: 640 },
  });
  await installSocketRecorder(context);
  const page = await context.newPage();
  try {
    await openPublic(page, isolatedRoute(testInfo));
    await openMenu(page);
    const menuBox = await page.getByTestId("drawing-companion-menu").boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(320);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(640);

    for (const control of [
      toggle(page),
    ]) {
      const box = await control.boundingBox();
      const controlName =
        (await control.getAttribute("data-testid")) ?? "drawing control";
      expect(
        box,
        controlName,
      ).not.toBeNull();
      expect(Math.round(box!.width), `${controlName} width`).toBeGreaterThanOrEqual(44);
      expect(Math.round(box!.height), `${controlName} height`).toBeGreaterThanOrEqual(44);
    }

    for (const control of [
      menuToggle(page),
      page.getByTestId("drawing-color-acid"),
      page.getByTestId("drawing-scope-public"),
      page.getByTestId("drawing-scope-solo"),
      page.getByTestId("party-start"),
    ]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      const controlName =
        (await control.getAttribute("data-testid")) ?? "drawing control";
      expect(
        box,
        controlName,
      ).not.toBeNull();
      expect(Math.round(box!.width), `${controlName} width`).toBeGreaterThanOrEqual(44);
      expect(Math.round(box!.height), `${controlName} height`).toBeGreaterThanOrEqual(44);
    }

    await toggle(page).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(toggle(page)).toBeFocused();
    expect(await toggle(page).evaluate((element) => getComputedStyle(element).outlineStyle))
      .not.toBe("none");
    await expect(sessionCount(page)).toBeVisible();
    await expect(sessionCount(page)).not.toHaveCSS("forced-color-adjust", "auto");
  } finally {
    await closeContexts([context]);
  }
});

test("hides animated public cursors for reduced motion", async ({
  baseURL,
  browser,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const route = isolatedRoute(testInfo);
    const drawer = await newPage(browser, baseURL, contexts);
    const context = await browser.newContext({
      baseURL,
      reducedMotion: "reduce",
      viewport: { width: 1_100, height: 760 },
    });
    contexts.push(context);
    await installSocketRecorder(context);
    const spectator = await context.newPage();
    await openPublic(drawer, route);
    await openPublic(spectator, route);
    await joinAsDrawer(drawer);
    await drawer.mouse.move(180, 260);
    await drawer.mouse.move(400, 260, { steps: 10 });
    await expect(spectator.getByTestId("public-remote-cursor")).toBeAttached();
    await expect(spectator.getByTestId("public-remote-cursor")).toHaveCSS(
      "display",
      "none",
    );
  } finally {
    await closeContexts(contexts);
  }
});

test("a stylus first movement promotes a watcher without drawing that trigger point", async ({
  page,
}, testInfo) => {
  await installSocketRecorder(page.context());
  await openPublic(page, isolatedRoute(testInfo));
  await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("[data-testid='drawing-toggle']")!
      .getBoundingClientRect();
    document.elementFromPoint(box.x + 4, box.y + 4)?.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 77,
        pointerType: "touch",
        clientX: box.x + 4,
        clientY: box.y + 4,
      }),
    );
  });
  await toggle(page).click();
  await expect(root(page)).toHaveAttribute("data-public-state", "drawing", {
    timeout: 15_000,
  });
  await page.keyboard.press("p");
  await expect(root(page)).toHaveAttribute("data-public-state", "paused");

  await page.evaluate(() => {
    const target = document.elementFromPoint(250, 300) ?? document.body;
    target.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: 250,
        clientY: 300,
        isPrimary: true,
        pointerId: 88,
        pointerType: "pen",
      }),
    );
  });
  await expect(root(page)).toHaveAttribute("data-public-state", "drawing", {
    timeout: 15_000,
  });
  await expectNoInk(page);
});

test("places five drawers into a full four-seat pod and a second pod", async ({
  baseURL,
  browser,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const route = isolatedRoute(testInfo);
    const pages: Page[] = [];
    for (let index = 0; index < 5; index += 1) {
      const page = await newPage(browser, baseURL, contexts);
      pages.push(page);
      await openPublic(page, route);
    }
    await expect(sessionCount(pages[0])).toContainText("5");

    await Promise.all(pages.map((page) => joinAsDrawer(page)));
    const podIds = await Promise.all(
      pages.map(async (page) => (await publicPodIds(page)).at(-1)),
    );
    expect(podIds.every(Boolean)).toBe(true);
    const occupancy = [...new Set(podIds)].map(
      (podId) => podIds.filter((candidate) => candidate === podId).length,
    );
    expect(occupancy.sort((left, right) => left - right)).toEqual([1, 4]);
    const pagesByPod = new Map<string, Page[]>();
    for (const [index, podId] of podIds.entries()) {
      const members = pagesByPod.get(podId!) ?? [];
      members.push(pages[index]);
      pagesByPod.set(podId!, members);
    }
    const fullPodPage = [...pagesByPod.values()].find(
      (members) => members.length === 4,
    )?.[0];
    const singletonPodPage = [...pagesByPod.values()].find(
      (members) => members.length === 1,
    )?.[0];
    expect(fullPodPage).toBeDefined();
    expect(singletonPodPage).toBeDefined();
    await expect(fullPodPage!.getByTestId(/^public-drawer-/)).toHaveCount(4);
    await expect(singletonPodPage!.getByTestId(/^public-drawer-/)).toHaveCount(1);
  } finally {
    await closeContexts(contexts);
  }
});

test("counts outstanding grants atomically before pod sockets consume them", async ({
  context,
  page,
}, testInfo) => {
  const route = isolatedRoute(testInfo);
  await installSocketRecorder(context);
  await openPublic(page, route);

  const assignments = await page.evaluate(async (matchRoute) => {
    const scope = window as typeof window & {
      __publicSockets?: RecordedSocket[];
    };
    const presenceUrl = scope.__publicSockets
      ?.map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === "/v2/public/presence");
    if (!presenceUrl) throw new Error("Public presence socket was not recorded");

    const sockets: WebSocket[] = [];
    try {
      return await Promise.all(
        Array.from({ length: 5 }, () =>
          new Promise<string>((resolve, reject) => {
            const url = new URL("/v2/public/presence", presenceUrl.origin);
            url.searchParams.set("route", `${matchRoute}/grants`);
            const socket = new WebSocket(url, "mistakes-party-drawing-v2");
            sockets.push(socket);
            const timer = window.setTimeout(
              () => reject(new Error("Timed out waiting for a pod grant")),
              10_000,
            );
            socket.addEventListener("message", (event) => {
              if (typeof event.data !== "string") return;
              const message = JSON.parse(event.data) as {
                type?: string;
                assignment?: { podId?: string };
              };
              if (message.type === "presence:welcome") {
                socket.send(
                  JSON.stringify({ type: "match:request", role: "drawer" }),
                );
              } else if (
                message.type === "match:assignment" &&
                typeof message.assignment?.podId === "string"
              ) {
                window.clearTimeout(timer);
                resolve(message.assignment.podId);
              } else if (message.type === "error") {
                window.clearTimeout(timer);
                reject(new Error("Match request was rejected"));
              }
            });
            socket.addEventListener("error", () => {
              window.clearTimeout(timer);
              reject(new Error("Presence socket failed"));
            });
          }),
        ),
      );
    } finally {
      for (const socket of sockets) socket.close(1000, "Grant test complete");
    }
  }, route);

  const occupancy = [...new Set(assignments)].map(
    (podId) => assignments.filter((candidate) => candidate === podId).length,
  );
  expect(occupancy.sort((left, right) => left - right)).toEqual([1, 4]);
});

test("mutes a drawer locally and Clear My Marks removes only that author's ink", async ({
  baseURL,
  browser,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const route = isolatedRoute(testInfo);
    const first = await newPage(browser, baseURL, contexts);
    const second = await newPage(browser, baseURL, contexts);
    await openPublic(first, route);
    await openPublic(second, route);
    await joinAsDrawer(first);
    await joinAsDrawer(second);

    await drawLine(first, { x: 145, y: 230 }, { x: 425, y: 230 });
    await expectInk(second, FIRST_REGION);
    const mute = second.getByTestId(/^public-mute-/).first();
    await expect(mute).toBeVisible();
    await mute.click();
    await expectNoInk(second, FIRST_REGION);
    await expectInk(first, FIRST_REGION);
    await mute.click();
    await expectInk(second, FIRST_REGION);

    await drawLine(second, { x: 145, y: 380 }, { x: 425, y: 380 });
    await expectInk(first, SECOND_REGION);
    await first.getByTestId("public-clear-mine").click();
    await expect(first.getByTestId("public-clear-mine")).toHaveText("SURE?");
    await first.getByTestId("public-clear-mine").click();
    await expectNoInk(first, FIRST_REGION);
    await expectNoInk(second, FIRST_REGION);
    await expectInk(first, SECOND_REGION);
    await expectInk(second, SECOND_REGION);
  } finally {
    await closeContexts(contexts);
  }
});

test("rejects sequence gaps and ignores duplicate stroke appends", async ({
  baseURL,
  browser,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const route = isolatedRoute(testInfo);
    const drawer = await newPage(browser, baseURL, contexts);
    const observer = await newPage(browser, baseURL, contexts);
    await openPublic(drawer, route);
    await openPublic(observer, route);
    await joinAsDrawer(drawer);
    await joinAsDrawer(observer);
    const socket = await latestOpenPublicPodSocket(drawer);
    const identity = await drawer.evaluate((key) =>
      JSON.parse(sessionStorage.getItem(key) ?? "null") as { id: string },
    PUBLIC_SESSION_KEY);
    const welcome = await drawer.evaluate(() => {
      const scope = window as typeof window & { __publicSockets?: RecordedSocket[] };
      return (scope.__publicSockets ?? [])
        .filter(({ url }) => url.includes("/v2/public/pods/"))
        .flatMap(({ received }) => received)
        .map((value) => JSON.parse(value) as Record<string, unknown>)
        .find(({ type }) => type === "pod:welcome") as {
        epoch: number;
        selfAuthorGeneration: number;
      };
    });
    const strokeId = `raw_${Date.now().toString(36)}`;
    const bounds = { minX: 0.2, minY: 0.2, maxX: 0.4, maxY: 0.4 };
    const send = async (message: object) => {
      await socket.evaluate((activeSocket, payload) => {
        activeSocket.send(JSON.stringify(payload));
      }, message);
    };

    await send({
      type: "stroke:start",
      stroke: {
        version: 2,
        id: strokeId,
        route,
        color: "#dfff00",
        width: 32,
        opacity: 0.45,
        createdAt: Date.now(),
        anchorSchemaVersion: 1,
        anchorId: "page-root",
        points: [0.2, 0.2],
        bounds: { minX: 0.2, minY: 0.2, maxX: 0.2, maxY: 0.2 },
        sequence: 0,
        epoch: welcome.epoch,
        authorGeneration: welcome.selfAuthorGeneration,
      },
    });
    const append = {
      type: "stroke:append",
      strokeId,
      anchorId: "page-root",
      anchorSchemaVersion: 1,
      sequence: 1,
      points: [0.4, 0.4],
      bounds,
      epoch: welcome.epoch,
      authorGeneration: welcome.selfAuthorGeneration,
    };
    await send(append);
    await send(append);
    await expect
      .poll(async () => {
        return observer.evaluate(
          ({ id, targetStroke }) => {
            const scope = window as typeof window & { __publicSockets?: RecordedSocket[] };
            return (scope.__publicSockets ?? [])
              .flatMap(({ received }) => received)
              .map((value) => JSON.parse(value) as {
                type?: string;
                authorId?: string;
                strokeId?: string;
                sequence?: number;
              })
              .filter(
                (message) =>
                  message.type === "stroke:append" &&
                  message.authorId === id &&
                  message.strokeId === targetStroke &&
                  message.sequence === 1,
              ).length;
          },
          { id: identity.id, targetStroke: strokeId },
        );
      })
      .toBe(1);

    await send({ ...append, sequence: 3 });
    await expect
      .poll(async () =>
        drawer.evaluate(() => {
          const scope = window as typeof window & { __publicSockets?: RecordedSocket[] };
          return (scope.__publicSockets ?? [])
            .flatMap(({ received }) => received)
            .map((value) => JSON.parse(value) as { type?: string; code?: string })
            .some(
              ({ type, code }) => type === "error" && code === "SEQUENCE_GAP",
            );
        }),
      )
      .toBe(true);
  } finally {
    await closeContexts(contexts);
  }
});

test("fences pre-clear author generations and lifecycle cancellation is authoritative", async ({
  baseURL,
  browser,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const route = isolatedRoute(testInfo);
    const drawer = await newPage(browser, baseURL, contexts);
    const watcher = await newPage(browser, baseURL, contexts, {
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    await openPublic(drawer, route);
    await openPublic(watcher, route);
    await joinAsDrawer(drawer);
    const watcherBox = await toggle(watcher).boundingBox();
    await watcher.touchscreen.tap(
      watcherBox!.x + watcherBox!.width / 2,
      watcherBox!.y + watcherBox!.height / 2,
    );
    await expect(root(watcher)).toHaveAttribute("data-public-state", "watching");
    const socket = await latestOpenPublicPodSocket(drawer);
    const welcome = await drawer.evaluate(() => {
      const scope = window as typeof window & { __publicSockets?: RecordedSocket[] };
      return (scope.__publicSockets ?? [])
        .flatMap(({ received }) => received)
        .map((value) => JSON.parse(value) as Record<string, unknown>)
        .find(({ type }) => type === "pod:welcome") as {
        epoch: number;
        selfAuthorGeneration: number;
      };
    });
    await socket.evaluate((activeSocket) =>
      activeSocket.send(JSON.stringify({ type: "clear:mine" })),
    );
    await expect
      .poll(async () =>
        drawer.evaluate(() => {
          const scope = window as typeof window & { __publicSockets?: RecordedSocket[] };
          return (scope.__publicSockets ?? [])
            .flatMap(({ received }) => received)
            .map((value) => JSON.parse(value) as { type?: string })
            .some(({ type }) => type === "strokes:cleared");
        }),
      )
      .toBe(true);

    await socket.evaluate(
      (activeSocket, details) =>
        activeSocket.send(
          JSON.stringify({
            type: "stroke:start",
            stroke: {
              version: 2,
              id: `stale_${Date.now().toString(36)}`,
              route: details.route,
              color: "#dfff00",
              width: 32,
              opacity: 0.45,
              createdAt: Date.now(),
              anchorSchemaVersion: 1,
              anchorId: "page-root",
              points: [0.2, 0.2],
              bounds: { minX: 0.2, minY: 0.2, maxX: 0.2, maxY: 0.2 },
              sequence: 0,
              epoch: details.epoch,
              authorGeneration: details.authorGeneration,
            },
          }),
        ),
      { route, epoch: welcome.epoch, authorGeneration: welcome.selfAuthorGeneration },
    );
    await expect
      .poll(async () =>
        drawer.evaluate(() => {
          const scope = window as typeof window & { __publicSockets?: RecordedSocket[] };
          return (scope.__publicSockets ?? [])
            .flatMap(({ received }) => received)
            .map((value) => JSON.parse(value) as { type?: string; code?: string })
            .some(
              ({ type, code }) => type === "error" && code === "INVALID_MESSAGE",
            );
        }),
      )
      .toBe(true);

    await drawer.getByTestId("public-leave").click();
    await expect
      .poll(async () =>
        watcher.evaluate(() => {
          const scope = window as typeof window & { __publicSockets?: RecordedSocket[] };
          return (scope.__publicSockets ?? [])
            .flatMap(({ received }) => received)
            .map((value) => JSON.parse(value) as {
              type?: string;
              fadeAt?: number | null;
              expiresAt?: number | null;
            })
            .reverse()
            .find(({ type }) => type === "pod:lifecycle") ?? null;
        }),
      )
      .toMatchObject({
        type: "pod:lifecycle",
        fadeAt: expect.any(Number),
        expiresAt: expect.any(Number),
      });

    await watcher.evaluate(() => {
      const scope = window as typeof window & { __publicSocketInstances?: WebSocket[] };
      const socket = [...(scope.__publicSocketInstances ?? [])]
        .reverse()
        .find(
          (candidate) =>
            candidate.url.includes("/v2/public/pods/") &&
            candidate.readyState === WebSocket.OPEN,
        );
      if (!socket) throw new Error("No open watcher pod socket was recorded");
      socket?.send(JSON.stringify({ type: "seat:promote" }));
    });
    await expect
      .poll(async () =>
        watcher.evaluate(() => {
          const scope = window as typeof window & { __publicSockets?: RecordedSocket[] };
          const lifecycles = (scope.__publicSockets ?? [])
            .flatMap(({ received }) => received)
            .map((value) => JSON.parse(value) as {
              type?: string;
              fadeAt?: number | null;
              expiresAt?: number | null;
            })
            .filter(({ type }) => type === "pod:lifecycle");
          return lifecycles.at(-1) ?? null;
        }),
      )
      .toMatchObject({ type: "pod:lifecycle", fadeAt: null, expiresAt: null });
  } finally {
    await closeContexts(contexts);
  }
});

test("migrates legacy profiles to Solo and never stores public ink in IndexedDB", async ({
  baseURL,
  browser,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const migrated = await newPage(browser, baseURL, contexts);
    await migrated.addInitScript(
      ({ preferencesKey }) => {
        localStorage.setItem(
          preferencesKey,
          JSON.stringify({ version: 1, enabled: false, color: "#dfff00" }),
        );
      },
      { preferencesKey: PREFERENCES_KEY },
    );
    await migrated.goto(isolatedRoute(testInfo, "migrated"));
    await expect(root(migrated)).toHaveAttribute("data-hydrated", "true");
    await expect(root(migrated)).toHaveAttribute("data-scope", "solo");
    expect(
      await migrated.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), SCOPE_KEY),
    ).toEqual({ version: 1, scope: "solo" });

    const clean = await newPage(browser, baseURL, contexts);
    await openPublic(clean, isolatedRoute(testInfo, "clean"));
    await joinAsDrawer(clean);
    await drawLine(clean, { x: 145, y: 230 }, { x: 425, y: 230 });
    await expectInk(clean, FIRST_REGION);
    expect(await storedSoloStrokeCount(clean)).toBe(0);

    await openMenu(clean);
    await clean.getByTestId("drawing-scope-solo").click();
    await expect(root(clean)).toHaveAttribute("data-scope", "solo");
    await expectNoInk(clean);
    await toggle(clean).click();
    await drawLine(clean, { x: 145, y: 380 }, { x: 425, y: 380 });
    await expectInk(clean, SECOND_REGION);
    await expect
      .poll(() => storedSoloStrokeCount(clean))
      .toBeGreaterThan(0);

    // The public stroke remained browser-storage-free while the Solo stroke
    // persisted. They never coexist on the visible canvas.
    await expectNoInk(clean, FIRST_REGION);
  } finally {
    await closeContexts(contexts);
  }
});

test("touch activation watches without drawing or publishing pointer movement", async ({
  baseURL,
  browser,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const page = await newPage(browser, baseURL, contexts, {
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    await openPublic(page, isolatedRoute(testInfo));
    const box = await toggle(page).boundingBox();
    expect(box).not.toBeNull();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(root(page)).toHaveAttribute("data-public-state", "watching", {
      timeout: 15_000,
    });
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");

    const touchMovesAllowed = await page.evaluate(() => {
      let allAllowed = true;
      for (let index = 0; index < 12; index += 1) {
        const x = 80 + index * 18;
        const target = document.elementFromPoint(x, 260) ?? document.body;
        allAllowed =
          target.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: 260,
            isPrimary: true,
            pointerId: 31,
            pointerType: "touch",
          }),
          ) && allAllowed;
      }
      return allAllowed;
    });
    await page.waitForTimeout(240);
    expect(touchMovesAllowed).toBe(true);
    await expect(canvas(page)).toHaveCSS("pointer-events", "none");
    await expectNoInk(page);
    expect(await publicOutgoingTypes(page)).not.toEqual(
      expect.arrayContaining([
        "cursor:move",
        "stroke:start",
        "stroke:append",
        "stroke:end",
      ]),
    );
  } finally {
    await closeContexts(contexts);
  }
});

test("keeps an empty pod's ink for its afterglow and then expires it", async ({
  baseURL,
  browser,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const route = isolatedRoute(testInfo);
    const drawer = await newPage(browser, baseURL, contexts);
    const watcher = await newPage(browser, baseURL, contexts, {
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    await openPublic(drawer, route);
    await joinAsDrawer(drawer);
    await drawLine(drawer, { x: 145, y: 230 }, { x: 365, y: 230 });

    await openPublic(watcher, route);
    const box = await toggle(watcher).boundingBox();
    expect(box).not.toBeNull();
    await watcher.touchscreen.tap(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2,
    );
    await expect(root(watcher)).toHaveAttribute("data-public-state", "watching", {
      timeout: 15_000,
    });
    await expectInk(watcher);

    await drawer.getByTestId("public-leave").click();
    await expect(root(drawer)).toHaveAttribute("data-public-state", "ambient");
    await expectInk(watcher);
    await expect
      .poll(() => inkPixels(watcher), { timeout: 8_000 })
      .toBe(0);
  } finally {
    await closeContexts(contexts);
  }
});

test("armed internal navigation rematches and reload reconnects paused with ink", async ({
  baseURL,
  browser,
}) => {
  const contexts: BrowserContext[] = [];
  try {
    const page = await newPage(browser, baseURL, contexts);
    await openPublic(page, "/blogs/");
    await joinAsDrawer(page, true);
    const firstPodConnections = (await publicPodRoutes(page)).length;

    await page.getByRole("link", { name: "MISTAKES.PARTY", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect
      .poll(async () => (await publicPodRoutes(page)).at(-1), {
        timeout: 15_000,
      })
      .toBe("/");
    expect((await publicPodRoutes(page)).length).toBeGreaterThan(
      firstPodConnections,
    );
    await expect(root(page)).toHaveAttribute("data-public-state", "drawing", {
      timeout: 15_000,
    });

    await drawLine(page, { x: 145, y: 230 }, { x: 425, y: 230 });
    await expectInk(page, FIRST_REGION);
    const sessionBeforeReload = await page.evaluate((key) => sessionStorage.getItem(key), PUBLIC_SESSION_KEY);
    expect(sessionBeforeReload).not.toBeNull();
    await page.reload();
    await expect(root(page)).toHaveAttribute("data-hydrated", "true");
    await expect(root(page)).toHaveAttribute(
      "data-public-state",
      /^(paused|watching)$/,
      { timeout: 15_000 },
    );
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expectInk(page, FIRST_REGION);
  } finally {
    await closeContexts(contexts);
  }
});

test("reports Live Offline and offers an explicit Solo fallback", async ({
  baseURL,
  browser,
}, testInfo) => {
  const contexts: BrowserContext[] = [];
  try {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1_100, height: 760 },
    });
    contexts.push(context);
    await context.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, argumentsList) {
          if (String(argumentsList[0]).includes("/v2/public/")) {
            throw new DOMException("Realtime intentionally unavailable", "NetworkError");
          }
          return Reflect.construct(target, argumentsList) as WebSocket;
        },
      });
    });
    const page = await context.newPage();
    await page.goto(isolatedRoute(testInfo));
    await expect(root(page)).toHaveAttribute("data-hydrated", "true");
    await expect(root(page)).toHaveAttribute("data-public-state", "offline");
    await openMenu(page);
    await expect(page.getByTestId("public-live-status")).toContainText(
      "LIVE OFFLINE",
    );
    await page.getByTestId("public-draw-solo").click();
    await expect(root(page)).toHaveAttribute("data-scope", "solo");
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), SCOPE_KEY),
    ).toEqual({ version: 1, scope: "solo" });
  } finally {
    await closeContexts(contexts);
  }
});
