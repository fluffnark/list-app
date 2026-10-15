import { _android as android, expect as baseExpect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
const expect = baseExpect.configure({ timeout: 20000 });
const [device] = await android.devices({ host: "127.0.0.1", port: 5037 });
if (!device)
  throw new Error(
    "Connect a debug Android device or boot the ListFlow emulator",
  );
const pkg = "com.doomslug.listflow";
try {
  const start = async () => {
    await device.shell(`am start -n ${pkg}/.MainActivity`);
    const view = await device.webView({ pkg }, { timeout: 30000 });
    return view.page();
  };
  await device.shell(
    `am start -n ${pkg}/.MainActivity -a android.intent.action.VIEW -d listflow://today`,
  );
  let page = await start();
  await expect(page.getByRole("heading", { name: "Today." })).toBeVisible();
  if (await page.getByRole("button", { name: "Close capture" }).isVisible())
    await page.getByRole("button", { name: "Close capture" }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Home" })
    .click();
  await page
    .locator(".home-navigation")
    .getByRole("button", { name: /Inbox/ })
    .click();
  await device.shell("svc wifi disable");
  await device.shell("svc data disable");
  await page.getByRole("button", { name: "Quick capture" }).click();
  const title = "Android offline " + Date.now();
  await page.getByRole("textbox", { name: "What’s on your mind?" }).fill(title);
  await page
    .locator(".capture-modal")
    .getByRole("button", { name: "Add item" })
    .click();
  await expect(
    page.locator(".task-title").filter({ hasText: title }),
  ).toBeVisible();
  const noteTitle = "Android drawing " + Date.now();
  await page.getByRole("button", { name: "Quick capture" }).click();
  await page
    .getByRole("textbox", { name: "What’s on your mind?" })
    .fill("note: " + noteTitle);
  await page
    .locator(".capture-modal")
    .getByRole("button", { name: "Add item" })
    .click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Notes", exact: true })
    .click();
  await page.getByText(noteTitle, { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("## Native drawing");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const canvasBounds = await page.getByLabel("Drawing canvas").boundingBox();
  await page.mouse.move(canvasBounds.x + 20, canvasBounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(canvasBounds.x + 80, canvasBounds.y + 50, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save drawing", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(
    /attachment:/,
  );
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Close details" }).click();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await page
    .locator(".home-navigation")
    .getByRole("button", { name: /Inbox/ })
    .click();
  const checkpoint = await page.evaluate(async () =>
    JSON.parse((await window.Capacitor.Plugins.ListFlowStorage.read()).state),
  );
  if (
    !checkpoint.meta.some(
      (x) =>
        x.key.startsWith("attachment:") &&
        x.value.data_url.startsWith("data:image/png"),
    )
  )
    throw new Error("SQLite checkpoint did not contain the drawing");
  if (!checkpoint.outbox.some((x) => x.patch.title === title))
    throw new Error("SQLite checkpoint did not contain queued operation");
  await device.shell("am force-stop " + pkg);
  page = await start();
  await expect(
    page.getByRole("heading", { name: "Your space." }),
  ).toBeVisible();
  await page
    .locator(".home-navigation")
    .getByRole("button", { name: /Inbox/ })
    .click();
  await expect(
    page.locator(".task-title").filter({ hasText: title }),
  ).toBeVisible();
  // Remove only the WebView IndexedDB mirror; SQLite must restore the canonical offline checkpoint.
  await page.evaluate(async () => {
    const data = await window.Capacitor.Plugins.ListFlowStorage.read();
    if (!data.state) throw new Error("Missing native state");
    const r = indexedDB.open("listflow-v1");
    const db = await new Promise(
      (resolve) => (r.onsuccess = () => resolve(r.result)),
    );
    await new Promise((resolve, reject) => {
      const tx = db.transaction(
        ["entities", "remote", "meta", "outbox", "conflicts"],
        "readwrite",
      );
      for (const key of ["entities", "remote", "meta", "outbox", "conflicts"])
        tx.objectStore(key).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await device.shell("am force-stop " + pkg);
  page = await start();
  await expect(
    page.getByRole("heading", { name: "Your space." }),
  ).toBeVisible();
  await page
    .locator(".home-navigation")
    .getByRole("button", { name: /Inbox/ })
    .click();
  await expect(
    page.locator(".task-title").filter({ hasText: title }),
  ).toBeVisible();
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Notes", exact: true })
    .click();
  await page.getByText(noteTitle, { exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Native drawing" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Drawing", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "Drawing", exact: true })
        .evaluate((image) => image.naturalWidth),
    )
    .toBe(960);
  await page.screenshot({ path: "docs/screenshots/android-rich-note.png" });
  await page.getByRole("button", { name: "Close details" }).click();
  await device.shell(
    `am start -n ${pkg}/.MainActivity -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT 'Shared Android thought'`,
  );
  await expect(
    page.getByRole("textbox", { name: "What’s on your mind?" }),
  ).toHaveValue("Shared Android thought");
  await page
    .locator(".capture-modal")
    .getByRole("button", { name: "Add item" })
    .click();
  await device.shell(
    `am start -n ${pkg}/.MainActivity -a android.intent.action.VIEW -d listflow://shopping`,
  );
  await expect(page.getByRole("heading", { name: "Shopping." })).toBeVisible();
  mkdirSync("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/android-shopping.png" });
  await device.shell("svc wifi enable");
  await device.shell("svc data enable");
  console.log(
    "PASS: Android bundled launch, offline capture, native SQLite queued checkpoint, force-stop recovery, Markdown and drawing recovery after IndexedDB deletion, share target, shopping deep link.",
  );
} finally {
  await device.shell("svc wifi enable");
  await device.shell("svc data enable");
  await device.close();
}
