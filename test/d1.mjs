// A D1 shim over node:sqlite, enough to run the Worker's queries for real.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

/** schema.sql, which is what a new database is. */
export const readSchema = () => readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

class Stmt {
  constructor(db, sql, binds = []) { this.db = db; this.sql = sql; this.binds = binds; }
  bind(...args) { return new Stmt(this.db, this.sql, args.map(v => v === undefined ? null : v)); }
  _run() {
    const s = this.db.prepare(this.sql);
    return s.run(...this.binds);
  }
  async first(col) {
    const s = this.db.prepare(this.sql);
    const row = s.get(...this.binds);
    if (!row) return null;
    return col ? row[col] : row;
  }
  async all() {
    const s = this.db.prepare(this.sql);
    return { results: s.all(...this.binds), success: true };
  }
  async run() {
    const r = this._run();
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function makeDb(schemaSql) {
  const db = new DatabaseSync(':memory:');
  if (schemaSql) db.exec(schemaSql);
  return {
    _raw: db,
    prepare: sql => new Stmt(db, sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(select)/i.test(s.sql)) out.push(await s.all());
          else out.push(await s.run());
        }
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
