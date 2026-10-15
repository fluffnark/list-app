import {
  _android as android,
  request,
  expect as baseExpect,
} from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const expect = baseExpect.configure({ timeout: 20000 });
const data = mkdtempSync(join(tmpdir(), "listflow-android-sync-"));
const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: {
    ...process.env,
    PORT: "4319",
    APP_BASE: "/listflow",
    PUBLIC_ORIGIN: "http://localhost:4319",
    ADMIN_PASSWORD: "android-test-only-password",
    DATA_DIR: data,
  },
  stdio: "ignore",
});
const api = await request.newContext({
  baseURL: "http://localhost:4319/listflow/",
});
let device;
try {
  await expect
    .poll(
      async () => {
        try {
          return (await api.get("api/health")).status();
        } catch {
          return 0;
        }
      },
      { timeout: 15000 },
    )
    .toBe(200);
  await api.post("auth/login", {
    data: { password: "android-test-only-password" },
  });
  const { token } = await (
    await api.post("api/tokens", {
      data: { label: "Android integration test", device: true },
    })
  ).json();
  [device] = await android.devices();
  if (!device) throw new Error("No Android device");
  await device.shell("svc wifi enable");
  await device.shell("svc data enable");
  await device.shell(
    "am start -n com.doomslug.listflow/.MainActivity -a android.intent.action.VIEW -d listflow://today",
  );
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    "/home/doomslug/.local/share/mise/installs/android-sdk/23.0/platform-tools/adb",
    ["-s", device.serial(), "reverse", "tcp:4319", "tcp:4319"],
  );
  const page = await (
    await device.webView({ pkg: "com.doomslug.listflow" })
  ).page();
  page.on("dialog", (d) => d.accept());
  if (await page.getByRole("button", { name: "Close capture" }).isVisible())
    await page.getByRole("button", { name: "Close capture" }).click();
  await page.getByRole("button", { name: "Open account settings" }).click();
  await page
    .getByRole("textbox", { name: "Sync server URL" })
    .fill("http://localhost:4319/listflow");
  await page
    .getByRole("textbox", { name: "Device token", exact: true })
    .fill(token);
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(
    page.getByText("Signed in to your private workspace."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Inbox" })
    .click();
  await page.getByRole("button", { name: "Quick capture" }).click();
  const title = "Native sync integration " + Date.now();
  await page.getByRole("textbox", { name: "What’s on your mind?" }).fill(title);
  await page
    .locator(".capture-modal")
    .getByRole("button", { name: "Add item" })
    .click();
  await expect
    .poll(
      async () => {
        const r = await api.get(
          "api/search?query=" + encodeURIComponent(title),
        );
        return (await r.json()).total;
      },
      { timeout: 20000 },
    )
    .toBe(1);
  const created = (
    await (
      await api.get("api/search?query=" + encodeURIComponent(title))
    ).json()
  ).items[0];
  await api.post("api/operations:batch", {
    data: {
      operations: [
        {
          id: crypto.randomUUID(),
          entity_id: created.id,
          actor_id: "integration",
          device_id: "second-device",
          base_version: created.version,
          operation_type: "patch",
          patch: { title: title + " from web" },
          client_created_at: new Date().toISOString(),
        },
      ],
    },
  });
  await page.getByRole("button", { name: "Open account settings" }).click();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(
    page.locator(".task-title").filter({ hasText: title + " from web" }),
  ).toBeVisible();
  console.log(
    "PASS: Android token authentication and CORS, native outbox → transactional gateway, gateway edit → Android next sync.",
  );
} finally {
  if (device) await device.close();
  await api.dispose();
  server.kill("SIGTERM");
}
