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
    .getByRole("button", { name: "Inbox" })
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
  const checkpoint = await page.evaluate(async () =>
    JSON.parse((await window.Capacitor.Plugins.ListFlowStorage.read()).state),
  );
  if (!checkpoint.outbox.some((x) => x.patch.title === title))
    throw new Error("SQLite checkpoint did not contain queued operation");
  await device.shell("am force-stop " + pkg);
  page = await start();
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
    page.locator(".task-title").filter({ hasText: title }),
  ).toBeVisible();
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
    "PASS: Android bundled launch, offline capture, native SQLite queued checkpoint, force-stop recovery, share target, shopping deep link.",
  );
} finally {
  await device.shell("svc wifi enable");
  await device.shell("svc data enable");
  await device.close();
}
