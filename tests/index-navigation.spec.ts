import { expect, test, type Page } from "@playwright/test";

const destinations = [
  ["github", "GITHUB", "https://github.com/30ozSteak"],
  ["medium", "MEDIUM", "https://medium.com/@30ozsteak"],
  ["itch", "ITCH.IO", "https://steaks.itch.io"],
] as const;

async function waitForHome(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("party-house")).toHaveAttribute(
    "data-connection",
    "live",
  );
}

test("the homepage is a three-link external index", async ({ page }) => {
  await waitForHome(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "MISTAKES.PARTY",
  );
  await expect(
    page.getByRole("navigation", { name: "Elsewhere" }),
  ).toBeVisible();
  await expect(page.locator("[data-portal-section]")).toHaveCount(3);
  await expect(page.locator(".portal-link")).toHaveCount(3);
  await expect(page.locator(".portal-arrow")).toHaveCount(3);

  for (const [source, label, href] of destinations) {
    const row = page.locator(`[data-portal-section="${source}"]`);
    const link = row.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toBeVisible();
  }

  await expect(page.locator("details, summary, .portal-panel")).toHaveCount(0);
  await expect(page.getByText(/PUBLIC REPOS/)).toHaveCount(0);
  await expect(page.getByText("UNTITLED GAME 01", { exact: true })).toHaveCount(
    0,
  );

  await expect(
    page.getByRole("link", { name: "SUPPORT ↗", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("MXP", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open primary navigation" }),
  ).toHaveCount(0);
});

test("the atmosphere responds without becoming part of the interface", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForHome(page);

  const atmosphere = page.getByTestId("portal-atmosphere");
  const field = atmosphere.locator(".portal-atmosphere-field");

  await expect(atmosphere).toHaveAttribute("aria-hidden", "true");
  await expect(atmosphere).toHaveAttribute("data-crowd", "0");
  await expect(atmosphere).toHaveCSS("pointer-events", "none");
  await expect(atmosphere.locator(".portal-atmosphere-glass")).toHaveCount(0);
  expect(
    await field.evaluate(
      (element) => getComputedStyle(element, "::before").filter,
    ),
  ).toMatch(
    /saturate\(1\.3\).*brightness\(1\.05\)/,
  );
  await expect(
    atmosphere.locator("a, button, input, select, textarea, [tabindex]"),
  ).toHaveCount(0);

  await page.mouse.move(1439, 899);
  await expect
    .poll(() =>
      atmosphere.evaluate((element) =>
        [
          "--portal-pointer-turn",
          "--portal-pointer-x",
          "--portal-pointer-y",
        ].every((property) =>
          Number.isFinite(
            Number.parseFloat(element.style.getPropertyValue(property)),
          ),
        ),
      ),
    )
    .toBe(true);

  const pointerPosition = await atmosphere.evaluate((element) => ({
    turn: Number.parseFloat(
      element.style.getPropertyValue("--portal-pointer-turn"),
    ),
    x: Number.parseFloat(element.style.getPropertyValue("--portal-pointer-x")),
    y: Number.parseFloat(element.style.getPropertyValue("--portal-pointer-y")),
  }));
  expect(pointerPosition.x).toBeGreaterThan(20);
  expect(pointerPosition.x).toBeLessThanOrEqual(24);
  expect(pointerPosition.y).toBeGreaterThan(12);
  expect(pointerPosition.y).toBeLessThanOrEqual(16);
  expect(Math.abs(pointerPosition.turn)).toBeLessThanOrEqual(6);

  await page
    .locator('[data-portal-section="medium"] > .portal-link')
    .hover();
  await expect
    .poll(() =>
      atmosphere.evaluate((element) =>
        getComputedStyle(element)
          .getPropertyValue("--portal-section-turn")
          .trim(),
      ),
    )
    .toBe("2.5deg");

  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);

  const light = atmosphere.locator(".portal-house-light").first();
  await expect(light).toBeAttached();
  expect(
    await light.evaluate(
      (element) => getComputedStyle(element, "::after").content,
    ),
  ).toBe("none");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(field).toHaveCSS("transform", "none");
  await page.mouse.move(1, 1);
  await expect
    .poll(() =>
      atmosphere.evaluate((element) =>
        element.style.getPropertyValue("--portal-pointer-x"),
      ),
    )
    .toBe("0px");

  await page.emulateMedia({
    forcedColors: "active",
    reducedMotion: "reduce",
  });
  await expect(atmosphere).toHaveCSS("display", "none");
});

test("the desktop links stay balanced without labels colliding with arrows", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const size of [
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 2048, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await waitForHome(page);

    const geometry = await page.locator(".portal-home").evaluate((home) => {
      const homeBox = home.getBoundingClientRect();
      const homeStyle = getComputedStyle(home);
      const mastheadBox = home
        .querySelector(".portal-masthead")!
        .getBoundingClientRect();
      const destinations = home.querySelector(".portal-destinations")!;
      const destinationsBox = destinations.getBoundingClientRect();
      const footerBox = home
        .querySelector(".portal-footer")!
        .getBoundingClientRect();
      const rootFontSize = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );

      const rows = [...destinations.querySelectorAll(".portal-link")].map(
        (link) => {
          const linkBox = link.getBoundingClientRect();
          const name = link.querySelector(".portal-name")!;
          const nameBox = name.getBoundingClientRect();
          const nameStyle = getComputedStyle(name);
          const arrowBox = link
            .querySelector(".portal-arrow")!
            .getBoundingClientRect();
          const labelRange = document.createRange();
          labelRange.selectNodeContents(name);
          const labelBox = labelRange.getBoundingClientRect();

          return {
            arrowCenter: arrowBox.top + arrowBox.height / 2,
            arrowLeft: arrowBox.left,
            arrowRight: arrowBox.right,
            bottomClearance: linkBox.bottom - nameBox.bottom,
            fontSize: Number.parseFloat(nameStyle.fontSize),
            labelRight: labelBox.right,
            nameBottom: nameBox.bottom,
            nameTop: nameBox.top,
            rowBottom: linkBox.bottom,
            rowHeight: linkBox.height,
            rowTop: linkBox.top,
            topClearance: nameBox.top - linkBox.top,
          };
        },
      );

      return {
        contentLeft: homeBox.left + Number.parseFloat(homeStyle.paddingLeft),
        contentRight: homeBox.right - Number.parseFloat(homeStyle.paddingRight),
        destinations: {
          bottom: destinationsBox.bottom,
          left: destinationsBox.left,
          right: destinationsBox.right,
          top: destinationsBox.top,
          width: destinationsBox.width,
        },
        documentScrollWidth: document.documentElement.scrollWidth,
        footerTop: footerBox.top,
        mastheadBottom: mastheadBox.bottom,
        rootFontSize,
        rows,
      };
    });

    const contentWidth = geometry.contentRight - geometry.contentLeft;
    const expectedWidth = Math.min(contentWidth, 90 * geometry.rootFontSize);
    const leftInset = geometry.destinations.left - geometry.contentLeft;
    const rightInset = geometry.contentRight - geometry.destinations.right;

    expect(Math.abs(geometry.destinations.width - expectedWidth)).toBeLessThan(
      1.5,
    );
    expect(Math.abs(leftInset - rightInset)).toBeLessThan(1.5);
    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(size.width);
    expect(
      geometry.destinations.top - geometry.mastheadBottom,
    ).toBeGreaterThanOrEqual(32);
    expect(
      geometry.footerTop - geometry.destinations.bottom,
    ).toBeGreaterThanOrEqual(32);

    for (const [index, row] of geometry.rows.entries()) {
      expect(row.topClearance).toBeGreaterThanOrEqual(10);
      expect(row.bottomClearance).toBeGreaterThanOrEqual(10);
      expect(row.rowHeight).toBeGreaterThanOrEqual(row.fontSize + 16);
      expect(row.arrowLeft - row.labelRight).toBeGreaterThanOrEqual(24);
      expect(row.arrowLeft).toBeGreaterThanOrEqual(geometry.destinations.left);
      expect(row.arrowRight).toBeLessThanOrEqual(geometry.destinations.right);
      expect(
        Math.abs(row.arrowCenter - (row.rowTop + row.rowHeight / 2)),
      ).toBeLessThan(1.5);

      const nextRow = geometry.rows[index + 1];
      if (nextRow) {
        expect(Math.abs(row.rowBottom - nextRow.rowTop)).toBeLessThan(1.5);
        expect(nextRow.nameTop - row.nameBottom).toBeGreaterThanOrEqual(20);
      }
    }

    const rowHeights = geometry.rows.map(({ rowHeight }) => rowHeight);
    expect(Math.max(...rowHeights) - Math.min(...rowHeights)).toBeLessThan(
      1.5,
    );
  }
});

