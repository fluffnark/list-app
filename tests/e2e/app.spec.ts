import { test, expect, type Page } from "@playwright/test";
async function capture(page: Page, title: string) {
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByRole("textbox", { name: "What’s on your mind?" }).fill(title);
  await page
    .locator(".capture-modal")
    .getByRole("button", { name: "Add item" })
    .click();
  await expect(page.locator(".capture-modal")).toHaveCount(0);
}
test("capture survives offline reload, supports hierarchy and undo", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today." })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await capture(page, "Offline parent");
  await expect(
    page.locator(".task-title").filter({ hasText: /^Offline parent$/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".task-title").filter({ hasText: /^Offline parent$/ }),
  ).toBeVisible();
  await page.getByText("Offline parent", { exact: true }).click();
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await page
    .getByRole("textbox", { name: "What’s on your mind?" })
    .fill("Offline child");
  await page
    .locator(".capture-modal")
    .getByRole("button", { name: "Add item" })
    .click();
  await page.getByRole("button", { name: "Close details" }).click();
  await page
    .getByRole("button", { name: "Complete Offline parent", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Complete the whole task?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep working" }).click();
  await page.getByText("Offline parent", { exact: true }).click();
  await page
    .getByRole("button", { name: "Move to trash with subtasks" })
    .click();
  await expect(
    page.locator(".task-title").filter({ hasText: /^Offline parent$/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Offline parent", { exact: true })).toBeVisible();
  await expect(page.getByText("Offline child", { exact: true })).toBeVisible();
  await context.setOffline(false);
});
test("capture draft survives closing and reopening; shopping stays one tap away", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick capture" }).click();
  await page
    .getByRole("textbox", { name: "What’s on your mind?" })
    .fill("breadcrumbs for shopping");
  await page.getByRole("button", { name: "Close capture" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Quick capture" }).click();
  await expect(
    page.getByRole("textbox", { name: "What’s on your mind?" }),
  ).toHaveValue("breadcrumbs for shopping");
  await page
    .locator(".capture-modal")
    .getByRole("button", { name: "Add item" })
    .click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Shopping" })
    .click();
  await expect(page.getByText("breadcrumbs", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Complete breadcrumbs", exact: true })
    .click();
  await expect(
    page.getByText("breadcrumbs", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Show completed" }).click();
  await expect(page.getByText("breadcrumbs", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("signed-in queued item propagates to a second independent device", async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  for (const p of [a, b]) {
    await p.goto("/");
    await p.getByRole("button", { name: "Open account settings" }).click();
    await p
      .getByRole("textbox", { name: "Workspace password" })
      .fill("listflow-test-password");
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByText("Signed in to your private workspace."),
    ).toBeVisible();
    await p.getByRole("button", { name: "Close settings" }).click();
  }
  const title = "Cross-device " + Date.now();
  await capture(a, title);
  await expect
    .poll(
      async () => {
        const response = await first.request.get(
          "/api/search?query=" + encodeURIComponent(title),
        );
        return (await response.json()).total;
      },
      { timeout: 10000 },
    )
    .toBe(1);
  await b.reload();
  await expect(b.getByText(title, { exact: true })).toBeVisible();
  await first.close();
  await second.close();
});
test("markdown note editing survives reload and remains local", async ({
  page,
}) => {
  await page.goto("/");
  await capture(page, "note: A quiet idea");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByText("A quiet idea", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("## Keep this\nA private thought.");
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Close details" }).click();
  await page.reload();
  await page.getByText("A quiet idea", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    "## Keep this\nA private thought.",
  );
});

test("mobile opens navigation and recent notes with large controls; desktop keeps its view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your space." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Write a note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "What’s on your mind?" })
    .fill("Mobile landing note");
  await page
    .locator(".capture-modal")
    .getByRole("button", { name: "Add item" })
    .click();
  await expect(page.locator(".capture-modal")).toHaveCount(0);
  await expect(
    page.locator(".home-note").filter({ hasText: "Mobile landing note" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".home-note").filter({ hasText: "Mobile landing note" }),
  ).toBeVisible();
  for (const button of await page.locator(".home-navigation button").all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  }
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("heading", { name: "Today." })).toBeVisible();
});
