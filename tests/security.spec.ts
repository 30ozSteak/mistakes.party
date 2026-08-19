import { expect, test } from "@playwright/test";

test("keeps the static-compatible security policy and blocks inline handlers", async ({
  page,
}) => {
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"] ?? "";

  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self' 'unsafe-inline'");
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toContain("nonce-");
  expect(policy).not.toContain("mistakes-party-drawing-realtime");

  await page.evaluate(() => {
    const button = document.createElement("button");
    button.setAttribute("onclick", "window.__inlineHandlerExecuted = true");
    document.body.append(button);
    button.click();
  });

  await expect
    .poll(() =>
      page.evaluate(() => "__inlineHandlerExecuted" in window),
    )
    .toBe(false);
});
