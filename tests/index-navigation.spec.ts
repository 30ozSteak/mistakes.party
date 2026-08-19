import { expect, test } from "@playwright/test";

const destinations = [
  ["projects", "PROJECTS", "/code"],
  ["games", "GAMES", "https://steaks.itch.io"],
  ["websites", "WEBSITES", null],
  ["blogs", "BLOGS", null],
  ["shop", "SHOP", null],
] as const;

test("the homepage is a static five-section index", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "MISTAKES.PARTY",
  );
  await expect(page.locator("[data-portal-section] details")).toHaveCount(5);

  for (const [source, label, href] of destinations) {
    const section = page.locator(`[data-portal-section="${source}"]`);
    await section.locator("summary").click();
    await expect(section.locator("details")).toHaveAttribute("open", "");

    if (href) {
      await expect(
        section.getByRole("link", { name: new RegExp(`^OPEN ${label}`) }),
      ).toHaveAttribute("href", href);
    } else {
      await expect(
        section.getByRole("link", { name: new RegExp(`^OPEN ${label}`) }),
      ).toHaveCount(0);
    }

    await expect(page.locator(".portal-destinations details[open]")).toHaveCount(
      1,
    );
  }

  await expect(page.getByText(/ROOM OPEN|LIGHTS? (?:ON|HERE)/)).toHaveCount(0);
  await expect(page.locator('[data-testid^="party-"]')).toHaveCount(0);
});

test("the ambient SVG stays passive, slow, and motion-safe", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");

  const atmosphere = page.getByTestId("portal-atmosphere");
  const blob = page.getByTestId("ambient-blob");

  await expect(atmosphere).toHaveAttribute("aria-hidden", "true");
  await expect(atmosphere).toHaveCSS("pointer-events", "none");
  await expect(blob).toHaveCount(1);
  await expect(atmosphere.locator(".portal-frost")).toHaveCount(1);
  await expect(
    atmosphere.locator("a, button, input, select, textarea, [tabindex]"),
  ).toHaveCount(0);
  await expect(blob).toHaveCSS("color", "rgb(223, 255, 0)");
  await expect(blob).toHaveCSS("animation-duration", "190s, 137s, 260s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(blob).toHaveCSS("animation-name", "none");

  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await expect(atmosphere).toHaveCSS("display", "none");
});

test("the index remains contained on small phones", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);

  for (const summary of await page.locator(".portal-link").all()) {
    const box = await summary.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
