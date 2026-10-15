import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyOperation } from "../shared/engine";
import {
  initialEntities,
  type Entity,
  type Operation,
  type OpResult,
} from "../shared/model";
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS operations(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,actor TEXT NOT NULL,operation TEXT NOT NULL,result TEXT NOT NULL,committed_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS credentials(hash TEXT PRIMARY KEY,kind TEXT NOT NULL,scopes TEXT NOT NULL,expires INTEGER NOT NULL,label TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER NOT NULL);`);
    if (!this.entities().length)
      for (const e of initialEntities())
        this.db
          .prepare("INSERT INTO entities VALUES (?,?)")
          .run(e.id, JSON.stringify(e));
  }
  entities(): Entity[] {
    return (
      this.db.prepare("SELECT value FROM entities").all() as { value: string }[]
    ).map((x) => JSON.parse(x.value));
  }
  apply(op: Operation, actor: string): OpResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare("SELECT result FROM operations WHERE id=?")
        .get(op.id) as { result: string } | undefined;
      if (existing) {
        this.db.exec("COMMIT");
        return JSON.parse(existing.result);
      }
      const result = applyOperation(this.entities(), {
        ...op,
        actor_id: actor,
      });
      if (result.status === "applied")
        for (const e of result.changes)
          this.db
            .prepare(
              "INSERT INTO entities VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
            )
            .run(e.id, JSON.stringify(e));
      const insert = this.db
        .prepare(
          "INSERT INTO operations(id,actor,operation,result,committed_at) VALUES (?,?,?,?,?)",
        )
        .run(
          op.id,
          actor,
          JSON.stringify(op),
          JSON.stringify(result),
          new Date().toISOString(),
        );
      result.sequence = Number(insert.lastInsertRowid);
      this.db
        .prepare("UPDATE operations SET result=? WHERE id=?")
        .run(JSON.stringify(result), op.id);
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  cursor() {
    return Number(
      (
        this.db
          .prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM operations")
          .get() as { n: number }
      ).n,
    );
  }
  changes(cursor: number) {
    return (
      this.db
        .prepare(
          "SELECT sequence,result,actor,committed_at FROM operations WHERE sequence>? ORDER BY sequence LIMIT 500",
        )
        .all(cursor) as {
        sequence: number;
        result: string;
        actor: string;
        committed_at: string;
      }[]
    ).map((x) => ({ ...x, result: JSON.parse(x.result) as OpResult }));
  }
  setting(key: string) {
    return (
      this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as
        { value: string } | undefined
    )?.value;
  }
  set(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
}
