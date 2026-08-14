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
      hasKnocked: false,
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

test("KNOCK echoes once to the house and persists its 24-hour afterglow", async ({
  browser,
}) => {
  const sender = await openHousePage(browser, "/");
  const peer = await openHousePage(browser, "/");

  try {
    await expectPresence(sender.page, 2);
    const before = await sender.page
      .getByTestId("portal-atmosphere")
      .getAttribute("data-afterglow");

    await sender.page.getByTestId("party-knock").click();

    const selfWave = sender.page.locator(
      '[data-testid="party-knock-wave"][data-self="true"]',
    );
    const peerWave = peer.page.locator(
      '[data-testid="party-knock-wave"][data-self="false"]',
    );
    await expect(selfWave).toHaveCount(1);
    await expect(peerWave).toHaveCount(1);
    await expect(selfWave).toHaveAttribute("data-color", /^[0-3]$/);
    await expect(selfWave).toHaveAttribute("data-zone", /^[0-8]$/);
    const knockColor = Number(await selfWave.getAttribute("data-color"));

    const session = await readSession(sender.page);
    expect(session).toMatchObject({
      hasKnocked: true,
      motionPreference: "on",
    });

    const atmosphere = sender.page.getByTestId("portal-atmosphere");
    await expect
      .poll(() => atmosphere.getAttribute("data-afterglow"))
      .not.toBe(before);
    const after = parseAfterglow(await atmosphere.getAttribute("data-afterglow"));
    if (!after) throw new Error("Expected serialized Living Glass afterglow");
    expect(after.intensity).toBeGreaterThan(0);
    expect(after.weights[knockColor]).toBeGreaterThan(0);

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
      expect(lateAfterglow?.weights[knockColor]).toBeGreaterThan(0);
      await expect(late.page.getByTestId("portal-atmosphere")).toHaveCount(0);
      await expect(late.page.getByTestId("party-knock-wave")).toHaveCount(0);
    } finally {
      await late.context.close();
    }

    // One knock produces one event per client; a late tab gets state, not history.
    await expect(sender.page.getByTestId("party-knock-wave")).toHaveCount(0, {
      timeout: 3_000,
    });
    await expect(peer.page.getByTestId("party-knock-wave")).toHaveCount(0, {
      timeout: 3_000,
    });
  } finally {
    await sender.context.close();
    await peer.context.close();
  }
});

test("coarse motion stays locked until KNOCK and remembers the off toggle", async ({
  browser,
}) => {
  const visitor = await openHousePage(browser);

  try {
    const motion = visitor.page.getByTestId("party-motion");
    await expect(motion).toHaveCount(0);

    await visitor.page.mouse.move(1, 1);
    await visitor.page.mouse.move(1200, 700);
    await expect(
      visitor.page.locator(
        '[data-testid="party-light"][data-self="true"]',
      ),
    ).toHaveAttribute("data-sharing", "false");

    await visitor.page.getByTestId("party-knock").click();
    await expect(motion).toBeVisible();
    await expect(motion).toHaveAttribute("aria-pressed", "true");
    await visitor.page.mouse.move(1, 1);
    await visitor.page.waitForTimeout(550);
    await visitor.page.mouse.move(1200, 700);
    await expect(
      visitor.page.locator(
        '[data-testid="party-light"][data-self="true"]',
      ),
    ).toHaveAttribute("data-sharing", "true");

    await motion.click();
    await expect(motion).toHaveAttribute("aria-pressed", "false");
    const selfLight = visitor.page.locator(
      '[data-testid="party-light"][data-self="true"]',
    );
    await expect(selfLight).toHaveAttribute("data-sharing", "false");
    // A pointer move schedules an idle frame. Turning motion off must cancel
    // that frame instead of silently re-enabling sharing 900ms later.
    await visitor.page.waitForTimeout(1_050);
    await expect(selfLight).toHaveAttribute("data-sharing", "false");
    await expect.poll(() => readSession(visitor.page)).toMatchObject({
      hasKnocked: true,
      motionPreference: "off",
    });

    await visitor.page.reload();
    await expect(visitor.page.getByTestId("party-house")).toHaveAttribute(
      "data-connection",
      "live",
    );
    await expect(visitor.page.getByTestId("party-motion")).toBeVisible();
    await expect(visitor.page.getByTestId("party-motion")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  } finally {
    await visitor.context.close();
  }
});

test("keeps Living Glass keyboard and thumb friendly at 320px", async ({
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

    const knockBox = await page.getByTestId("party-knock").boundingBox();
    expect(knockBox).not.toBeNull();
    expect(knockBox!.width).toBeGreaterThanOrEqual(44);
    expect(knockBox!.height).toBeGreaterThanOrEqual(44);

    await page.getByTestId("party-knock").focus();
    await expect(page.getByTestId("party-knock")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("party-knock-wave")).toHaveCount(1);
    const motionBox = await page.getByTestId("party-motion").boundingBox();
    expect(motionBox).not.toBeNull();
    expect(motionBox!.width).toBeGreaterThanOrEqual(44);
    expect(motionBox!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("party-motion")).toBeFocused();
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
    await page.getByTestId("party-knock").click();
    const wave = page.getByTestId("party-knock-wave");
    await expect(wave).toHaveCount(1);
    expect(await wave.evaluate((element) => element.getAnimations().length)).toBe(
      0,
    );

    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await expect(page.getByTestId("party-switchboard")).toBeVisible();
    await expect(page.getByTestId("party-knock")).toBeVisible();
    await expect(page.getByTestId("party-motion")).toBeVisible();
    await expect(page.getByTestId("portal-atmosphere")).toBeHidden();
    await expect(page.getByTestId("party-light").first()).toBeHidden();
  } finally {
    await context.close();
  }
});

test("uses a static inner-header color step under reduced motion", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const home = await context.newPage();
  const inner = await context.newPage();

  try {
    await home.goto("/");
    await inner.goto("/blogs/");
    await expect(home.getByTestId("party-house")).toHaveAttribute(
      "data-connection",
      "live",
    );
    await expect(inner.getByTestId("party-house")).toHaveAttribute(
      "data-connection",
      "live",
    );
    await home.getByTestId("party-knock").click();
    await expect(inner.locator(".site-header")).toHaveCSS(
      "border-bottom-color",
      "rgb(43, 222, 203)",
    );
    await expect(inner.locator(".brand-mark")).toHaveCSS(
      "background-color",
      "rgb(43, 222, 203)",
    );
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
