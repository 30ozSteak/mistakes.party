import { expect, test, type Locator, type Page } from "@playwright/test";

const destinations = [
  ["GITHUB", "https://github.com/30ozSteak"],
  ["MEDIUM", "https://medium.com/@30ozsteak"],
  ["PATREON", "https://patreon.com/steaks"],
  ["ITCH.IO", "https://steaks.itch.io"],
] as const;

async function waitForHome(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("drawing-playground")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
}

async function sweepScale(link: Locator) {
  return link.evaluate((element) => {
    const transform = getComputedStyle(element, "::before").transform;
    if (transform === "none") return 1;
    return new DOMMatrixReadOnly(transform).a;
  });
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
  await expect(page.getByText("PICK ONE")).toHaveCount(0);
});

test("the portal stays usable at 320px and reveals neon only on interaction", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await waitForHome(page);

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);

  const links = page.locator(".portal-link");
  for (let index = 0; index < (await links.count()); index += 1) {
    const box = await links.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  const github = page.getByRole("link", { name: "GITHUB", exact: true });
  expect(await sweepScale(github)).toBeLessThan(0.01);

  await github.focus();
  await expect(github).toBeFocused();
  await expect.poll(() => sweepScale(github)).toBeGreaterThan(0.99);

  await expect(page.getByTestId("public-nudge")).toHaveCount(0);
  await expect(page.getByTestId("drawing-menu-toggle")).toBeVisible();
  await expect(page.getByTestId("drawing-toggle")).toBeVisible();
});
