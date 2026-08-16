import { expect, test, type Browser, type Page } from "@playwright/test";

const HOUSE_SESSION_KEY = "mistakes-party.house.session.v2";

async function openHousePage(browser: Browser, pathname = "/") {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(pathname);
  const house = page.getByTestId("party-house");
  await expect(house).toHaveAttribute("data-connection", "live", {
    timeout: 10_000,
  });
  return { context, house, page };
}

async function expectPresence(page: Page, count: number) {
  await expect(page.getByTestId("party-house")).toHaveAttribute(
    "data-presence",
    String(count),
    { timeout: 10_000 },
  );
}

async function readSession(page: Page) {
  return page.evaluate((key) => {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  }, HOUSE_SESSION_KEY);
}

function parseAfterglow(value: string | null) {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("weights" in parsed) ||
      !("intensity" in parsed) ||
      !Array.isArray(parsed.weights) ||
      parsed.weights.length !== 4 ||
      typeof parsed.intensity !== "number"
    ) {
      return null;
    }
    return { weights: parsed.weights as number[], intensity: parsed.intensity };
  } catch {
    return null;
  }
}

test("counts distinct tabs in one sitewide house across public routes", async ({
  browser,
}) => {
  const home = await openHousePage(browser, "/");
  const project = await openHousePage(browser, "/work/itadw/");
  const writing = await openHousePage(browser, "/blogs/");

  try {
    await expectPresence(home.page, 3);
    await expectPresence(project.page, 3);
    await expectPresence(writing.page, 3);

    const atmosphere = home.page.getByTestId("portal-atmosphere");
    await expect(atmosphere).toHaveAttribute("data-crowd", "2");
    await expect(atmosphere).toHaveAttribute("data-party-swell", /^(?:odd|even)$/);
    await expect(home.page.getByTestId("party-light")).toHaveCount(3);

    const visualState = await atmosphere.evaluate((element) => {
      const style = getComputedStyle(element);
      const lights = [...element.querySelectorAll('[data-testid="party-light"]')]
        .map((light) => ({
          field: getComputedStyle(light, "::before").backgroundImage,
          core: getComputedStyle(light, "::after").content,
        }));
      return {
        activeColors: [0, 1, 2, 3].map((color) =>
          Number.parseFloat(style.getPropertyValue(`--party-color-${color}`)),
        ),
        lights,
        presenceStrength: Number.parseFloat(
          style.getPropertyValue("--party-presence-strength"),
        ),
      };
    });
    expect(visualState.presenceStrength).toBeGreaterThan(0.6);
    expect(visualState.activeColors.some((weight) => weight > 0.25)).toBe(true);
    expect(visualState.lights).toHaveLength(3);
    for (const light of visualState.lights) {
      expect(light.field).toContain("radial-gradient");
      expect(light.core).toBe("none");
    }

    const homeSession = await readSession(home.page);
    expect(homeSession).toMatchObject({
      generation: expect.any(String),
      sessionId: expect.any(String),
      hasLeftBalloon: false,
      motionPreference: null,
    });

    await project.context.close();
    await expectPresence(home.page, 2);
    await expectPresence(writing.page, 2);
    await expect(atmosphere).toHaveAttribute("data-crowd", "1");
    await expect(home.page.getByTestId("party-light")).toHaveCount(2);

    await home.page.reload();
    await expectPresence(home.page, 2);
    expect(await readSession(home.page)).toEqual(homeSession);
  } finally {
    await home.context.close();
    await writing.context.close();
  }
});

