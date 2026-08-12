import { expect, test, type Page } from "@playwright/test";

async function waitForApp(page: Page, pathname = "/") {
  await page.goto(pathname);
  await expect(page.getByTestId("drawing-playground")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
}

test("whole index rows navigate internally from their titles and metadata", async ({
  page,
}) => {
  await waitForApp(page);

  const projectRow = page.getByRole("link", {
    name: "LIGHTHOUSE CHECKER",
    exact: true,
  });
  await expect(projectRow).toHaveAttribute(
    "href",
    /\/work\/lighthouse-checker\/?$/,
  );
  await expect(projectRow.getByText("TOOL / CODE · PUBLIC")).toBeVisible();
  await projectRow.getByText("TOOL / CODE · PUBLIC").click();
  await expect(page).toHaveURL(/\/work\/lighthouse-checker\/?$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "LIGHTHOUSE CHECKER",
  );

  await waitForApp(page);
  const archiveRow = page.getByRole("link", {
    name: "APPLAUSE BUTTON",
    exact: true,
  });
  await archiveRow.focus();
  await expect(archiveRow).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/archive\/applause-button\/?$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "APPLAUSE BUTTON",
  );
  await expect(
    page.getByRole("link", { name: "VIEW ON GITHUB", exact: false }),
  ).toHaveAttribute(
    "href",
    "https://github.com/30ozSteak/applause-button",
  );
});

test("the code landing page promotes the complete GitHub archive", async ({
  page,
}) => {
  await waitForApp(page);

  await page.getByRole("link", { name: "ALL REPOS", exact: true }).click();
  await expect(page).toHaveURL(/\/code\/?$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ALL REPOS");
  await expect(
    page.getByRole("link", { name: "BROWSE GITHUB", exact: false }),
  ).toHaveAttribute(
    "href",
    "https://github.com/30ozSteak?tab=repositories",
  );
});
