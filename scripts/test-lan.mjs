import { chromium, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
const base = "http://harmony.local:4443/listflow";
const browser = await chromium.launch({
  proxy: { server: "socks5://127.0.0.1:1088" },
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://harmony.local:4443/");
  await expect(
    page.getByRole("heading", { name: "Your space." }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  const password = execFileSync(
    "ssh",
    [
      "-F",
      "/home/doomslug/.ssh/config",
      "harmony",
      "cat ~/repos/listflow/data/admin-password",
    ],
    { encoding: "utf8" },
  ).trim();
  await page.getByRole("button", { name: "Open account settings" }).click();
  await page
    .getByRole("textbox", { name: "Workspace password" })
    .fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Signed in to your private workspace."),
  ).toBeVisible();
  const cookie = (await context.cookies()).find(
    (c) => c.name === "listflow_session",
  );
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.secure).toBe(false);
  await page.getByRole("button", { name: "Close settings" }).click();
  const title = "LAN verification " + Date.now();
  await page.getByRole("button", { name: "Write a note", exact: true }).click();
  await page.getByRole("textbox", { name: "What’s on your mind?" }).fill(title);
  await page
    .locator(".capture-modal")
    .getByRole("button", { name: "Add item" })
    .click();
  await expect(page.locator(".capture-modal")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          await (
            await context.request.get(
              base + "/api/search?query=" + encodeURIComponent(title),
            )
          ).json()
        ).total,
      { timeout: 15000 },
    )
    .toBe(1);
  await page.reload();
  await page.locator(".home-note").filter({ hasText: title }).click();
  await page
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  const denied = await context.request.post(base + "/auth/login", {
    headers: { Origin: "http://untrusted.example" },
    data: { password },
  });
  expect(denied.status()).toBe(403);
  const secureBase = "https://harmony.great-kettle.ts.net:4443/listflow";
  const secure = await context.request.post(secureBase + "/auth/login", {
    data: { password },
  });
  expect(secure.ok()).toBe(true);
  expect(secure.headers()["set-cookie"]).toContain("Secure");
  expect(errors).toEqual([]);
  console.log(
    "PASS: LAN HTTP redirect, non-secure-context capture, owner login, cookie persistence, server sync, reload, cleanup, origin denial, HTTPS Secure cookie preserved.",
  );
} finally {
  await browser.close();
}