test("a balloon echoes once to the house and persists its 24-hour afterglow", async ({
  browser,
}) => {
  const sender = await openHousePage(browser, "/");
  const peer = await openHousePage(browser, "/");

  try {
    await expectPresence(sender.page, 2);
    const before = await sender.page
      .getByTestId("portal-atmosphere")
      .getAttribute("data-afterglow");

    const trigger = sender.page.getByTestId("party-balloon-trigger");
    await expect(trigger).toContainText("2 HERE");
    await trigger.click();

    const selfBalloon = sender.page.locator(
      '[data-testid="party-balloon"][data-self="true"]',
    );
    const peerBalloon = peer.page.locator(
      '[data-testid="party-balloon"][data-self="false"]',
    );
    await expect(selfBalloon).toHaveCount(1);
    await expect(peerBalloon).toHaveCount(1);
    await expect(selfBalloon).toHaveAttribute("data-color", /^[0-3]$/);
    const balloonColor = Number(await selfBalloon.getAttribute("data-color"));
    await expect(sender.page.getByTestId("party-balloon-confirmation")).toContainText(
      "THE COLOR LINGERS FOR 24 HOURS",
    );

    const session = await readSession(sender.page);
    expect(session).toMatchObject({
      hasLeftBalloon: true,
      motionPreference: "on",
    });
    await trigger.click();
    await expect(sender.page.getByTestId("party-balloon-dialog")).toBeVisible();
    await sender.page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();

    const atmosphere = sender.page.getByTestId("portal-atmosphere");
    await expect
      .poll(() => atmosphere.getAttribute("data-afterglow"))
      .not.toBe(before);
    const after = parseAfterglow(await atmosphere.getAttribute("data-afterglow"));
    if (!after) throw new Error("Expected serialized Living Glass afterglow");
    expect(after.intensity).toBeGreaterThan(0);
    expect(after.weights[balloonColor]).toBeGreaterThan(0);

    const late = await openHousePage(browser, "/code/");
    try {
      await expect
        .poll(async () => {
          const value = await late.page
            .getByTestId("party-house")
            .getAttribute("data-afterglow");
          return parseAfterglow(value)?.intensity ?? 0;
        })
        .toBeGreaterThan(0);
      const lateAfterglow = parseAfterglow(
        await late.page.getByTestId("party-house").getAttribute("data-afterglow"),
      );
      expect(lateAfterglow?.weights[balloonColor]).toBeGreaterThan(0);
      await expect(late.page.getByTestId("portal-atmosphere")).toHaveCount(0);
      await expect(late.page.getByTestId("party-balloon")).toHaveCount(0);
    } finally {
      await late.context.close();
    }

    // One balloon produces one event per client; a late tab gets state, not history.
    await expect(sender.page.getByTestId("party-balloon")).toHaveCount(0, {
      timeout: 6_000,
    });
    await expect(peer.page.getByTestId("party-balloon")).toHaveCount(0, {
      timeout: 6_000,
    });

    await sender.page.evaluate((key) => {
      const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
      value.hasKnocked = value.hasLeftBalloon;
      delete value.hasLeftBalloon;
      sessionStorage.setItem(key, JSON.stringify(value));
    }, HOUSE_SESSION_KEY);
    await sender.page.reload();
    await expect(sender.page.getByTestId("party-house")).toHaveAttribute(
      "data-connection",
      "live",
    );
    await expect.poll(() => readSession(sender.page)).toMatchObject({
      hasLeftBalloon: true,
      motionPreference: "on",
    });
    await sender.page.getByTestId("party-balloon-trigger").click();
    await expect(sender.page.getByTestId("party-balloon-dialog")).toBeVisible();
  } finally {
    await sender.context.close();
    await peer.context.close();
  }
});

