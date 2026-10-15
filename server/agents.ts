import { z } from "zod";
import type { Store } from "./store";
import {
  uuid,
  newItem,
  WORKSPACE,
  descendants,
  type Item,
  type Operation,
} from "../shared/model";
export const agentTools = [
  [
    "get_attachment",
    "Read an image attached to a note or category",
    {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  ],
  ["list_categories", "List categories", { type: "object", properties: {} }],
  ["list_lists", "List destinations", { type: "object", properties: {} }],
  [
    "query_items",
    "Search items with stable pagination",
    {
      type: "object",
      properties: {
        query: { type: "string" },
        list_id: { type: "string" },
        status: { type: "string" },
        type: { enum: ["task", "shopping", "note"] },
        offset: { type: "integer" },
        limit: { type: "integer" },
      },
    },
  ],
  [
    "get_item",
    "Read an item and its subtasks",
    {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  ],
  [
    "create_item",
    "Capture a task, shopping item, or note",
    {
      type: "object",
      properties: {
        title: { type: "string" },
        type: { enum: ["task", "shopping", "note"] },
        body_md: { type: "string" },
        list_id: { type: "string" },
        idempotency_key: { type: "string" },
      },
      required: ["title", "idempotency_key"],
    },
  ],
  [
    "update_item",
    "Update item fields with optimistic concurrency",
    {
      type: "object",
      properties: {
        id: { type: "string" },
        base_version: { type: "integer" },
        patch: { type: "object" },
        idempotency_key: { type: "string" },
      },
      required: ["id", "base_version", "patch", "idempotency_key"],
    },
  ],
  [
    "complete_item",
    "Complete an item after all subtasks are done",
    {
      type: "object",
      properties: {
        id: { type: "string" },
        base_version: { type: "integer" },
        idempotency_key: { type: "string" },
      },
      required: ["id", "base_version", "idempotency_key"],
    },
  ],
  [
    "create_subtask",
    "Create a child within a parent",
    {
      type: "object",
      properties: {
        parent_id: { type: "string" },
        title: { type: "string" },
        idempotency_key: { type: "string" },
      },
      required: ["parent_id", "title", "idempotency_key"],
    },
  ],
  [
    "set_recurrence",
    "Set a timezone-aware repeat rule",
    {
      type: "object",
      properties: {
        id: { type: "string" },
        base_version: { type: "integer" },
        rule: { type: "object" },
        idempotency_key: { type: "string" },
      },
      required: ["id", "base_version", "rule", "idempotency_key"],
    },
  ],
  [
    "draft_daily_plan",
    "Propose a daily order without changing commitments",
    { type: "object", properties: { date: { type: "string" } } },
  ],
  [
    "propose_bulk_change",
    "Queue bulk/destructive edits for human review",
    {
      type: "object",
      properties: { operations: { type: "array", items: { type: "object" } } },
      required: ["operations"],
    },
  ],
  [
    "confirm_bulk_change",
    "Check approval status; confirmation requires the human web interface",
    {
      type: "object",
      properties: { proposal_id: { type: "string" } },
      required: ["proposal_id"],
    },
  ],
].map(([name, description, inputSchema]) => ({
  name,
  description,
  inputSchema,
}));
export function callAgent(
  store: Store,
  name: string,
  args: Record<string, any>,
  actor: string,
  write: boolean,
) {
  const entities = store.entities();
  if (name === "get_attachment") {
    const id = z.string().uuid().parse(args.id);
    const row = store.db
      .prepare("SELECT value FROM attachments WHERE id=?")
      .get(id) as { value: string } | undefined;
    if (!row) throw new Error("Image not found");
    return JSON.parse(row.value);
  }
  const items = entities.filter(
    (x): x is Item => x.kind === "item" && !x.deleted_at,
  );
  if (name === "list_categories")
    return entities.filter((x) => x.kind === "category");
  if (name === "list_lists") return entities.filter((x) => x.kind === "list");
  if (name === "query_items") {
    const start = Math.max(0, Number(args.offset) || 0),
      limit = Math.min(100, Math.max(1, Number(args.limit) || 50));
    const all = items.filter(
      (x) =>
        (!args.query ||
          `${x.title} ${x.body_md}`
            .toLowerCase()
            .includes(String(args.query).toLowerCase())) &&
        (!args.list_id || x.list_id === args.list_id) &&
        (!args.status || x.status === args.status) &&
        (!args.type || x.type === args.type),
    );
    return {
      items: all.slice(start, start + limit),
      next_offset: start + limit < all.length ? start + limit : null,
      total: all.length,
    };
  }
  if (name === "get_item") {
    const item = items.find((x) => x.id === args.id);
    if (!item) throw new Error("Item not found");
    return { item, subtasks: descendants(entities, item.id) };
  }
  if (name === "draft_daily_plan")
    return {
      date: args.date ?? new Date().toISOString().slice(0, 10),
      proposed: items
        .filter(
          (x) => x.status !== "done" && !x.parent_item_id && x.type === "task",
        )
        .sort(
          (a, b) =>
            ["urgent", "high", "medium", "low", "none"].indexOf(a.priority) -
            ["urgent", "high", "medium", "low", "none"].indexOf(b.priority),
        )
        .slice(0, 5)
        .map((x) => ({
          item_id: x.id,
          reason:
            x.priority === "none" ? "Available task" : `${x.priority} priority`,
        })),
      provenance: actor,
      status: "proposed",
      applied: false,
    };
  if (!write) throw new Error("Token does not grant write access");
  if (name === "propose_bulk_change") {
    const operations = z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .max(100)
      .parse(args.operations);
    const id = uuid();
    store.db.prepare("INSERT INTO proposals VALUES (?,?,?)").run(
      id,
      JSON.stringify({
        id,
        operations,
        actor,
        status: "pending",
        created_at: new Date().toISOString(),
      }),
      Date.now() + 86400000,
    );
    return {
      proposal_id: id,
      status: "pending",
      approval: "Review in ListFlow Settings → Assistant proposals",
    };
  }
  if (name === "confirm_bulk_change") {
    const p = store.db
      .prepare("SELECT value,expires FROM proposals WHERE id=?")
      .get(String(args.proposal_id)) as
      { value: string; expires: number } | undefined;
    if (!p || p.expires < Date.now())
      throw new Error("Proposal not found or expired");
    return JSON.parse(p.value);
  }
  let operation: Operation;
  const id = z.string().uuid().parse(args.idempotency_key);
  const base = {
    id,
    actor_id: actor,
    device_id: "agent",
    client_created_at: new Date().toISOString(),
    base_version: args.base_version ?? 0,
  };
  if (name === "create_item" || name === "create_subtask") {
    let patch: Partial<Item> = {};
    if (name === "create_subtask") {
      const parent = items.find((x) => x.id === args.parent_id);
      if (!parent) throw new Error("Parent not found");
      patch = { list_id: parent.list_id, parent_item_id: parent.id };
    } else {
      if (args.type) patch.type = args.type;
      if (args.list_id) patch.list_id = args.list_id;
      if (args.body_md !== undefined)
        patch.body_md = z.string().parse(args.body_md);
    }
    const item = newItem(z.string().min(1).parse(args.title), patch);
    operation = {
      ...base,
      entity_id: item.id,
      operation_type: "create",
      patch: item,
    };
  } else if (name === "update_item")
    operation = {
      ...base,
      entity_id: z.string().uuid().parse(args.id),
      operation_type: "patch",
      patch: z.record(z.string(), z.unknown()).parse(args.patch),
    };
  else if (name === "set_recurrence")
    operation = {
      ...base,
      entity_id: z.string().uuid().parse(args.id),
      operation_type: "patch",
      patch: { recurrence: args.rule },
    };
  else if (name === "complete_item")
    operation = {
      ...base,
      entity_id: z.string().uuid().parse(args.id),
      operation_type: "complete",
      patch: {},
    };
  else throw new Error("Unknown tool");
  if (
    operation.operation_type === "patch" &&
    Object.keys(operation.patch).some(
      (f) =>
        ![
          "title",
          "body_md",
          "priority",
          "due_at",
          "scheduled_for",
          "sort_key",
          "recurrence",
        ].includes(f),
    )
  )
    throw new Error("Structural changes require a reviewed bulk proposal");
  return store.apply(operation, actor);
}
