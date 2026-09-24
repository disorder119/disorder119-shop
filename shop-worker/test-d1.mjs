// Echte SQLite-Datenbank mit der D1-Oberflaeche fuer Tests: prepare/bind/
// first/all/run und batch. So laufen die Tests gegen das echte SQL der
// Migrationen samt Triggern, nicht gegen einen Nachbau.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));

// Alle Migrationen in Nummernreihenfolge, wie in scripts/test_d1_migrations.py.
export function allMigrations() {
  return [
    "schema.sql",
    ...fs.readdirSync(path.join(here, "migrations"))
      .filter(name => /^\d{4}_.+\.sql$/.test(name))
      .sort()
      .map(name => `migrations/${name}`),
  ];
}

// `files` relativ zu shop-worker/, z. B. "migrations/0014_admin_passkeys.sql".
export function sqliteD1(files = []) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of files) {
    db.exec(fs.readFileSync(path.join(here, name), "utf8"));
  }
  const clean = args => args.map(value => (value === undefined ? null : value));
  const statement = (sql, args) => ({
    async first() { return db.prepare(sql).get(...clean(args)) ?? null; },
    async all() { return { results: db.prepare(sql).all(...clean(args)) }; },
    async run() {
      const result = db.prepare(sql).run(...clean(args));
      return { meta: { changes: Number(result.changes) } };
    },
    execute() { return db.prepare(sql).run(...clean(args)); },
  });
  return {
    prepare(sql) {
      return { ...statement(sql, []), bind: (...args) => statement(sql, args) };
    },
    async batch(list) {
      db.exec("BEGIN");
      try {
        const results = list.map(item => ({ meta: { changes: Number(item.execute().changes) } }));
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    raw: db,
  };
}