test("MY LIGHT unlocks after a balloon and remembers the off toggle", async ({
  browser,
}) => {
  const visitor = await openHousePage(browser);

  try {
    const motion = visitor.page.getByTestId("party-motion");
    await expect(motion).toHaveCount(0);

    const github = visitor.page.locator('[data-portal-section="github"]');
    await github.getByRole("button", { name: /^GITHUB/ }).click();
    await expect(
      visitor.page.locator(
        '[data-testid="party-light"][data-self="true"]',
      ),
    ).toHaveAttribute("data-sharing", "false");

    await visitor.page.getByTestId("party-balloon-trigger").click();
    await visitor.page.getByTestId("party-balloon-trigger").click();
    await expect(visitor.page.getByTestId("party-balloon-dialog")).toBeVisible();
    await expect(motion).toBeVisible();
    await expect(motion).toHaveAttribute("aria-pressed", "true");
    const selfLight = visitor.page.locator(
      '[data-testid="party-light"][data-self="true"]',
    );
    await expect(selfLight).toHaveAttribute("data-sharing", "true");
    await expect(selfLight).toHaveAttribute("data-zone", "1");
    await expect(selfLight).toHaveAttribute("data-room", "code");
    await visitor.page.getByRole("button", {
      name: "Close balloon guestbook",
    }).click();

    const medium = visitor.page.locator('[data-portal-section="medium"]');
    await medium.getByRole("button", { name: /^MEDIUM/ }).click();
    await expect(selfLight).toHaveAttribute("data-zone", "3");
    await expect(selfLight).toHaveAttribute("data-room", "writing");

    await visitor.page.getByTestId("party-balloon-trigger").click();
    await motion.click();
    await expect(motion).toHaveAttribute("aria-pressed", "false");
    await expect(selfLight).toHaveAttribute("data-sharing", "false");
    await expect.poll(() => readSession(visitor.page)).toMatchObject({
      hasLeftBalloon: true,
      motionPreference: "off",
    });

    await visitor.page.reload();
    await expect(visitor.page.getByTestId("party-house")).toHaveAttribute(
      "data-connection",
      "live",
    );
    await visitor.page.getByTestId("party-balloon-trigger").click();
    await expect(visitor.page.getByTestId("party-balloon-dialog")).toBeVisible();
    await expect(visitor.page.getByTestId("party-motion")).toBeVisible();
    await expect(visitor.page.getByTestId("party-motion")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  } finally {
    await visitor.context.close();
  }
});

test("keeps the balloon guestbook keyboard and thumb friendly at 320px", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 640 },
  });
  const page = await context.newPage();

  try {
    await page.goto("/");
    await expect(page.getByTestId("party-house")).toHaveAttribute(
      "data-connection",
      "live",
    );

    const switchboard = page.getByTestId("party-switchboard");
    const switchboardBox = await switchboard.boundingBox();
    expect(switchboardBox).not.toBeNull();
    expect(switchboardBox!.x).toBeGreaterThanOrEqual(0);
    expect(switchboardBox!.x + switchboardBox!.width).toBeLessThanOrEqual(320);

    const trigger = page.getByTestId("party-balloon-trigger");
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox!.width).toBeGreaterThanOrEqual(44);
    expect(triggerBox!.height).toBeGreaterThanOrEqual(44);
    expect(triggerBox!.x).toBeGreaterThanOrEqual(0);
    expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(320);
    expect(triggerBox!.y + triggerBox!.height).toBeLessThanOrEqual(640);

    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("party-balloon")).toHaveCount(1);
    await trigger.click();
    await expect(page.getByTestId("party-balloon-dialog")).toBeVisible();
    const dialogBox = await page.getByTestId("party-balloon-dialog").boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBe(0);
    expect(dialogBox!.width).toBe(320);
    const motionBox = await page.getByTestId("party-motion").boundingBox();
    expect(motionBox).not.toBeNull();
    expect(motionBox!.width).toBeGreaterThanOrEqual(44);
    expect(motionBox!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("party-motion")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("party-balloon-dialog")).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
  } finally {
    await context.close();
  }
});

