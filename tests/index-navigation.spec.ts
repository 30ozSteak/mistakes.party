import { expect, test, type Locator, type Page } from "@playwright/test";

const sections = [
  ["github", "GITHUB"],
  ["medium", "MEDIUM"],
  ["itch", "ITCH.IO"],
] as const;

async function waitForHome(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("party-presence")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
}

test("the homepage is a three-part expandable external index", async ({
  page,
}) => {
  await waitForHome(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "MISTAKES.PARTY",
  );
  await expect(
    page.getByRole("navigation", { name: "Elsewhere" }),
  ).toBeVisible();
  await expect(page.locator("[data-portal-section]")).toHaveCount(3);
  await expect(page.locator('details[name="portal-sections"]')).toHaveCount(3);
  await expect(page.locator(".portal-link")).toHaveCount(3);
  await expect(page.locator(".portal-number")).toHaveCount(0);
  await expect(page.getByText(/PUBLIC REPOS/)).toHaveCount(0);

  const support = page.getByRole("link", { name: "SUPPORT ↗", exact: true });
  await expect(support).toHaveAttribute("href", "https://patreon.com/steaks");
  await expect(page.locator('summary[aria-label="PATREON"]')).toHaveCount(0);
  await expect(page.getByText("MXP", { exact: true })).toHaveCount(0);

  let previouslyOpened: Locator | null = null;
  for (const [source, label] of sections) {
    const details = page.locator(`[data-portal-section="${source}"]`);

    await expect(details).not.toHaveAttribute("open", "");
    await expect(details.locator(".portal-panel")).not.toBeVisible();
    await details.locator(`summary[aria-label="${label}"]`).click();
    await expect(details).toHaveAttribute("open", "");
    await expect(details.locator(".portal-panel")).toBeVisible();
    if (previouslyOpened) {
      await expect(previouslyOpened).not.toHaveAttribute("open", "");
    }
    await expect(page).toHaveURL(/\/$/);
    previouslyOpened = details;
  }

  const github = page.locator('[data-portal-section="github"]');
  const githubSummary = github.locator("summary");
  await githubSummary.focus();
  await page.keyboard.press("Enter");
  await expect(github).toHaveAttribute("open", "");
  await expect(
    page.locator('[data-portal-section="itch"]'),
  ).not.toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(github).not.toHaveAttribute("open", "");

  const itch = page.locator('[data-portal-section="itch"]');
  await itch.locator("summary").click();
  await expect(itch.locator('[data-source-item="itch"]')).toHaveCount(5);
  await expect(itch.getByText("UNTITLED GAME 01", { exact: true })).toBeVisible();
  await expect(itch.getByText("UNTITLED GAME 05", { exact: true })).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Open primary navigation" }),
  ).toHaveCount(0);
  await expect(page.getByText("FOUR BAD DOORS")).toHaveCount(0);
  await expect(page.getByText("PICK ONE. IT DISAPPEARS.")).toBeHidden();
});