test("the direct links stay usable and contained on small phones", async ({
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
      bottomPadding: Number.parseFloat(getComputedStyle(home).paddingBottom),
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      destinationsBottom: home
        .querySelector(".portal-destinations")!
        .getBoundingClientRect().bottom,
      destinationsMarginBottom: Number.parseFloat(
        getComputedStyle(home.querySelector(".portal-destinations")!)
          .marginBottom,
      ),
      footerBottom: home
        .querySelector(".portal-footer")!
        .getBoundingClientRect().bottom,
      footerTop: home
        .querySelector(".portal-footer")!
        .getBoundingClientRect().top,
      homeBottom: home.getBoundingClientRect().bottom,
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
    expect(Math.abs(viewport.height - viewport.innerHeight)).toBeLessThanOrEqual(
      1,
    );
    expect(
      Math.abs(viewport.homeBottom - viewport.innerHeight),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        viewport.innerHeight -
          viewport.footerBottom -
          viewport.bottomPadding,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        viewport.footerTop -
          viewport.destinationsBottom -
          viewport.destinationsMarginBottom,
      ),
    ).toBeLessThanOrEqual(1);

    for (const [, label] of destinations) {
      const link = page.getByRole("link", { name: label, exact: true });
      const [linkBox, nameBox] = await Promise.all([
        link.boundingBox(),
        link.locator(".portal-name").boundingBox(),
      ]);
      expect(linkBox).not.toBeNull();
      expect(nameBox).not.toBeNull();
      expect(linkBox!.x).toBeGreaterThanOrEqual(0);
      expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(size.width);
      expect(linkBox!.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(nameBox!.x - linkBox!.x)).toBeLessThanOrEqual(1);
    }
  }

  const githubLink = page.getByRole("link", { name: "GITHUB", exact: true });
  await page.mouse.move(0, 0);
  const restingBackground = await githubLink.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await expect(githubLink).toHaveCSS("outline-style", "none");
  await githubLink.hover();
  await expect(githubLink).toHaveCSS("background-color", restingBackground);
  await githubLink.focus();
  await expect(githubLink).toBeFocused();
  await expect(githubLink).toHaveCSS("outline-style", "solid");
  await expect(githubLink).toHaveCSS("background-color", restingBackground);

  const partySwitchboard = page.getByTestId("party-switchboard");
  const email = page.getByRole("link", { name: "HELLO@MISTAKES.PARTY" });
  const [partyBox, emailBox] = await Promise.all([
    partySwitchboard.boundingBox(),
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

  await expect(page.getByTestId("party-house")).toHaveAttribute(
    "data-connection",
    "live",
  );
  await page.getByTestId("party-knock").click();
  await expect(page.getByTestId("party-knock-wave")).toHaveCount(1);
  await expect(page.getByTestId("party-motion")).toBeVisible();
});
