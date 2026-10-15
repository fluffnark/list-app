import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { applyOperation } from "../shared/engine";
import {
  capture,
  calendarDate,
  initialEntities,
  newItem,
  uuid,
  nextOccurrence,
  SHOPPING,
  INBOX,
  type Entity,
  type Operation,
  type Recurrence,
} from "../shared/model";
const op = (
  entity: Entity,
  type: Operation["operation_type"],
  patch: Record<string, unknown> = {},
  all = false,
): Operation => ({
  id: uuid(),
  actor_id: "test",
  device_id: "test",
  entity_id: entity.id,
  base_version: entity.version,
  operation_type: type,
  patch,
  client_created_at: "2026-10-14T12:00:00.000Z",
  complete_all: all,
});
function fixture() {
  let entities = initialEntities();
  return {
    get entities() {
      return entities;
    },
    apply(o: Operation) {
      const r = applyOperation(entities, o, "2026-10-14T12:00:00.000Z");
      if (r.status === "applied") {
        const m = new Map(entities.map((x) => [x.id, x]));
        r.changes.forEach((x) => m.set(x.id, x));
        entities = [...m.values()];
      }
      return r;
    },
    get(id: string) {
      return entities.find((x) => x.id === id)!;
    },
    add(title: string, patch: Record<string, any> = {}) {
      const e = newItem(title, patch);
      this.apply(op(e, "create", e));
      return this.get(e.id);
    },
  };
}
describe("capture", () => {
  it("preserves unknown text and defaults to Inbox", () => {
    const e = capture("some unclassified thought");
    expect(e.title).toBe("some unclassified thought");
    expect(e.list_id).toBe(INBOX);
  });
  it("suggests shopping and dates without requiring them", () => {
    expect(capture("breadcrumbs for shopping").list_id).toBe(SHOPPING);
    expect(capture("review PR tomorrow").scheduled_for).toBe(
      DateTime.local().plus({ days: 1 }).toISODate(),
    );
  });
});
describe("hierarchy", () => {
  it("rejects cycles without changing state", () => {
    const f = fixture();
    const p = f.add("Parent");
    const c = f.add("Child", { parent_item_id: p.id });
    const before = JSON.stringify(f.entities);
    expect(
      f.apply(op(f.get(p.id), "patch", { parent_item_id: c.id })).status,
    ).toBe("rejected");
    expect(JSON.stringify(f.entities)).toBe(before);
  });
  it("rejects completion with an unfinished deep descendant", () => {
    const f = fixture();
    const p = f.add("Parent");
    const c = f.add("Child", { parent_item_id: p.id });
    f.add("Grandchild", { parent_item_id: c.id });
    expect(f.apply(op(f.get(p.id), "complete")).status).toBe("rejected");
  });
  it("complete-all is explicit and completes every descendant", () => {
    const f = fixture();
    const p = f.add("Parent");
    const c = f.add("Child", { parent_item_id: p.id });
    const g = f.add("Grandchild", { parent_item_id: c.id });
    expect(f.apply(op(f.get(p.id), "complete", {}, true)).status).toBe(
      "applied",
    );
    for (const id of [p.id, c.id, g.id])
      expect((f.get(id) as any).status).toBe("done");
  });
  it("auto-completes pure containers upward, while independent parents stay active", () => {
    const f = fixture();
    const p = f.add("Container", { container: true });
    const c = f.add("Nested container", {
      parent_item_id: p.id,
      container: true,
    });
    const g = f.add("Work", { parent_item_id: c.id });
    f.apply(op(f.get(g.id), "complete"));
    expect((f.get(p.id) as any).status).toBe("done");
    const independent = f.add("Independent");
    const sub = f.add("Sub", { parent_item_id: independent.id });
    f.apply(op(f.get(sub.id), "complete"));
    expect((f.get(independent.id) as any).status).toBe("active");
  });
  it("reopens completed ancestors when a descendant is reopened", () => {
    const f = fixture();
    const p = f.add("Container", { container: true });
    const c = f.add("Work", { parent_item_id: p.id });
    f.apply(op(f.get(c.id), "complete"));
    f.apply(op(f.get(c.id), "reopen"));
    expect((f.get(p.id) as any).status).toBe("active");
  });
  it("deletes and restores a subtree without reviving independently deleted children", () => {
    const f = fixture();
    const p = f.add("Parent");
    const c = f.add("Child", { parent_item_id: p.id });
    const old = f.add("Earlier deletion", { parent_item_id: p.id });
    f.apply(op(f.get(old.id), "delete"));
    f.apply(op(f.get(p.id), "delete"));
    expect((f.get(c.id) as any).deleted_at).toBeTruthy();
    f.apply(op(f.get(p.id), "restore"));
    expect((f.get(c.id) as any).deleted_at).toBeNull();
    expect((f.get(old.id) as any).deleted_at).toBeTruthy();
  });
  it("never mirrors a subtask into a different list", () => {
    const f = fixture();
    const p = f.add("Project");
    const c = f.add("Child", { parent_item_id: p.id, list_id: SHOPPING });
    expect((c as any).list_id).toBe(INBOX);
    expect(f.apply(op(c, "patch", { list_id: SHOPPING })).status).toBe(
      "rejected",
    );
    expect(
      f.apply(op(f.get(p.id), "patch", { list_id: SHOPPING })).status,
    ).toBe("applied");
    expect((f.get(c.id) as any).list_id).toBe(SHOPPING);
  });
});
describe("concurrent field merge", () => {
  it("merges disjoint fields from a stale base", () => {
    const f = fixture();
    const e = f.add("Title");
    f.apply(op(e, "patch", { title: "New title" }));
    const r = f.apply(op(e, "patch", { body_md: "New body" }));
    expect(r.status).toBe("applied");
    expect((f.get(e.id) as any).title).toBe("New title");
  });
  it("preserves both versions of a same-field text conflict", () => {
    const f = fixture();
    const e = f.add("Title");
    f.apply(op(e, "patch", { title: "First edit" }));
    const r = f.apply(op(e, "patch", { title: "Second edit" }));
    expect(r.status).toBe("conflict");
    expect(r.fields).toContain("title");
    expect((r.changes[0] as any).title).toBe("First edit");
  });
  it("rejects direct protected field overwrites", () => {
    const f = fixture();
    const e = f.add("Title");
    expect(f.apply(op(e, "patch", { status: "done" })).status).toBe("rejected");
    expect(f.apply(op(e, "patch", { version: 999 })).status).toBe("rejected");
  });
});
const rule = (
  tz = "America/Denver",
  frequency: Recurrence["frequency"] = "daily",
): Recurrence => ({
  frequency,
  interval: 1,
  timezone: tz,
  active: true,
  next_at: null,
  last_completed_at: null,
});
describe("recurrence", () => {
  it("preserves wall-clock time across spring DST", () => {
    const next = nextOccurrence(
      rule(),
      "2026-03-07T16:00:00Z",
      "2026-03-07T17:00:00Z",
    );
    expect(DateTime.fromISO(next).setZone("America/Denver").hour).toBe(9);
    expect(next).toBe("2026-03-08T15:00:00.000Z");
  });
  it("preserves wall-clock time across fall DST", () => {
    const next = nextOccurrence(
      rule(),
      "2026-10-31T15:00:00Z",
      "2026-10-31T16:00:00Z",
    );
    expect(next).toBe("2026-11-01T16:00:00.000Z");
  });
  it("skips 30 missed days without a backlog", () => {
    const next = nextOccurrence(
      rule("UTC"),
      "2026-09-01T09:00:00Z",
      "2026-10-01T12:00:00Z",
    );
    expect(next).toBe("2026-10-02T09:00:00.000Z");
  });
  it("handles weekly and monthly intervals", () => {
    expect(
      nextOccurrence(
        rule("UTC", "weekly"),
        "2026-09-01T09:00:00Z",
        "2026-10-01T12:00:00Z",
      ),
    ).toBe("2026-10-06T09:00:00.000Z");
    expect(
      nextOccurrence(
        rule("UTC", "monthly"),
        "2026-01-31T09:00:00Z",
        "2026-02-01T00:00:00Z",
      ),
    ).toBe("2026-02-28T09:00:00.000Z");
  });
  it("uses one persistent item through complete, reopen and complete", () => {
    const f = fixture();
    const e = f.add("Daily", { recurrence: rule("UTC") });
    f.apply(op(e, "complete"));
    const after = f.entities.length;
    f.apply(op(f.get(e.id), "reopen"));
    f.apply(op(f.get(e.id), "complete"));
    expect(f.entities).toHaveLength(after);
    expect((f.get(e.id) as any).recurrence.next_at).toBe(
      "2026-10-15T12:00:00.000Z",
    );
  });
  it("skip advances a future occurrence", () => {
    expect(
      nextOccurrence(
        rule("UTC"),
        "2026-10-20T09:00:00Z",
        "2026-10-14T09:00:00Z",
      ),
    ).toBe("2026-10-21T09:00:00.000Z");
  });
  it("paused rules do not schedule another occurrence", () => {
    const f = fixture();
    const e = f.add("Paused", { recurrence: { ...rule(), active: false } });
    f.apply(op(e, "complete"));
    expect((f.get(e.id) as any).status).toBe("done");
  });
});

it("uses the local day for UTC completions after evening in Denver", () => {
  expect(calendarDate("2026-10-15T03:00:00Z", "America/Denver")).toBe(
    "2026-10-14",
  );
  expect(calendarDate("2026-10-15", "America/Denver")).toBe("2026-10-15");
});
