import { expect, test } from "@playwright/test";

test("enforces the nonce CSP without breaking hydration", async ({ page }) => {
  const unexpectedCspViolations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /content security policy/i.test(message.text())
    ) {
      unexpectedCspViolations.push(message.text());
    }
  });

  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"] ?? "";
  const nonce = policy.match(/'nonce-([a-f0-9]{32})'/)?.[1];

  expect(nonce).toBeTruthy();
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).toContain("style-src-attr 'none'");
  expect(policy).not.toMatch(/script-src [^;]*'unsafe-inline'/);

  const scriptNonces = await page.locator("script").evaluateAll((scripts) =>
    scripts.map((script) => (script as HTMLScriptElement).nonce),
  );
  const nonEmptyScriptNonces = scriptNonces.filter(Boolean);
  expect(nonEmptyScriptNonces.length).toBeGreaterThan(0);
  expect(nonEmptyScriptNonces.every((value) => value === nonce)).toBe(true);

  const atmosphere = page.getByTestId("portal-atmosphere");
  await expect(atmosphere).toHaveAttribute("aria-hidden", "true");
  await page.mouse.move(1200, 700);
  await expect
    .poll(() =>
      atmosphere.evaluate((element) =>
        element.style.getPropertyValue("--portal-pointer-x"),
      ),
    )
    .not.toBe("");

  // Turbopack may append same-origin HMR scripts after parsing, so those tags
  // need not copy the nonce. Inline scripts still require it.
  await page.waitForTimeout(100);
  expect(unexpectedCspViolations).toEqual([]);

  await expect(page.getByTestId("party-house")).toHaveAttribute(
    "data-connection",
    "live",
  );
  await page.getByTestId("party-balloon-trigger").click();
  await expect(page.getByTestId("party-balloon")).toHaveCount(1);
  await page.getByTestId("party-balloon-trigger").click();
  await expect(page.getByTestId("party-balloon-dialog")).toBeVisible();
  await expect(page.getByTestId("party-motion")).toBeVisible();
  await page.getByRole("button", { name: "Close balloon guestbook" }).click();
  await page.getByRole("button", { name: /^GITHUB/ }).hover();
  await expect(
    page.locator('[data-testid="party-light"][data-self="true"]'),
  ).toHaveAttribute("data-sharing", "true");
  await page.waitForTimeout(100);
  expect(unexpectedCspViolations).toEqual([]);

  await page.evaluate(() => {
    const inlineScript = document.createElement("script");
    inlineScript.textContent = "window.__cspInlineScriptExecuted = true";
    document.head.append(inlineScript);

    const javascriptUrl = document.createElement("a");
    javascriptUrl.href =
      "javascript:window.__cspJavascriptUrlExecuted = true;void 0";
    document.body.append(javascriptUrl);
    javascriptUrl.click();
  });

  await expect
    .poll(() =>
      page.evaluate(() => ({
        inline: "__cspInlineScriptExecuted" in window,
        javascriptUrl: "__cspJavascriptUrlExecuted" in window,
      })),
    )
    .toEqual({ inline: false, javascriptUrl: false });

  await page.evaluate(() => {
    const sameOriginScript = document.createElement("script");
    sameOriginScript.src = "/_next/static/chunks/polyfills.js";
    document.head.append(sameOriginScript);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.scripts].some(
          (script) =>
            script.src.endsWith("/_next/static/chunks/polyfills.js") &&
            (script as HTMLScriptElement).nonce === "",
        ),
      ),
    )
    .toBe(true);
});
