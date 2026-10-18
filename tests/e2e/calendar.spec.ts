import { test, expect } from "@playwright/test";
import { newItem, uuid } from "../../shared/model";

test.use({ timezoneId: "America/Denver" });
test("day/week/month navigation retains tasks and lays out Google events on desktop and mobile", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: new Date("2026-10-20T16:00:00Z") });
  await context.request.post("/auth/login", {
    data: { password: "listflow-test-password" },
  });
  const item = newItem("Calendar dentist", { scheduled_for: "2026-10-20" });
  await context.request.post("/api/operations:batch", {
    data: {
      operations: [
        {
          id: uuid(),
          entity_id: item.id,
          actor_id: "owner",
          device_id: "calendar-test",
          base_version: 0,
          operation_type: "create",
          patch: item,
          client_created_at: new Date().toISOString(),
        },
      ],
    },
  });
  await page.route("**/api/calendar/events?*", (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: "a",
            title: "Morning meeting",
            start: "2026-10-20T09:00:00-06:00",
            end: "2026-10-20T10:00:00-06:00",
            allDay: false,
            color: "#7c9cf5",
            sourceName: "Google",
          },
          {
            id: "b",
            title: "Overlapping call",
            start: "2026-10-20T09:30:00-06:00",
            end: "2026-10-20T10:30:00-06:00",
            allDay: false,
            color: "#6cc18f",
            sourceName: "Google",
          },
          {
            id: "holiday",
            title: "Holiday",
            start: "2026-10-20",
            end: "2026-10-21",
            allDay: true,
            color: "#e8a35c",
            sourceName: "Google",
          },
        ],
        errors: [],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const calendar = page.getByRole("region", { name: "Calendar", exact: true });
  await expect(
    calendar.getByRole("button", { name: "Week", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".calendar-time-column")).toHaveCount(7);
  await expect(
    calendar.getByText("Morning meeting", { exact: true }),
  ).toBeVisible();
  await expect(
    calendar.getByRole("button", { name: "Calendar dentist" }),
  ).toBeVisible();
  await calendar.getByRole("button", { name: /Morning meeting/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Google");
  await expect(
    page.getByRole("heading", { name: "Morning meeting" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const positions = await page
    .locator(".calendar-timed-event")
    .evaluateAll((es) =>
      es.map((e) => ({
        left: (e as HTMLElement).style.left,
        width: (e as HTMLElement).style.width,
      })),
    );
  expect(positions).toHaveLength(2);
  expect(positions[0].left).not.toBe(positions[1].left);
  await calendar.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.locator(".calendar-month-day")).toHaveCount(35);
  await calendar.getByRole("button", { name: "Next month" }).click();
  await expect(page.locator(".calendar-toolbar strong")).toHaveText(
    "November 2026",
  );
  await calendar.getByRole("button", { name: "Today", exact: true }).click();
  await calendar
    .getByRole("button", { name: "Open Tuesday, 20 October 2026" })
    .click();
  await expect(page.locator(".calendar-time-column")).toHaveCount(1);
  await calendar.getByRole("button", { name: "Next day" }).click();
  await expect(calendar.getByText("Holiday", { exact: true })).toHaveCount(0);
  await calendar.getByRole("button", { name: "Previous day" }).click();
  await calendar.getByRole("button", { name: "Calendar dentist" }).click();
  await expect(page.getByRole("textbox", { name: "Item title" })).toHaveValue(
    "Calendar dentist",
  );
  await page.getByRole("button", { name: "Close details" }).click();
  await page.reload();
  await expect(
    calendar.getByRole("button", { name: "Day", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Calendar", exact: true })
      .click();
    for (const mode of ["Month", "Week", "Day"]) {
      await calendar.getByRole("button", { name: mode, exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.screenshot({
    path: "/tmp/listflow-calendar-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await calendar.getByRole("button", { name: "Week", exact: true }).click();
  await page.screenshot({
    path: "/tmp/listflow-calendar-week.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("Settings guides Google setup, protects credentials, and starts OAuth", async ({
  page,
  context,
}) => {
  expect(
    (await context.request.put("/api/google/config", { data: {} })).status(),
  ).toBe(401);
  await page.goto("/");
  await page.getByRole("button", { name: "Open account settings" }).click();
  await expect(
    page.getByText(
      "Sign in to your workspace above to set up Google Calendar.",
    ),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Workspace password" })
    .fill("listflow-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Google owner email").fill("owner@gmail.com");
  await page
    .getByLabel("Google client ID")
    .fill("123-test.apps.googleusercontent.com");
  await page.getByLabel("Google client secret").fill("GOCSPX-test-secret");
  await page.getByRole("button", { name: "Save Google setup" }).click();
  const signIn = page.getByRole("link", {
    name: "Sign in with Google",
    exact: true,
  });
  await expect(signIn).toBeVisible();
  const config = await (await context.request.get("/api/google/config")).json();
  expect(config.configured).toBe(true);
  expect(config.ownerEmail).toBe("owner@gmail.com");
  expect(JSON.stringify(config)).not.toContain("GOCSPX");
  expect(config.clientSecret).toBeUndefined();
  const authorization = await context.request.get("/auth/google", {
    maxRedirects: 0,
  });
  const lanStart = await context.request.get("/auth/google", {
    headers: { Host: "harmony.local:4443" },
    maxRedirects: 0,
  });
  expect(lanStart.status()).toBe(302);
  expect(lanStart.headers().location).toBe(config.authorizationUrl);
  expect(lanStart.headers()["set-cookie"]).toBeUndefined();
  const tasksStart = await context.request.get("/auth/google?tasks=1", {
    headers: { Host: "harmony.local:4443" },
    maxRedirects: 0,
  });
  expect(tasksStart.headers().location).toBe(
    config.authorizationUrl + "?tasks=1",
  );
  expect(authorization.status()).toBe(302);
  const url = new URL(authorization.headers().location);
  expect(url.hostname).toBe("accounts.google.com");
  expect(url.searchParams.get("scope")).toContain("calendar.events");
  expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  expect(authorization.headers()["set-cookie"]).toContain("HttpOnly");
  await page
    .locator(".calendar-settings")
    .screenshot({ path: "/tmp/listflow-google-settings.png" });
});
