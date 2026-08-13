import { expect, test, type Browser, type Page } from "@playwright/test";

async function openPartyPage(browser: Browser, pathname = "/") {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(pathname);
  await expect(page.getByTestId("party-presence")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  return { context, page };
}

async function expectHere(page: Page, count: number) {
  await expect(page.getByTestId("party-trigger")).toContainText(
    `${count} HERE`,
    { timeout: 10_000 },
  );
}

test("counts unique sessions on one route and isolates other routes", async ({
  browser,
}) => {
  const first = await openPartyPage(browser, "/work/itadw/");
  const second = await openPartyPage(browser, "/work/itadw/");
  const elsewhere = await openPartyPage(
    browser,
    "/work/lighthouse-checker/",
  );

  try {
    await expectHere(first.page, 2);
    await expectHere(second.page, 2);
    await expectHere(elsewhere.page, 1);

    await second.context.close();
    await expectHere(first.page, 1);
    await expectHere(elsewhere.page, 1);

    await first.page.reload();
    await expectHere(first.page, 1);
  } finally {
    await first.context.close();
    await elsewhere.context.close();
  }
});

test("broadcasts a fixed signal once, expires it, and never replays it", async ({
  browser,
}) => {
  const sender = await openPartyPage(browser, "/archive/applause-button/");
  const peer = await openPartyPage(browser, "/archive/applause-button/");

  try {
    await expectHere(sender.page, 2);
    await sender.page.getByTestId("party-trigger").click();
    await sender.page.getByTestId("party-signal-cheers").click();

    const senderEvent = sender.page.locator(
      '[data-testid="party-signal-event"][data-kind="cheers"]',
    );
    const peerEvent = peer.page.locator(
      '[data-testid="party-signal-event"][data-kind="cheers"]',
    );
    await expect(senderEvent).toHaveCount(1);
    await expect(peerEvent).toHaveCount(1);
    await expect(sender.page.getByRole("status")).toHaveText("Sent CHEERS.");
    await expect(sender.page.getByTestId("party-dialog")).not.toBeVisible();

    const late = await openPartyPage(browser, "/archive/applause-button/");
    try {
      await expect(
        late.page.locator('[data-testid="party-signal-event"]'),
      ).toHaveCount(0);
    } finally {
      await late.context.close();
    }

    await expect(senderEvent).toHaveCount(0, { timeout: 5_000 });
    await expect(peerEvent).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await sender.context.close();
    await peer.context.close();
  }
});

test("keeps the signal sheet keyboard and thumb friendly at 320px", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 640 },
  });
  const page = await context.newPage();

  try {
    await page.goto("/");
    await expect(page.getByTestId("party-presence")).toHaveAttribute(
      "data-connection",
      "live",
    );
    const trigger = page.getByTestId("party-trigger");
    await trigger.click();

    const dialog = page.getByTestId("party-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("party-signal-cheers")).toBeFocused();

    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(320);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(640);

    for (const kind of ["cheers", "hi", "bad_idea", "i_was_here"]) {
      const box = await page.getByTestId(`party-signal-${kind}`).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

test("does not mount public party presence anywhere under Patreon", async ({
  page,
}) => {
  await page.goto("/patreon/");
  await expect(page.getByTestId("party-presence")).toHaveCount(0);

  await page.goto("/patreon/room/");
  await expect(page).toHaveURL(/\/patreon\/?\?returnTo=/);
  await expect(page.getByTestId("party-presence")).toHaveCount(0);
});
