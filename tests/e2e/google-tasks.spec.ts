import { test, expect } from "@playwright/test";

test("only the owner can configure or run Google Tasks imports", async ({
  request,
}) => {
  expect((await request.get("/api/google-tasks")).status()).toBe(401);
  expect(
    (
      await request.put("/api/google-tasks", {
        data: { enabled: false, sourceListId: null },
      })
    ).status(),
  ).toBe(401);
  await request.post("/auth/login", {
    data: { password: "listflow-test-password" },
  });
  const state = await request.get("/api/google-tasks");
  expect(state.ok()).toBeTruthy();
  expect(await state.json()).toMatchObject({
    ready: false,
    enabled: false,
    lists: [],
  });
  expect((await request.post("/api/google-tasks/sync")).status()).toBe(409);
  expect(
    (
      await request.put("/api/google-tasks", {
        data: { enabled: true, sourceListId: "test-list" },
      })
    ).status(),
  ).toBe(400);
  const token = await (
    await request.post("/api/tokens", {
      data: { label: "Tasks boundary test", write: true },
    })
  ).json();
  const headers = { Authorization: "Bearer " + token.token };
  expect((await request.get("/api/google-tasks", { headers })).status()).toBe(
    403,
  );
  expect(
    (
      await request.put("/api/google-tasks", {
        headers,
        data: { enabled: false, sourceListId: null },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await request.post("/api/google-tasks/sync", { headers })).status(),
  ).toBe(403);
});

test("task capture settings explain enablement and stay inside a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open account settings" }).click();
  await page
    .getByRole("textbox", { name: "Workspace password" })
    .fill("listflow-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const heading = page.getByRole("heading", {
    name: "Google Home task capture",
  });
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toBeVisible();
  await expect(
    page.getByText("Configure the server’s Google OAuth client", {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/listflow-google-home-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("owner can enable, import, and disable a chosen list from the settings card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post("/auth/login", {
    data: { password: "listflow-test-password" },
  });
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { google: true } }),
  );
  let enabled = false;
  let imports = 0;
  const state = () => ({
    ready: true,
    enabled,
    sourceListId: enabled ? "voice" : null,
    lists: [{ id: "voice", title: "My Tasks" }],
    lastSync: imports ? new Date().toISOString() : null,
    lastResult: imports ? { imported: 1, existing: 0 } : null,
    error: null,
  });
  await page.route("**/api/google-tasks", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(body.sourceListId).toBe("voice");
      enabled = body.enabled;
    }
    await route.fulfill({ json: state() });
  });
  await page.route("**/api/google-tasks/sync", async (route) => {
    imports++;
    await route.fulfill({ json: { result: { imported: 1, existing: 0 } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open account settings" }).click();
  await page.getByRole("button", { name: "Enable task capture" }).click();
  await expect(
    page.getByRole("button", { name: "Turn off task capture" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Google Tasks list")).toBeDisabled();
  expect(imports).toBe(1);
  await page
    .getByRole("heading", { name: "Google Home task capture" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/listflow-google-home-configured.png" });
  await page.getByRole("button", { name: "Import now", exact: true }).click();
  await expect.poll(() => imports).toBe(2);
  await page.getByRole("button", { name: "Turn off task capture" }).click();
  await expect(
    page.getByRole("button", { name: "Enable task capture" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Import now", exact: true }),
  ).toBeDisabled();
});
