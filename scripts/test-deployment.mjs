import { chromium, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const url =
  process.env.LISTFLOW_URL || "https://harmony.great-kettle.ts.net:4443/listflow";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.LISTFLOW_PROXY
    ? { proxy: { server: process.env.LISTFLOW_PROXY } }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url + "/");
await expect(page.getByRole("heading", { name: "Today." })).toBeVisible();
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
await page.getByRole("textbox", { name: "Workspace password" }).fill(password);
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await expect(
  page.getByText("Signed in to your private workspace."),
).toBeVisible();
await page.getByRole("button", { name: "Close settings" }).click();
const title = "Deployment verification " + Date.now();
await page.getByRole("button", { name: "Add item", exact: true }).click();
await page.getByRole("textbox", { name: "What’s on your mind?" }).fill(title);
await page
  .locator(".capture-modal")
  .getByRole("button", { name: "Add item" })
  .click();
await expect(
  page.locator(".task-title").filter({ hasText: title }),
).toBeVisible();
await expect
  .poll(
    async () => {
      const r = await context.request.get(
        url + "/api/search?query=" + encodeURIComponent(title),
      );
      return (await r.json()).total;
    },
    { timeout: 15000 },
  )
  .toBe(1);
mkdirSync("docs/screenshots", { recursive: true });
await page.screenshot({
  path: "docs/screenshots/web-desktop.png",
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "docs/screenshots/web-mobile.png",
  fullPage: true,
});
await page.locator(".task-title").filter({ hasText: title }).click();
await page.getByRole("button", { name: "Move to trash", exact: true }).click();
const metadata = await context.request.get(
  url + "/.well-known/oauth-authorization-server",
);
expect((await metadata.json()).issuer).toBe(url);
if (errors.length) throw new Error("Browser errors: " + errors.join("; "));
console.log(
  "PASS: Harmony HTTPS route, production JavaScript, owner login, local capture, durable sync, desktop/mobile render, OAuth discovery.",
);
await browser.close();
