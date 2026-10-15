import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { resolve } from "node:path";
const root = process.env.DATA_DIR || resolve("data");
const target = resolve(root, "backups");
mkdirSync(target, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(resolve(root, "listflow.sqlite"));
const dest = resolve(
  target,
  "listflow-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sqlite",
);
db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
db.close();
const files = readdirSync(target)
  .filter((x) => x.endsWith(".sqlite"))
  .sort()
  .reverse();
for (const file of files.slice(14)) unlinkSync(resolve(target, file));
console.log("Recovery snapshot created; keeping the latest 14 snapshots.");
