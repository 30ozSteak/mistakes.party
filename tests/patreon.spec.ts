import { expect, test } from "@playwright/test";

const MEMBER_PASSWORD = "playwright-member-password";

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("protects the member route, rejects a bad password, and persists a valid grant", async ({
  context,
  page,
}) => {
  await page.goto("/patreon/room/");

  await expect(page).toHaveURL(
    /\/patreon\/?\?returnTo=%2Fpatreon%2Froom$/,
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("THE DOOR");
  await expect(page.getByText("PRIVATE SIGNAL 01")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "JOIN ON PATREON", exact: false }),
  ).toHaveAttribute("href", "https://patreon.com/steaks");

  const password = page.getByLabel("MEMBER PASSWORD");
  await password.fill("not-the-password");
  await page.getByRole("button", { name: "ENTER THE ROOM" }).click();
  await expect(page.locator(".patreon-form-error")).toHaveText(
    "That password did not open the door.",
  );
  await expect(page).toHaveURL(/\/patreon\/?\?returnTo=/);

  await password.fill(MEMBER_PASSWORD);
  await page.getByRole("button", { name: "ENTER THE ROOM" }).click();
  await expect(page).toHaveURL(/\/patreon\/room\/?$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "THE BACK ROOM",
  );
  await expect(page.getByText("PRIVATE SIGNAL 01")).toBeVisible();

  const grant = (await context.cookies()).find(
    ({ name }) => name === "mxp_patreon_access",
  );
  expect(grant).toBeTruthy();
  expect(grant?.httpOnly).toBe(true);
  expect(grant?.sameSite).toBe("Lax");
  expect(grant?.value).not.toContain(MEMBER_PASSWORD);

  await page.goto("/patreon/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("YOU'RE IN");
  await page.getByRole("link", { name: "ENTER THE PATRON ROOM" }).click();
  await expect(page).toHaveURL(/\/patreon\/room\/?$/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "THE BACK ROOM",
  );
});

test("fails closed for a tampered grant and can lock a shared browser", async ({
  context,
  page,
}) => {
  await page.goto("/patreon/");
  await page.getByLabel("MEMBER PASSWORD").fill(MEMBER_PASSWORD);
  await page.getByRole("button", { name: "ENTER THE ROOM" }).click();
  await expect(page).toHaveURL(/\/patreon\/room\/?$/);

  const grant = (await context.cookies()).find(
    ({ name }) => name === "mxp_patreon_access",
  );
  expect(grant).toBeTruthy();

  await context.addCookies([
    {
      ...grant!,
      value: `${grant!.value.slice(0, -1)}x`,
    },
  ]);
  await page.goto("/patreon/room/");
  await expect(page).toHaveURL(/\/patreon\/?\?returnTo=/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("THE DOOR");

  await page.goto(
    "/patreon/?returnTo=https%3A%2F%2Fevil.example%2Fstolen",
  );
  await page.getByLabel("MEMBER PASSWORD").fill(MEMBER_PASSWORD);
  await page.getByRole("button", { name: "ENTER THE ROOM" }).click();
  await page.getByRole("button", { name: "LOCK THIS BROWSER" }).click();
  await expect(page).toHaveURL(/\/patreon\/?$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("THE DOOR");
  expect(
    (await context.cookies()).some(
      ({ name }) => name === "mxp_patreon_access",
    ),
  ).toBe(false);
});

test("never offers anonymous public drawing on Patreon pages", async ({ page }) => {
  await page.goto("/patreon/");
  await page.getByTestId("drawing-menu-toggle").click();
  await expect(page.getByTestId("drawing-scope-public")).toHaveCount(0);
  await expect(page.locator(".drawing-scope-options")).toHaveAttribute(
    "data-public-available",
    "false",
  );
  await expect(page.getByTestId("drawing-scope-solo")).toBeVisible();
});

test("restores a Public drawing preference after leaving Patreon", async ({
  page,
}) => {
  const scopeKey = "mistakes-party.drawing.scope.v1";

  await page.goto("/");
  const playground = page.getByTestId("drawing-playground");
  await expect(playground).toHaveAttribute("data-hydrated", "true");
  await expect(playground).toHaveAttribute("data-scope", "public");

  await page.goto("/patreon/room/");
  await expect(page).toHaveURL(/\/patreon\/?\?returnTo=/);
  await expect(playground).toHaveAttribute("data-scope", "solo");
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
      scopeKey,
    ),
  ).toEqual({ version: 1, scope: "public" });

  await page.getByRole("link", { name: "MISTAKES.PARTY", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(playground).toHaveAttribute("data-scope", "public");
  await expect(page.getByTestId("drawing-session-count")).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
      scopeKey,
    ),
  ).toEqual({ version: 1, scope: "public" });
});
