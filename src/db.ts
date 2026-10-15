import { native } from "./native";
import Dexie, { type Table } from "dexie";
import { applyOperation } from "../shared/engine";
import {
  initialEntities,
  uuid,
  type Entity,
  type Item,
  type Operation,
  type OpResult,
} from "../shared/model";
export interface Conflict {
  id: string;
  operation: Operation;
  result: OpResult;
  created_at: string;
}
class LocalDB extends Dexie {
  remote!: Table<Entity, string>;
  entities!: Table<Entity, string>;
  outbox!: Table<Operation, string>;
  meta!: Table<{ key: string; value: any }, string>;
  conflicts!: Table<Conflict, string>;
  constructor() {
    super("listflow-v1", { chromeTransactionDurability: "strict" });
    this.version(1).stores({
      remote: "id,kind",
      entities: "id,kind",
      outbox: "id,client_created_at",
      meta: "key",
      conflicts: "id",
    });
  }
}
export const db = new LocalDB();
export const deviceId = localStorage.getItem("listflow-device") || uuid();
localStorage.setItem("listflow-device", deviceId);
async function checkpoint() {
  if (!native) return;
  const tables = ["remote", "entities", "outbox", "meta", "conflicts"] as const;
  const snapshot: Record<string, unknown> = {};
  for (const key of tables) snapshot[key] = await db[key].toArray();
  await Dexie.waitFor(native.write({ state: JSON.stringify(snapshot) }));
}
export async function initDB() {
  if (native) {
    const snapshot = await native.read();
    if (snapshot.state) {
      const parsed = JSON.parse(snapshot.state);
      await db.transaction(
        "rw",
        [db.remote, db.entities, db.outbox, db.meta, db.conflicts],
        async () => {
          for (const key of [
            "remote",
            "entities",
            "outbox",
            "meta",
            "conflicts",
          ] as const) {
            await db[key].clear();
            await (db[key] as Table<any, string>).bulkPut(parsed[key] || []);
          }
        },
      );
    }
  }
  await db.transaction(
    "rw",
    [db.entities, db.remote, db.meta, db.outbox, db.conflicts],
    async () => {
      if (!(await db.meta.get("initialized"))) {
        const seed = initialEntities();
        await db.remote.bulkPut(seed);
        await db.entities.bulkPut(seed);
        await db.meta.put({ key: "initialized", value: true });
      }
      await checkpoint();
    },
  );
}
async function rebuild() {
  let state = await db.remote.toArray();
  for (const op of await db.outbox.orderBy("client_created_at").toArray()) {
    const r = applyOperation(state, op, op.client_created_at);
    if (r.status === "applied") {
      const map = new Map(state.map((x) => [x.id, x]));
      for (const e of r.changes) map.set(e.id, e);
      state = [...map.values()];
    } else {
      await db.conflicts.put({
        id: op.id,
        operation: op,
        result: r,
        created_at: new Date().toISOString(),
      });
      await db.outbox.delete(op.id);
    }
  }
  await db.entities.clear();
  await db.entities.bulkPut(state);
}
export async function mutate(
  id: string,
  type: Operation["operation_type"],
  patch: Record<string, unknown> = {},
  completeAll = false,
) {
  const op: Operation = {
    id: uuid(),
    entity_id: id,
    actor_id: "owner",
    device_id: deviceId,
    base_version: 0,
    operation_type: type,
    patch,
    client_created_at: new Date().toISOString(),
    complete_all: completeAll,
  };
  await db.transaction(
    "rw",
    [db.entities, db.outbox, db.remote, db.meta, db.conflicts],
    async () => {
      const clock = await db.meta.get("queue_clock");
      const timestamp = Math.max(Date.now(), Number(clock?.value || 0) + 1);
      op.client_created_at = new Date(timestamp).toISOString();
      await db.meta.put({ key: "queue_clock", value: timestamp });
      const e = await db.entities.get(id);
      op.base_version = e?.version ?? 0;
      const result = applyOperation(
        await db.entities.toArray(),
        op,
        op.client_created_at,
      );
      if (result.status !== "applied")
        throw new Error(result.message || "Could not save");
      await db.entities.bulkPut(result.changes);
      await db.outbox.add(op);
      await checkpoint();
    },
  );
  window.dispatchEvent(new Event("listflow-write"));
  return op;
}
export const create = (entity: Entity) => mutate(entity.id, "create", entity);
export const apiRoot = () =>
  localStorage.getItem("listflow-server") ||
  import.meta.env.BASE_URL.replace(/\/$/, "");
