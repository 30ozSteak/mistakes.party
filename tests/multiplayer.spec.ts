import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

type Point = { x: number; y: number };
type Region = { x: number; y: number; width: number; height: number };

const playground = (page: Page) => page.getByTestId("drawing-playground");
const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const toggle = (page: Page) => page.getByTestId("drawing-toggle");
const partyStart = (page: Page) => page.getByTestId("party-start");
const partyShareLink = (page: Page) => page.getByTestId("party-share-link");
const partyStatus = (page: Page) => page.getByTestId("party-live-status");
const partyCount = (page: Page) => page.getByTestId("party-count");
const partyClearMine = (page: Page) => page.getByTestId("party-clear-mine");
const partyLeave = (page: Page) => page.getByTestId("party-leave");
const DRAWING_SCOPE_KEY = "mistakes-party.drawing.scope.v1";

async function selectSoloOnFirstLoad(context: BrowserContext) {
  await context.addInitScript((scopeKey) => {
    localStorage.setItem(
      scopeKey,
      JSON.stringify({ version: 1, scope: "solo" }),
    );
  }, DRAWING_SCOPE_KEY);
}

test.beforeEach(async ({ context }) => {
  // Private v1 rooms are an explicit secondary mode now. Keep these regression
  // tests in Solo until an invite is accepted.
  await selectSoloOnFirstLoad(context);
});

const SNAPSHOT_REGION: Region = { x: 130, y: 205, width: 340, height: 115 };
const LIVE_REGION: Region = { x: 130, y: 355, width: 340, height: 115 };
const HOST_REGION: Region = { x: 130, y: 205, width: 340, height: 115 };
const GUEST_REGION: Region = { x: 610, y: 365, width: 330, height: 115 };
const BLOG_REGION: Region = { x: 375, y: 275, width: 330, height: 115 };

async function newPage(
  browser: Browser,
  baseURL: string | undefined,
  contexts: BrowserContext[],
) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1_100, height: 760 },
  });
  contexts.push(context);
  await selectSoloOnFirstLoad(context);
  return context.newPage();
}

async function expectPlayground(page: Page) {
  await expect(playground(page)).toBeAttached();
  await expect(playground(page)).toHaveAttribute("data-hydrated", "true");
  await expect(canvas(page)).toBeVisible();
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await expectPlayground(page);
}

async function enableDrawing(page: Page) {
  if ((await toggle(page).getAttribute("aria-pressed")) !== "true") {
    await toggle(page).click();
  }
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
}

async function startParty(page: Page, pathname = "/") {
  await open(page, pathname);
  await enableDrawing(page);
  await partyStart(page).click();
  await expect(partyStatus(page)).toHaveText("LIVE");
  await expect(partyCount(page)).toHaveText("1/4");

  const invite = await partyShareLink(page).inputValue();
  const inviteUrl = new URL(invite);
  const inviteHash = new URLSearchParams(inviteUrl.hash.slice(1));
  expect(inviteHash.get("party")).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  return invite;
}

async function joinParty(page: Page, invite: string) {
  await open(page, invite);
  await expect(partyStatus(page)).toHaveText("LIVE");
  // Invite links connect and reveal the private room, but never publish cursor
  // movement until the guest explicitly presses P or the balloon.
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
}

async function drawLine(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.move(to.x, to.y, { steps: 24 });
  // Drawing idles after 150ms. Waiting for that boundary makes the final
  // append/end packet deterministic before remote assertions begin.
  await page.waitForTimeout(220);
}

