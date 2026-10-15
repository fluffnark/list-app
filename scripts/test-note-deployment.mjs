import { chromium, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const url = "https://harmony.great-kettle.ts.net:4443/listflow";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.LISTFLOW_PROXY
    ? { proxy: { server: process.env.LISTFLOW_PROXY } }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const noteId = randomUUID(),
  imageId = randomUUID();
const title = "Rich-note deployment check " + Date.now();
let version;
const operation = (type, patch, base_version = 0) => ({
  id: randomUUID(),
  entity_id: noteId,
  actor_id: "owner",
  device_id: "deployment-check",
  base_version,
  operation_type: type,
  patch,
  client_created_at: new Date().toISOString(),
});
const submit = async (op) => {
  const response = await context.request.post(url + "/api/operations:batch", {
    data: { operations: [op] },
  });
  expect(response.ok()).toBe(true);
  const result = (await response.json()).results[0];
  expect(result.status).toBe("applied");
  return result;
};
try {
  await page.goto(url + "/");
  await expect(
    page.getByRole("heading", { name: "Your space." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open account settings" }).click();
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
  await page
    .getByRole("textbox", { name: "Workspace password" })
    .fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Signed in to your private workspace."),
  ).toBeVisible();
  // Check the exact deployed artifact without opening other workspace records.
  const href = await page
    .locator('a[download="listflow-v0.3.0.apk"]')
    .getAttribute("href");
  const artifact = await context.request.get(new URL(href, url).href);
  expect(artifact.ok()).toBe(true);
  expect(
    createHash("sha256")
      .update(await artifact.body())
      .digest("hex"),
  ).toBe(
    createHash("sha256")
      .update(readFileSync("releases/listflow-v0.3.0.apk"))
      .digest("hex"),
  );
  await page.getByRole("button", { name: "Close settings" }).click();
  const image = {
    id: imageId,
    name: "Deployment test.png",
    data_url:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  };
  expect(
    (
      await context.request.put(url + "/api/attachments/" + imageId, {
        data: image,
      })
    ).ok(),
  ).toBe(true);
  const now = new Date().toISOString();
  const note = {
    id: noteId,
    workspace_id: "personal",
    kind: "item",
    type: "note",
    title,
    body_md:
      "## Live Markdown\n\n![Deployment image](attachment:" + imageId + ")",
    parent_item_id: null,
    list_id: "00000000-0000-4000-8000-000000000001",
    category_id: null,
    status: "active",
    priority: "none",
    due_at: null,
    scheduled_for: null,
    completed_at: null,
    sort_key: Date.now(),
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 0,
    actor_id: "owner",
    container: false,
    recurrence: null,
    metadata_json: {},
  };
  const result = await submit(operation("create", note));
  version = result.changes.find((x) => x.id === noteId).version;
  await page.reload();
  await page.getByText(title, { exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Live Markdown" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "Deployment image" })
        .evaluate((img) => img.naturalWidth),
    )
    .toBe(1);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole("button", { name: "Close details" }).click();
  await context.setOffline(true);
  await page.reload();
  await page.getByText(title, { exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "Deployment image" })
        .evaluate((img) => img.naturalWidth),
    )
    .toBe(1);
  await context.setOffline(false);
  const discovery = await context.request.post(url + "/mcp", {
    data: { jsonrpc: "2.0", id: 0, method: "tools/list" },
  });
  const rpc = await discovery.json();
  expect(rpc.id).toBe(0);
  expect(rpc.result.tools.some((tool) => tool.name === "get_attachment")).toBe(
    true,
  );
  console.log(
    "PASS: production login, v0.3.0 APK checksum, authenticated image upload, Markdown render, offline image reload, MCP ID-zero discovery.",
  );
} finally {
  await context.setOffline(false);
  if (version) await submit(operation("delete", {}, version));
  await context.request.post(url + "/api/logout");
  await browser.close();
}