export async function api(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem("listflow-token");
  const r = await fetch(apiRoot() + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...options.headers,
    },
    credentials: native ? "omit" : "include",
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(
      d.error ||
        (r.status === 401 ? "Sign in to sync" : `Request failed (${r.status})`),
    );
  }
  return r.json();
}
let syncing = false;
let failures = 0;
let nextTry = 0;
export async function syncNow(force = false) {
  if (syncing || (!force && Date.now() < nextTry) || !navigator.onLine) return;
  syncing = true;
  window.dispatchEvent(new CustomEvent("listflow-sync", { detail: "Syncing" }));
  try {
    const boot = await db.meta.get("cursor");
    if (!boot) {
      const b = await api("/api/bootstrap");
      await db.transaction(
        "rw",
        [db.remote, db.entities, db.meta, db.outbox, db.conflicts],
        async () => {
          await db.remote.clear();
          await db.remote.bulkPut(b.entities);
          await db.meta.put({ key: "cursor", value: b.cursor });
          await rebuild();
          await checkpoint();
        },
      );
    }
    const pending = await db.outbox
      .orderBy("client_created_at")
      .limit(100)
      .toArray();
    if (pending.length) {
      const response = await api("/api/operations:batch", {
        method: "POST",
        body: JSON.stringify({ operations: pending }),
      });
      await db.transaction(
        "rw",
        [db.remote, db.outbox, db.conflicts, db.entities, db.meta],
        async () => {
          for (const result of response.results as OpResult[]) {
            for (const entity of result.changes) {
              const old = await db.remote.get(entity.id);
              if (!old || entity.version >= old.version)
                await db.remote.put(entity);
            }
            const operation = pending.find((x) => x.id === result.id)!;
            if (result.status !== "applied")
              await db.conflicts.put({
                id: result.id,
                operation,
                result,
                created_at: new Date().toISOString(),
              });
            await db.outbox.delete(result.id);
          }
          await rebuild();
          await checkpoint();
        },
      );
    }
    let more = true;
    while (more) {
      const cursor = (await db.meta.get("cursor"))?.value ?? 0;
      const response = await api("/api/changes?cursor=" + cursor);
      await db.transaction(
        "rw",
        [db.remote, db.entities, db.meta, db.outbox, db.conflicts],
        async () => {
          for (const change of response.changes)
            if (change.result.status === "applied")
              for (const entity of change.result.changes) {
                const old = await db.remote.get(entity.id);
                if (!old || entity.version >= old.version)
                  await db.remote.put(entity);
              }
          await db.meta.put({ key: "cursor", value: response.cursor });
          await rebuild();
          await checkpoint();
        },
      );
      more = response.hasMore;
    }
    failures = 0;
    nextTry = 0;
    await db.meta.delete("sync_error");
    window.dispatchEvent(
      new CustomEvent("listflow-sync", {
        detail: (await db.conflicts.count()) ? "Action needed" : "Synced",
      }),
    );
  } catch (e) {
    await db.meta.put({
      key: "sync_error",
      value: e instanceof Error ? e.message : "Sync could not finish",
    });
    failures++;
    nextTry =
      Date.now() +
      Math.min(120000, 1000 * 2 ** Math.min(failures, 7)) *
        (0.75 + Math.random() * 0.5);
    window.dispatchEvent(
      new CustomEvent("listflow-sync", {
        detail:
          !navigator.onLine || e instanceof TypeError
            ? "Saved on device"
            : e instanceof Error && /Sign in/.test(e.message)
              ? "Saved on device"
              : "Action needed",
      }),
    );
  } finally {
    syncing = false;
  }
}
export async function refreshSnapshot() {
  await db.transaction(
    "rw",
    [db.remote, db.entities, db.outbox, db.meta, db.conflicts],
    async () => {
      await db.meta.delete("cursor");
      await checkpoint();
    },
  );
  await syncNow(true);
}
export async function resolveConflict(conflict: Conflict, keepLocal: boolean) {
  if (keepLocal) {
    const e = await db.entities.get(conflict.operation.entity_id);
    if (e)
      await mutate(
        e.id,
        conflict.operation.operation_type,
        conflict.operation.patch,
        conflict.operation.complete_all,
      );
  }
  await db.transaction(
    "rw",
    [db.remote, db.entities, db.outbox, db.meta, db.conflicts],
    async () => {
      await db.conflicts.delete(conflict.id);
      await checkpoint();
    },
  );
}
export function download(
  name: string,
  text: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function markdown(item: Item) {
  return `---\nlistflow_id: ${item.id}\nstatus: ${item.status}\n---\n\n# ${item.title}\n\n${item.body_md}\n\n[ListFlow](listflow://item/${item.id})\n`;
}