async function inkPixels(page: Page, region: Region) {
  return canvas(page).evaluate((element, requestedRegion) => {
    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error("drawing-canvas is not a canvas element");
    }
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context || element.width === 0 || element.height === 0) return 0;

    const scaleX = element.clientWidth ? element.width / element.clientWidth : 1;
    const scaleY = element.clientHeight ? element.height / element.clientHeight : 1;
    const x = Math.max(0, Math.floor(requestedRegion.x * scaleX));
    const y = Math.max(0, Math.floor(requestedRegion.y * scaleY));
    const width = Math.min(
      element.width - x,
      Math.max(1, Math.ceil(requestedRegion.width * scaleX)),
    );
    const height = Math.min(
      element.height - y,
      Math.max(1, Math.ceil(requestedRegion.height * scaleY)),
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

async function expectInk(page: Page, region: Region) {
  await expect.poll(() => inkPixels(page, region)).toBeGreaterThan(0);
}

async function expectNoInk(page: Page, region: Region) {
  await expect.poll(() => inkPixels(page, region)).toBe(0);
}

test("keeps room credentials session-only and out of WebSocket URLs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const scope = window as typeof window & {
      __partyWebSockets?: Array<{
        url: string;
        protocols: string[];
        selectedProtocol: string;
      }>;
    };
    const NativeWebSocket = window.WebSocket;
    scope.__partyWebSockets = [];
    window.localStorage.setItem(
      "mistakes-party.drawing.participant.v1",
      JSON.stringify({
        id: "legacy_participant",
        name: "<img src=x onerror=alert(1)>",
        token: "legacy_participant_token",
      }),
    );
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, argumentsList) {
        const protocols = Array.isArray(argumentsList[1])
          ? [...argumentsList[1]]
          : typeof argumentsList[1] === "string"
            ? [argumentsList[1]]
            : [];
        const record = {
          url: String(argumentsList[0]),
          protocols,
          selectedProtocol: "",
        };
        scope.__partyWebSockets?.push(record);
        const socket = Reflect.construct(target, argumentsList) as WebSocket;
        socket.addEventListener("open", () => {
          record.selectedProtocol = socket.protocol;
        });
        return socket;
      },
    });
  });

  const invite = await startParty(page);
  const roomId = new URLSearchParams(new URL(invite).hash.slice(1)).get("party");
  expect(roomId).not.toBeNull();

  const securityState = await page.evaluate((activeRoomId) => {
    const scope = window as typeof window & {
      __partyWebSockets?: Array<{
        url: string;
        protocols: string[];
        selectedProtocol: string;
      }>;
    };
    const identityKey = `mistakes-party.drawing.participant.v2.${activeRoomId}`;
    const identity = JSON.parse(
      window.sessionStorage.getItem(identityKey) ?? "null",
    ) as { id?: unknown; name?: unknown; token?: unknown } | null;
    return {
      identityKey,
      identity,
      legacyIdentity: window.localStorage.getItem(
        "mistakes-party.drawing.participant.v1",
      ),
      localIdentityKeys: Object.keys(window.localStorage).filter((key) =>
        key.startsWith("mistakes-party.drawing.participant"),
      ),
      socket: scope.__partyWebSockets?.at(-1) ?? null,
    };
  }, roomId);

  expect(securityState.legacyIdentity).toBeNull();
  expect(securityState.localIdentityKeys).toEqual([]);
  expect(securityState.identity).toMatchObject({
    id: expect.stringMatching(/^[A-Za-z0-9_-]{8,128}$/),
    name: expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 '-]{0,39}$/),
    token: expect.stringMatching(/^[A-Za-z0-9_-]{8,128}$/),
  });
  expect(securityState.socket).not.toBeNull();
  const socketUrl = new URL(securityState.socket!.url);
  expect(socketUrl.searchParams.has("participantToken")).toBe(false);
  expect(socketUrl.toString()).not.toContain(String(securityState.identity?.token));
  expect(securityState.socket!.protocols).toEqual([
    "mistakes-party-drawing-v1",
    `mistakes-party-auth.${securityState.identity?.token}`,
  ]);
  expect(securityState.socket!.selectedProtocol).toBe(
    "mistakes-party-drawing-v1",
  );
  expect(securityState.socket!.selectedProtocol).not.toContain(
    String(securityState.identity?.token),
  );
});

