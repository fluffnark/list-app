import { describe, it, expect } from "vitest";
import { Store } from "../server/store";
import { seal, unseal } from "../server/sheets";
import { callAgent } from "../server/agents";
import { newItem, uuid, type Operation } from "../shared/model";
const make = (title = "Task"): Operation => {
  const e = newItem(title);
  return {
    id: uuid(),
    actor_id: "claimed actor",
    device_id: "one",
    entity_id: e.id,
    base_version: 0,
    operation_type: "create",
    patch: e,
    client_created_at: new Date().toISOString(),
  };
};
describe("transactional ledger", () => {
  it("applies retries once and allocates monotonically increasing sequences", () => {
    const s = new Store(":memory:");
    const op = make();
    const first = s.apply(op, "owner");
    expect(s.apply(op, "owner")).toEqual(first);
    expect(s.cursor()).toBe(1);
    expect(s.entities()).toHaveLength(3);
    expect(s.apply(make("Next"), "owner").sequence).toBe(2);
    s.db.close();
  });
  it("attributes actor on the server and exposes ordered deltas", () => {
    const s = new Store(":memory:");
    const op = make();
    s.apply(op, "verified actor");
    expect(s.changes(0)[0].actor).toBe("verified actor");
    expect(
      (s.entities().find((x) => x.id === op.entity_id) as any).actor_id,
    ).toBe("verified actor");
    s.db.close();
  });
  it("records rejected edits without mutating entities", () => {
    const s = new Store(":memory:");
    const op = make();
    op.patch.list_id = uuid();
    expect(s.apply(op, "owner").status).toBe("rejected");
    expect(s.entities()).toHaveLength(2);
    s.db.close();
  });
});
describe("assistant boundaries", () => {
  it("denies mutation without write scope", () => {
    const s = new Store(":memory:");
    expect(() =>
      callAgent(
        s,
        "create_item",
        { title: "Forbidden", idempotency_key: uuid() },
        "agent",
        false,
      ),
    ).toThrow(/write access/);
    expect(s.entities()).toHaveLength(2);
    s.db.close();
  });
  it("drafts a plan without modifying commitments", () => {
    const s = new Store(":memory:");
    s.apply(make(), "owner");
    const before = JSON.stringify(s.entities());
    expect(callAgent(s, "draft_daily_plan", {}, "agent", false)).toMatchObject({
      applied: false,
      status: "proposed",
    });
    expect(JSON.stringify(s.entities())).toBe(before);
    s.db.close();
  });
  it("creates a reviewable proposal without applying it", () => {
    const s = new Store(":memory:");
    const result = callAgent(
      s,
      "propose_bulk_change",
      { operations: [make()] },
      "agent",
      true,
    ) as any;
    expect(result.status).toBe("pending");
    expect(s.entities()).toHaveLength(2);
    s.db.close();
  });
  it("assistant create retries are idempotent", () => {
    const s = new Store(":memory:");
    const args = { title: "Retry", idempotency_key: uuid() };
    const a = callAgent(s, "create_item", args, "agent", true);
    expect(callAgent(s, "create_item", args, "agent", true)).toEqual(a);
    expect(s.entities()).toHaveLength(3);
    s.db.close();
  });
});
it("encrypts refresh tokens and rejects a different key", () => {
  const blob = seal("refresh-token-secret", "key-one");
  expect(blob).not.toContain("refresh-token-secret");
  expect(unseal(blob, "key-one")).toBe("refresh-token-secret");
  expect(() => unseal(blob, "key-two")).toThrow();
});

it("rolls back an interrupted SQLite write after a real SIGKILL", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "listflow-crash-"));
  const path = join(dir, "test.sqlite");
  try {
    const before = new Store(path);
    before.apply(make("Survives crash"), "owner");
    const cursor = before.cursor();
    before.db.close();
    const child = spawnSync(process.execPath, [
      "-e",
      `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');db.prepare('INSERT INTO entities VALUES (?,?)').run('uncommitted','{}');process.kill(process.pid,'SIGKILL');`,
      path,
    ]);
    expect(child.signal).toBe("SIGKILL");
    const after = new Store(path);
    expect(after.entities()).toHaveLength(3);
    expect(after.cursor()).toBe(cursor);
    expect(after.entities().some((x) => x.id === "uncommitted")).toBe(false);
    after.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
