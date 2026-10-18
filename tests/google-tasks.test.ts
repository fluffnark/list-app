import { afterEach, expect, it, vi } from "vitest";
import { GoogleTasksService, TASKS_READ_SCOPE } from "../server/google-tasks";
import { Store } from "../server/store";
import { uuid, type Item } from "../shared/model";

const stores: Store[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  stores.splice(0).forEach((store) => store.db.close());
});
function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  store.set("google_refresh", "encrypted-refresh");
  store.set("google_scopes", TASKS_READ_SCOPE);
  store.set("google_account", "owner@example.com");
  const token = vi.fn(async () => "test-access-token");
  const service = new GoogleTasksService(store, token);
  service.configure({ enabled: true, sourceListId: "voice/list" });
  return { store, service, token };
}
const response = (data: unknown) => new Response(JSON.stringify(data));
const openTask = {
  id: "task1",
  title: "Buy milk",
  status: "needsAction",
  due: "2026-10-19T00:00:00.000Z",
  notes: "Oat milk",
};
const items = (store: Store) =>
  store.entities().filter((x): x is Item => x.kind === "item");

it("requires explicit enablement and an exact Tasks scope before importing", async () => {
  const { store, service, token } = setup();
  store.set("google_scopes", TASKS_READ_SCOPE + ".unrelated");
  expect(service.ready()).toBe(false);
  expect(() =>
    service.configure({ enabled: true, sourceListId: "voice" }),
  ).toThrow("Allow Google Tasks access");
  expect(await service.sync(true)).toEqual({ imported: 0, existing: 0 });
  expect(token).not.toHaveBeenCalled();
  store.set("google_scopes", TASKS_READ_SCOPE);
  service.configure({ enabled: false, sourceListId: "voice" });
  await service.sync(true);
  expect(token).not.toHaveBeenCalled();
  expect(() =>
    service.configure({ enabled: true, sourceListId: null }),
  ).toThrow("Choose");
});

it("imports paginated open tasks into Inbox and preserves the date without inventing a reminder time", async () => {
  const { store, service } = setup();
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push(url);
      expect(init.method).toBeUndefined();
      expect(init.headers).toEqual({
        Authorization: "Bearer test-access-token",
      });
      return response(
        calls.length === 1
          ? {
              items: [
                openTask,
                { ...openTask, id: "done", status: "completed" },
                { ...openTask, id: "deleted", deleted: true },
              ],
              nextPageToken: "next",
            }
          : {
              items: [
                { ...openTask, id: "second", title: "Call Mom" },
                { ...openTask, id: "hidden", hidden: true },
              ],
            },
      );
    }),
  );
  expect(await service.sync(true)).toEqual({ imported: 2, existing: 0 });
  expect(calls[0]).toContain("/lists/voice%2Flist/tasks?");
  expect(calls[1]).toContain("pageToken=next");
  expect(items(store)).toHaveLength(2);
  expect(items(store)[0]).toMatchObject({
    title: "Buy milk",
    status: "inbox",
    due_at: "2026-10-19",
    scheduled_for: null,
    body_md: "Oat milk",
    actor_id: "integration:google-tasks",
  });
  expect(store.changes(0)).toHaveLength(2);
  expect(service.status().lastSync).toBeTruthy();
});

it("retries a partial import without duplicates, overwrites, or resurrecting local deletions", async () => {
  const { store, service } = setup();
  let broken = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!url.includes("pageToken"))
        return response({ items: [openTask], nextPageToken: "next" });
      if (broken) return new Response(null, { status: 503 });
      return response({
        items: [{ ...openTask, id: "task2", title: "Second" }],
      });
    }),
  );
  await expect(service.sync(true)).rejects.toThrow("503");
  expect(service.status().lastSync).toBeNull();
  const first = items(store)[0];
  store.apply(
    {
      id: uuid(),
      actor_id: "owner",
      device_id: "test",
      entity_id: first.id,
      base_version: first.version,
      operation_type: "patch",
      patch: { title: "My edited task" },
      client_created_at: new Date().toISOString(),
    },
    "owner",
  );
  broken = false;
  expect(await service.sync(true)).toEqual({ imported: 1, existing: 1 });
  const edited = items(store).find((x) => x.id === first.id)!;
  expect(edited.title).toBe("My edited task");
  store.apply(
    {
      id: uuid(),
      actor_id: "owner",
      device_id: "test",
      entity_id: edited.id,
      base_version: edited.version,
      operation_type: "delete",
      patch: {},
      client_created_at: new Date().toISOString(),
    },
    "owner",
  );
  expect(await service.sync(true)).toEqual({ imported: 0, existing: 2 });
  expect(items(store).find((x) => x.id === first.id)?.deleted_at).toBeTruthy();
  expect(service.status().error).toBeNull();
});

it("stops an in-flight import when disabled and shares concurrent sync requests", async () => {
  const { store, service } = setup();
  let release!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ),
  );
  const first = service.sync(true);
  expect(service.sync(true)).toBe(first);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  service.configure({ enabled: false, sourceListId: "voice/list" });
  release(response({ items: [openTask] }));
  await first;
  expect(items(store)).toHaveLength(0);
  expect(service.status().lastSync).toBeNull();
});

it("paginates task-list discovery and reports missing API permission without leaking the token", async () => {
  const { service } = setup();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response({
        items: [{ id: "first", title: "My Tasks" }],
        nextPageToken: "more",
      }),
    )
    .mockResolvedValueOnce(
      response({ items: [{ id: "second", title: "Work" }] }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await service.lists()).toEqual([
    { id: "first", title: "My Tasks" },
    { id: "second", title: "Work" },
  ]);
  await expect(service.sync(true)).rejects.toThrow("Enable the Tasks API");
  expect(service.status().error).not.toContain("test-access-token");
});

it("does not import a previous account's response after the account changes", async () => {
  const { store, service } = setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      store.set("google_account", "different@example.com");
      return response({ items: [openTask] });
    }),
  );
  await service.sync(true);
  expect(items(store)).toHaveLength(0);
});
