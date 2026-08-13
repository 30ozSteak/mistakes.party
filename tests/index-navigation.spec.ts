import { expect, test, type Page } from "@playwright/test";

const destinations = [
  ["GITHUB", "https://github.com/30ozSteak"],
  ["MEDIUM", "https://medium.com/@30ozsteak"],
  ["PATREON", "https://patreon.com/steaks"],
  ["ITCH.IO", "https://steaks.itch.io"],
] as const;

async function waitForHome(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("party-presence")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
}

test("the homepage is a direct four-link portal", async ({ page }) => {
  await waitForHome(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "MISTAKES.PARTY",
  );
  await expect(page.getByRole("navigation", { name: "Elsewhere" })).toBeVisible();
  await expect(page.locator(".portal-link")).toHaveCount(4);

  for (const [name, href] of destinations) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute(
      "href",
      href,
    );
  }

  await expect(page.getByRole("button", { name: "Open primary navigation" })).toHaveCount(0);
  await expect(page.getByText("FOUR BAD DOORS")).toHaveCount(0);
  await expect(page.getByText("PICK ONE. IT DISAPPEARS.")).toBeHidden();
});

test("the portal fits a small mobile viewport without a block hover treatment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await waitForHome(page);

  const links = page.locator(".portal-link");
  for (const size of [
    { width: 320, height: 640 },
    { width: 320, height: 400 },
    { width: 640, height: 320 },
  ]) {
    await page.setViewportSize(size);

    const viewport = await page.locator(".portal-home").evaluate((home) => ({
      bodyScrollHeight: document.body.scrollHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      height: home.getBoundingClientRect().height,
      innerHeight,
      innerWidth,
    }));
    expect(viewport.documentScrollWidth).toBeLessThanOrEqual(
      viewport.innerWidth,
    );
    expect(viewport.documentScrollHeight).toBeLessThanOrEqual(
      viewport.innerHeight,
    );
    expect(viewport.bodyScrollHeight).toBeLessThanOrEqual(viewport.innerHeight);
    expect(Math.abs(viewport.height - viewport.innerHeight)).toBeLessThanOrEqual(
      1,
    );

    for (let index = 0; index < (await links.count()); index += 1) {
      const box = await links.nth(index).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  }

  const github = page.getByRole("link", { name: "GITHUB", exact: true });
  const githubArrow = github.locator(".portal-arrow");
  await expect(githubArrow).toHaveText("");
  expect(
    await github.evaluate(
      (element) => getComputedStyle(element, "::before").content,
    ),
  ).toBe("none");
  expect(
    await githubArrow.evaluate(
      (element) => getComputedStyle(element, "::before").content,
    ),
  ).toBe('\"\"');
  await expect(githubArrow).toHaveCSS("font-family", /^(?!.*Emoji)/);
  const restingBackground = await github.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  await github.hover();
  await expect
    .poll(() =>
      github.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe(restingBackground);
  await github.focus();
  await expect(github).toBeFocused();
  await expect(github).toHaveCSS("outline-style", "solid");

  await page.setViewportSize({ width: 320, height: 568 });
  const partyTrigger = page.getByTestId("party-trigger");
  await expect(page.getByTestId("party-presence")).toHaveAttribute(
    "data-connection",
    "live",
  );
  await expect(partyTrigger).toBeVisible();
  const partyBox = await partyTrigger.boundingBox();
  expect(partyBox).not.toBeNull();
  expect(partyBox!.width).toBeGreaterThanOrEqual(48);
  expect(partyBox!.height).toBeGreaterThanOrEqual(48);
  expect(partyBox!.x + partyBox!.width).toBeLessThanOrEqual(320);
  expect(partyBox!.y + partyBox!.height).toBeLessThanOrEqual(568);

  await partyTrigger.click();
  await expect(page.getByTestId("party-dialog")).toBeVisible();
  await expect(page.getByTestId("party-signal-cheers")).toBeFocused();
});
