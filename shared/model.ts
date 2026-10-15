import { z } from "zod";
import { DateTime } from "luxon";
export const WORKSPACE = "personal";
export const INBOX = "00000000-0000-4000-8000-000000000001";
export const SHOPPING = "00000000-0000-4000-8000-000000000002";
export const uuid = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // getRandomValues is also available on LAN HTTP, where randomUUID is absent.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const nullableText = z.string().max(100000).nullable();
export const recurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).max(365),
  timezone: z
    .string()
    .refine((x) => DateTime.now().setZone(x).isValid, "Invalid timezone"),
  active: z.boolean(),
  next_at: z.string().datetime({ offset: true }).nullable(),
  last_completed_at: z.string().nullable(),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;
export const itemSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.literal(WORKSPACE),
  kind: z.literal("item"),
  type: z.enum(["task", "shopping", "note"]),
  title: z.string().trim().min(1).max(500),
  body_md: z.string().max(100000),
  parent_item_id: z.string().uuid().nullable(),
  list_id: z.string().uuid(),
  category_id: z.string().uuid().nullable(),
  status: z.enum(["inbox", "active", "done", "archived"]),
  priority: z.enum(["none", "low", "medium", "high", "urgent"]),
  due_at: nullableText,
  scheduled_for: nullableText,
  completed_at: nullableText,
  sort_key: z.number().finite(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullableText,
  version: z.number().int().nonnegative(),
  actor_id: z.string(),
  container: z.boolean(),
  recurrence: recurrenceSchema.nullable(),
  metadata_json: z.record(z.string(), z.unknown()),
});
export const listSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.literal(WORKSPACE),
  kind: z.literal("list"),
  name: z.string().trim().min(1).max(100),
  category_id: z.string().uuid().nullable(),
  sort_key: z.number(),
  pinned: z.boolean(),
  archived_at: nullableText,
  version: z.number().int().nonnegative(),
  updated_at: z.string(),
  field_versions: z.record(z.string(), z.number()).optional(),
});
export const categorySchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.literal(WORKSPACE),
  kind: z.literal("category"),
  name: z.string().trim().min(1).max(100),
  icon: z.string().max(100).nullable().optional(),
  sort_key: z.number(),
  archived_at: nullableText,
  version: z.number().int().nonnegative(),
  updated_at: z.string(),
  field_versions: z.record(z.string(), z.number()).optional(),
});
export type Item = z.infer<typeof itemSchema> & {
  field_versions?: Record<string, number>;
};
export type List = z.infer<typeof listSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Entity = Item | List | Category;
export const entitySchema = z.discriminatedUnion("kind", [
  itemSchema.extend({
    field_versions: z.record(z.string(), z.number()).optional(),
  }),
  listSchema,
  categorySchema,
]);
export const operationSchema = z.object({
  id: z.string().uuid(),
  actor_id: z.string().max(150),
  device_id: z.string().max(150),
  entity_id: z.string().uuid(),
  base_version: z.number().int().nonnegative(),
  operation_type: z.enum([
    "create",
    "patch",
    "complete",
    "reopen",
    "delete",
    "restore",
    "skip",
  ]),
  patch: z.record(z.string(), z.unknown()),
  client_created_at: z.string(),
  complete_all: z.boolean().optional(),
});
export type Operation = z.infer<typeof operationSchema>;
export interface OpResult {
  id: string;
  status: "applied" | "conflict" | "rejected";
  changes: Entity[];
  message?: string;
  fields?: string[];
  sequence?: number;
}
export function initialEntities(): Entity[] {
  const now = new Date().toISOString();
  return [
    {
      id: INBOX,
      workspace_id: WORKSPACE,
      kind: "list",
      name: "Inbox",
      category_id: null,
      sort_key: 0,
      pinned: false,
      archived_at: null,
      version: 1,
      updated_at: now,
    },
    {
      id: SHOPPING,
      workspace_id: WORKSPACE,
      kind: "list",
      name: "Shopping",
      category_id: null,
      sort_key: 1,
      pinned: true,
      archived_at: null,
      version: 1,
      updated_at: now,
    },
  ];
}
export function newItem(title: string, patch: Partial<Item> = {}): Item {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    workspace_id: WORKSPACE,
    kind: "item",
    type: "task",
    title,
    body_md: "",
    parent_item_id: null,
    list_id: INBOX,
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
    actor_id: "local",
    container: false,
    recurrence: null,
    metadata_json: {},
    ...patch,
  };
}
export function descendants(entities: Entity[], id: string): Item[] {
  const out: Item[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const p = queue.shift();
    for (const x of entities) {
      if (x.kind === "item" && x.parent_item_id === p && !seen.has(x.id)) {
        seen.add(x.id);
        out.push(x);
        queue.push(x.id);
      }
    }
  }
  return out;
}
export function nextOccurrence(
  rule: Recurrence,
  anchor: string,
  now: string,
): string {
  let d = DateTime.fromISO(anchor, { zone: rule.timezone }).setZone(
    rule.timezone,
  );
  const limit = DateTime.fromISO(now).setZone(rule.timezone);
  if (!d.isValid || !limit.isValid) throw new Error("Invalid recurrence date");
  const unit =
    rule.frequency === "daily"
      ? "days"
      : rule.frequency === "weekly"
        ? "weeks"
        : "months";
  d = d.plus({ [unit]: rule.interval }); // Advance from wall-clock anchor, never materialize missed occurrences.
  if (d <= limit) {
    const diff = limit.diff(d, unit).get(unit);
    d = d.plus({
      [unit]: Math.max(1, Math.floor(diff / rule.interval)) * rule.interval,
    });
    while (d <= limit) d = d.plus({ [unit]: rule.interval });
  }
  return d.toUTC().toISO()!;
}
export function capture(text: string, listId = INBOX): Item {
  let title = text.trim();
  const patch: Partial<Item> = {
    list_id: listId,
    type: listId === SHOPPING ? "shopping" : "task",
  };
  if (/\s+(?:for|to) shopping$/i.test(title)) {
    title = title.replace(/\s+(?:for|to) shopping$/i, "");
    patch.list_id = SHOPPING;
    patch.type = "shopping";
  }
  if (/^note:\s*/i.test(title)) {
    title = title.replace(/^note:\s*/i, "");
    patch.type = "note";
  }
  const match = title.match(/\s+(today|tomorrow)$/i);
  if (match) {
    patch.scheduled_for = DateTime.local()
      .plus({ days: match[1].toLowerCase() === "tomorrow" ? 1 : 0 })
      .toISODate();
    title = title.slice(0, -match[0].length);
  }
  return newItem(title || text.trim(), patch);
}
export function isActive(x: Item) {
  return !x.deleted_at && x.status !== "archived" && x.status !== "done";
}
export function ready(x: Item, now = DateTime.now()) {
  return (
    !x.recurrence?.active ||
    !x.recurrence.next_at ||
    Date.parse(x.recurrence.next_at) <= now.toMillis()
  );
}

export function calendarDate(
  value: string | null | undefined,
  zone = DateTime.local().zoneName,
): string | null {
  return value
    ? DateTime.fromISO(value, { zone }).setZone(zone).toISODate()
    : null;
}
