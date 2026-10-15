import {
  entitySchema,
  operationSchema,
  descendants,
  isActive,
  nextOccurrence,
  type Entity,
  type Item,
  type Operation,
  type OpResult,
} from "./model";
const locked = new Set([
  "id",
  "workspace_id",
  "kind",
  "version",
  "field_versions",
  "created_at",
  "updated_at",
  "actor_id",
  "deleted_at",
  "completed_at",
  "status",
]);
export function applyOperation(
  input: Entity[],
  raw: Operation,
  now = new Date().toISOString(),
): OpResult {
  const parsed = operationSchema.safeParse(raw);
  if (!parsed.success)
    return {
      id: raw.id,
      status: "rejected",
      changes: [],
      message: parsed.error.issues.map((x) => x.message).join(", "),
    };
  const op = parsed.data;
  const map = new Map(input.map((x) => [x.id, structuredClone(x)]));
  const changes = new Map<string, Entity>();
  function save(e: Entity, fields: string[]) {
    const original = input.find((x) => x.id === e.id);
    e.version = (original?.version ?? 0) + 1;
    e.updated_at = now;
    e.field_versions = {
      ...e.field_versions,
      ...Object.fromEntries(fields.map((f) => [f, e.version])),
    };
    map.set(e.id, e);
    changes.set(e.id, e);
  }
  try {
    let entity = map.get(op.entity_id);
    if (op.operation_type === "create") {
      if (entity) throw new Error("This ID already exists");
      const candidate = entitySchema.parse({
        ...op.patch,
        id: op.entity_id,
        version: 0,
        field_versions: {},
      });
      if (candidate.kind === "item") {
        candidate.actor_id = op.actor_id;
        if (candidate.parent_item_id) {
          const p = map.get(candidate.parent_item_id);
          if (!p || p.kind !== "item" || p.deleted_at)
            throw new Error("Parent does not exist");
          candidate.list_id = p.list_id;
        }
      }
      entity = candidate;
      save(entity, Object.keys(entity));
    } else {
      if (!entity) throw new Error("Item does not exist");
      if (op.base_version > entity.version)
        return {
          id: op.id,
          status: "conflict",
          changes: [entity],
          message:
            "An earlier edit needs resolution before this dependent edit can apply.",
        };
      const fields =
        op.operation_type === "patch"
          ? Object.keys(op.patch)
          : op.operation_type === "delete" || op.operation_type === "restore"
            ? ["deleted_at"]
            : ["status", "recurrence", "completed_at"];
      const conflicts = fields.filter(
        (f) =>
          (entity!.field_versions?.[f] ?? entity!.version) > op.base_version,
      );
      if (conflicts.length)
        return {
          id: op.id,
          status: "conflict",
          changes: [entity],
          fields: conflicts,
          message:
            "This changed on another device. Choose which version to keep.",
        };
      if (op.operation_type === "patch") {
        if (fields.some((f) => locked.has(f)))
          throw new Error(
            "Use a dedicated operation to change protected fields",
          );
        if (entity.kind === "item" && entity.deleted_at)
          throw new Error("Restore this item before editing");
        const patched = entitySchema.parse({ ...entity, ...op.patch });
        if (patched.kind !== entity.kind)
          throw new Error("Cannot change entity type");
        entity = patched;
        save(entity, fields);
        if (entity.kind === "item" && fields.includes("list_id"))
          for (const child of descendants([...map.values()], entity.id)) {
            child.list_id = entity.list_id;
            save(child, ["list_id"]);
          }
      } else if (entity.kind !== "item")
        throw new Error("This action requires an item");
      else if (
        op.operation_type === "delete" ||
        op.operation_type === "restore"
      ) {
        const value = op.operation_type === "delete" ? now : null;
        const batch =
          op.operation_type === "delete"
            ? op.id
            : entity.metadata_json.deletion_batch;
        for (const child of [
          entity,
          ...descendants([...map.values()], entity.id),
        ]) {
          if (
            op.operation_type === "restore" &&
            child.metadata_json.deletion_batch !== batch
          )
            continue;
          if (op.operation_type === "delete" && child.deleted_at) continue;
          child.deleted_at = value;
          child.metadata_json = {
            ...child.metadata_json,
            deletion_batch: batch,
          };
          save(child, ["deleted_at", "metadata_json"]);
        }
      } else if (op.operation_type === "complete") {
        if (entity.deleted_at) throw new Error("Restore this item first");
        if (entity.status === "done")
          return { id: op.id, status: "applied", changes: [] };
        const active = descendants([...map.values()], entity.id).filter(
          isActive,
        );
        if (active.length && !op.complete_all)
          throw new Error(
            "Complete the active subtasks first, or choose complete all",
          );
        for (const x of [...active.reverse(), entity]) {
          x.status = "done";
          x.completed_at = now;
          save(x, ["status", "completed_at"]);
        }
        if (entity.recurrence?.active) {
          const r = entity.recurrence;
          r.next_at = nextOccurrence(
            r,
            r.next_at ?? entity.scheduled_for ?? now,
            now,
          );
          r.last_completed_at = now;
          entity.status = "active";
          entity.scheduled_for = r.next_at;
          save(entity, [
            "status",
            "recurrence",
            "scheduled_for",
            "completed_at",
          ]);
        }
      } else if (op.operation_type === "reopen") {
        entity.status = "active";
        entity.completed_at = null;
        if (entity.recurrence) {
          entity.recurrence = {
            ...entity.recurrence,
            next_at: now,
            last_completed_at: null,
          };
          entity.scheduled_for = now;
        }
        save(entity, ["status", "completed_at", "recurrence", "scheduled_for"]);
      } else if (op.operation_type === "skip") {
        if (!entity.recurrence?.active)
          throw new Error("No active repeat rule");
        entity.recurrence.next_at = nextOccurrence(
          entity.recurrence,
          entity.recurrence.next_at ?? now,
          now,
        );
        entity.scheduled_for = entity.recurrence.next_at;
        save(entity, ["recurrence", "scheduled_for"]);
      }
    }
    // Validate the entire resulting graph before committing anything.
    for (const e of map.values())
      if (e.kind === "item") {
        const list = map.get(e.list_id);
        if (!list || list.kind !== "list")
          throw new Error("Destination list does not exist");
        const seen = new Set([e.id]);
        let p = e.parent_item_id;
        while (p) {
          if (seen.has(p)) throw new Error("Subtasks cannot form a cycle");
          seen.add(p);
          const parent = map.get(p);
          if (!parent || parent.kind !== "item")
            throw new Error("Parent does not exist");
          if (!e.deleted_at && parent.deleted_at)
            throw new Error("Parent is in trash");
          if (e.list_id !== parent.list_id)
            throw new Error("Subtasks stay in their parent’s list");
          p = parent.parent_item_id;
        }
      }
    // Recompute all ancestors from deepest to shallowest. Pure containers auto-complete.
    const items = [...map.values()].filter(
      (x): x is Item => x.kind === "item" && !x.deleted_at,
    );
    const depth = (x: Item): number =>
      x.parent_item_id ? 1 + depth(map.get(x.parent_item_id) as Item) : 0;
    for (const parent of items.sort((a, b) => depth(b) - depth(a))) {
      const children = items.filter(
        (x) => x.parent_item_id === parent.id && x.status !== "archived",
      );
      if (!children.length) continue;
      const unfinished = children.some((x) => isActive(x));
      if (unfinished && parent.status === "done") {
        parent.status = "active";
        parent.completed_at = null;
        save(parent, ["status", "completed_at"]);
      } else if (!unfinished && parent.container && parent.status !== "done") {
        parent.status = "done";
        parent.completed_at = now;
        save(parent, ["status", "completed_at"]);
      }
    }
    return { id: op.id, status: "applied", changes: [...changes.values()] };
  } catch (e) {
    return {
      id: op.id,
      status: "rejected",
      changes: [],
      message: e instanceof Error ? e.message : "Invalid operation",
    };
  }
}