test("the disclosures stay usable and horizontally contained on small phones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await waitForHome(page);

  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);

    const viewport = await page.locator(".portal-home").evaluate((home) => ({
      documentScrollWidth: document.documentElement.scrollWidth,
      height: home.getBoundingClientRect().height,
      innerHeight,
      innerWidth,
    }));
    expect(viewport.documentScrollWidth).toBeLessThanOrEqual(
      viewport.innerWidth,
    );
    expect(viewport.height).toBeGreaterThanOrEqual(viewport.innerHeight);

    for (const [, label] of sections) {
      const summary = page.locator(`summary[aria-label="${label}"]`);
      const [summaryBox, nameBox] = await Promise.all([
        summary.boundingBox(),
        summary.locator(".portal-name").boundingBox(),
      ]);
      expect(summaryBox).not.toBeNull();
      expect(nameBox).not.toBeNull();
      expect(summaryBox!.x).toBeGreaterThanOrEqual(0);
      expect(summaryBox!.x + summaryBox!.width).toBeLessThanOrEqual(size.width);
      expect(summaryBox!.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(nameBox!.x - summaryBox!.x)).toBeLessThanOrEqual(1);
    }

    const supportBox = await page
      .getByRole("link", { name: "SUPPORT ↗", exact: true })
      .boundingBox();
    expect(supportBox).not.toBeNull();
    expect(supportBox!.width).toBeGreaterThanOrEqual(44);
    expect(supportBox!.height).toBeGreaterThanOrEqual(44);
  }

  await page.setViewportSize({ width: 320, height: 568 });
  let previouslyOpened: Locator | null = null;
  for (const [source] of sections) {
    const details = page.locator(`[data-portal-section="${source}"]`);
    await details.locator("summary").click();
    if ((await details.getAttribute("open")) === null) {
      await details.locator("summary").click();
    }
    await expect(details).toHaveAttribute("open", "");
    if (previouslyOpened) {
      await expect(previouslyOpened).not.toHaveAttribute("open", "");
    }
    previouslyOpened = details;
  }

  const expandedViewport = await page.evaluate(() => ({
    innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  }));
  expect(expandedViewport.scrollHeight).toBeGreaterThan(
    expandedViewport.innerHeight,
  );
  expect(expandedViewport.scrollWidth).toBeLessThanOrEqual(
    expandedViewport.innerWidth,
  );

  const lastGame = page.locator('[data-source-item="itch"]').last();
  await lastGame.scrollIntoViewIfNeeded();
  await expect(lastGame).toBeVisible();
  await page.locator(".portal-footer").scrollIntoViewIfNeeded();

  const partyTrigger = page.getByTestId("party-trigger");
  const email = page.getByRole("link", { name: "HELLO@MISTAKES.PARTY" });
  const [partyBox, emailBox] = await Promise.all([
    partyTrigger.boundingBox(),
    email.boundingBox(),
  ]);
  expect(partyBox).not.toBeNull();
  expect(emailBox).not.toBeNull();
  const overlaps = !(
    partyBox!.x >= emailBox!.x + emailBox!.width ||
    emailBox!.x >= partyBox!.x + partyBox!.width ||
    partyBox!.y >= emailBox!.y + emailBox!.height ||
    emailBox!.y >= partyBox!.y + partyBox!.height
  );
  expect(overlaps).toBe(false);

  const githubSummary = page.locator(
    '[data-portal-section="github"] summary',
  );
  await page.mouse.move(0, 0);
  await githubSummary.evaluate((element) => (element as HTMLElement).blur());
  const restingBackground = await githubSummary.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await expect(githubSummary).toHaveCSS("outline-style", "none");
  await githubSummary.hover();
  await expect
    .poll(() =>
      githubSummary.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    )
    .toBe(restingBackground);
  await page.mouse.move(0, 0);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (
      await githubSummary.evaluate(
        (element) => element === document.activeElement,
      )
    ) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(githubSummary).toBeFocused();
  await expect(githubSummary).toHaveCSS("outline-style", "solid");
  await expect(githubSummary).toHaveCSS(
    "background-color",
    restingBackground,
  );
  await githubSummary.evaluate((element) => (element as HTMLElement).blur());
  await page.mouse.move(0, 0);
  await expect
    .poll(() =>
      githubSummary.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    )
    .toBe(restingBackground);

  await githubSummary.click();
  await expect(
    page.locator('[data-portal-section="github"]'),
  ).toHaveAttribute("open", "");
  await expect(
    page.locator('[data-portal-section="itch"]'),
  ).not.toHaveAttribute("open", "");
  await expect(githubSummary).toHaveCSS(
    "background-color",
    restingBackground,
  );

  await expect(page.getByTestId("party-presence")).toHaveAttribute(
    "data-connection",
    "live",
  );
  await partyTrigger.click();
  await expect(page.getByTestId("party-dialog")).toBeVisible();
  await expect(page.getByTestId("party-signal-cheers")).toBeFocused();
});
