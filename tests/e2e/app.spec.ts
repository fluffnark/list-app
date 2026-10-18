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
  await capture(a, "note: " + title);
  await a.getByRole("button", { name: "Notes", exact: true }).click();
  await a.getByText(title, { exact: true }).click();
  await a.getByLabel("Attach images").setInputFiles({
    name: "shared.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(a.getByRole("textbox", { name: "Description" })).toHaveValue(
    /attachment:/,
  );
  await expect
    .poll(
      async () => {
        const response = await first.request.get(
          "/api/search?query=" + encodeURIComponent(title),
        );
        const result = await response.json();
        return (
          result.items?.some((item: any) =>
            item.body_md?.includes("attachment:"),
          ) ?? false
        );
      },
      { timeout: 10000 },
    )
    .toBe(true);
  await b.reload();
  await b.getByRole("button", { name: "Notes", exact: true }).click();
  await b.getByText(title, { exact: true }).click();
  await b.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(b.getByRole("img", { name: "shared.png" })).toBeVisible();
  await expect
    .poll(() =>
      b
        .getByRole("img", { name: "shared.png" })
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
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
  await expect(page.locator(".current-crumb")).toHaveText("Home");
  await page.getByRole("button", { name: "Write a note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note title" })
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

test("mobile rich notes preserve Markdown, images and drawings offline; categories accept icons", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Write a note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note title" })
    .fill("Rich offline note");
  await page
    .locator(".capture-modal")
    .getByRole("button", { name: "Add item" })
    .click();
  await page.getByText("Rich offline note", { exact: true }).click();
  const source = page.getByRole("textbox", { name: "Description" });
  await source.fill(
    "## Rich heading\n\n| A | B |\n| - | - |\n| one | two |\n\n- [x] Checked\n\n```js\nconst x = 1;\n```\n\n<script>window.badMarkdown = true</script>\n\n[Unsafe](javascript:alert(1))",
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("Attach images")
    .setInputFiles({ name: "test.png", mimeType: "image/png", buffer: png });
  await expect(source).toHaveValue(/attachment:/);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const canvas = page.getByLabel("Drawing canvas");
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 15, bounds.y + 15);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 70, bounds.y + 50, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save drawing", exact: true }).click();
  await expect(source).toHaveValue(/!\[Drawing\]/);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Rich heading" }),
  ).toBeVisible();
  await expect(page.locator(".markdown-body table")).toBeVisible();
  await expect(page.locator(".markdown-body pre")).toContainText("const x = 1");
  await expect(
    page.locator(".markdown-body input[type=checkbox]"),
  ).toBeChecked();
  await expect(page.locator(".markdown-body img")).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator(".markdown-body img")
        .evaluateAll((images) =>
          images.every((img) => (img as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => (window as any).badMarkdown),
  ).toBeUndefined();
  await expect(page.getByRole("link", { name: "Unsafe" })).not.toHaveAttribute(
    "href",
    /javascript:/,
  );
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Markdown with images" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("listflow-note.zip");
  await page.waitForTimeout(650);
  await page.getByRole("button", { name: "Close details" }).click();
  await page.reload();
  await page.getByText("Rich offline note", { exact: true }).click();
  await expect(source).toHaveValue(/!\[Drawing\]/);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".markdown-body img")).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator(".markdown-body img")
        .evaluateAll((images) =>
          images.every((img) => (img as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  await page.screenshot({
    path: "docs/screenshots/mobile-rich-note.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close details" }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Lists", exact: true })
    .click();
  await page.getByLabel("Category name", { exact: true }).fill("Sketches");
  await page.getByLabel("New category icon").fill("🎨");
  await page
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  const category = page
    .locator(".category-management")
    .filter({ hasText: "Sketches" });
  await expect(category.locator(".category-icon-emoji")).toHaveText("🎨");
  await page
    .getByLabel("Upload icon for Sketches")
    .setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: png });
  await expect(
    category.getByRole("img", { name: "Sketches icon" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Lists", exact: true })
    .click();
  await expect(
    category.getByRole("img", { name: "Sketches icon" }),
  ).toBeVisible();
  await context.setOffline(false);
});

test("themes apply across the app, persist offline and support light mode and keyboard selection", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.getByRole("button", { name: "Open account settings" }).click();
  await expect(
    page.getByRole("radio", { name: "Catppuccin Mocha", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "Catppuccin Mocha", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "catppuccin",
  );
  expect(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--bg")),
  ).toBe("#1e1e2e");
  await page.getByLabel("Search themes").fill("Tycho");
  await page.getByRole("radio", { name: "Tycho", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "tycho");
  await page
    .locator(".settings-modal")
    .screenshot({ path: "docs/screenshots/theme-tycho-mobile.png" });
  await page.getByRole("button", { name: "Close settings" }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "tycho");
  await page.getByRole("button", { name: "Open account settings" }).click();
  await page.getByLabel("Search themes").fill("Dracula");
  await page.getByRole("radio", { name: "Dracula", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "community-dracula",
  );
  await page.getByLabel("Search themes").fill("Catppuccin");
  await page.getByLabel("Theme mode").selectOption("light");
  await page
    .getByRole("radio", { name: "Catppuccin Latte", exact: true })
    .click();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).colorScheme),
  ).toBe("light");
  await page
    .locator(".settings-modal")
    .screenshot({ path: "docs/screenshots/theme-latte-mobile.png" });
  await page.getByLabel("Theme mode").selectOption("all");
  await page.getByLabel("Search themes").fill("no such theme xyz");
  await expect(page.getByRole("status")).toHaveText(
    "No themes match your search.",
  );
  await page.getByLabel("Search themes").fill("Tycho");
  await page.getByRole("radio", { name: "Tycho", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("radio", { name: "Tycho", exact: true }),
  ).toBeChecked();
  await context.setOffline(false);
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "tycho");
  await page.getByLabel("Search themes").fill("ListFlow");
  await page.getByRole("radio", { name: "ListFlow", exact: true }).click();
  await expect(second.locator("html")).toHaveAttribute(
    "data-theme",
    "listflow",
  );
  await second.close();
  await page.evaluate(() =>
    localStorage.setItem("listflow-theme", "missing-theme"),
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "listflow");
});

test("note capture separates title and Markdown, preserves drafts offline and uses Enter for content", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Write a note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note title" })
    .fill("A separate title");
  const content = page.getByRole("textbox", { name: "Note content" });
  await content.fill("## Content");
  await content.press("End");
  await content.press("Enter");
  await content.type("This belongs in the body tomorrow");
  await expect(page.locator(".capture-modal")).toBeVisible();
  await expect(content).toHaveValue(
    "## Content\nThis belongs in the body tomorrow",
  );
  await page.getByRole("button", { name: "Close capture" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Write a note", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "A separate title",
  );
  await expect(content).toHaveValue(
    "## Content\nThis belongs in the body tomorrow",
  );
  await content.press("Control+Enter");
  await expect(page.locator(".capture-modal")).toHaveCount(0);
  await page.getByText("A separate title", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Item title" })).toHaveValue(
    "A separate title",
  );
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    "## Content\nThis belongs in the body tomorrow",
  );
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Write a note", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "",
  );
  await expect(content).toHaveValue("");
  await content.fill("A content-only note");
  await page
    .locator(".capture-modal")
    .getByRole("button", { name: "Add item" })
    .click();
  await page.getByText("Untitled note", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    "A content-only note",
  );
  await context.setOffline(false);
});
