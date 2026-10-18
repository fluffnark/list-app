import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import type { Store } from "./store";
export function seal(value: string, secret: string) {
  const iv = randomBytes(12);
  const c = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret).digest(),
    iv,
  );
  return JSON.stringify({
    iv: iv.toString("base64"),
    data: Buffer.concat([c.update(value), c.final()]).toString("base64"),
    tag: c.getAuthTag().toString("base64"),
  });
}
export function unseal(value: string, secret: string) {
  const v = JSON.parse(value);
  const c = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret).digest(),
    Buffer.from(v.iv, "base64"),
  );
  c.setAuthTag(Buffer.from(v.tag, "base64"));
  return Buffer.concat([
    c.update(Buffer.from(v.data, "base64")),
    c.final(),
  ]).toString();
}
export type GoogleCredentials = {
  clientId: string;
  clientSecret: string;
  ownerEmail: string;
};
export function googleCredentials(
  store: Store,
  secret: string,
): GoogleCredentials {
  const saved = store.setting("google_client");
  if (saved) return JSON.parse(unseal(saved, secret));
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    ownerEmail: process.env.OWNER_EMAIL || "",
  };
}
export function saveGoogleCredentials(
  store: Store,
  secret: string,
  input: unknown,
) {
  const v = input as Partial<GoogleCredentials> | null;
  if (
    !v ||
    typeof v.clientId !== "string" ||
    !/^[a-zA-Z0-9_.-]+\.apps\.googleusercontent\.com$/.test(
      v.clientId.trim(),
    ) ||
    typeof v.clientSecret !== "string" ||
    !v.clientSecret.trim() ||
    v.clientSecret.length > 512 ||
    typeof v.ownerEmail !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.ownerEmail.trim())
  )
    throw new Error(
      "Enter a Google web client ID, client secret, and your full Google email address.",
    );
  const next = {
    clientId: v.clientId.trim(),
    clientSecret: v.clientSecret.trim(),
    ownerEmail: v.ownerEmail.trim().toLowerCase(),
  };
  const old = googleCredentials(store, secret);
  // Keep existing calendar selections, but never reuse a token with another client/account.
  store.db.exec("BEGIN IMMEDIATE");
  try {
    store.set("google_client", seal(JSON.stringify(next), secret));
    if (
      old.clientId !== next.clientId ||
      old.clientSecret !== next.clientSecret ||
      old.ownerEmail.toLowerCase() !== next.ownerEmail
    ) {
      store.db
        .prepare(
          "DELETE FROM settings WHERE key IN ('google_refresh', 'google_scopes')",
        )
        .run();
    }
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
const tabs = [
  "Items",
  "Lists",
  "Categories",
  "Recurrences",
  "OperationLog",
  "Settings",
  "Schema",
];
const canonical = (values: unknown[][][]) =>
  JSON.stringify(
    values.map((rows) =>
      rows
        .map((row) => {
          const cells = row.map((x) => String(x ?? ""));
          while (cells.at(-1) === "") cells.pop();
          return cells;
        })
        .filter((row) => row.length),
    ),
  );
export class SheetsProjection {
  running = false;
  nextTry = 0;
  failures = 0;
  lastCheck = 0;
  constructor(
    private store: Store,
    private secret: string,
  ) {}
  async token() {
    const encrypted = this.store.setting("google_refresh");
    if (!encrypted) throw new Error("Connect Google first");
    const credentials = googleCredentials(this.store, this.secret);
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "refresh_token",
        refresh_token: unseal(encrypted, this.secret),
      }),
    });
    const data = (await r.json()) as any;
    if (!r.ok || !data.access_token)
      throw new Error("Google authorization needs reconnecting");
    return data.access_token as string;
  }
  async request(path: string, method: string, body: unknown, token: string) {
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!r.ok)
      throw new Error(`Sheets request failed (${r.status}); retry queued`);
    return r.json() as Promise<any>;
  }
  async create() {
    const token = await this.token();
    const d = await this.request(
      "",
      "POST",
      {
        properties: { title: "ListFlow" },
        sheets: tabs.map((title) => ({
          properties: {
            title,
            gridProperties: { rowCount: 12000, columnCount: 32 },
          },
        })),
      },
      token,
    );
    this.store.set("spreadsheet_id", d.spreadsheetId);
    this.store.set("sheets_sequence", "-1");
    return d.spreadsheetId as string;
  }
  async sync(force = false) {
    if (this.running || Date.now() < this.nextTry) return;
    const id = this.store.setting("spreadsheet_id");
    if (!id) return;
    if (
      !force &&
      Number(this.store.setting("sheets_sequence")) === this.store.cursor() &&
      Date.now() - this.lastCheck < 600000
    )
      return;
    this.running = true;
    try {
      const sequence = this.store.cursor();
      const token = await this.token();
      const entities = this.store.entities();
      const tab = (kind: string, headers: string[]) => {
        const rows = entities.filter((x) => x.kind === kind);
        return [
          headers,
          ...rows.map((x) =>
            headers.map((h) => {
              const value = (x as any)[h];
              return value === null || value === undefined
                ? ""
                : typeof value === "object"
                  ? JSON.stringify(value)
                  : value;
            }),
          ),
        ];
      };
      const itemHeaders = [
        "id",
        "title",
        "type",
        "body_md",
        "parent_item_id",
        "list_id",
        "category_id",
        "status",
        "priority",
        "due_at",
        "scheduled_for",
        "completed_at",
        "sort_key",
        "created_at",
        "updated_at",
        "deleted_at",
        "version",
        "actor_id",
        "container",
        "metadata_json",
      ];
      // The full ledger stays in SQLite; bound the readable history projection before Sheets limits.
      const log = (
        this.store.db
          .prepare(
            "SELECT sequence,id,actor,operation,committed_at FROM (SELECT * FROM operations ORDER BY sequence DESC LIMIT 10000) ORDER BY sequence",
          )
          .all() as any[]
      ).map((x) => [x.sequence, x.id, x.actor, x.operation, x.committed_at]);
      const values = [
        { range: "Items!A1", values: tab("item", itemHeaders) },
        {
          range: "Lists!A1",
          values: tab("list", [
            "id",
            "name",
            "category_id",
            "sort_key",
            "pinned",
            "archived_at",
            "version",
            "updated_at",
          ]),
        },
        {
          range: "Categories!A1",
          values: tab("category", [
            "id",
            "name",
            "sort_key",
            "archived_at",
            "version",
            "updated_at",
          ]),
        },
        {
          range: "Recurrences!A1",
          values: [
            ["item_id", "rule_json"],
            ...entities
              .filter((x) => x.kind === "item" && x.recurrence)
              .map((x) => [x.id, JSON.stringify((x as any).recurrence)]),
          ],
        },
        {
          range: "OperationLog!A1",
          values: [
            ["sequence", "id", "actor", "operation", "committed_at"],
            ...log,
          ],
        },
        {
          range: "Settings!A1",
          values: [
            ["key", "value"],
            ["projection_sequence", sequence],
            [
              "projected_operations",
              "Latest 10000; full history in server export/backups",
            ],
            ["mode", "Read-only projection; edit through ListFlow"],
          ],
        },
        {
          range: "Schema!A1",
          values: [
            ["version", "updated_at"],
            [1, new Date().toISOString()],
          ],
        },
      ];
      if (values.some((x) => x.values.length > 11999))
        throw new Error(
          "Sheet capacity reached. Export/archive old data before rebuilding. The server ledger remains safe.",
        );
      const ranges = new URLSearchParams();
      for (const name of tabs) ranges.append("ranges", name + "!A:AF");
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${ranges}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok)
        throw new Error(`Cannot verify Sheets projection (${response.status})`);
      const prior = (await response.json()) as any;
      const priorValues =
        prior.valueRanges?.map((v: any) => v.values ?? []) ??
        tabs.map(() => []);
      const hash = createHash("sha256")
        .update(canonical(priorValues))
        .digest("hex");
      const expected = this.store.setting("sheets_hash");
      if (expected && hash !== expected && !force)
        throw new Error(
          "External Sheet edits detected. Export the sheet, then explicitly rebuild projection.",
        );
      this.lastCheck = Date.now();
      if (
        !force &&
        expected &&
        Number(this.store.setting("sheets_sequence")) === sequence
      ) {
        this.store.set("sheets_error", "");
        this.failures = 0;
        return;
      }
      // One batchUpdate replaces values and clears stale tails atomically within the spreadsheet.
      const requests = values.map((v, index) => ({
        updateCells: {
          range: { sheetId: index },
          rows: v.values.map((row) => ({
            values: row.map((value) => ({
              userEnteredValue:
                typeof value === "number"
                  ? { numberValue: value }
                  : typeof value === "boolean"
                    ? { boolValue: value }
                    : { stringValue: String(value ?? "") },
            })),
          })),
          fields: "userEnteredValue",
        },
      }));
      // Resolve stable sheet IDs; never assume tab positions identify entities or survive manual changes.
      const metadata = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!metadata.ok) throw new Error("Cannot read sheet schema");
      const schema = (await metadata.json()) as any;
      for (let index = 0; index < tabs.length; index++) {
        const sheet = schema.sheets?.find(
          (x: any) => x.properties.title === tabs[index],
        );
        if (!sheet) throw new Error("Sheet schema is missing " + tabs[index]);
        requests[index].updateCells.range.sheetId = sheet.properties.sheetId;
      }
      await this.request(`/${id}:batchUpdate`, "POST", { requests }, token);
      this.store.set(
        "sheets_hash",
        createHash("sha256")
          .update(canonical(values.map((x) => x.values)))
          .digest("hex"),
      );
      this.store.set("sheets_sequence", String(sequence));
      this.store.set("sheets_error", "");
      this.failures = 0;
    } catch (e) {
      this.failures++;
      this.nextTry =
        Date.now() +
        Math.min(3600000, 1000 * 2 ** Math.min(this.failures, 11)) *
          (0.7 + Math.random() * 0.6);
      this.store.set(
        "sheets_error",
        e instanceof Error ? e.message : "Sheets sync failed",
      );
    } finally {
      this.running = false;
    }
  }
}