test("normalizes hostile participant names before presence is broadcast", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const scope = window as typeof window & { __partyServerMessages?: string[] };
    const NativeWebSocket = window.WebSocket;
    scope.__partyServerMessages = [];
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, argumentsList) {
        const url = new URL(String(argumentsList[0]));
        url.searchParams.set("name", "<img src=x onerror=alert(1)>");
        argumentsList[0] = url.toString();
        const socket = Reflect.construct(target, argumentsList) as WebSocket;
        socket.addEventListener("message", (event) => {
          if (typeof event.data === "string") {
            scope.__partyServerMessages?.push(event.data);
          }
        });
        return socket;
      },
    });
  });

  await startParty(page);
  const welcome = await page.evaluate(() => {
    const scope = window as typeof window & { __partyServerMessages?: string[] };
    return scope.__partyServerMessages
      ?.map((value) => JSON.parse(value) as { type?: string })
      .find((message) => message.type === "welcome");
  });
  expect(welcome).toMatchObject({
    type: "welcome",
    participants: [{ name: "img src x onerror alert 1" }],
  });
});

test("shares live strokes, restores snapshots, and rejects a fifth participant", async ({
  baseURL,
  browser,
}) => {
  const contexts: BrowserContext[] = [];

  try {
    const host = await newPage(browser, baseURL, contexts);
    const invite = await startParty(host);

    // This stroke exists before the first guest, so it can only arrive through
    // the welcome snapshot rather than a live broadcast.
    await drawLine(host, { x: 170, y: 260 }, { x: 420, y: 260 });
    await expectInk(host, SNAPSHOT_REGION);

    const firstGuest = await newPage(browser, baseURL, contexts);
    await joinParty(firstGuest, invite);
    await expect(partyCount(host)).toHaveText("2/4");
    await expectInk(firstGuest, SNAPSHOT_REGION);

    // A second stroke after the guest joins exercises the live WebSocket path.
    await drawLine(host, { x: 170, y: 410 }, { x: 420, y: 410 });
    await expectInk(firstGuest, LIVE_REGION);

    const secondGuest = await newPage(browser, baseURL, contexts);
    await joinParty(secondGuest, invite);
    const thirdGuest = await newPage(browser, baseURL, contexts);
    await joinParty(thirdGuest, invite);
    await expect(partyCount(host)).toHaveText("4/4");
    await expect(partyCount(firstGuest)).toHaveText("4/4");

    const rejectedGuest = await newPage(browser, baseURL, contexts);
    await open(rejectedGuest, invite);
    await expect(partyStatus(rejectedGuest)).toHaveText("PARTY FULL");
    await expect(partyCount(host)).toHaveText("4/4");

    // Reloading closes and replaces this participant's socket. The room must
    // recognize the stable participant id and restore both route strokes.
    await firstGuest.reload();
    await expectPlayground(firstGuest);
    await expect(partyStatus(firstGuest)).toHaveText("LIVE");
    await expectInk(firstGuest, SNAPSHOT_REGION);
    await expectInk(firstGuest, LIVE_REGION);
    await expect(partyCount(host)).toHaveText("4/4");
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("treats duplicate tabs as separate session participants while keeping their canvases synced", async ({
  baseURL,
  browser,
}) => {
  const contexts: BrowserContext[] = [];

  try {
    const firstTab = await newPage(browser, baseURL, contexts);
    const invite = await startParty(firstTab);
    const secondTab = await firstTab.context().newPage();

    await joinParty(secondTab, invite);
    await expect(partyCount(firstTab)).toHaveText("2/4");
    await expect(partyCount(secondTab)).toHaveText("2/4");

    await drawLine(firstTab, { x: 170, y: 260 }, { x: 420, y: 260 });
    await expectInk(secondTab, SNAPSHOT_REGION);

    // sessionStorage is tab-scoped: opening another tab creates an independent
    // room-scoped identity instead of exposing one tab's credential to another.
    const thirdTab = await firstTab.context().newPage();
    await joinParty(thirdTab, invite);
    await expect(partyStatus(firstTab)).toHaveText("LIVE");
    await expect(partyStatus(secondTab)).toHaveText("LIVE");
    await expect(partyCount(firstTab)).toHaveText("3/4");
    await expect(partyCount(secondTab)).toHaveText("3/4");
    await expect(partyCount(thirdTab)).toHaveText("3/4");
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("leaving ignores delayed frames from the old room", async ({
  baseURL,
  browser,
}) => {
  const contexts: BrowserContext[] = [];

  try {
    const host = await newPage(browser, baseURL, contexts);
    const invite = await startParty(host);
    const guest = await newPage(browser, baseURL, contexts);

    // Delay only message callbacks, not the socket itself. After the first
    // welcome we can hold a frame from the old room, leave, create a new room,
    // and then release the stale callback deterministically.
    await guest.addInitScript(() => {
      const scope = window as typeof window & {
        __partyMessageDelay?: number;
      };
      scope.__partyMessageDelay = 0;
      const nativeAddEventListener = WebSocket.prototype.addEventListener;

      Object.defineProperty(WebSocket.prototype, "addEventListener", {
        configurable: true,
        value: function (
          this: WebSocket,
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          options?: boolean | AddEventListenerOptions,
        ) {
          if (type !== "message" || listener === null) {
            return Reflect.apply(nativeAddEventListener, this, [
              type,
              listener,
              options,
            ]);
          }

          const delayedListener = (event: Event) => {
            const invoke = () => {
              if (typeof listener === "function") {
                listener.call(this, event);
              } else {
                listener.handleEvent(event);
              }
            };
            const delay = scope.__partyMessageDelay ?? 0;
            if (delay > 0) {
              window.setTimeout(invoke, delay);
            } else {
              invoke();
            }
          };

          return Reflect.apply(nativeAddEventListener, this, [
            type,
            delayedListener,
            options,
          ]);
        },
        writable: true,
      });
    });

    await joinParty(guest, invite);
    await enableDrawing(guest);
    await guest.evaluate(() => {
      (
        window as typeof window & { __partyMessageDelay: number }
      ).__partyMessageDelay = 650;
    });

    await host.mouse.move(170, 260);
    await host.mouse.move(420, 260, { steps: 12 });
    await host.waitForTimeout(100);

    await partyLeave(guest).click();
    await expect(playground(guest)).toHaveAttribute("data-party-state", "solo");
    await expect(playground(guest)).not.toHaveAttribute("data-party-id", /.+/);

    await guest.evaluate(() => {
      (
        window as typeof window & { __partyMessageDelay: number }
      ).__partyMessageDelay = 0;
    });
    await partyStart(guest).click();
    await expect(partyStatus(guest)).toHaveText("LIVE");
    await expect(partyCount(guest)).toHaveText("1/4");
    await expectNoInk(guest, SNAPSHOT_REGION);

    // The delayed stroke:start and append from the first room arrive here.
    // They must not mutate the replacement room or its connection state.
    await guest.waitForTimeout(750);
    await expect(partyStatus(guest)).toHaveText("LIVE");
    await expect(partyCount(guest)).toHaveText("1/4");
    await expectNoInk(guest, SNAPSHOT_REGION);
    await expect(partyCount(host)).toHaveText("1/4");
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("finishes an active stroke across SPA route changes and restores the new route snapshot", async ({
  baseURL,
  browser,
}) => {
  const contexts: BrowserContext[] = [];

  try {
    const host = await newPage(browser, baseURL, contexts);
    const invite = await startParty(host, "/blogs/");
    const guest = await newPage(browser, baseURL, contexts);
    await joinParty(guest, invite);

    // Start moving, then navigate before the 150ms idle boundary. The route
    // transition must flush/end the blog stroke before requesting the portal.
    await host.mouse.move(170, 260);
    await host.mouse.move(420, 260, { steps: 24 });
    await host.getByRole("link", { name: "MISTAKES.PARTY", exact: true }).click();
    await expect(host).toHaveURL(/\/$/);
    await expectPlayground(host);
    await expect(partyStatus(host)).toHaveText("LIVE");
    await expectNoInk(host, HOST_REGION);
    await expectInk(guest, HOST_REGION);

    await enableDrawing(host);
    await drawLine(host, { x: 415, y: 330 }, { x: 665, y: 330 });
    await expectInk(host, BLOG_REGION);

    await guest.getByRole("link", { name: "MISTAKES.PARTY", exact: true }).click();
    await expect(guest).toHaveURL(/\/$/);
    await expectPlayground(guest);
    await expect(partyStatus(guest)).toHaveText("LIVE");
    await expectInk(guest, BLOG_REGION);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("clear mine drains an in-flight append before deleting the stroke", async ({
  baseURL,
  browser,
}) => {
  const contexts: BrowserContext[] = [];

  try {
    const host = await newPage(browser, baseURL, contexts);
    const invite = await startParty(host);
    const guest = await newPage(browser, baseURL, contexts);
    await joinParty(guest, invite);

    await host.mouse.move(170, 260);
    await host.mouse.move(420, 260, { steps: 24 });
    await expectInk(host, HOST_REGION);

    // Entering the controls finishes the still-active stroke. Clear follows on
    // the same ordered socket and must remain authoritative after send timers
    // and idle timers would otherwise have fired.
    await partyClearMine(host).click();
    await expect(partyClearMine(host)).toHaveText("SURE?");
    await partyClearMine(host).click();
    await expectNoInk(host, HOST_REGION);
    await expectNoInk(guest, HOST_REGION);
    await host.waitForTimeout(350);
    await expectNoInk(host, HOST_REGION);
    await expectNoInk(guest, HOST_REGION);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("keeps routes isolated and clear-mine preserves another participant's ink", async ({
  baseURL,
  browser,
}) => {
  const contexts: BrowserContext[] = [];

  try {
    const host = await newPage(browser, baseURL, contexts);
    const invite = await startParty(host);
    const guest = await newPage(browser, baseURL, contexts);
    await joinParty(guest, invite);
    await enableDrawing(guest);

    await drawLine(host, { x: 170, y: 260 }, { x: 420, y: 260 });
    await guest.getByTestId("drawing-color-pink").click();
    await drawLine(guest, { x: 650, y: 420 }, { x: 900, y: 420 });

    for (const page of [host, guest]) {
      await expectInk(page, HOST_REGION);
      await expectInk(page, GUEST_REGION);
    }

    await partyClearMine(host).click();
    await expect(partyClearMine(host)).toHaveText("SURE?");
    // Confirmation itself must not mutate any participant's canvas.
    await expectInk(host, HOST_REGION);
    await expectInk(guest, HOST_REGION);
    await partyClearMine(host).click();
    for (const page of [host, guest]) {
      await expectNoInk(page, HOST_REGION);
      await expectInk(page, GUEST_REGION);
    }

    // Party membership survives navigation, but each pathname receives a
    // separate snapshot. A /blogs stroke must not leak onto the host's / canvas.
    await open(guest, "/blogs");
    await expect(partyStatus(guest)).toHaveText("LIVE");
    await enableDrawing(guest);
    await drawLine(guest, { x: 415, y: 330 }, { x: 665, y: 330 });
    await expectInk(guest, BLOG_REGION);
    await expectNoInk(host, BLOG_REGION);

    await open(host, "/blogs");
    await expect(partyStatus(host)).toHaveText("LIVE");
    await expectInk(host, BLOG_REGION);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
