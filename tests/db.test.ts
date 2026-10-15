import "fake-indexeddb/auto";
import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { Store } from "../server/store";
import { newItem, uuid } from "../shared/model";
let local: typeof import("../src/db");
let server: Store;
beforeAll(async () => {
  const memory = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) || null,
    setItem: (k: string, v: string) => memory.set(k, v),
    removeItem: (k: string) => memory.delete(k),
  });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
  local = await import("../src/db");
});
beforeEach(async () => {
  await local.db.delete();
  await local.db.open();
  await local.initDB();
  server = new Store(":memory:");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: any) => {
      if (url.endsWith("/api/bootstrap"))
        return Response.json({
          entities: server.entities(),
          cursor: server.cursor(),
        });
      if (url.endsWith("/api/operations:batch"))
        return Response.json({
          results: JSON.parse(options.body).operations.map((x: any) =>
            server.apply(x, "owner"),
          ),
          cursor: server.cursor(),
        });
      if (url.includes("/api/changes?")) {
        const cursor = Number(url.split("cursor=")[1]);
        const changes = server.changes(cursor);
        return Response.json({
          changes,
          cursor: changes.at(-1)?.sequence ?? cursor,
          hasMore: false,
        });
      }
      return Response.json({ error: "Unexpected request" }, { status: 404 });
    }),
  );
});
afterAll(async () => {
  await local.db.delete();
  vi.unstubAllGlobals();
});
it("atomically saves an entity with its durable outbox operation", async () => {
  const item = newItem("Offline capture");
  await local.create(item);
  expect(await local.db.entities.get(item.id)).toMatchObject({
    title: "Offline capture",
    version: 1,
  });
  expect(await local.db.outbox.count()).toBe(1);
  local.db.close();
  await local.db.open();
  expect(await local.db.outbox.count()).toBe(1);
  expect((await local.db.entities.get(item.id))?.id).toBe(item.id);
  server.db.close();
});
it("preserves parent-before-child ordering through sync", async () => {
  const parent = newItem("Parent");
  await local.create(parent);
  const child = newItem("Child", { parent_item_id: parent.id });
  await local.create(child);
  const queue = await local.db.outbox.orderBy("client_created_at").toArray();
  expect(queue[0].entity_id).toBe(parent.id);
  expect(queue[1].entity_id).toBe(child.id);
  await local.syncNow(true);
  expect(await local.db.outbox.count()).toBe(0);
  expect(server.entities().find((x) => x.id === child.id)).toMatchObject({
    parent_item_id: parent.id,
  });
  server.db.close();
});
it("preserves pending data after a 429 and replays it exactly once", async () => {
  const item = newItem("Retry me");
  await local.create(item);
  const fetcher = globalThis.fetch;
  let fail = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, opts: any) =>
      String(url).includes("/operations:batch") && fail
        ? Response.json({ error: "quota" }, { status: 429 })
        : fetcher(url, opts),
    ),
  );
  await local.syncNow(true);
  expect(await local.db.outbox.count()).toBe(1);
  fail = false;
  await local.syncNow(true);
  await local.syncNow(true);
  expect(await local.db.outbox.count()).toBe(0);
  expect(server.entities().filter((x) => x.id === item.id)).toHaveLength(1);
  server.db.close();
});
it("retains both text versions when a queued edit conflicts on reconnect", async () => {
  const item = newItem("Original");
  await local.create(item);
  await local.syncNow(true);
  await local.mutate(item.id, "patch", { title: "Local title" });
  server.apply(
    {
      id: uuid(),
      entity_id: item.id,
      actor_id: "other device",
      device_id: "other",
      base_version: 1,
      operation_type: "patch",
      patch: { title: "Remote title" },
      client_created_at: new Date().toISOString(),
    },
    "other device",
  );
  await local.syncNow(true);
  const conflicts = await local.db.conflicts.toArray();
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].operation.patch.title).toBe("Local title");
  expect((await local.db.entities.get(item.id)) as any).toMatchObject({
    title: "Remote title",
  });
  await local.resolveConflict(conflicts[0], true);
  await local.syncNow(true);
  expect(await local.db.conflicts.count()).toBe(0);
  expect(server.entities().find((x) => x.id === item.id)).toMatchObject({
    title: "Local title",
  });
  server.db.close();
});