test("honors reduced motion and forced colors without hiding controls", async ({
  browser,
}) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  try {
    await page.goto("/");
    await expect(page.getByTestId("party-house")).toHaveAttribute(
      "data-connection",
      "live",
    );
    await page.getByTestId("party-balloon-trigger").click();
    const balloon = page.getByTestId("party-balloon");
    await expect(balloon).toHaveCount(1);
    await expect(balloon).toHaveCSS("animation-name", /balloon-static/);

    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await expect(page.getByTestId("party-switchboard")).toBeVisible();
    await expect(page.getByTestId("party-balloon-trigger")).toBeVisible();
    await page.getByTestId("party-balloon-trigger").click();
    await expect(page.getByTestId("party-balloon-dialog")).toBeVisible();
    await expect(page.getByTestId("party-motion")).toBeVisible();
    await expect(page.getByTestId("portal-atmosphere")).toBeHidden();
    await expect(page.getByTestId("party-light").first()).toBeHidden();
  } finally {
    await context.close();
  }
});

test("the guestbook closes on its backdrop and restores trigger focus", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const home = await context.newPage();

  try {
    await home.goto("/");
    await expect(home.getByTestId("party-house")).toHaveAttribute(
      "data-connection",
      "live",
    );
    const trigger = home.getByTestId("party-balloon-trigger");
    await trigger.click();
    await trigger.click();
    const dialog = home.getByTestId("party-balloon-dialog");
    await expect(dialog).toBeVisible();
    await home.mouse.click(10, 10);
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

test("a completed guestbook stays available while reconnecting", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    class ObservableWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (
          (window as Window & { __blockPartySockets?: boolean })
            .__blockPartySockets
        ) {
          throw new Error("Test reconnect");
        }
        super(url, protocols);
        if (new URL(String(url), window.location.href).pathname === "/v2/house") {
          sockets.push(this);
        }
      }
    }
    Object.defineProperty(window, "WebSocket", { value: ObservableWebSocket });
    Object.defineProperty(window, "__partySockets", { value: sockets });
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("party-house")).toHaveAttribute(
    "data-connection",
    "live",
  );

  try {
    const trigger = page.getByTestId("party-balloon-trigger");
    await trigger.click();
    await expect(trigger).toHaveAttribute("data-balloon-left", "true");
    await page.evaluate(() => {
      const testWindow = window as Window & {
        __blockPartySockets?: boolean;
        __partySockets?: WebSocket[];
      };
      testWindow.__blockPartySockets = true;
      const sockets = testWindow.__partySockets;
      sockets?.at(-1)?.dispatchEvent(
        new CloseEvent("close", { code: 4000, reason: "Test reconnect" }),
      );
    });
    await expect(page.getByTestId("party-house")).toHaveAttribute(
      "data-connection",
      "reconnecting",
      { timeout: 10_000 },
    );
    await trigger.click();
    await expect(page.getByTestId("party-balloon-dialog")).toBeVisible();
    await expect(page.getByTestId("party-motion")).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("never mounts or opens Living Glass anywhere under Patreon", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    let opened = 0;
    class CountingWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const pathname = new URL(String(url), window.location.href).pathname;
        if (pathname === "/v2/house") opened += 1;
        super(url, protocols);
      }
    }
    Object.defineProperty(window, "WebSocket", { value: CountingWebSocket });
    Object.defineProperty(window, "__partySocketCount", {
      get: () => opened,
    });
  });
  const page = await context.newPage();

  try {
    await page.goto("/patreon/");
    await expect(page.getByTestId("party-house")).toHaveCount(0);
    await expect(page.getByTestId("party-switchboard")).toHaveCount(0);
    await expect(page.getByTestId("party-light")).toHaveCount(0);
    await expect(page.getByTestId("party-guestbook")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __partySocketCount?: number })
            .__partySocketCount ?? 0,
      ),
    ).toBe(0);

    await page.goto("/patreon/room/");
    await expect(page).toHaveURL(/\/patreon\/?\?returnTo=/);
    await expect(page.getByTestId("party-house")).toHaveCount(0);
    await expect(page.getByTestId("party-switchboard")).toHaveCount(0);
    await expect(page.getByTestId("party-guestbook")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __partySocketCount?: number })
            .__partySocketCount ?? 0,
      ),
    ).toBe(0);
  } finally {
    await context.close();
  }
});
