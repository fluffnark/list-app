import { createHash } from "node:crypto";
import { z } from "zod";
import { newItem } from "../shared/model";
import type { Store } from "./store";

export const TASKS_READ_SCOPE =
  "https://www.googleapis.com/auth/tasks.readonly";
const API = "https://tasks.googleapis.com/tasks/v1";
const configSchema = z
  .object({
    enabled: z.boolean(),
    sourceListId: z.string().min(1).max(1024).nullable(),
  })
  .strict();
type Config = z.infer<typeof configSchema>;
type Task = {
  id?: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: string;
  deleted?: boolean;
  hidden?: boolean;
};
export type ImportResult = { imported: number; existing: number };

function stableId(value: string) {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Capture only: Google stays read-only; subsequent edits in either app stay local.
export class GoogleTasksService {
  private running?: Promise<ImportResult>;
  private nextTry = 0;
  private failures = 0;
  constructor(
    private store: Store,
    private token: () => Promise<string>,
  ) {}

  config(): Config {
    const value = this.store.setting("google_tasks_config");
    return value
      ? configSchema.parse(JSON.parse(value))
      : { enabled: false, sourceListId: null };
  }
  configure(input: unknown) {
    const next = configSchema.parse(input);
    if (next.enabled && !next.sourceListId)
      throw new Error("Choose a Google Tasks list first");
    if (next.enabled && !this.ready())
      throw new Error("Allow Google Tasks access first");
    this.store.set("google_tasks_config", JSON.stringify(next));
    this.nextTry = 0;
    return next;
  }
  ready() {
    const scopes = new Set(
      (this.store.setting("google_scopes") || "").split(/\s+/),
    );
    return (
      !!this.store.setting("google_refresh") &&
      (scopes.has(TASKS_READ_SCOPE) ||
        scopes.has("https://www.googleapis.com/auth/tasks"))
    );
  }
  private async get(path: string) {
    const response = await fetch(API + path, {
      headers: { Authorization: "Bearer " + (await this.token()) },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error(
          "Google Tasks access failed. Enable the Tasks API and reconnect Google with Tasks access.",
        );
      throw new Error(
        `Google Tasks returned HTTP ${response.status}; retry later.`,
      );
    }
    return response.json();
  }
  async lists(): Promise<{ id: string; title: string }[]> {
    if (!this.ready()) return [];
    const lists: { id: string; title: string }[] = [];
    const seen = new Set<string>();
    let page = "";
    do {
      const q = new URLSearchParams({ maxResults: "100" });
      if (page) q.set("pageToken", page);
      const data = await this.get("/users/@me/lists?" + q);
      for (const list of data.items || [])
        if (typeof list.id === "string" && typeof list.title === "string")
          lists.push({ id: list.id, title: list.title });
      page = data.nextPageToken || "";
      if (page && (seen.has(page) || seen.size >= 200))
        throw new Error("Google Tasks returned too many list pages.");
      seen.add(page);
    } while (page);
    return lists;
  }
  status() {
    return {
      ...this.config(),
      ready: this.ready(),
      lastSync: this.store.setting("google_tasks_last_sync") || null,
      lastResult: JSON.parse(
        this.store.setting("google_tasks_last_result") || "null",
      ),
      error: this.store.setting("google_tasks_error") || null,
    };
  }
  sync(force = false): Promise<ImportResult> {
    if (this.running) return this.running;
    if (
      (!force && Date.now() < this.nextTry) ||
      !this.ready() ||
      !this.config().enabled
    )
      return Promise.resolve({ imported: 0, existing: 0 });
    this.nextTry = Date.now() + 60000;
    this.running = this.importTasks()
      .then((result) => {
        this.failures = 0;
        return result;
      })
      .catch((error) => {
        this.store.set(
          "google_tasks_error",
          error instanceof Error ? error.message : "Google Tasks import failed",
        );
        this.nextTry =
          Date.now() +
          Math.min(600000, 60000 * 2 ** Math.min(++this.failures, 4));
        throw error;
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async importTasks(): Promise<ImportResult> {
    const config = this.config();
    const current = () => {
      const now = this.config();
      return (
        now.enabled &&
        now.sourceListId === config.sourceListId &&
        this.ready() &&
        (this.store.setting("google_account") || "owner") === account
      );
    };
    const result = { imported: 0, existing: 0 };
    const account = this.store.setting("google_account") || "owner";
    const ids = new Set(this.store.entities().map((x) => x.id));
    const seenPages = new Set<string>();
    let page = "";
    do {
      const q = new URLSearchParams({
        maxResults: "100",
        showCompleted: "false",
        showDeleted: "false",
        showHidden: "false",
      });
      if (page) q.set("pageToken", page);
      const data = await this.get(
        `/lists/${encodeURIComponent(config.sourceListId!)}/tasks?${q}`,
      );
      // A request already in flight must not import after the owner disables it.
      if (!current()) return result;
      for (const task of (data.items || []) as Task[]) {
        if (
          !task.id ||
          !task.title?.trim() ||
          task.deleted ||
          task.hidden ||
          task.status !== "needsAction"
        )
          continue;
        const key = JSON.stringify([account, config.sourceListId, task.id]);
        const id = stableId("google-tasks:item:" + key);
        // Tombstones count too: deleting an imported item must not recreate it.
        if (ids.has(id)) {
          result.existing++;
          continue;
        }
        const due =
          task.due &&
          /^\d{4}-\d{2}-\d{2}T/.test(task.due) &&
          Number.isFinite(Date.parse(task.due))
            ? task.due.slice(0, 10)
            : null;
        const item = newItem(task.title.trim().slice(0, 500), {
          id,
          status: "inbox",
          body_md: (task.notes || "").slice(0, 100000),
          due_at: due,
          metadata_json: {
            google_tasks: {
              account,
              list_id: config.sourceListId,
              task_id: task.id,
              original_title: task.title,
            },
          },
        });
        const applied = this.store.apply(
          {
            id: stableId("google-tasks:create:" + key),
            actor_id: "integration:google-tasks",
            device_id: "google-tasks",
            entity_id: id,
            base_version: 0,
            operation_type: "create",
            patch: item,
            client_created_at: item.created_at,
          },
          "integration:google-tasks",
        );
        if (applied.status !== "applied")
          throw new Error(
            "Could not save an imported task; retry from Settings.",
          );
        ids.add(id);
        result.imported++;
      }
      page = data.nextPageToken || "";
      if (page && (seenPages.has(page) || seenPages.size >= 200))
        throw new Error("Google Tasks returned too many task pages.");
      seenPages.add(page);
    } while (page);
    if (current()) {
      this.store.set("google_tasks_last_sync", new Date().toISOString());
      this.store.set("google_tasks_last_result", JSON.stringify(result));
      this.store.set("google_tasks_error", "");
    }
    return result;
  }
}
