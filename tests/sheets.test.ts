import { it, expect, vi, afterEach } from "vitest";
import { Store } from "../server/store";
import { SheetsProjection, seal } from "../server/sheets";
import { newItem, uuid } from "../shared/model";
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const store = new Store(":memory:");
  store.set("google_refresh", seal("refresh", "secret"));
  store.set("spreadsheet_id", "test-sheet");
  store.set("sheets_sequence", "-1");
  const projection = new SheetsProjection(store, "secret");
  return { store, projection };
}
function add(store: Store) {
  const e = newItem("Projection test");
  store.apply(
    {
      id: uuid(),
      entity_id: e.id,
      actor_id: "owner",
      device_id: "test",
      base_version: 0,
      operation_type: "create",
      patch: e,
      client_created_at: new Date().toISOString(),
    },
    "owner",
  );
}
it("projects readable tabs and never exports refresh credentials", async () => {
  const { store, projection } = fixture();
  add(store);
  const writes: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, opts: any) => {
      if (url.includes("oauth2"))
        return Response.json({ access_token: "access" });
      if (url.includes("?fields="))
        return Response.json({
          sheets: [
            "Items",
            "Lists",
            "Categories",
            "Recurrences",
            "OperationLog",
            "Settings",
            "Schema",
          ].map((title, sheetId) => ({ properties: { title, sheetId } })),
        });
      if (!opts?.method) return Response.json({ valueRanges: [] });
      if (opts.method === "POST") {
        writes.push(JSON.parse(opts.body));
        return Response.json({});
      }
      return Response.json({ values: [] });
    }),
  );
  await projection.sync();
  expect(store.setting("sheets_error")).toBe("");
  const data = writes.find((x) => x.requests)?.requests;
  expect(data).toHaveLength(7);
  expect(
    data[0].updateCells.rows[0].values[1].userEnteredValue.stringValue,
  ).toBe("title");
  expect(JSON.stringify(data)).not.toContain("refresh");
  store.db.close();
});
it("backs off on quota errors without losing ledger data", async () => {
  const { store, projection } = fixture();
  add(store);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, opts: any) => {
      if (url.includes("oauth2"))
        return Response.json({ access_token: "access" });
      if (url.includes("?fields="))
        return Response.json({
          sheets: [
            "Items",
            "Lists",
            "Categories",
            "Recurrences",
            "OperationLog",
            "Settings",
            "Schema",
          ].map((title, sheetId) => ({ properties: { title, sheetId } })),
        });
      if (opts?.method === "POST")
        return Response.json({ error: "quota" }, { status: 429 });
      return Response.json({ values: [] });
    }),
  );
  await projection.sync();
  expect(store.setting("sheets_error")).toContain("429");
  expect(projection.nextTry).toBeGreaterThan(Date.now());
  expect(store.cursor()).toBe(1);
  expect(store.setting("sheets_sequence")).toBe("-1");
  store.db.close();
});
it("detects external edits and preserves the authoritative ledger", async () => {
  const { store, projection } = fixture();
  store.set("sheets_hash", "expected-hash");
  add(store);
  const mock = vi.fn(async (url: string) =>
    url.includes("oauth2")
      ? Response.json({ access_token: "access" })
      : Response.json({ valueRanges: [{ values: [["tampered row"]] }] }),
  );
  vi.stubGlobal("fetch", mock);
  await projection.sync();
  expect(store.setting("sheets_error")).toContain(
    "External Sheet edits detected",
  );
  expect(mock).toHaveBeenCalledTimes(2);
  expect(store.cursor()).toBe(1);
  store.db.close();
});
