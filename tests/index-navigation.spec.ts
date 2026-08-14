import { expect, test, type Locator, type Page } from "@playwright/test";

const sections = [
  ["github", "GITHUB"],
  ["medium", "MEDIUM"],
  ["itch", "ITCH.IO"],
] as const;

async function waitForHome(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("party-house")).toHaveAttribute(
    "data-connection",
    "live",
  );
}

async function waitForPortalMotion(page: Page) {
  await page.locator(".portal-destinations").evaluate(async (destinations) => {
    const animations = destinations.getAnimations({ subtree: true });
    await Promise.all(
      animations.map((animation) => animation.finished.catch(() => undefined)),
    );
  });
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

test("the glass atmosphere responds without becoming part of the interface", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForHome(page);

  const atmosphere = page.getByTestId("portal-atmosphere");
  const field = atmosphere.locator(".portal-atmosphere-field");

  await expect(atmosphere).toHaveAttribute("aria-hidden", "true");
  await expect(atmosphere).toHaveCSS("pointer-events", "none");
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

  const medium = page.locator('[data-portal-section="medium"]');
  await medium.locator("summary").click();
  await expect(medium).toHaveAttribute("open", "");
  await expect
    .poll(() =>
      atmosphere.evaluate((element) =>
        getComputedStyle(element)
          .getPropertyValue("--portal-section-turn")
          .trim(),
      ),
    )
    .toBe("5deg");
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);

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

test("the disclosure panels ease open and closed while respecting reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await waitForHome(page);

  const itch = page.locator('[data-portal-section="itch"]');
  const motion = await itch.evaluate(async (details) => {
    const summary = details.querySelector("summary");
    if (!summary) throw new Error("Disclosure summary is missing");

    const sampleHeight = async () => {
      const heights: number[] = [];
      const start = performance.now();

      do {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        heights.push(details.getBoundingClientRect().height);
      } while (performance.now() - start < 480);

      return heights;
    };

    summary.click();
    const opening = await sampleHeight();
    summary.click();
    const closing = await sampleHeight();
    const panelStyle = getComputedStyle(details, "::details-content");

    return {
      closing,
      opening,
      transitionDuration: panelStyle.transitionDuration,
      transitionProperty: panelStyle.transitionProperty,
    };
  });

  expect(motion.transitionProperty).toContain("grid-template-rows");
  expect(motion.transitionDuration).toContain("0.42s");
  expect(motion.opening.at(-1)! - motion.opening[0]).toBeGreaterThan(100);
  expect(motion.closing[0] - motion.closing.at(-1)!).toBeGreaterThan(100);
  expect(
    new Set(motion.opening.map((height) => Math.round(height))).size,
  ).toBeGreaterThan(5);
  expect(
    new Set(motion.closing.map((height) => Math.round(height))).size,
  ).toBeGreaterThan(5);
  expect(itch).not.toHaveAttribute("open", "");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedDuration = await itch.evaluate(
    (details) =>
      getComputedStyle(details, "::details-content").transitionDuration,
  );
  expect(
    reducedDuration
      .split(",")
      .every((duration) => duration.trim() === "0s"),
  ).toBe(true);

  await itch.locator("summary").click();
  await expect(itch).toHaveAttribute("open", "");
  await expect(itch.locator(".portal-panel")).toBeVisible();
});

test("the desktop index stays balanced without labels colliding with its rules", async ({
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

      const rows = [...destinations.querySelectorAll("summary")].map(
        (summary) => {
          const summaryBox = summary.getBoundingClientRect();
          const name = summary.querySelector(".portal-name")!;
          const nameBox = name.getBoundingClientRect();
          const nameStyle = getComputedStyle(name);
          const toggleBox = summary
            .querySelector(".portal-toggle")!
            .getBoundingClientRect();
          const labelRange = document.createRange();
          labelRange.selectNodeContents(name);
          const labelBox = labelRange.getBoundingClientRect();

          return {
            bottomClearance: summaryBox.bottom - nameBox.bottom,
            fontSize: Number.parseFloat(nameStyle.fontSize),
            labelRight: labelBox.right,
            nameBottom: nameBox.bottom,
            nameTop: nameBox.top,
            rowBottom: summaryBox.bottom,
            rowHeight: summaryBox.height,
            rowTop: summaryBox.top,
            toggleCenter: toggleBox.top + toggleBox.height / 2,
            toggleLeft: toggleBox.left,
            toggleRight: toggleBox.right,
            topClearance: nameBox.top - summaryBox.top,
          };
        },
      );

      return {
        contentLeft:
          homeBox.left + Number.parseFloat(homeStyle.paddingLeft),
        contentRight:
          homeBox.right - Number.parseFloat(homeStyle.paddingRight),
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
      expect(row.toggleLeft - row.labelRight).toBeGreaterThanOrEqual(24);
      expect(row.toggleLeft).toBeGreaterThanOrEqual(
        geometry.destinations.left,
      );
      expect(row.toggleRight).toBeLessThanOrEqual(
        geometry.destinations.right,
      );
      expect(
        Math.abs(row.toggleCenter - (row.rowTop + row.rowHeight / 2)),
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

    const github = page.locator('[data-portal-section="github"]');
    await github.locator("summary").click();
    await expect(github).toHaveAttribute("open", "");
    await expect(github.locator(".portal-panel")).toBeVisible();

    const expanded = await page
      .locator(".portal-destinations")
      .evaluate((destinations) => {
        const destinationsBox = destinations.getBoundingClientRect();
        const firstSummaryBox = destinations
          .querySelector("summary")!
          .getBoundingClientRect();
        const panelBox = destinations
          .querySelector(".portal-panel")!
          .getBoundingClientRect();
        const nextSummaryBox = destinations
          .querySelectorAll("summary")[1]!
          .getBoundingClientRect();

        return {
          destinationsLeft: destinationsBox.left,
          destinationsRight: destinationsBox.right,
          documentScrollWidth: document.documentElement.scrollWidth,
          firstSummaryBottom: firstSummaryBox.bottom,
          nextSummaryTop: nextSummaryBox.top,
          panelBottom: panelBox.bottom,
          panelLeft: panelBox.left,
          panelRight: panelBox.right,
          panelTop: panelBox.top,
        };
      });

    expect(
      Math.abs(expanded.panelLeft - expanded.destinationsLeft),
    ).toBeLessThan(1.5);
    expect(
      Math.abs(expanded.panelRight - expanded.destinationsRight),
    ).toBeLessThan(1.5);
    expect(expanded.panelTop).toBeGreaterThanOrEqual(
      expanded.firstSummaryBottom - 1.5,
    );
    expect(expanded.nextSummaryTop).toBeGreaterThanOrEqual(
      expanded.panelBottom - 1.5,
    );
    expect(expanded.documentScrollWidth).toBeLessThanOrEqual(size.width);
  }
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

  await waitForPortalMotion(page);

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

  await expect(page.getByTestId("party-house")).toHaveAttribute(
    "data-connection",
    "live",
  );
  await page.getByTestId("party-knock").click();
  await expect(page.getByTestId("party-knock-wave")).toHaveCount(1);
  await expect(page.getByTestId("party-motion")).toBeVisible();
});
